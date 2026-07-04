'use client';
import { useState, useRef, useEffect } from 'react';
import { X, Upload, Image as ImageIcon, Loader2, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { extractDealFromImage } from '@/lib/screenshotExtract';
import { CRMS, CAMPAIGNS, LEAD_CATEGORIES, SOURCES, OWNERS, MAIN_PRODUCTS, ADDON_PRODUCTS } from '@/lib/constants';
import { GlassModal } from './motion/MotionPrimitives';

const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

const Field = ({ label, children, hint }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">{label}</label>
    {children}
    {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
  </div>
);

export default function ScreenshotImport({ open, onClose, onCreateLead }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState(null);
  const fileRef = useRef(null);

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setFile(null); setPreviewUrl(''); setResult(null);
      setEdits(null); setProgress(0); setError(''); setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setResult(null);
    setError('');
  };

  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) {
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
      setResult(null);
      setError('');
    }
  };

  const runExtract = async () => {
    if (!file) return;
    setBusy(true); setError(''); setProgress(0);
    try {
      const { parsed, rawText, usedAi } = await extractDealFromImage(file, setProgress);
      setResult({ parsed, rawText, usedAi: !!usedAi });
      // Seed tracker-required fields with sensible defaults — agent edits
      // these before clicking Create Lead.
      setEdits({
        ...parsed,
        crm: 'RINGY',
        source: 'CRM',
        leadCategory: 'AGED',
        campaign: 'AGED.25',
        owner: 'You',
        leadCost: '',
      });
    } catch (e) {
      setError('OCR failed: ' + (e.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const setEdit = (patch) => setEdits(prev => ({ ...prev, ...patch }));

  const confirm = () => {
    if (!edits) return;
    // Map the extracted record onto a Lead patch. Tracker-required fields
    // (CRM, source, lead category, campaign, owner, leadCost) come from the
    // user-edited defaults — they can't be inferred from a USHA screenshot.
    // Compute age from DOB when DOB is present and age wasn't extracted
    // (or extraction returned 0). Saves the agent a step.
    let computedAge = Number(edits.age) || 0;
    if (!computedAge && edits.dob) {
      const dobDate = new Date(edits.dob);
      if (!isNaN(dobDate.getTime())) {
        const now = new Date();
        let yrs = now.getFullYear() - dobDate.getFullYear();
        const m = now.getMonth() - dobDate.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dobDate.getDate())) yrs--;
        if (yrs > 0 && yrs < 120) computedAge = yrs;
      }
    }
    const lead = {
      name: edits.name,
      phone: edits.phone,
      email: edits.email,
      state: edits.state,
      age: computedAge,
      stage: edits.stage || 'Issued',
      mainProduct: edits.mainProduct,
      mainProductPremium: Number(edits.monthlyPremium) || 0,
      policyNumber: edits.policyNumber,
      products: (edits.products || []).map(p => ({ id: p, premium: 0 })),
      // Association plan extracted by the AI path; preserved so the
      // Associations tab picks it up automatically.
      ...(edits.associationPlan ? { associationPlan: edits.associationPlan } : {}),
      closedDate: edits.applicationDate || new Date().toISOString().slice(0, 10),
      dateAdded: edits.applicationDate || new Date().toISOString().slice(0, 10),
      lastTouch: new Date().toISOString().slice(0, 10),
      // Tracker fields
      crm: edits.crm || 'RINGY',
      source: edits.source || 'CRM',
      leadCategory: edits.leadCategory || 'AGED',
      campaign: edits.campaign || 'AGED.25',
      owner: edits.owner || 'You',
      leadCost: Number(edits.leadCost) || 0,
      notes: [
        edits.gender && `Gender: ${edits.gender}`,
        edits.dob && `DOB: ${edits.dob}`,
        (edits.addressStreet || edits.addressCity) && `Addr: ${[edits.addressStreet, edits.addressCity].filter(Boolean).join(', ')}`,
        edits.zip && `ZIP: ${edits.zip}`,
        edits.indvOrFamily === 'Family' && 'Family policy',
        edits.effectiveDate && `Effective: ${edits.effectiveDate}`,
        edits.paidToDate && `Paid through: ${edits.paidToDate}`,
      ].filter(Boolean).join(' · '),
      // Family members on the policy — protects against partial-issuance
      // commission loss. Statement matcher will index this lead under each
      // dependent's name too, so a payout under the spouse/dependent name
      // routes back to this same lead.
      dependents: Array.isArray(edits.dependents)
        ? edits.dependents
            .filter(d => d?.name?.trim())
            .map(d => ({
              name: d.name.trim(),
              relationship: d.relationship || 'other',
              dob: d.dob || '',
            }))
        : [],
    };
    onCreateLead(lead);
    onClose();
  };

  return (
    <GlassModal open maxWidth="max-w-5xl" className="max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Import deal from screenshot</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Drop a USHA portal screenshot — we&apos;ll OCR it and pre-fill a new Lead.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-slate-200">
          {/* LEFT: image drop / preview */}
          <div className="p-5">
            <input type="file" ref={fileRef} accept="image/*" onChange={onPick} className="hidden" />
            {!previewUrl ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/30 rounded-xl p-12 text-center cursor-pointer transition"
              >
                <ImageIcon size={36} className="mx-auto text-slate-300 mb-3" />
                <div className="text-sm font-semibold text-slate-700">Drop a screenshot here</div>
                <div className="text-xs text-slate-500 mt-1">or click to browse</div>
                <div className="text-[11px] text-slate-400 mt-3">Works best on clean USHA portal pages (PNG/JPG)</div>
              </div>
            ) : (
              <div>
                <div className="relative bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                  <img src={previewUrl} alt="screenshot" className="max-h-96 w-full object-contain" />
                </div>
                <div className="flex items-center justify-between mt-3">
                  <button onClick={() => { setFile(null); setPreviewUrl(''); setResult(null); }}
                    className="text-xs text-slate-500 hover:text-slate-700">Choose different image</button>
                  {!result && (
                    <button onClick={runExtract} disabled={busy}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
                      {busy ? <><Loader2 size={14} className="animate-spin" /> Extracting… {progress}%</> : <><Upload size={14} /> Extract data</>}
                    </button>
                  )}
                </div>
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 mt-3 flex items-start gap-2">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{error}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: extracted fields (editable) */}
          <div className="p-5">
            {!result ? (
              <div className="text-center text-slate-400 py-12">
                <FileText size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Extracted fields will appear here</p>
                <p className="text-[11px] mt-1">First run downloads ~3MB OCR engine — subsequent runs are instant.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className={`rounded-lg p-3 flex items-start gap-2 ${result.usedAi ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                  <CheckCircle2 size={14} className={`${result.usedAi ? 'text-emerald-700' : 'text-amber-700'} mt-0.5 flex-shrink-0`} />
                  <div className={`text-xs ${result.usedAi ? 'text-emerald-900' : 'text-amber-900'}`}>
                    <div className="font-semibold flex items-center gap-1.5">
                      {result.usedAi ? (
                        <>Extracted via Claude Vision <span className="text-[9px] uppercase bg-emerald-200 text-emerald-900 rounded px-1 py-0.5 font-bold">AI</span></>
                      ) : (
                        <>Extracted via offline OCR <span className="text-[9px] uppercase bg-amber-200 text-amber-900 rounded px-1 py-0.5 font-bold">FALLBACK</span></>
                      )}
                    </div>
                    <div className="mt-0.5">
                      {result.usedAi
                        ? 'Review and edit anything that\'s wrong, then click "Create Lead."'
                        : 'AI extraction unavailable. Results may have garbled emails or missed phone numbers. Double-check before saving.'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name">
                    <input className={inp} value={edits.name || ''} onChange={e => setEdit({ name: e.target.value })} />
                  </Field>
                  <Field label="Stage">
                    <select className={inp} value={edits.stage || ''} onChange={e => setEdit({ stage: e.target.value })}>
                      <option value="">—</option>
                      <option>Pending</option>
                      <option>Issued</option>
                      <option>Declined</option>
                      <option>Withdrawn</option>
                      <option>Not taken</option>
                    </select>
                  </Field>
                  <Field label="Phone">
                    <input className={inp} value={edits.phone || ''} onChange={e => setEdit({ phone: e.target.value })} placeholder="(XXX) XXX-XXXX" />
                  </Field>
                  <Field label="Email">
                    <input className={inp} value={edits.email || ''} onChange={e => setEdit({ email: e.target.value })} />
                  </Field>
                  <Field label="DOB" hint="Used to auto-compute age.">
                    <input type="date" className={inp} value={edits.dob || ''} onChange={e => setEdit({ dob: e.target.value })} />
                  </Field>
                  <Field label="Age">
                    <input type="number" min={0} max={120} className={inp} value={edits.age || ''} onChange={e => setEdit({ age: e.target.value })} placeholder="Auto from DOB" />
                  </Field>
                  <Field label="Address (street)" hint="Optional — goes to lead notes.">
                    <input className={inp} value={edits.addressStreet || ''} onChange={e => setEdit({ addressStreet: e.target.value })} />
                  </Field>
                  <Field label="Address (city)">
                    <input className={inp} value={edits.addressCity || ''} onChange={e => setEdit({ addressCity: e.target.value })} />
                  </Field>
                  <Field label="State">
                    <input className={inp} value={edits.state || ''} onChange={e => setEdit({ state: e.target.value.toUpperCase() })} maxLength={2} />
                  </Field>
                  <Field label="ZIP">
                    <input className={inp} value={edits.zip || ''} onChange={e => setEdit({ zip: e.target.value })} />
                  </Field>
                  <Field label="Policy Number">
                    <input className={inp} value={edits.policyNumber || ''} onChange={e => setEdit({ policyNumber: e.target.value })} />
                  </Field>
                  <Field label="Monthly Premium">
                    <input type="number" step="0.01" className={inp} value={edits.monthlyPremium || ''} onChange={e => setEdit({ monthlyPremium: e.target.value })} />
                  </Field>
                  <Field label="Application Date">
                    <input type="date" className={inp} value={edits.applicationDate || ''} onChange={e => setEdit({ applicationDate: e.target.value })} />
                  </Field>
                  <Field label="Effective Date">
                    <input type="date" className={inp} value={edits.effectiveDate || ''} onChange={e => setEdit({ effectiveDate: e.target.value })} />
                  </Field>
                  <Field label="Main Product">
                    <select className={inp} value={edits.mainProduct || ''} onChange={e => setEdit({ mainProduct: e.target.value })}>
                      <option value="">— Select —</option>
                      {MAIN_PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                    </select>
                  </Field>
                  <Field label="Indv / Family">
                    <select className={inp} value={edits.indvOrFamily || 'Indv'} onChange={e => setEdit({ indvOrFamily: e.target.value })}>
                      <option value="Indv">Individual</option>
                      <option value="Family">Family</option>
                    </select>
                  </Field>
                </div>

                {/* Add-ons multi-select */}
                <Field label="Add-on Products" hint="Comes from the screenshot. Toggle to keep or drop.">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1">
                    {ADDON_PRODUCTS.map(ap => {
                      const checked = (edits.products || []).includes(ap.id);
                      return (
                        <label key={ap.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white rounded px-1 py-0.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(edits.products || []);
                              if (e.target.checked) next.add(ap.id); else next.delete(ap.id);
                              setEdit({ products: [...next] });
                            }}
                            className="accent-indigo-600"
                          />
                          <span className={checked ? 'text-slate-900 font-medium' : 'text-slate-500'}>{ap.id}</span>
                        </label>
                      );
                    })}
                  </div>
                </Field>

                {/* Family members on the policy — protects partial-issuance commissions */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-bold text-amber-900 tracking-wider uppercase">Family Members on Policy</div>
                      <div className="text-[10px] text-amber-700 mt-0.5">If primary is declined but a dependent gets approved, the statement comes back under their name. Adding them here makes sure the commission still routes to this lead.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEdit({ dependents: [...(edits.dependents || []), { name: '', relationship: 'spouse', dob: '' }] })}
                      className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded px-2 py-1 flex-shrink-0"
                    >
                      + Add
                    </button>
                  </div>
                  {(edits.dependents || []).length === 0 ? (
                    <div className="text-[11px] text-amber-700/70 italic">None detected. Click "Add" to add manually.</div>
                  ) : (
                    <div className="space-y-1">
                      {(edits.dependents || []).map((dep, i) => (
                        <div key={i} className="flex items-center gap-1.5 bg-white border border-amber-200 rounded px-1.5 py-1">
                          <input
                            className="flex-1 min-w-0 border border-slate-200 rounded px-1.5 py-0.5 text-xs"
                            placeholder="Full name"
                            value={dep.name || ''}
                            onChange={e => setEdit({
                              dependents: edits.dependents.map((d, j) => j === i ? { ...d, name: e.target.value } : d)
                            })}
                          />
                          <select
                            className="border border-slate-200 rounded px-1 py-0.5 text-[11px] w-20"
                            value={dep.relationship || 'spouse'}
                            onChange={e => setEdit({
                              dependents: edits.dependents.map((d, j) => j === i ? { ...d, relationship: e.target.value } : d)
                            })}
                          >
                            <option value="spouse">Spouse</option>
                            <option value="child">Child</option>
                            <option value="other">Other</option>
                          </select>
                          <input
                            type="date"
                            className="border border-slate-200 rounded px-1 py-0.5 text-[11px] w-32"
                            value={dep.dob || ''}
                            onChange={e => setEdit({
                              dependents: edits.dependents.map((d, j) => j === i ? { ...d, dob: e.target.value } : d)
                            })}
                          />
                          <button
                            type="button"
                            onClick={() => setEdit({ dependents: edits.dependents.filter((_, j) => j !== i) })}
                            className="text-red-500 hover:bg-red-50 px-1 py-0.5 rounded text-xs"
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tracker fields — not in screenshot, agent provides */}
                <div className="border-t border-slate-200 pt-3 mt-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Tracker info (not in screenshot)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="CRM">
                      <select className={inp} value={edits.crm || 'RINGY'} onChange={e => setEdit({ crm: e.target.value })}>
                        {CRMS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                      </select>
                    </Field>
                    <Field label="Lead Source">
                      <select className={inp} value={edits.source || 'CRM'} onChange={e => setEdit({ source: e.target.value })}>
                        {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </Field>
                    <Field label="Lead Category">
                      <select className={inp} value={edits.leadCategory || 'AGED'} onChange={e => setEdit({ leadCategory: e.target.value })}>
                        {LEAD_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                      </select>
                    </Field>
                    <Field label="Campaign">
                      <select className={inp} value={edits.campaign || 'AGED.25'} onChange={e => setEdit({ campaign: e.target.value })}>
                        {CAMPAIGNS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                      </select>
                    </Field>
                    <Field label="Owner">
                      <select className={inp} value={edits.owner || 'You'} onChange={e => setEdit({ owner: e.target.value })}>
                        {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Lead Cost ($)">
                      <input type="number" step="0.01" className={inp} value={edits.leadCost || ''} onChange={e => setEdit({ leadCost: e.target.value })} placeholder="0.00" />
                    </Field>
                  </div>
                </div>

                <details className="text-[11px] text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-700">Show raw OCR output (for debugging)</summary>
                  <pre className="bg-slate-50 border border-slate-200 rounded p-2 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">{result.rawText}</pre>
                </details>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-5 border-t border-slate-200">
          <button onClick={onClose} className="border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold">Cancel</button>
          <button
            onClick={confirm}
            disabled={!edits?.name && !edits?.policyNumber}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
          >
            <CheckCircle2 size={14} /> Create Lead
          </button>
        </div>
    </GlassModal>
  );
}
