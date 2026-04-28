'use client';
import { useState, useRef, useEffect } from 'react';
import { X, Upload, Image as ImageIcon, Loader2, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { extractDealFromImage } from '@/lib/screenshotExtract';

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
      const { parsed, rawText } = await extractDealFromImage(file, setProgress);
      setResult({ parsed, rawText });
      setEdits({ ...parsed });
    } catch (e) {
      setError('OCR failed: ' + (e.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const setEdit = (patch) => setEdits(prev => ({ ...prev, ...patch }));

  const confirm = () => {
    if (!edits) return;
    // Map the extracted record onto a Lead patch
    const lead = {
      name: edits.name,
      phone: edits.phone,
      email: edits.email,
      state: edits.state,
      stage: edits.stage || 'Issued',
      mainProduct: edits.mainProduct,
      mainProductPremium: Number(edits.monthlyPremium) || 0,
      policyNumber: edits.policyNumber,
      products: (edits.products || []).slice(1).map(p => ({ id: p, premium: 0 })),
      closedDate: edits.applicationDate || new Date().toISOString().slice(0, 10),
      dateAdded: edits.applicationDate || new Date().toISOString().slice(0, 10),
      lastTouch: new Date().toISOString().slice(0, 10),
      notes: [
        edits.gender && `Gender: ${edits.gender}`,
        edits.dob && `DOB: ${edits.dob}`,
        edits.zip && `ZIP: ${edits.zip}`,
        edits.indvOrFamily === 'Family' && 'Family policy',
        edits.effectiveDate && `Effective: ${edits.effectiveDate}`,
        edits.paidToDate && `Paid through: ${edits.paidToDate}`,
      ].filter(Boolean).join(' · '),
    };
    onCreateLead(lead);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto">
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
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2">
                  <CheckCircle2 size={14} className="text-emerald-700 mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-emerald-900">Extracted. Review and edit anything that&apos;s wrong, then click &quot;Create Lead.&quot;</span>
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
                    <input className={inp} value={edits.phone || ''} onChange={e => setEdit({ phone: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <input className={inp} value={edits.email || ''} onChange={e => setEdit({ email: e.target.value })} />
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
                    <input className={inp} value={edits.mainProduct || ''} onChange={e => setEdit({ mainProduct: e.target.value })} />
                  </Field>
                  <Field label="Indv / Family">
                    <select className={inp} value={edits.indvOrFamily || 'Indv'} onChange={e => setEdit({ indvOrFamily: e.target.value })}>
                      <option value="Indv">Individual</option>
                      <option value="Family">Family</option>
                    </select>
                  </Field>
                </div>

                {edits.products && edits.products.length > 1 && (
                  <Field label={`Add-on Products (${edits.products.length - 1})`} hint="Saved into the lead's products list. You can adjust premium per add-on after creating.">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs space-y-1">
                      {edits.products.slice(1).map((p, i) => <div key={i}>· {p}</div>)}
                    </div>
                  </Field>
                )}

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
      </div>
    </div>
  );
}
