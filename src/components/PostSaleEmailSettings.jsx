'use client';
import { useEffect, useState, useMemo } from 'react';
import { Mail, Save, Loader2, AlertTriangle, Eye, CheckCircle2, Beaker, Lock } from 'lucide-react';
import {
  loadTemplate,
  saveTemplate,
  renderTemplate,
  parseTestAddresses,
  findMissingValues,
  TEMPLATE_VARIABLES,
  DEFAULT_TEMPLATE,
} from '@/lib/postSaleEmails';
import { useBetaFeature } from '@/lib/useBetaFeature';

/**
 * Settings UI for post-sale email templates.
 *
 * Three modes:
 *  - Loading / no access: shows nothing or an upgrade teaser (handled in
 *    the wrapping settings tab; this component assumes access has already
 *    been granted upstream — the tab won't even render otherwise).
 *  - Editing: subject + body editor with variable chips, test addresses,
 *    test-mode toggle (locked ON during beta), live preview.
 *  - Saving / saved: subtle status indicator.
 *
 * The preview uses a sample lead so an agent can iterate on copy without
 * needing a real lead in front of them.
 */
const SAMPLE_LEAD = {
  name: 'Sarah Johnson',
  mainProduct: 'PREMIER ADVANTAGE',
  associationPlan: 'EXECUTIVE DIAMOND',
  policyNumber: '72G216584S',
  effectiveDate: '2026-05-15',
  email: 'sarah.test@example.com',
};

export default function PostSaleEmailSettings() {
  const { profile } = useBetaFeature('post_sale_emails');
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTemplate().then(t => { if (alive) { setTemplate(t); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const update = (patch) => setTemplate(prev => ({ ...prev, ...patch }));

  const onSave = async () => {
    setSaving(true);
    try {
      const next = await saveTemplate(template);
      setTemplate(next);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const insertToken = (token) => {
    update({ body: (template.body || '') + token });
  };

  const rendered = useMemo(
    () => renderTemplate(template, SAMPLE_LEAD, profile, { agentName: profile?.email?.split('@')[0] }),
    [template, profile]
  );
  const missing = useMemo(() => {
    const out = findMissingValues(rendered);
    // SAMPLE_LEAD is reasonably complete so this should usually be empty —
    // when it isn't, the agent has a typo'd placeholder. Surface it.
    return out;
  }, [rendered]);

  const testAddressList = parseTestAddresses(template.testAddresses);

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading template…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Beta banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <Beaker size={18} className="text-amber-700 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-900">
          <div className="font-semibold mb-0.5">Beta — Pro &amp; Team feature</div>
          <p className="text-xs">
            Test mode is locked ON during beta. Emails route to your test addresses below — never to real customers.
            We&apos;ll flip this off together once your template is dialed in.
          </p>
        </div>
      </div>

      {/* Template editor */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Mail size={16} className="text-indigo-600" />
          <h3 className="font-semibold text-slate-900">Welcome template</h3>
          <span className="ml-auto text-xs text-slate-500">Triggered manually from a lead, for now.</span>
        </div>

        <Field label="Subject">
          <input
            type="text"
            value={template.subject}
            onChange={e => update({ subject: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Welcome to USHEALTH, {customer_first_name}"
          />
        </Field>

        <Field label="Body" hint="Use the variable chips below to insert dynamic values.">
          <textarea
            value={template.body}
            onChange={e => update({ body: e.target.value })}
            rows={10}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed"
          />
          <div className="flex flex-wrap gap-1 mt-2">
            {TEMPLATE_VARIABLES.map(v => (
              <button
                key={v.token}
                type="button"
                onClick={() => insertToken(v.token)}
                className="text-[11px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-mono border border-indigo-200 transition"
                title={`${v.label} — e.g. ${v.sample}`}
              >
                {v.token}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="From name (optional)" hint="Leave blank to use your account email's display name.">
            <input
              type="text"
              value={template.fromName}
              onChange={e => update({ fromName: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Juan Trejo"
            />
          </Field>
          <Field label="Test addresses (required during beta)" hint="Comma-separated. All sends route here.">
            <input
              type="text"
              value={template.testAddresses}
              onChange={e => update({ testAddresses: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="you@example.com, friend@example.com"
            />
          </Field>
        </div>

        {/* Test mode toggle — locked ON during beta */}
        <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Lock size={14} className="text-amber-600" />
            <span className="font-medium">Test mode</span>
            <span className="text-xs text-slate-500">— locked ON during beta. Emails route to your test addresses only.</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold">ON</span>
        </div>
      </div>

      {/* Live preview */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-slate-500" />
          <h4 className="font-semibold text-sm text-slate-700">Live preview (sample lead: Sarah Johnson)</h4>
        </div>
        <div className="bg-slate-50 rounded-lg border border-slate-100 p-3">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Subject</div>
          <div className="font-semibold text-sm text-slate-900 mb-3">{rendered.subject || <em className="text-slate-400">(empty)</em>}</div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Body</div>
          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 leading-relaxed">{rendered.body || <em className="text-slate-400">(empty)</em>}</pre>
        </div>
        <div className="text-[11px] text-slate-500">
          Would send to <span className="font-mono">{rendered.recipient || '(no recipient resolved)'}</span>
          {rendered.testMode && rendered.intendedRecipient && rendered.intendedRecipient !== rendered.recipient && (
            <> · <span className="text-amber-700">redirected from {rendered.intendedRecipient} (test mode)</span></>
          )}
        </div>
        {missing.length > 0 && (
          <div className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
            <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              These placeholders didn&apos;t resolve in the preview — typo? <span className="font-mono">{missing.join(' ')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Save row */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {testAddressList.length > 0
            ? <>Test addresses: <span className="font-mono">{testAddressList.join(', ')}</span></>
            : <span className="text-amber-700">Add at least one test address before sending.</span>}
        </div>
        <div className="flex items-center gap-3">
          {savedFlash && <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 size={12} /> Saved</span>}
          <button
            onClick={onSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save template
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
