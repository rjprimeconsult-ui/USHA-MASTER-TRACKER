'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Sparkles, Loader2, ArrowRight, Trash2 } from 'lucide-react';
import { NAV_TABS } from '@/lib/constants';

const STORAGE_KEY = 'prim_chat_history_v1';
const SUGGESTED_OPENERS = [
  'How do I import my book of business?',
  'Why is my Earned KPI different from my statement?',
  'How do I track a new prospect?',
  "What's True CPA and how is it calculated?",
];

const navIdToLabel = Object.fromEntries(NAV_TABS.map(t => [t.id, t.label]));

// Tiny markdown subset — enough for chat bubbles. Avoids the bundle hit of
// react-markdown for this small surface. Supports:
//   **bold**, *italic*, `code`, [text](url), - bullet lists, paragraph breaks
function renderMessageContent(text, onCta) {
  // Strip [Open: <view> | <label>] CTAs out of the body — they're rendered separately
  const ctas = [];
  const cleaned = text.replace(/\[Open:\s*([\w-]+)\s*\|\s*([^\]]+)\]/gi, (m, view, label) => {
    ctas.push({ view: view.trim(), label: label.trim() });
    return '';
  });

  const blocks = cleaned.split(/\n\n+/).map((block, bi) => {
    // Bullet list
    if (/^\s*[-•]\s+/m.test(block) && block.trim().split('\n').every(l => /^\s*[-•]\s+/.test(l) || !l.trim())) {
      const items = block.trim().split('\n').filter(Boolean);
      return (
        <ul key={bi} className="list-disc pl-5 space-y-0.5 my-1">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item.replace(/^\s*[-•]\s+/, ''))}</li>
          ))}
        </ul>
      );
    }
    // Plain paragraph
    return <p key={bi} className="my-1 first:mt-0 last:mb-0">{renderInline(block.trim())}</p>;
  });

  return (
    <div>
      {blocks}
      {ctas.length > 0 && (
        <div className="flex flex-col items-start gap-1.5 mt-2">
          {ctas.map((c, i) => (
            <button
              key={i}
              onClick={() => onCta(c.view)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              {c.label || `Open ${navIdToLabel[c.view] || c.view}`} <ArrowRight size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function renderInline(s) {
  if (!s) return s;
  // Process in passes — split into tokens and react elements
  const out = [];
  let i = 0;
  let key = 0;
  // Single pass with regex for combined inline patterns
  const re = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > i) out.push(s.slice(i, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={key++} className="bg-slate-100 text-slate-800 rounded px-1 py-0.5 text-[0.85em] font-mono">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('[')) {
      const linkM = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkM) {
        out.push(<a key={key++} href={linkM[2]} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{linkM[1]}</a>);
      } else {
        out.push(tok);
      }
    }
    i = m.index + tok.length;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
}

export default function AgentChatbot({ onNavigate, buildContext, openSignal }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // [{ role, content }]
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // External "open" trigger — bumped by the onboarding walkthrough so
  // the assistant can pop on cue. Each increment of openSignal opens
  // the panel; ignored when component first mounts (signal === 0).
  useEffect(() => {
    if (openSignal && openSignal > 0) setOpen(true);
  }, [openSignal]);

  // Load chat history
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {}
  }, []);

  // Persist
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Auto-scroll on new content
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const sendMessage = useCallback(async (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed || streaming) return;

    const userMsg = { role: 'user', content: trimmed };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setStreaming(true);
    setError('');

    // Append empty assistant message that gets filled by stream
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    let userContext = {};
    try {
      userContext = (typeof buildContext === 'function') ? (buildContext() || {}) : {};
    } catch { userContext = {}; }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newHistory, userContext }),
      });
      if (!res.ok) {
        let msg;
        try { msg = (await res.json()).error; } catch { msg = `HTTP ${res.status}`; }
        throw new Error(msg);
      }
      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith('data:')) continue;
          let payload;
          try { payload = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (payload.type === 'text') {
            assembled += payload.text;
            // Update the last message (assistant) with current accumulated text
            setMessages(prev => {
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', content: assembled };
              return next;
            });
          } else if (payload.type === 'error') {
            throw new Error(payload.error);
          }
          // 'done' events just signal end-of-stream; no UI change needed
        }
      }
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg);
      // Replace the empty assistant placeholder with an error message
      setMessages(prev => {
        const next = [...prev];
        if (next[next.length - 1]?.role === 'assistant' && !next[next.length - 1]?.content) {
          next[next.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
        }
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, buildContext]);

  const onCta = (view) => {
    if (onNavigate && view) onNavigate(view);
    setOpen(false);
  };

  const clearChat = () => {
    if (!messages.length) return;
    if (!confirm('Clear chat history?')) return;
    setMessages([]);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <>
      {/* Floating launcher — bottom right, BELOW the bell icon */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-20 right-4 z-30 bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-full shadow-lg w-12 h-12 flex items-center justify-center hover:shadow-xl hover:scale-105 transition group"
        title="Ask the assistant"
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
        {!open && messages.length === 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 ring-2 ring-white">AI</span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-36 right-4 z-30 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-10rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <div>
                <div className="font-bold text-sm leading-tight">PRIM Assistant</div>
                <div className="text-[11px] opacity-80">Ask about features, numbers, or workflows</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={clearChat} className="text-white/80 hover:text-white p-1" title="Clear chat">
                  <Trash2 size={14} />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white p-1" title="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50">
            {messages.length === 0 && (
              <div className="text-center pt-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center mx-auto mb-3">
                  <Sparkles size={20} className="text-indigo-600" />
                </div>
                <p className="text-sm font-semibold text-slate-700">Hi! What can I help you with?</p>
                <p className="text-xs text-slate-500 mt-1 mb-4">I know how the app works, can read your data, and walk through any workflow.</p>
                <div className="space-y-1.5 text-left">
                  {SUGGESTED_OPENERS.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(q)}
                      className="w-full text-left bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 rounded-lg px-3 py-2 text-xs text-slate-700 transition"
                    >
                      <span className="text-indigo-500 mr-2">→</span>{q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'
                }`}>
                  {m.content
                    ? renderMessageContent(m.content, onCta)
                    : <Loader2 size={14} className="animate-spin opacity-50" />}
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t border-slate-200 p-2.5 bg-white flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={streaming ? 'Streaming response...' : 'Type a question...'}
              disabled={streaming}
              className="flex-1 bg-slate-100 border border-slate-200 rounded-full px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:from-slate-300 disabled:to-slate-300 text-white rounded-full w-9 h-9 flex items-center justify-center flex-shrink-0 transition"
            >
              {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
