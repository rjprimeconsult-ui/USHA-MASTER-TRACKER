'use client';
/**
 * RingySettings.jsx — "Ringy" webhook-feed settings card for the Prospects
 * settings modal.
 *
 * On mount: GET /api/ringy/config (authed bearer token).
 * Renders:
 *   1. Webhook URL (read-only) + Copy + Regenerate
 *   2. Disposition → Stage mapping table (add/remove rows)
 *   3. Default stage select
 *   4. Save button → POST { mapping, defaultStage }
 *   5. Status line (last received · imported count)
 *   6. Collapsible "Setup in Ringy" instructions + payload key table
 *
 * Mirrors TextDripSettings.jsx patterns exactly.
 */
import { useState, useEffect } from 'react';
import { Loader2, Copy, Check, RefreshCw, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
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

/** Payload key table rows shown in the setup instructions. */
const PAYLOAD_KEYS = [
  { key: 'leadId',    value: 'Lead ID' },
  { key: 'firstName', value: 'Lead first name' },
  { key: 'lastName',  value: 'Lead last name' },
  { key: 'phone',     value: 'Lead phone number' },
  { key: 'email',     value: 'Lead email' },
  { key: 'address',   value: 'Lead street address' },
  { key: 'city',      value: 'Lead city' },
  { key: 'state',     value: 'Lead State' },
  { key: 'zip',       value: 'Lead zipcode' },
  { key: 'birthday',  value: 'Lead birthday' },
  { key: 'notes',     value: 'Lead notes' },
  { key: 'status',    value: 'Lead status' },
  { key: 'source',    value: 'Lead source' },
  { key: 'disposition', value: 'Custom → type the disposition tag\'s name' },
];

/**
 * Props:
 *   stages — array of { id, label } from the prospect settings (draft.stages)
 */
export default function RingySettings({ stages = [] }) {
  const [config, setConfig]       = useState(null);   // null = loading
  const [loadErr, setLoadErr]     = useState('');
  const [mapping, setMapping]     = useState([]);      // [{ disposition, stage }]
  const [defaultStage, setDefaultStage] = useState('');
  const [blastDetectionEnabled, setBlastDetectionEnabled] = useState(true);
  const [blastPatterns, setBlastPatterns] = useState(''); // textarea, one pattern per line
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');      // '' | 'saved' | error text
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  // Seed default stage when stages list arrives
  useEffect(() => {
    if (!defaultStage && stages.length > 0) {
      setDefaultStage(stages[0].id);
    }
  }, [stages, defaultStage]);

  // Load config on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await authedFetch('/api/ringy/config');
        if (!alive) return;
        setConfig(data);
        setMapping(data.mapping ?? []);
        setDefaultStage(data.defaultStage || (stages.length > 0 ? stages[0].id : ''));
        setBlastDetectionEnabled(data.blastDetectionEnabled !== false);
        setBlastPatterns(Array.isArray(data.blastDispositionPatterns) ? data.blastDispositionPatterns.join('\n') : '');
      } catch (e) {
        if (!alive) return;
        setLoadErr(e.message || 'Failed to load Ringy config');
        setConfig({ webhookUrl: '', connected: false, lastReceivedAt: null, importedCount: 0 });
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
    } catch {
      // clipboard may be unavailable in some contexts — silent fail
    }
  };

  const handleRegenerate = async () => {
    if (!confirm('Regenerate the webhook URL? This will break your current Ringy automated actions — you\'ll need to paste the new URL in Ringy.')) return;
    setRegenerating(true);
    setSaveMsg('');
    try {
      const data = await authedFetch('/api/ringy/config', {
        method: 'POST',
        body: JSON.stringify({ mapping, defaultStage, regenerateToken: true, blastDetectionEnabled, blastDispositionPatterns: patternsArray() }),
      });
      setConfig(data);
      setMapping(data.mapping ?? []);
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
      const data = await authedFetch('/api/ringy/config', {
        method: 'POST',
        body: JSON.stringify({ mapping, defaultStage, blastDetectionEnabled, blastDispositionPatterns: patternsArray() }),
      });
      setConfig(data);
      setMapping(data.mapping ?? []);
      setSaveMsg('saved');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (e) {
      setSaveMsg(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const patternsArray = () => blastPatterns.split('\n').map(s => s.trim()).filter(Boolean);

  const addRow = () => setMapping(m => [...m, { disposition: '', stage: stages[0]?.id ?? '' }]);
  const removeRow = (i) => setMapping(m => m.filter((_, idx) => idx !== i));
  const updateRow = (i, patch) => setMapping(m => m.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  // ---- Loading state ----
  if (config === null) {
    return (
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
        <Loader2 size={14} className="animate-spin" />
        Loading Ringy config…
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

  const lastReceived = config.lastReceivedAt
    ? new Date(config.lastReceivedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'never';

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
            onClick={handleRegenerate}
            disabled={regenerating}
            title="Regenerate webhook URL (old URL stops working)"
            className="border border-amber-200 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-700 dark:text-amber-400 disabled:opacity-60 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 shrink-0"
          >
            {regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Regenerate
          </button>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Paste this URL into each Ringy Automated Action that should feed leads to PRIM.</p>
      </div>

      {/* 2. Disposition → Stage mapping */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Disposition → Stage Mapping</label>
          <button
            onClick={addRow}
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 flex items-center gap-1"
          >
            <Plus size={12} /> Add row
          </button>
        </div>
        {mapping.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500 italic py-1">
            No mappings yet — add a row for each Ringy disposition you want to track.
          </div>
        ) : (
          <div className="space-y-1.5">
            {mapping.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.disposition}
                  onChange={e => updateRow(i, { disposition: e.target.value })}
                  placeholder="Ringy disposition name (e.g. Expressed Interest)"
                  className="flex-1 border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <select
                  value={row.stage}
                  onChange={e => updateRow(i, { stage: e.target.value })}
                  className="w-40 border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {stages.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeRow(i)}
                  className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Default stage */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Default Stage (for unmapped dispositions)</label>
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

      {/* 3b. Blast / repurpose auto-capture */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={blastDetectionEnabled}
            onChange={e => setBlastDetectionEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Auto-log repurpose / blast tags to the Blasts tab</span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              A blast tag fires one webhook per lead. When on, PRIM rolls those into one daily entry on the <strong>Blasts</strong> tab instead of creating a prospect for each. The known <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">REPUROSED&nbsp;…&nbsp;DRIP</code> tag is detected automatically.
            </span>
          </span>
        </label>
        {blastDetectionEnabled && (
          <div className="pl-6">
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-1">Extra blast tag patterns (optional, one per line)</label>
            <textarea
              value={blastPatterns}
              onChange={e => setBlastPatterns(e.target.value)}
              rows={2}
              placeholder={'e.g. blast\naged.*drip'}
              className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Matched case-insensitively against the disposition. Plain words or regex both work — these add to the built-in defaults.</p>
          </div>
        )}
      </div>

      {/* 4. Save button + feedback */}
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

      {/* 5. Status line */}
      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
        {config.connected
          ? <span className="flex items-center gap-1 text-emerald-600 font-semibold"><Check size={11} /> Connected</span>
          : <span className="text-slate-400">Not yet receiving</span>
        }
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span>Last received: {lastReceived}</span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span>{config.importedCount ?? 0} imported</span>
      </div>

      {/* 6. Collapsible setup instructions */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowInstructions(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors"
        >
          Setup in Ringy — step-by-step instructions
          {showInstructions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showInstructions && (
          <div className="p-4 space-y-3 text-xs text-slate-600 dark:text-slate-300">
            <ol className="space-y-2 list-decimal list-inside">
              <li>In Ringy, open <strong>Disposition Tags &amp; Automated Actions</strong>.</li>
              <li>For each disposition you want to sync to PRIM, create or edit an <strong>Automated Action</strong>.</li>
              <li>Check <strong>Post to a custom webhook</strong> and paste the Webhook URL above.</li>
              <li>Click <strong>ADD VALUE</strong> for each key in the table below — type the key name exactly and pick the Ringy value from the dropdown.</li>
              <li>Save the automated action in Ringy.</li>
              <li>Back in PRIM, add a row in the Disposition → Stage Mapping above: type the <em>exact disposition tag name</em> and pick the PRIM stage it should land on.</li>
              <li>Click <strong>Save</strong>.</li>
            </ol>

            <p className="font-semibold text-slate-700 dark:text-slate-200 mt-3">Payload keys to configure in Ringy (ADD VALUE for each):</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-700/60">
                    <th className="text-left px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600">Key (type exactly)</th>
                    <th className="text-left px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600">Value (pick from Ringy dropdown)</th>
                  </tr>
                </thead>
                <tbody>
                  {PAYLOAD_KEYS.map(({ key, value }) => (
                    <tr key={key} className="even:bg-slate-50 dark:even:bg-slate-800/30">
                      <td className="px-3 py-1.5 border border-slate-200 dark:border-slate-600">
                        <code className="bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded font-mono">{key}</code>
                      </td>
                      <td className="px-3 py-1.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                        {key === 'disposition'
                          ? <><strong>Custom</strong> → type the disposition tag&apos;s name</>
                          : value
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
