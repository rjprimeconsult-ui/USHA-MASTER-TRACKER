'use client';
/**
 * BenepathSettings.jsx — "Benepath" webhook-feed settings card for the
 * Prospects settings modal.
 *
 * On mount: GET /api/benepath/config (authed bearer token).
 * Renders:
 *   1. Webhook (Posting) URL (read-only) + Copy + Regenerate
 *   2. Default stage select (every Benepath lead lands here)
 *   3. Save button → POST { defaultStage }
 *   4. Status line (last received · imported count)
 *   5. "Fields received" panel — shows the raw field names from the last lead
 *      so the field mapping can be confirmed.
 *   6. Collapsible "Setup in Benepath" instructions.
 *
 * Mirrors RingySettings.jsx; Benepath posts brand-new leads, so there is no
 * disposition→stage mapping.
 */
import { useState, useEffect } from 'react';
import { Loader2, Copy, Check, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';

async function getBearerToken() {
  if (!supabaseConfigured()) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

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

export default function BenepathSettings({ stages = [] }) {
  const [config, setConfig]       = useState(null);   // null = loading
  const [loadErr, setLoadErr]     = useState('');
  const [defaultStage, setDefaultStage] = useState('');
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  // Seed default stage when stages list arrives
  useEffect(() => {
    if (!defaultStage && stages.length > 0) setDefaultStage(stages[0].id);
  }, [stages, defaultStage]);

  // Load config on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await authedFetch('/api/benepath/config');
        if (!alive) return;
        setConfig(data);
        setDefaultStage(data.defaultStage || (stages.length > 0 ? stages[0].id : ''));
      } catch (e) {
        if (!alive) return;
        setLoadErr(e.message || 'Failed to load Benepath config');
        setConfig({ webhookUrl: '', connected: false, lastReceivedAt: null, importedCount: 0, lastReceivedKeys: [] });
      }
    })();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!confirm('Regenerate the Posting URL? Your current Benepath integration will stop delivering until you paste the new URL into Benepath.')) return;
    setRegenerating(true);
    setSaveMsg('');
    try {
      const data = await authedFetch('/api/benepath/config', {
        method: 'POST',
        body: JSON.stringify({ defaultStage, regenerateToken: true }),
      });
      setConfig(data);
    } catch (e) {
      setSaveMsg(e.message || 'Regenerate failed');
    } finally {
      setRegenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const data = await authedFetch('/api/benepath/config', {
        method: 'POST',
        body: JSON.stringify({ defaultStage }),
      });
      setConfig(data);
      setSaveMsg('saved');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (e) {
      setSaveMsg(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (config === null) {
    return (
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
        <Loader2 size={14} className="animate-spin" />
        Loading Benepath config…
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-400">
        {loadErr}
      </div>
    );
  }

  const lastReceived = config.lastReceivedAt
    ? new Date(config.lastReceivedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'never';
  const receivedKeys = Array.isArray(config.lastReceivedKeys) ? config.lastReceivedKeys : [];

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4">

      {/* 1. Posting URL */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Posting URL</label>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={config.webhookUrl || ''}
            className="flex-1 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 focus:outline-none select-all"
          />
          <button
            onClick={handleCopy}
            title="Copy Posting URL"
            className="border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 shrink-0"
          >
            {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            title="Regenerate Posting URL (old URL stops working)"
            className="border border-amber-200 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-700 dark:text-amber-400 disabled:opacity-60 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 shrink-0"
          >
            {regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Regenerate
          </button>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Paste this into Benepath → Integrations → New Integration → <strong>Posting URL</strong> (Connection Type: POST).</p>
      </div>

      {/* 2. Default stage */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Default Stage (every Benepath lead lands here)</label>
        <select
          value={defaultStage}
          onChange={e => setDefaultStage(e.target.value)}
          className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {stages.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* 3. Save button + feedback */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveMsg === 'saved' && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
            <Check size={13} /> Saved
          </span>
        )}
        {saveMsg && saveMsg !== 'saved' && (
          <span className="text-xs text-red-600">{saveMsg}</span>
        )}
      </div>

      {/* 4. Status line */}
      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
        {config.connected
          ? <span className="flex items-center gap-1 text-emerald-600 font-semibold"><Check size={11} /> Connected</span>
          : <span className="text-slate-400">Not yet receiving</span>
        }
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span>Last received: {lastReceived}</span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span>{config.importedCount ?? 0} imported</span>
      </div>

      {/* 5. Fields received (mapping confirmation) */}
      {receivedKeys.length > 0 && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-600 dark:text-slate-300">Fields Benepath sent (last lead):</span>{' '}
          <span className="font-mono break-words">{receivedKeys.join(', ')}</span>
        </div>
      )}

      {/* 6. Collapsible setup instructions */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowInstructions(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors"
        >
          Setup in Benepath — step-by-step instructions
          {showInstructions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showInstructions && (
          <div className="p-4 space-y-3 text-xs text-slate-600 dark:text-slate-300">
            <ol className="space-y-2 list-decimal list-inside">
              <li>In Benepath, open <strong>Integrations → New Integration</strong>.</li>
              <li>Give it a <strong>Name</strong> (e.g. &ldquo;PRIM&rdquo;).</li>
              <li>Set <strong>Connection Type</strong> to <strong>POST</strong>.</li>
              <li>Paste the <strong>Posting URL</strong> above into the Posting URL field.</li>
              <li>Leave <strong>&ldquo;Is it ping integration?&rdquo;</strong> turned <strong>OFF</strong> — we want full lead posts, not bid pings.</li>
              <li>Click <strong>Continue</strong> and finish any field-mapping/test step Benepath shows.</li>
              <li>Send a <strong>test lead</strong>. It appears in your Prospects tab, and the field names show up under &ldquo;Fields Benepath sent&rdquo; above.</li>
            </ol>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Every Benepath lead is created as a new prospect (source &ldquo;Web Lead&rdquo;, vendor &ldquo;Benepath&rdquo;) at your default stage. Duplicates of an existing prospect just fill in missing details and never change a stage you&rsquo;ve already set.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
