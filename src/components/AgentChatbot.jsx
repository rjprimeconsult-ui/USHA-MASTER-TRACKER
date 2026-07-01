'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageCircle, X, Send, Sparkles, Loader2, ArrowRight, Trash2,
  ThumbsUp, ThumbsDown, Paperclip, Mic, MicOff, Mail, Languages, Wrench, Zap,
} from 'lucide-react';
import { NAV_TABS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { supabase, supabaseConfigured } from '@/lib/supabase';

const HISTORY_KEY = 'chat_history_v1';   // cloud-synced via storage adapter
const LANG_KEY = 'chat_language_v1';     // cloud-synced
const MAX_HISTORY = 100;

const SUGGESTED_OPENERS_EN = [
  'How do I import my book of business?',
  'Why is my Earned KPI different from my statement?',
  'Show me my pending deals from last 30 days',
  'How much did I spend on Books last month?',
];
const SUGGESTED_OPENERS_ES = [
  '¿Cómo importo mi libro de negocios?',
  '¿Por qué mi KPI Earned no coincide con mi estado?',
  'Muéstrame mis tratos pendientes de los últimos 30 días',
  '¿Cuánto gasté en Books el mes pasado?',
];

const TXT = {
  en: {
    title: 'PRIM Assistant',
    subtitle: 'Ask about features, numbers, or workflows',
    helloHeader: 'Hi! What can I help you with?',
    helloBody: 'I can read your data, answer specific questions, and walk you through any workflow.',
    inputPlaceholder: 'Type a question...',
    streamingPlaceholder: 'Streaming response...',
    clearConfirm: 'Clear chat history?',
    consulting: 'Consulting your data',
    feedbackThanks: 'Thanks for the feedback!',
    feedbackError: 'Could not save feedback.',
    escalateBtn: 'Email Juan with this thread',
    fileTooLarge: 'File too large (max 4MB).',
    tooManyFiles: 'Up to 5 files at a time.',
    voiceUnsupported: 'Voice input not supported in this browser.',
    voiceListening: 'Listening...',
    proactiveLabel: 'Heads up:',
  },
  es: {
    title: 'Asistente PRIM',
    subtitle: 'Pregunta sobre funciones, números o flujos',
    helloHeader: '¡Hola! ¿En qué te ayudo?',
    helloBody: 'Puedo leer tus datos, responder preguntas específicas y guiarte por cualquier flujo.',
    inputPlaceholder: 'Escribe una pregunta...',
    streamingPlaceholder: 'Generando respuesta...',
    clearConfirm: '¿Borrar historial del chat?',
    consulting: 'Consultando tus datos',
    feedbackThanks: '¡Gracias por el feedback!',
    feedbackError: 'No se pudo guardar el feedback.',
    escalateBtn: 'Enviar este hilo a Juan por email',
    fileTooLarge: 'Archivo muy grande (máx 4MB).',
    tooManyFiles: 'Máximo 5 archivos a la vez.',
    voiceUnsupported: 'La voz no está disponible en este navegador.',
    voiceListening: 'Escuchando...',
    proactiveLabel: 'Aviso:',
  },
};

const navIdToLabel = Object.fromEntries(NAV_TABS.map(t => [t.id, t.label]));

// Tiny markdown subset — bold/italic/code/links/bullets, plus our two CTA
// sentinels [Open: <view> | <label>] and [Action: <action> | <label>].
function renderMessageContent(text, onCta, onAction) {
  const ctas = [];
  const actions = [];
  let cleaned = text.replace(/\[Open:\s*([\w-]+)\s*\|\s*([^\]]+)\]/gi, (m, view, label) => {
    ctas.push({ view: view.trim(), label: label.trim() });
    return '';
  });
  cleaned = cleaned.replace(/\[Action:\s*([\w-]+)\s*\|\s*([^\]]+)\]/gi, (m, action, label) => {
    actions.push({ action: action.trim(), label: label.trim() });
    return '';
  });

  const blocks = cleaned.split(/\n\n+/).map((block, bi) => {
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
    return <p key={bi} className="my-1 first:mt-0 last:mb-0">{renderInline(block.trim())}</p>;
  });

  return (
    <div>
      {blocks}
      {(ctas.length > 0 || actions.length > 0) && (
        <div className="flex flex-col items-start gap-1.5 mt-2">
          {ctas.map((c, i) => (
            <button
              key={`o${i}`}
              onClick={() => onCta(c.view)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              {c.label || `Open ${navIdToLabel[c.view] || c.view}`} <ArrowRight size={12} />
            </button>
          ))}
          {actions.map((a, i) => (
            <button
              key={`a${i}`}
              onClick={() => onAction(a.action)}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Zap size={12} /> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function renderInline(s) {
  if (!s) return s;
  const out = [];
  let i = 0;
  let key = 0;
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
      // Only render an anchor for safe schemes — never javascript:/data: (the
      // URL is model-influenced, and React does not strip dangerous hrefs).
      if (linkM && /^(https?:|mailto:)/i.test(linkM[2].trim())) {
        out.push(<a key={key++} href={linkM[2].trim()} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{linkM[1]}</a>);
      } else if (linkM) {
        out.push(linkM[1]);
      } else {
        out.push(tok);
      }
    }
    i = m.index + tok.length;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
}

// ---------- File → base64 helper for attachments ----------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = String(reader.result || '');
      const b64 = str.includes(',') ? str.split(',')[1] : str;
      resolve(b64);
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

// Pick a useful proactive starter based on the user's current state.
function proactiveStarter(ctx, lang) {
  if (!ctx) return null;
  const t = (en, es) => (lang === 'es' ? es : en);
  // Trial about to expire
  if (ctx.subscription && ctx.subscription.trialDaysLeft != null && ctx.subscription.trialDaysLeft >= 0 && ctx.subscription.trialDaysLeft <= 3) {
    return t(
      `Your trial ends in ${ctx.subscription.trialDaysLeft} day(s). Want to see your subscription options?`,
      `Tu prueba termina en ${ctx.subscription.trialDaysLeft} día(s). ¿Quieres ver tus opciones de suscripción?`
    );
  }
  // Lots of pending deals
  const pending = ctx.leadsByStage?.Pending || 0;
  if (pending >= 5) {
    return t(
      `You have ${pending} pending deals. Want me to show which ones might still be missing a statement entry?`,
      `Tienes ${pending} tratos pendientes. ¿Quieres ver cuáles podrían no tener entrada de estado de cuenta aún?`
    );
  }
  // Nothing imported yet
  if ((ctx.leadsCount || 0) === 0) {
    return t(
      `Your tracker is empty. Want me to walk you through your first import?`,
      `Tu tracker está vacío. ¿Quieres que te guíe en tu primera importación?`
    );
  }
  return null;
}

export default function AgentChatbot({ onNavigate, onAction, buildContext, openSignal }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // [{ role, content, attachments?, id?, toolCalls? }]
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]); // [{ name, size, type, base64 }]
  const [language, setLanguage] = useState('en');
  const [activeTool, setActiveTool] = useState(''); // shown while a tool is running
  const [proactiveSeen, setProactiveSeen] = useState(false);
  const [feedbackById, setFeedbackById] = useState({}); // { messageId: 1 | -1 | 'pending' }
  const [voiceOn, setVoiceOn] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const ctxRef = useRef(null); // last computed userContext, for escalate + proactive

  const t = TXT[language] || TXT.en;
  const SUGGESTED_OPENERS = language === 'es' ? SUGGESTED_OPENERS_ES : SUGGESTED_OPENERS_EN;

  // ---------- External "open" trigger ----------
  // The walkthrough bumps openSignal when the chatbot should pop. Track the
  // previously-handled value in a ref so we only call setOpen when the signal
  // actually changes — keeps the rules-of-hooks "set-state-in-effect" rule
  // happy by making the effect a one-shot per signal change.
  const lastSignalRef = useRef(0);
  useEffect(() => {
    if (openSignal && openSignal !== lastSignalRef.current) {
      lastSignalRef.current = openSignal;
      setOpen(true);
    }
  }, [openSignal]);

  // ---------- Load chat + lang from cloud (fall back to localStorage) ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await storage.getItem(HISTORY_KEY);
        if (alive && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setMessages(parsed.slice(-MAX_HISTORY));
        }
      } catch {}
      try {
        const langRaw = await storage.getItem(LANG_KEY);
        if (alive && langRaw) {
          const parsed = JSON.parse(langRaw);
          if (parsed === 'en' || parsed === 'es') setLanguage(parsed);
        }
      } catch {}
      if (alive) setHistoryLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  // ---------- Persist messages (debounced via effect, cloud + LS) ----------
  useEffect(() => {
    if (!historyLoaded) return; // don't overwrite cloud with empty array on mount
    const id = setTimeout(() => {
      const trimmed = messages.slice(-MAX_HISTORY);
      storage.setItem(HISTORY_KEY, JSON.stringify(trimmed)).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [messages, historyLoaded]);

  // ---------- Persist language ----------
  useEffect(() => {
    if (!historyLoaded) return;
    storage.setItem(LANG_KEY, JSON.stringify(language)).catch(() => {});
  }, [language, historyLoaded]);

  // ---------- Auto-scroll on new content ----------
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming, activeTool]);

  // ---------- Focus input when opened ----------
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // ---------- Compute context + proactive starter when panel opens ----------
  // We snapshot ctx into a ref so escalate/sendMessage can read the most
  // recent values without re-deriving. proactiveLine is real state so we
  // don't read the ref during render.
  const [proactiveLine, setProactiveLine] = useState(null);
  useEffect(() => {
    if (!open) return;
    let ctx = {};
    try { ctx = (typeof buildContext === 'function') ? (buildContext() || {}) : {}; } catch { ctx = {}; }
    ctxRef.current = ctx;
    if (!proactiveSeen && messages.length === 0) {
      setProactiveLine(proactiveStarter(ctx, language));
    } else {
      setProactiveLine(null);
    }
  }, [open, buildContext, language, messages.length, proactiveSeen]);

  // ---------- Send a message (with optional attachments) ----------
  const sendMessage = useCallback(async (text, opts = {}) => {
    const trimmed = String(text || '').trim();
    const attachments = opts.attachments || pendingFiles;
    if ((!trimmed && attachments.length === 0) || streaming) return;

    setProactiveSeen(true);

    const msgId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const userMsg = {
      role: 'user',
      content: trimmed || '(file attached)',
      id: msgId,
      attachments: attachments.length > 0
        ? attachments.map(a => ({ name: a.name, type: a.type, size: a.size }))
        : undefined,
    };

    // History sent to the model — strip our local-only fields (id, attachments meta).
    const wireHistory = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', id: `a_${msgId}` }]);
    setInput('');
    setPendingFiles([]);
    setStreaming(true);
    setError('');
    setActiveTool('');

    // Compute context
    let userContext = ctxRef.current || {};
    try {
      userContext = (typeof buildContext === 'function') ? (buildContext() || {}) : userContext;
      ctxRef.current = userContext;
    } catch {}

    // Bearer token (enables tool use server-side)
    let bearer = null;
    try {
      if (supabaseConfigured()) {
        const { data } = await supabase.auth.getSession();
        bearer = data.session?.access_token || null;
      }
    } catch {}

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({
          messages: wireHistory,
          userContext,
          language,
          attachments: attachments.map(a => ({
            type: a.type?.startsWith('image/') ? 'image' : 'document',
            mediaType: a.type || 'application/octet-stream',
            base64: a.base64,
          })),
        }),
      });
      if (!res.ok) {
        let msg;
        try { msg = (await res.json()).error; } catch { msg = `HTTP ${res.status}`; }
        throw new Error(msg);
      }
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
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, role: 'assistant', content: assembled };
              return next;
            });
            setActiveTool(''); // clear tool indicator once text starts flowing
          } else if (payload.type === 'tool_use') {
            setActiveTool(payload.name || 'tool');
          } else if (payload.type === 'error') {
            throw new Error(payload.error);
          }
        }
      }
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg);
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content) {
          next[next.length - 1] = { ...last, role: 'assistant', content: `⚠️ ${msg}` };
        }
        return next;
      });
    } finally {
      setStreaming(false);
      setActiveTool('');
    }
  }, [messages, streaming, buildContext, pendingFiles, language]);

  const onCta = (view) => {
    if (onNavigate && view) onNavigate(view);
    setOpen(false);
  };

  const handleAction = (action) => {
    if (typeof onAction === 'function') onAction(action);
    // Some actions navigate; others open modals. Close panel either way to
    // get the chat out of the way.
    setOpen(false);
  };

  const clearChat = () => {
    if (!messages.length) return;
    if (!confirm(t.clearConfirm)) return;
    setMessages([]);
    storage.removeItem(HISTORY_KEY).catch(() => {});
    setFeedbackById({});
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  // ---------- File picker / drop ----------
  const addFiles = useCallback(async (fileList) => {
    const arr = Array.from(fileList || []);
    if (arr.length === 0) return;
    if (pendingFiles.length + arr.length > 5) {
      setError(t.tooManyFiles);
      return;
    }
    const next = [];
    for (const f of arr) {
      if (f.size > 4 * 1024 * 1024) {
        setError(t.fileTooLarge);
        continue;
      }
      try {
        const base64 = await fileToBase64(f);
        next.push({ name: f.name, size: f.size, type: f.type, base64 });
      } catch {}
    }
    if (next.length) setPendingFiles(prev => [...prev, ...next]);
  }, [pendingFiles.length, t.tooManyFiles, t.fileTooLarge]);

  const onPick = (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  // ---------- Voice input (Web Speech API) ----------
  const toggleVoice = () => {
    const SR = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) {
      setError(t.voiceUnsupported);
      return;
    }
    if (voiceOn && recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      setVoiceOn(false);
      return;
    }
    const rec = new SR();
    rec.lang = language === 'es' ? 'es-US' : 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      const text = Array.from(event.results).map(r => r[0]?.transcript || '').join(' ').trim();
      setInput(text);
    };
    rec.onerror = () => setVoiceOn(false);
    rec.onend = () => setVoiceOn(false);
    recognitionRef.current = rec;
    try { rec.start(); setVoiceOn(true); } catch { setVoiceOn(false); }
  };

  // ---------- Feedback (thumbs up / down) ----------
  const sendFeedback = useCallback(async (assistantMsg, rating) => {
    const id = assistantMsg.id;
    if (!id) return;
    setFeedbackById(prev => ({ ...prev, [id]: 'pending' }));
    try {
      let bearer = null;
      try {
        if (supabaseConfigured()) {
          const { data } = await supabase.auth.getSession();
          bearer = data.session?.access_token || null;
        }
      } catch {}
      if (!bearer) throw new Error('not signed in');

      // Find the user message immediately preceding this assistant turn.
      const idx = messages.findIndex(m => m.id === id);
      const preceding = idx > 0 ? messages.slice(0, idx).reverse().find(m => m.role === 'user') : null;

      const res = await fetch('/api/chat/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          rating,
          messageText: assistantMsg.content,
          precedingUserMessage: preceding?.content,
          currentView: ctxRef.current?.currentView,
        }),
      });
      if (!res.ok) throw new Error('save failed');
      setFeedbackById(prev => ({ ...prev, [id]: rating }));
    } catch {
      setFeedbackById(prev => ({ ...prev, [id]: undefined }));
      setError(t.feedbackError);
    }
  }, [messages, t.feedbackError]);

  // ---------- Smart escalation (mailto) ----------
  const escalate = () => {
    const last5 = messages.slice(-5).map(m =>
      `${m.role === 'user' ? '👤 You' : '🤖 PRIM'}: ${typeof m.content === 'string' ? m.content : '[attachment]'}`
    ).join('\n\n');
    const ctx = ctxRef.current || {};
    const subject = encodeURIComponent('PRIM assistant — needs help');
    const body = encodeURIComponent(
      `Hi Juan,\n\nThe in-app assistant didn't fully solve this. Here's the context:\n\n` +
      `View: ${ctx.currentView || '?'}\n` +
      `Email: ${ctx.email || '?'}\n` +
      `Leads: ${ctx.leadsCount ?? '?'}\n\n` +
      `Recent thread:\n${last5}\n\n— Sent from PRIM assistant`
    );
    if (typeof window !== 'undefined') {
      window.location.href = `mailto:juantrejo9082@gmail.com?subject=${subject}&body=${body}`;
    }
  };

  return (
    <>
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

      {open && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="fixed bottom-36 right-4 z-30 w-[400px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-10rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <div>
                <div className="font-bold text-sm leading-tight">{t.title}</div>
                <div className="text-[11px] opacity-80">{t.subtitle}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLanguage(l => (l === 'en' ? 'es' : 'en'))}
                className="text-white/80 hover:text-white p-1 flex items-center gap-1"
                title={language === 'en' ? 'Switch to Spanish' : 'Cambiar a inglés'}
              >
                <Languages size={14} />
                <span className="text-[10px] font-bold">{language.toUpperCase()}</span>
              </button>
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
                <p className="text-sm font-semibold text-slate-700">{t.helloHeader}</p>
                <p className="text-xs text-slate-500 mt-1 mb-4">{t.helloBody}</p>
                {proactiveLine && (
                  <button
                    onClick={() => sendMessage(proactiveLine)}
                    className="w-full text-left bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg px-3 py-2 text-xs text-amber-900 transition mb-2"
                  >
                    <span className="font-semibold">{t.proactiveLabel}</span> {proactiveLine}
                  </button>
                )}
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

            {messages.map((m, i) => {
              const isAssistant = m.role === 'assistant';
              const fb = m.id ? feedbackById[m.id] : undefined;
              const isLastAssistant = isAssistant && i === messages.length - 1;
              return (
                <div key={m.id || i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'
                  }`}>
                    {/* Attachment chips on user messages */}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {m.attachments.map((a, ai) => (
                          <span key={ai} className="bg-indigo-700/50 text-indigo-50 text-[10px] rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                            <Paperclip size={10} /> {a.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {m.content
                      ? renderMessageContent(m.content, onCta, handleAction)
                      : (
                        <div className="flex items-center gap-2 text-slate-500">
                          <Loader2 size={14} className="animate-spin opacity-60" />
                          {activeTool && (
                            <span className="text-[11px] inline-flex items-center gap-1">
                              <Wrench size={10} /> {t.consulting}
                              <span className="font-mono">{activeTool}</span>…
                            </span>
                          )}
                        </div>
                      )
                    }

                    {/* Feedback row on assistant messages with content */}
                    {isAssistant && m.content && !streaming && (
                      <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-100">
                        <button
                          onClick={() => sendFeedback(m, 1)}
                          disabled={fb === 'pending'}
                          className={`p-1 rounded hover:bg-slate-100 transition ${fb === 1 ? 'text-emerald-600' : 'text-slate-400'}`}
                          title="Helpful"
                        >
                          <ThumbsUp size={12} />
                        </button>
                        <button
                          onClick={() => sendFeedback(m, -1)}
                          disabled={fb === 'pending'}
                          className={`p-1 rounded hover:bg-slate-100 transition ${fb === -1 ? 'text-rose-600' : 'text-slate-400'}`}
                          title="Not helpful"
                        >
                          <ThumbsDown size={12} />
                        </button>
                        {fb && fb !== 'pending' && (
                          <span className="text-[10px] text-slate-500">{t.feedbackThanks}</span>
                        )}
                        {/* Escalation button on the last assistant message after a thumbs-down */}
                        {isLastAssistant && fb === -1 && (
                          <button
                            onClick={escalate}
                            className="ml-auto text-[10px] text-rose-600 hover:underline inline-flex items-center gap-1"
                          >
                            <Mail size={10} /> {t.escalateBtn}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pending file chips */}
          {pendingFiles.length > 0 && (
            <div className="border-t border-slate-200 px-2.5 py-1.5 bg-slate-50 flex flex-wrap gap-1">
              {pendingFiles.map((f, i) => (
                <span key={i} className="bg-white border border-slate-200 text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1">
                  <Paperclip size={10} /> {f.name}
                  <button
                    onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                    className="text-slate-400 hover:text-rose-600 ml-1"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="border-t border-rose-200 px-3 py-1.5 bg-rose-50 text-[11px] text-rose-700 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-700"><X size={12} /></button>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t border-slate-200 p-2.5 bg-white flex items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={onPick}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              className="text-slate-500 hover:text-indigo-600 p-1.5 rounded transition"
              title="Attach file (image or PDF)"
            >
              <Paperclip size={16} />
            </button>
            <button
              type="button"
              onClick={toggleVoice}
              disabled={streaming}
              className={`p-1.5 rounded transition ${voiceOn ? 'text-rose-600 animate-pulse' : 'text-slate-500 hover:text-indigo-600'}`}
              title={voiceOn ? t.voiceListening : 'Voice input'}
            >
              {voiceOn ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={streaming ? t.streamingPlaceholder : t.inputPlaceholder}
              disabled={streaming}
              className="flex-1 bg-slate-100 border border-slate-200 rounded-full px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
            <button
              type="submit"
              disabled={streaming || (!input.trim() && pendingFiles.length === 0)}
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
