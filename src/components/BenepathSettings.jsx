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

/**
 * The Api Fields body template to paste into Benepath's Liquid editor — for
 * GROUP HEALTH (employer) leads. Left-side keys are exactly what PRIM reads;
 * right-side {{...}} are Benepath's macros. Liquid renders unknown macros as
 * empty (safe), so a blank field just means that macro is named differently —
 * click it from Benepath's Macro Key sidebar to fix.
 */
const BENEPATH_API_FIELDS_TEMPLATE = `{
  "first_name": "{{first_name}}",
  "last_name": "{{last_name}}",
  "email": "{{email}}",
  "phone": "{{phone}}",
  "address": "{{address}}",
  "city": "{{city}}",
  "state": "{{state}}",
  "zip": "{{zip}}",
  "currently_insured": "{{currently_insured}}",
  "company_name": "{{business_info_business_name}}",
  "num_employees": "{{business_info_num_employees}}",
  "coverage_expiration": "{{coverage_expiration}}",
  "lead_id": "{{lead_id}}"
}`;

export default function BenepathSettings({ stages = [] }) {
  const [config, setConfig]       = useState(null);   // null = loading
  const [loadErr, setLoadErr]     = useState('');
  const [defaultStage, setDefaultStage] = useState('');
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [copiedTpl, setCopiedTpl] = useState(false);
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

  const handleCopyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(BENEPATH_API_FIELDS_TEMPLATE);
      setCopiedTpl(true);
      setTimeout(() => setCopiedTpl(false), 2000);
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

            {/* Step 1 */}
            <p className="font-bold text-slate-700 dark:text-slate-200">Step 1 — Create the integration</p>
            <ol className="space-y-1.5 list-decimal list-inside">
              <li>In Benepath, open <strong>Integrations → New Integration</strong>.</li>
              <li><strong>Name</strong> it (e.g. &ldquo;PRIM&rdquo;).</li>
              <li><strong>Connection Type</strong> → <strong>POST</strong>.</li>
              <li>Paste the <strong>Posting URL</strong> from the top of this card into Benepath&rsquo;s <strong>Posting URL</strong> field.</li>
              <li>Leave <strong>&ldquo;Is it ping integration?&rdquo;</strong> <strong>OFF</strong>, then click <strong>Continue</strong>.</li>
            </ol>

            {/* Step 2 */}
            <p className="font-bold text-slate-700 dark:text-slate-200 pt-1">Step 2 — Request Headers</p>
            <p>Leave this section <strong>empty</strong>. Don&rsquo;t put lead fields here — your Posting URL already handles security.</p>

            {/* Step 3 */}
            <p className="font-bold text-slate-700 dark:text-slate-200 pt-1">Step 3 — Api Fields</p>
            <ol className="space-y-1.5 list-decimal list-inside">
              <li><strong>Content Type</strong> → <strong>application/json</strong>.</li>
              <li><strong>Lead Type</strong> → <strong>Group Health</strong> (match the product you actually buy).</li>
              <li>Clear the <strong>Editor</strong> and paste this exactly:</li>
            </ol>
            <div className="relative">
              <button
                onClick={handleCopyTemplate}
                className="absolute top-2 right-2 bg-slate-700/80 hover:bg-slate-600 text-white rounded px-2 py-1 text-[10px] font-semibold flex items-center gap-1"
              >
                {copiedTpl ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                {copiedTpl ? 'Copied' : 'Copy'}
              </button>
              <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 pr-16 overflow-x-auto text-[10px] leading-relaxed font-mono whitespace-pre select-all">{BENEPATH_API_FIELDS_TEMPLATE}</pre>
            </div>
            <p>Then click <strong>Save</strong>. If any field comes in <strong>blank</strong> on a test, click inside its quotes and click the matching item in Benepath&rsquo;s <strong>Macro Key</strong> sidebar — that drops in the exact macro name.</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Group Health leads carry <strong>Company Name</strong> and <strong># Employees</strong> (not age/household) — PRIM captures those and tags the prospect as a business/employer. Buying individual <strong>Health</strong> instead? Set Lead Type to Health and map age/gender/household macros — PRIM reads both.</p>

            {/* Step 4 */}
            <p className="font-bold text-slate-700 dark:text-slate-200 pt-1">Step 4 — Response Type</p>
            <p>Set the <strong>Success</strong> field to <code className="bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded font-mono">success</code> (PRIM&rsquo;s reply contains that word). Save.</p>

            {/* Step 5 */}
            <p className="font-bold text-slate-700 dark:text-slate-200 pt-1">Step 5 — Test &amp; go live</p>
            <ol className="space-y-1.5 list-decimal list-inside">
              <li><strong>Test Integration</strong> → Product <strong>Leads</strong>, Lead Type <strong>Group Health</strong> → <strong>Test Connection</strong>. The result should read <strong>Status 200 · Successful</strong>. (If nothing happens, make sure both dropdowns are set and you&rsquo;ve clicked <strong>Save</strong> in Api Fields first.)</li>
              <li>On the <strong>Integrations</strong> list, confirm the PRIM row&rsquo;s status dot is <strong>green (Active)</strong> and the integration is attached to your lead campaign(s).</li>
              <li>Back here, pick your <strong>Default Stage</strong> above and <strong>Save</strong>.</li>
            </ol>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Each Benepath lead becomes a new prospect (Source &amp; CRM &ldquo;Benepath&rdquo;) at your default stage and starts its follow-up cadence. Duplicates just fill missing details and never change a stage you&rsquo;ve set. It runs 24/7 — PRIM doesn&rsquo;t need to be open.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
