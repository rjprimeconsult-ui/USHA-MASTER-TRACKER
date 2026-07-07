'use client';
/**
 * WebformsSettings.jsx — "Website Leads" webhook-feed settings card for the
 * Prospects settings modal.
 *
 * On mount: GET /api/webforms/config (authed bearer token via @/lib/authedFetch).
 * Renders:
 *   1. Webhook URL (read-only) + Copy + Regenerate (guarded by ConfirmDialog)
 *   2. Status line — "Waiting for your first lead…" or
 *      "Last lead received <date> · <n> total"
 *   3. "Send a test lead" button — POSTs a sample lead to the webhook URL,
 *      then refetches config so the status line updates.
 *   4. Collapsible cheat-sheet — how to point common site builders at the URL.
 *
 * Any tool that can POST a form to a URL works; the secret lives in the URL, so
 * there is no API key to manage. Mirrors RingySettings.jsx card styling, but is
 * deliberately smaller — no disposition mapping, no default-stage select.
 */
import { useState, useEffect } from 'react';
import { Loader2, Copy, Check, RefreshCw, ChevronDown, ChevronUp, Send } from 'lucide-react';
import { authedFetch } from '@/lib/authedFetch';
import ConfirmDialog from '@/components/ConfirmDialog';

/** authedFetch returns a raw Response — parse JSON and surface API errors. */
async function fetchConfig() {
  const res = await authedFetch('/api/webforms/config');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status });
  return json;
}

async function postConfig(body) {
  const res = await authedFetch('/api/webforms/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status });
  return json;
}

export default function WebformsSettings() {
  const [config, setConfig]   = useState(null);   // null = loading
  const [loadErr, setLoadErr] = useState('');
  const [copied, setCopied]   = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmOpen, setConfirmOpen]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');   // '' | success text | error text
  const [testOk, setTestOk]   = useState(false);
  const [showCheatSheet, setShowCheatSheet] = useState(false);

  // Load config on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchConfig();
        if (!alive) return;
        setConfig(data);
      } catch (e) {
        if (!alive) return;
        setLoadErr(e.message || 'Failed to load Website Leads config');
        setConfig({ webhookUrl: '', connected: false, lastReceivedAt: null, receivedCount: 0 });
      }
    })();
    return () => { alive = false; };
  }, []);

  const handleCopy = async () => {
    if (!config?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(config.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be unavailable */ }
  };

  const handleRegenerate = async () => {
    setConfirmOpen(false);
    setRegenerating(true);
    setTestMsg('');
    try {
      const data = await postConfig({ regenerateToken: true });
      setConfig(data);
    } catch (e) {
      setTestMsg(e.message || 'Regenerate failed');
      setTestOk(false);
    } finally {
      setRegenerating(false);
    }
  };

  const handleSendTest = async () => {
    if (!config?.webhookUrl) return;
    setTesting(true);
    setTestMsg('');
    try {
      await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Lead (Website Leads)',
          email: 'test@primtracker.com',
          phone: '',
          message: 'Sent from the Send-a-test-lead button in PRIM settings — safe to archive.',
        }),
      });
      // Refetch so the status line reflects the new capture.
      try {
        const data = await fetchConfig();
        setConfig(data);
      } catch { /* status refresh best-effort */ }
      setTestOk(true);
      setTestMsg('Test lead created — check your Prospects board ✓');
    } catch (e) {
      setTestOk(false);
      setTestMsg(e.message || 'Test lead failed to send');
    } finally {
      setTesting(false);
    }
  };

  // ---- Loading state ----
  if (config === null) {
    return (
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
        <Loader2 size={14} className="animate-spin" />
        Loading Website Leads config…
      </div>
    );
  }

  // ---- Error loading ----
  if (loadErr) {
    return (
      <div className="border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-400">
        {loadErr}
      </div>
    );
  }

  const statusLine = config.lastReceivedAt
    ? `Last lead received ${new Date(config.lastReceivedAt).toLocaleString()} · ${config.receivedCount ?? 0} total`
    : 'Waiting for your first lead…';

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4">

      {/* 1. Webhook URL */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Webhook URL</label>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={config.webhookUrl || ''}
            className="flex-1 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 focus:outline-none select-all"
          />
          <button
            onClick={handleCopy}
            title="Copy webhook URL"
            className="border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 shrink-0"
          >
            {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={regenerating}
            title="Regenerate webhook URL (old URL stops working)"
            className="border border-amber-200 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-700 dark:text-amber-400 disabled:opacity-60 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 shrink-0"
          >
            {regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Regenerate
          </button>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Point your website&apos;s form (or automation tool) at this URL. No API key needed — the secret is in the URL.</p>
      </div>

      {/* 2. Status line */}
      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
        {config.lastReceivedAt
          ? <span className="flex items-center gap-1 text-emerald-600 font-semibold"><Check size={11} /> Connected</span>
          : <span className="text-slate-400">Not yet receiving</span>
        }
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span>{statusLine}</span>
      </div>

      {/* 3. Send a test lead */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSendTest}
          disabled={testing || !config.webhookUrl}
          className="border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 disabled:opacity-60 rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {testing ? 'Sending…' : 'Send a test lead'}
        </button>
        {testMsg && (
          <span className={`text-xs font-semibold ${testOk ? 'text-emerald-600' : 'text-red-600'}`}>
            {testMsg}
          </span>
        )}
      </div>

      {/* 4. Collapsible cheat-sheet */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowCheatSheet(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors"
        >
          How to connect your website — cheat-sheet
          {showCheatSheet ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showCheatSheet && (
          <div className="p-4 space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <ul className="space-y-1.5 list-disc list-inside">
              <li><strong>Webflow</strong> — Site settings → Forms → add the URL as a native <strong>form webhook</strong>.</li>
              <li><strong>Typeform / JotForm</strong> — open the form&apos;s <strong>Webhooks</strong> setting and paste the URL.</li>
              <li><strong>WordPress</strong> — use <strong>Gravity Forms</strong> or <strong>WPForms</strong> webhook add-on, or a <strong>Contact Form 7</strong> webhook plugin.</li>
              <li><strong>Wix / Squarespace</strong> — add a <strong>Zapier</strong> or <strong>Make</strong> &quot;Webhooks: POST&quot; step that posts to the URL.</li>
              <li><strong>Custom sites / MANUS-built</strong> — POST JSON to the URL. Any field names work.</li>
            </ul>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">Any tool that can POST a form to a URL works. No API key needed — the secret is in the URL.</p>
          </div>
        )}
      </div>

      {/* Regenerate confirmation */}
      <ConfirmDialog
        open={confirmOpen}
        title="Regenerate webhook URL?"
        message="Your old webhook URL will stop capturing immediately — update your website after regenerating."
        onConfirm={handleRegenerate}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
