'use client';
/**
 * TextDripSettings.jsx — "TextDrip" connect card for the Prospects settings area.
 *
 * On mount: GET /api/textdrip/status.
 *   Not connected → show form (API key, tag, default stage) + Connect button.
 *   Connected     → show status + Disconnect / Sync now buttons.
 *
 * Never stores/logs the API key client-side beyond the controlled input value.
 * The key is sent once to POST /api/textdrip/connect, then forgotten.
 */
import { useState, useEffect } from 'react';
import { Loader2, Check, Unlink, RefreshCw } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';

/** Get the Supabase bearer token for authed API calls. */
async function getBearerToken() {
  if (!supabaseConfigured()) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

/** Authed JSON fetch helper */
async function authedFetch(url, options = {}) {
  const token = await getBearerToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status });
  return json;
}

/**
 * Props:
 *   stages     — array of { id, label } (from prospect settings)
 *   onSyncDone — called after a successful sync so the parent can run
 *                the client-side upsert. Receives the sync payload.
 *   onStatus   — optional callback with the latest status object
 */
export default function TextDripSettings({ stages = [], onSyncDone, onStatus }) {
  const [status, setStatus]       = useState(null);  // null = loading
  const [loadErr, setLoadErr]     = useState('');
  const [apiKey, setApiKey]       = useState('');
  const [importTag, setImportTag] = useState('');
  const [defaultStage, setDefaultStage] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectErr, setConnectErr] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [syncMsg, setSyncMsg]     = useState('');

  // Set a sensible default stage when the stages list loads
  useEffect(() => {
    if (!defaultStage && stages.length > 0) {
      setDefaultStage(stages[0].id);
    }
  }, [stages, defaultStage]);

  // Load status on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await authedFetch('/api/textdrip/status');
        if (!alive) return;
        setStatus(data);
        onStatus?.(data);
      } catch (e) {
        if (!alive) return;
        setLoadErr(e.message || 'Failed to load TextDrip status');
        setStatus({ connected: false });
      }
    })();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) { setConnectErr('API key is required'); return; }
    if (!importTag.trim()) { setConnectErr('Import tag is required'); return; }
    if (!defaultStage) { setConnectErr('Please pick a default stage'); return; }
    setConnecting(true);
    setConnectErr('');
    try {
      const data = await authedFetch('/api/textdrip/connect', {
        method: 'POST',
        body: JSON.stringify({ apiKey: apiKey.trim(), importTag: importTag.trim(), defaultStage }),
      });
      setStatus(data);
      onStatus?.(data);
      setApiKey(''); // forget the key immediately
    } catch (e) {
      setConnectErr(e.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect TextDrip? Your existing imported prospects are not deleted.')) return;
    setDisconnecting(true);
    try {
      const data = await authedFetch('/api/textdrip/disconnect', { method: 'POST' });
      setStatus(data);
      onStatus?.(data);
    } catch (e) {
      alert(e.message || 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const payload = await authedFetch('/api/textdrip/sync', { method: 'POST' });
      // Hand the payload to the parent (LeadTracker) for upsert/dedup/review
      // and AWAIT it: the spinner must cover the whole import, and the
      // returned summary is shown INLINE so the outcome is never a missed
      // toast. (Previously the payload was passed un-awaited to a wrapper
      // that dropped it and kicked off a SECOND scan — double duration, and
      // the result toast fired long after the spinner stopped.)
      const res = await onSyncDone?.(payload);
      setSyncMsg(res?.summary || `Scanned ${payload?.scanned ?? 0} conversations`);
      // Refresh status so lastSyncAt updates
      const fresh = await authedFetch('/api/textdrip/status').catch(() => null);
      if (fresh) { setStatus(fresh); onStatus?.(fresh); }
    } catch (e) {
      setSyncMsg(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // ---- Loading state ----
  if (status === null) {
    return (
      <div className="border border-slate-200 rounded-xl p-4 flex items-center gap-2 text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" />
        Loading TextDrip status…
      </div>
    );
  }

  // ---- Error loading status ----
  if (loadErr && !status?.connected) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-xl p-4 text-sm text-red-700">
        {loadErr}
      </div>
    );
  }

  // ---- CONNECTED state ----
  if (status?.connected) {
    const lastSync = status.lastSyncAt
      ? new Date(status.lastSyncAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'never';

    return (
      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <Check size={14} /> Connected
          </span>
          <span className="text-sm text-slate-500">
            ••••{status.last4}
          </span>
          <span className="text-slate-300">·</span>
          <span className="text-xs text-slate-500">last synced {lastSync}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
          <div>
            <span className="font-semibold">Import tag:</span>{' '}
            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{status.importTag || '—'}</span>
          </div>
          <div>
            <span className="font-semibold">Default stage:</span>{' '}
            {stages.find(s => s.id === status.defaultStage)?.label || status.defaultStage || '—'}
          </div>
        </div>

        {syncMsg && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {syncMsg}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1.5"
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-600 rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
          >
            {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  // ---- NOT CONNECTED state — show setup form ----
  return (
    <form onSubmit={handleConnect} className="border border-slate-200 rounded-xl p-4 space-y-3">
      <p className="text-xs text-slate-500">
        Connect your TextDrip account to pull tagged contacts + SMS conversations into PRIM as prospects.
      </p>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">TextDrip API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="Paste your TextDrip API key"
          autoComplete="new-password"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Import Tag
          <span className="ml-1 font-normal text-slate-500">(exact tag title in TextDrip, e.g. APPT SET PRIM)</span>
        </label>
        <input
          type="text"
          value={importTag}
          onChange={e => setImportTag(e.target.value)}
          placeholder="e.g. APPT SET PRIM"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Default Stage for new imports</label>
        <select
          value={defaultStage}
          onChange={e => setDefaultStage(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {stages.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {connectErr && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {connectErr}
        </div>
      )}

      <button
        type="submit"
        disabled={connecting}
        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 w-full justify-center"
      >
        {connecting ? <Loader2 size={14} className="animate-spin" /> : null}
        {connecting ? 'Connecting…' : 'Connect TextDrip'}
      </button>
    </form>
  );
}
