'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  Mail, Save, Loader2, AlertTriangle, Eye, CheckCircle2, Beaker, Plus, Trash2, ChevronLeft, Edit2, Power, Zap,
} from 'lucide-react';
import {
  loadBundle,
  saveBundle,
  renderTemplate,
  parseTestAddresses,
  findMissingValues,
  createBlankTemplate,
  TEMPLATE_VARIABLES,
  AUTO_SEND_STAGES,
} from '@/lib/postSaleEmails';
import { useBetaFeature } from '@/lib/useBetaFeature';

/**
 * Settings for multi-template post-sale emails.
 *
 * Layout has two screens (state held in `editingId`):
 *   - List view: every template with name, status pill, auto-send pill,
 *     edit / delete / duplicate actions. Plus the shared test-mode +
 *     test-addresses block at the top.
 *   - Editor view: subject + body + variables + preview for one template.
 *
 * The list is shared with the SendWelcomeEmail button (it reads from the
 * same bundle), and any change persists immediately on Save.
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
  const [bundle, setBundle] = useState({ testMode: true, testAddresses: '', templates: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    let alive = true;
    loadBundle().then((b) => {
      if (!alive) return;
      setBundle(b);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const updateBundle = (patch) => setBundle(prev => ({ ...prev, ...patch }));
  const updateTemplate = (id, patch) => {
    setBundle(prev => ({
      ...prev,
      templates: prev.templates.map(t => t.id === id ? { ...t, ...patch } : t),
    }));
  };

  const addTemplate = () => {
    const t = createBlankTemplate();
    setBundle(prev => ({ ...prev, templates: [...prev.templates, t] }));
    setEditingId(t.id);
  };
  const deleteTemplate = (id) => {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    setBundle(prev => ({ ...prev, templates: prev.templates.filter(t => t.id !== id) }));
    if (editingId === id) setEditingId(null);
  };
  const duplicateTemplate = (id) => {
    const src = bundle.templates.find(t => t.id === id);
    if (!src) return;
    const copy = createBlankTemplate();
    copy.name = `${src.name} (copy)`;
    copy.subject = src.subject;
    copy.body = src.body;
    copy.fromName = src.fromName;
    copy.autoSendOnStage = null;
    setBundle(prev => ({ ...prev, templates: [...prev.templates, copy] }));
    setEditingId(copy.id);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const nextBundle = await saveBundle(bundle);
      setBundle(nextBundle);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const editing = useMemo(
    () => bundle.templates.find(t => t.id === editingId) || null,
    [bundle.templates, editingId]
  );

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading templates…</div>;
  }

  return (
    <div className="space-y-4">
      <BetaBanner testMode={bundle.testMode === true} />

      {/* Sender identity used to live here — moved to the Profile hub
          (top-right avatar → Profile → Email sender) since it's an
          identity-level setting, not an email-feature setting. */}
      <SenderIdentityNotice />

      {/* Shared settings (apply to every template) */}
      <SharedSettings bundle={bundle} updateBundle={updateBundle} />

      {/* Either list or editor */}
      {!editing ? (
        <TemplateList
          templates={bundle.templates}
          onEdit={setEditingId}
          onDelete={deleteTemplate}
          onDuplicate={duplicateTemplate}
          onToggleEnabled={(id, enabled) => updateTemplate(id, { enabled })}
          onAdd={addTemplate}
        />
      ) : (
        <TemplateEditor
          template={editing}
          bundle={bundle}
          profile={profile}
          onChange={(patch) => updateTemplate(editing.id, patch)}
          onBack={() => setEditingId(null)}
        />
      )}

      {/* Save row */}
      <div className="flex items-center justify-end gap-3">
        {savedFlash && <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 size={12} /> Saved</span>}
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save changes
        </button>
      </div>
    </div>
  );
}

function BetaBanner({ testMode }) {
  // Two states now that the feature is live:
  //   - Test mode ON  → amber banner reminding the agent emails route
  //     to test addresses instead of real customers.
  //   - Test mode OFF → emerald banner confirming sends go straight
  //     to the customer email on each lead.
  if (testMode) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <Beaker size={18} className="text-amber-700 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-900">
          <div className="font-semibold mb-0.5">Test mode is ON</div>
          <p className="text-xs">
            Emails route to your test addresses below — never to real customers. Toggle off when you&apos;re ready to go live.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
      <CheckCircle2 size={18} className="text-emerald-700 mt-0.5 flex-shrink-0" />
      <div className="text-sm text-emerald-900">
        <div className="font-semibold mb-0.5">Live — sending to real customers</div>
        <p className="text-xs">
          Emails go straight to each lead&apos;s email on file. Need to preview a new template safely? Flip Test mode on below.
        </p>
      </div>
    </div>
  );
}

function SenderIdentityNotice() {
  return (
    <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-indigo-900">
      <Mail size={14} className="text-indigo-700 mt-0.5 flex-shrink-0" />
      <div>
        <span className="font-semibold">Sender identity moved to your Profile.</span>{' '}
        Set your From name + address from the top-right avatar → <span className="font-semibold">Profile</span> → <span className="font-semibold">Email sender</span>. Same settings, just consolidated with your other identity fields.
      </div>
    </div>
  );
}

function SharedSettings({ bundle, updateBundle }) {
  const testOn = bundle.testMode === true;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="text-xs font-bold text-slate-500 tracking-wider">SHARED SETTINGS</div>
      <Field
        label="Test addresses"
        hint={testOn
          ? 'Comma-separated. Required while test mode is on — all sends route to the first address.'
          : 'Optional. Only used when you flip Test mode on below.'}
      >
        <input
          type="text"
          value={bundle.testAddresses}
          onChange={e => updateBundle({ testAddresses: e.target.value })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="you@example.com, friend@example.com"
        />
      </Field>
      <div className={`flex items-center justify-between rounded-lg px-3 py-2 border ${testOn ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
        <div className="flex items-center gap-2 text-sm">
          {testOn
            ? <Beaker size={14} className="text-amber-600 flex-shrink-0" />
            : <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />}
          <div>
            <div className="font-medium text-slate-900">Test mode</div>
            <div className="text-[11px] text-slate-600 leading-snug">
              {testOn
                ? 'Sends route to your test addresses — never to real customers.'
                : 'Sends go straight to each lead’s email on file.'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => updateBundle({ testMode: !testOn })}
          role="switch"
          aria-checked={testOn}
          className={`relative w-12 h-6 rounded-full transition flex-shrink-0 ${testOn ? 'bg-amber-500' : 'bg-emerald-500'}`}
          title={testOn ? 'Currently ON — click to go live' : 'Currently OFF — click to enable test mode'}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${testOn ? 'translate-x-6' : 'translate-x-0'}`}
          />
        </button>
      </div>
    </div>
  );
}

function TemplateList({ templates, onEdit, onDelete, onDuplicate, onToggleEnabled, onAdd }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Mail size={16} className="text-indigo-600" />
          <h3 className="font-semibold text-slate-900">Templates ({templates.length})</h3>
        </div>
        <button
          onClick={onAdd}
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
        >
          <Plus size={12} /> New template
        </button>
      </div>

      {templates.length === 0 && (
        <div className="text-center py-8 text-sm text-slate-400">
          No templates yet. Click <span className="font-semibold">New template</span> to add one.
        </div>
      )}

      <div className="space-y-2">
        {templates.map(t => (
          <div key={t.id} className="border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-900 truncate">{t.name}</span>
                {!t.enabled && (
                  <span className="text-[10px] uppercase tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">Disabled</span>
                )}
                {t.autoSendOnStage && (
                  <span className="text-[10px] uppercase tracking-wider bg-violet-100 text-violet-800 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                    <Zap size={9} /> Auto on {t.autoSendOnStage}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 truncate mt-0.5">{t.subject || <em>(no subject)</em>}</div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => onToggleEnabled(t.id, !t.enabled)}
                className={`p-1.5 rounded transition ${t.enabled ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                title={t.enabled ? 'Disable' : 'Enable'}
              >
                <Power size={14} />
              </button>
              <button
                onClick={() => onDuplicate(t.id)}
                className="p-1.5 rounded text-slate-500 hover:bg-slate-100 transition"
                title="Duplicate"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => onEdit(t.id)}
                className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50 transition"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => onDelete(t.id)}
                className="p-1.5 rounded text-rose-600 hover:bg-rose-50 transition"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplateEditor({ template, bundle, profile, onChange, onBack }) {
  const insertToken = (token) => {
    onChange({ body: (template.body || '') + token });
  };

  const rendered = useMemo(
    () => renderTemplate(template, SAMPLE_LEAD, profile, bundle, { agentName: profile?.email?.split('@')[0] }),
    [template, bundle, profile]
  );
  const missing = useMemo(() => findMissingValues(rendered), [rendered]);
  const testList = parseTestAddresses(bundle.testAddresses);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-indigo-700 hover:text-indigo-900 flex items-center gap-1"
      >
        <ChevronLeft size={12} /> Back to templates
      </button>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <Field label="Template name" hint="Just for your reference — agents see this when picking which template to send.">
          <input
            type="text"
            value={template.name}
            onChange={e => onChange({ name: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Welcome email"
          />
        </Field>

        <Field label="Subject">
          <input
            type="text"
            value={template.subject}
            onChange={e => onChange({ subject: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Welcome to USHEALTH, {customer_first_name}"
          />
        </Field>

        <Field label="Body" hint="Use the variable chips below to insert dynamic values.">
          <textarea
            value={template.body}
            onChange={e => onChange({ body: e.target.value })}
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
          <Field label="From name (optional)" hint="Leave blank to use your account email's name.">
            <input
              type="text"
              value={template.fromName}
              onChange={e => onChange({ fromName: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Juan Trejo"
            />
          </Field>
          <Field label="Auto-send trigger" hint="Fires automatically when a lead's stage changes to this value (with a 5-min grace window to cancel).">
            <select
              value={template.autoSendOnStage || ''}
              onChange={e => onChange({ autoSendOnStage: e.target.value || null })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Manual only</option>
              {AUTO_SEND_STAGES.map(s => <option key={s} value={s}>When stage → {s}</option>)}
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <input
            id={`enabled_${template.id}`}
            type="checkbox"
            checked={template.enabled !== false}
            onChange={e => onChange({ enabled: e.target.checked })}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label htmlFor={`enabled_${template.id}`} className="text-sm text-slate-700 cursor-pointer">
            Enabled — show in send picker and run auto-send when triggered.
          </label>
        </div>
      </div>

      {/* Polished HTML layout — banner + policy info card + signature
          shell. Agent edits the wording above; the HTML structure
          renders server-side and can't be broken. */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm text-slate-900">Polished layout (HTML)</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Banner + policy info card + signature wrap, branded with your accent palette from Profile.</p>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer flex-shrink-0">
            <input
              type="checkbox"
              checked={template.useHtmlRender === true}
              onChange={e => onChange({ useHtmlRender: e.target.checked })}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-xs font-semibold text-slate-700">{template.useHtmlRender ? 'On' : 'Off'}</span>
          </label>
        </div>

        {template.useHtmlRender && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <Field label="Closing line" hint="Short line above your signature.">
              <input
                type="text"
                value={template.closingLine || ''}
                onChange={e => onChange({ closingLine: e.target.value })}
                placeholder="Thank you for your business."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>

            <Field label="Verification call phone (optional)" hint="When set, the email shows: ‘You'll receive a call at this number to verify your application answers.' Leave blank to hide the verification card.">
              <input
                type="tel"
                value={template.verificationPhone || ''}
                onChange={e => onChange({ verificationPhone: e.target.value })}
                placeholder="(800) 555-0100"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={template.referralEnabled !== false}
                  onChange={e => onChange({ referralEnabled: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-slate-700">Include referral program card</span>
              </label>
              {template.referralEnabled !== false && (
                <Field label="Referral wording (optional)" hint="Leave blank to use the default $150–$200 bounty wording.">
                  <textarea
                    value={template.referralText || ''}
                    onChange={e => onChange({ referralText: e.target.value })}
                    rows={4}
                    placeholder="(Leave blank for the default wording — $150 to $200 referral bonus.)"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed"
                  />
                </Field>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={template.attachDearDoctorPdf !== false}
                  onChange={e => onChange({ attachDearDoctorPdf: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-slate-700">Attach &ldquo;Dear Doctor Letter&rdquo; PDF</span>
              </label>
              <p className="text-[11px] text-slate-500 mt-1 ml-6 leading-relaxed">
                Auto-picks the right PDF based on the lead&apos;s main product
                (Premier Advantage / Premier Choice / Secure Advantage / Health Access).
                Skipped silently for products without a matching PDF (ACA Wrap, Suppy).
              </p>
            </div>
          </div>
        )}
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
        {testList.length === 0 && (
          <div className="text-xs text-amber-700">Add at least one test address above before sending.</div>
        )}
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
