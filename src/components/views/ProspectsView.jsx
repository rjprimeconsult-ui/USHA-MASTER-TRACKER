'use client';
import { useState, useMemo, useRef, useCallback } from 'react';
import {
  Plus, Search, LayoutGrid, List as ListIcon, Settings as SettingsIcon, Upload,
  Calendar, Phone, Mail, MapPin, ArrowRight, Trash2, X, AlertCircle, Clock, GripVertical,
  User, Home, Briefcase, FileText, Pencil, Pill, Activity, DollarSign, Tag,
} from 'lucide-react';
import { TiltCard, FadeIn, Stagger, StaggerItem } from '../motion/MotionPrimitives';
import { fmt2, today } from '@/lib/utils';
import { newProspect, defaultProspectSettings, detectFieldFromHeader, detectStageId, detectSource, detectIndvOrFamily, prospectDedupKey } from '@/lib/prospects';
import { DEFAULT_PROSPECT_STAGES } from '@/lib/constants';
import * as XLSX from 'xlsx';
import ProspectForm from '../ProspectForm';

const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

// ---------- helpers ----------
function timeUntil(isoDateTime) {
  const d = apptDate(isoDateTime);
  if (!d) return null;
  const t = d.getTime();
  const now = Date.now();
  const diffMs = t - now;
  if (diffMs > 0 && diffMs < 60 * 60 * 1000) return { mins: Math.round(diffMs / 60000), soon: true, past: false };
  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) return { hours: Math.round(diffMs / 3600000), soon: false, past: false };
  if (diffMs <= 0 && diffMs > -24 * 60 * 60 * 1000) return { mins: Math.round(-diffMs / 60000), soon: false, past: true };
  return null;
}

// Returns a formatted appointment string, OR null if the value isn't a real
// date. Used to be lenient (returned the raw input) but that allowed garbage
// (e.g. situation text accidentally mapped to appointmentTime during import)
// to display in the appointment column. Now we hard-validate.
function formatAppt(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (!s) return null;
  // Reject anything that doesn't look at least like a date string
  // (must contain digits and either dash, slash, or "T")
  if (!/\d/.test(s) || !/[-/T:]/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Filter out the unix epoch fallback (1970-01-01) which often comes from
  // bad parsing
  if (d.getFullYear() < 2000) return null;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Returns the parsed Date object (or null), used by filters
function apptDate(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (!s || !/\d/.test(s) || !/[-/T:]/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return null;
  return d;
}

function isToday(iso) {
  const d = apptDate(iso);
  if (!d) return false;
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

function isThisWeek(iso) {
  const d = apptDate(iso);
  if (!d) return false;
  const now = new Date();
  // Sunday = 0; treat Monday as start of week
  const day = now.getDay();
  const diffToMon = (day === 0 ? -6 : 1) - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  return d >= monday && d < sunday;
}

function isUpcoming(iso) {
  const d = apptDate(iso);
  if (!d) return false;
  return d.getTime() > Date.now();
}

function isOverdueAppt(iso, stage) {
  const d = apptDate(iso);
  if (!d) return false;
  if (['SOLD', 'LOST', 'GHOSTED'].includes(stage)) return false;
  return d.getTime() < Date.now() - 12 * 60 * 60 * 1000; // > 12h past
}

function isOverdueFollowup(p) {
  if (!p.lastContact) return false;
  const stalenessDays = (Date.now() - new Date(p.lastContact + 'T00:00:00').getTime()) / 86400000;
  // No appt scheduled and last contact > 5 days ago → overdue follow-up
  return !p.appointmentTime && stalenessDays > 5 && !['SOLD', 'LOST', 'GHOSTED'].includes(p.stage);
}

// ---------- Today Panel ----------
function TodayPanel({ prospects, onEdit }) {
  const todayAppts = prospects
    .filter(p => p.appointmentTime && isToday(p.appointmentTime) && !p.archivedAt)
    .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
  const overdue = prospects.filter(p => isOverdueFollowup(p) && !p.archivedAt).slice(0, 8);

  if (todayAppts.length === 0 && overdue.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 border border-indigo-100 rounded-xl p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar size={16} className="text-indigo-600" />
        <h3 className="text-sm font-bold text-slate-900 tracking-wide">TODAY</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] font-bold text-slate-500 tracking-wider mb-1.5">APPOINTMENTS</div>
          {todayAppts.length === 0 ? (
            <div className="text-xs text-slate-400 italic">No appointments today.</div>
          ) : (
            <div className="space-y-1.5">
              {todayAppts.map(p => {
                const tu = timeUntil(p.appointmentTime);
                const colorClass = tu?.soon ? 'bg-amber-100 text-amber-800 border-amber-200' :
                                  tu?.past ? 'bg-slate-100 text-slate-500 border-slate-200' :
                                  'bg-white text-slate-700 border-slate-200';
                return (
                  <button key={p.id} onClick={() => onEdit(p)}
                    className={`w-full text-left rounded-lg border px-3 py-2 hover:shadow-sm transition ${colorClass}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm truncate">{p.name || '(no name)'}</div>
                      <div className="text-xs whitespace-nowrap">{formatAppt(p.appointmentTime)}</div>
                    </div>
                    {p.phone && <div className="text-xs text-slate-500 mt-0.5">{p.phone}</div>}
                    {tu?.soon && <div className="text-[11px] font-bold text-amber-700 mt-0.5">In {tu.mins} min</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] font-bold text-slate-500 tracking-wider mb-1.5">OVERDUE FOLLOW-UPS</div>
          {overdue.length === 0 ? (
            <div className="text-xs text-slate-400 italic">All caught up.</div>
          ) : (
            <div className="space-y-1.5">
              {overdue.map(p => (
                <button key={p.id} onClick={() => onEdit(p)}
                  className="w-full text-left rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 hover:shadow-sm transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm text-slate-800 truncate">{p.name || '(no name)'}</div>
                    <div className="text-xs text-orange-700 whitespace-nowrap">last: {p.lastContact}</div>
                  </div>
                  {p.nextSteps && <div className="text-[11px] text-slate-600 mt-0.5 truncate">{p.nextSteps}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Kanban Card ----------
function KanbanCard({ prospect, onEdit, onDragStart }) {
  const tu = timeUntil(prospect.appointmentTime);
  const apptStr = formatAppt(prospect.appointmentTime);
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, prospect.id)}
      onClick={() => onEdit(prospect)}
      className="bg-white border border-slate-200 rounded-lg p-3 cursor-pointer hover:shadow-md hover:border-indigo-300 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-semibold text-sm text-slate-900 truncate">{prospect.name || '(no name)'}</div>
        {prospect.indvOrFamily === 'Family' && (
          <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">FAM</span>
        )}
      </div>
      {prospect.phone && (
        <div className="text-xs text-slate-500 flex items-center gap-1"><Phone size={11} /> {prospect.phone}</div>
      )}
      {prospect.state && (
        <div className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={11} /> {prospect.state} {prospect.timezone && `· ${prospect.timezone}`}</div>
      )}
      {apptStr && (
        <div className={`mt-1.5 text-[11px] px-2 py-1 rounded inline-flex items-center gap-1
          ${tu?.soon ? 'bg-amber-100 text-amber-800' :
            tu?.past ? 'bg-slate-100 text-slate-500' :
            'bg-indigo-50 text-indigo-700'}`}>
          <Clock size={10} /> {apptStr}
        </div>
      )}
      {prospect.quoteSize && (
        <div className="mt-1 text-[11px] font-semibold text-emerald-700">{prospect.quoteSize}</div>
      )}
      {prospect.source && (
        <div className="mt-1 text-[10px] text-slate-400">{prospect.source}</div>
      )}
    </div>
  );
}

// ---------- Kanban Column ----------
function KanbanColumn({ stage, prospects, onEdit, onDragStart, onDrop }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(stage.id); }}
      className={`flex-shrink-0 w-72 rounded-xl p-2.5 transition-colors ${over ? 'bg-indigo-50' : 'bg-slate-50'}`}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
          <span className="text-xs font-bold text-slate-700 tracking-wide uppercase">{stage.label}</span>
        </div>
        <span className="text-xs font-semibold text-slate-400">{prospects.length}</span>
      </div>
      <div className="space-y-2 min-h-[80px]">
        {prospects.map(p => (
          <KanbanCard key={p.id} prospect={p} onEdit={onEdit} onDragStart={onDragStart} />
        ))}
      </div>
    </div>
  );
}

// ---------- Settings Modal ----------
function SettingsModal({ open, settings, onSave, onClose }) {
  const [draft, setDraft] = useState(settings);
  if (!open) return null;

  const updateStage = (i, patch) => {
    setDraft(d => ({ ...d, stages: d.stages.map((s, idx) => idx === i ? { ...s, ...patch } : s) }));
  };
  const removeStage = (i) => setDraft(d => ({ ...d, stages: d.stages.filter((_, idx) => idx !== i) }));
  const addStage = () => setDraft(d => ({ ...d, stages: [...d.stages, { id: 'STAGE_' + Date.now(), label: 'New Stage', color: '#6366f1' }] }));
  const moveStage = (i, dir) => {
    setDraft(d => {
      const next = [...d.stages];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, stages: next };
    });
  };

  const updateField = (i, patch) => {
    setDraft(d => ({ ...d, customFields: d.customFields.map((f, idx) => idx === i ? { ...f, ...patch } : f) }));
  };
  const removeField = (i) => setDraft(d => ({ ...d, customFields: d.customFields.filter((_, idx) => idx !== i) }));
  const addField = () => setDraft(d => ({ ...d, customFields: [...d.customFields, { id: 'cf_' + Date.now(), label: 'New Field', type: 'text', options: [] }] }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">Prospects Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-6">
          {/* Stages */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-900">Pipeline Stages</h3>
              <button onClick={addStage} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"><Plus size={12} /> Add stage</button>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">Drag to reorder, rename freely. Renaming or deleting a stage will keep prospects on it but they'll show as "{`<stage id>`}" until you rename to match.</p>
            <div className="space-y-1.5">
              {draft.stages.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                  <div className="flex flex-col">
                    <button onClick={() => moveStage(i, -1)} className="text-slate-400 hover:text-slate-700 text-xs">▲</button>
                    <button onClick={() => moveStage(i, 1)} className="text-slate-400 hover:text-slate-700 text-xs">▼</button>
                  </div>
                  <input type="color" value={s.color} onChange={e => updateStage(i, { color: e.target.value })} className="w-8 h-8 rounded cursor-pointer border-0" />
                  <input className={`${inp} flex-1`} value={s.label} onChange={e => updateStage(i, { label: e.target.value })} />
                  <button onClick={() => removeStage(i)} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </section>

          {/* Custom fields */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-900">Custom Fields</h3>
              <button onClick={addField} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"><Plus size={12} /> Add field</button>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">Add fields specific to your workflow. They'll appear on every prospect form.</p>
            {draft.customFields.length === 0 && (
              <div className="text-xs text-slate-400 italic">No custom fields yet.</div>
            )}
            <div className="space-y-1.5">
              {draft.customFields.map((f, i) => (
                <div key={f.id} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2 flex-wrap">
                  <input className={`${inp} flex-1 min-w-[160px]`} value={f.label} onChange={e => updateField(i, { label: e.target.value })} placeholder="Field label" />
                  <select className={`${inp} w-32`} value={f.type} onChange={e => updateField(i, { type: e.target.value })}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="dropdown">Dropdown</option>
                  </select>
                  {f.type === 'dropdown' && (
                    <input className={`${inp} flex-1 min-w-[200px]`} value={(f.options || []).join(', ')}
                      onChange={e => updateField(i, { options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })}
                      placeholder="Option 1, Option 2, ..." />
                  )}
                  <button onClick={() => removeField(i)} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-slate-200">
          <button onClick={onClose} className="border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold">Cancel</button>
          <button onClick={() => { onSave(draft); onClose(); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">Save Settings</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Import Wizard ----------
function ImportWizard({ open, file, settings, prospects, onImport, onClose }) {
  const [step, setStep] = useState('preview'); // 'preview' | 'mapping' | 'done'
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState('');

  // Load file once when modal opens with a file
  useMemo(() => {
    if (!open || !file) return;
    setError('');
    (async () => {
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        if (!data || data.length < 2) { setError('Empty or unreadable file.'); return; }
        // Smarter header-row detection: scan the first 12 rows and pick the
        // one with the MOST recognized field names. This handles spreadsheets
        // that start with section labels ("APPOINTMENT SET" etc.) before the
        // actual column headers, or a title row above the headers.
        let headerRowIdx = 0;
        let headerScore = -1;
        for (let i = 0; i < Math.min(data.length, 12); i++) {
          const row = data[i] || [];
          let score = 0;
          for (const cell of row) {
            if (detectFieldFromHeader(cell)) score++;
          }
          if (score > headerScore) {
            headerScore = score;
            headerRowIdx = i;
          }
        }
        // Fallback: if nothing matched any known field, use first non-empty row
        if (headerScore <= 0) {
          for (let i = 0; i < Math.min(data.length, 6); i++) {
            if (data[i].some(c => String(c || '').trim())) { headerRowIdx = i; break; }
          }
        }
        const hdr = data[headerRowIdx].map(c => String(c || '').trim());
        const body = data.slice(headerRowIdx + 1).filter(row => row.some(c => String(c || '').trim()));
        setHeaders(hdr);
        setRows(body);
        // Auto-map columns
        const auto = {};
        hdr.forEach((h, i) => {
          const f = detectFieldFromHeader(h);
          if (f) auto[i] = f;
        });
        setMapping(auto);
        setStep('mapping');
      } catch (e) {
        setError('Could not read file: ' + (e.message || e));
      }
    })();
  }, [open, file]);

  if (!open) return null;

  const FIELD_OPTIONS = [
    ['', '— Skip column —'],
    ['name', 'Name'],
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['state', 'State'],
    ['zip', 'ZIP'],
    ['timezone', 'Time Zone'],
    ['indvOrFamily', 'Indv/Family'],
    ['dobs', 'DOB(s)'],
    ['income', 'Income'],
    ['quoteSize', 'Quote Size'],
    ['policyType', 'Policy Type'],
    ['meds', 'Meds'],
    ['situation', 'Situation/Notes'],
    ['startDate', 'Start Date'],
    ['source', 'Lead Source'],
    ['referrer', 'Referrer'],
    ['crm', 'CRM'],
    ['stage', 'Stage'],
    ['appointmentTime', 'Appointment Time'],
    ['nextSteps', 'Next Steps'],
    ['lastContact', 'Last Contact'],
  ];

  const doImport = () => {
    const existingKeys = new Set(prospects.map(prospectDedupKey));
    const fresh = [];
    let dups = 0;
    for (const row of rows) {
      const p = newProspect({});
      for (const [colIdx, field] of Object.entries(mapping)) {
        if (!field) continue;
        const val = String(row[colIdx] ?? '').trim();
        if (!val) continue;
        if (field === 'stage')              p.stage = detectStageId(val, settings.stages);
        else if (field === 'source')        p.source = detectSource(val);
        else if (field === 'indvOrFamily')  p.indvOrFamily = detectIndvOrFamily(val);
        else                                p[field] = val;
      }
      // Skip rows with neither name nor phone
      if (!p.name && !p.phone) continue;
      const key = prospectDedupKey(p);
      if (existingKeys.has(key)) { dups++; continue; }
      existingKeys.add(key);
      fresh.push(p);
    }
    onImport(fresh, dups);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Import Prospects</h2>
            <p className="text-xs text-slate-500 mt-0.5">{file?.name} · {rows.length} rows</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 mb-4 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{error}</span>
            </div>
          )}
          {step === 'mapping' && (
            <>
              <p className="text-sm text-slate-700 mb-3">
                Map your columns to prospect fields. We auto-matched what we recognized — adjust anything that's wrong.
              </p>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-lg p-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-700 truncate">{h || `(column ${i + 1})`}</div>
                      <div className="text-[11px] text-slate-400 truncate">e.g. {String(rows[0]?.[i] ?? '').slice(0, 40) || '(empty)'}</div>
                    </div>
                    <ArrowRight size={14} className="text-slate-300" />
                    <select className={`${inp} w-56`}
                      value={mapping[i] || ''}
                      onChange={e => setMapping(m => ({ ...m, [i]: e.target.value }))}>
                      {FIELD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-slate-200">
          <button onClick={onClose} className="border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold">Cancel</button>
          <button onClick={doImport} disabled={!!error || rows.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg text-sm font-semibold">
            Import {rows.length} prospects
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Detail Bubble (read-only summary card) ----------
function DetailRow({ Icon, label, value, valueClass = '' }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-2.5 text-sm py-1.5">
      <Icon size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        {label && <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">{label}</div>}
        <div className={`text-slate-800 ${valueClass} break-words`}>{value}</div>
      </div>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-bold text-slate-900 mb-2">{title}</h3>
      <div className="divide-y divide-slate-100 -my-1.5">{children}</div>
    </div>
  );
}

function ProspectDetail({ open, prospect, settings, onClose, onEdit, onDelete, onConvertToLead }) {
  if (!open || !prospect) return null;
  const stage = settings.stages.find(s => s.id === prospect.stage);
  const stageColor = stage?.color || '#64748b';
  const stageLabel = stage?.label || prospect.stage;
  const isSold = prospect.stage === 'SOLD';
  const created = prospect.createdAt ? new Date(prospect.createdAt) : null;
  const daysSinceCreated = created ? Math.floor((Date.now() - created.getTime()) / 86400000) : null;
  const apptD = apptDate(prospect.appointmentTime);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* Hero header */}
        <div className="bg-white rounded-t-2xl border-b border-slate-200 p-6 relative">
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1">
            <X size={20} />
          </button>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: stageColor + '22', color: stageColor }}>
              {stageLabel}
            </span>
            {prospect.indvOrFamily === 'Family' && (
              <span className="text-[11px] font-bold text-violet-700 bg-violet-100 px-2.5 py-1 rounded-full">FAMILY</span>
            )}
            {prospect.source && (
              <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{prospect.source}</span>
            )}
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{prospect.name || '(no name)'}</h2>
          <div className="text-sm text-slate-500 mt-1 space-y-0.5">
            {prospect.quoteSize && (
              <div className="flex items-center gap-1.5"><DollarSign size={14} className="text-emerald-600" /><span className="text-emerald-700 font-semibold">Quote: {prospect.quoteSize}</span></div>
            )}
            {created && (
              <div>Added: {created.toLocaleDateString()} ({daysSinceCreated} day{daysSinceCreated !== 1 ? 's' : ''} ago)</div>
            )}
            {apptD && (
              <div className="font-semibold text-indigo-700">Appointment: {apptD.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            )}
          </div>
        </div>

        {/* Body sections */}
        <div className="p-4 space-y-3">
          {/* Primary Information */}
          <DetailSection title="Primary Information">
            <DetailRow Icon={User} value={prospect.indvOrFamily === 'Family' ? 'Family policy' : 'Individual'} />
            {prospect.dobs && <DetailRow Icon={Calendar} value={prospect.dobs} />}
            {prospect.phone && <DetailRow Icon={Phone} value={<a href={`tel:${prospect.phone}`} className="text-indigo-700 hover:underline">{prospect.phone}</a>} />}
            {prospect.email && <DetailRow Icon={Mail} value={<a href={`mailto:${prospect.email}`} className="text-indigo-700 hover:underline break-all">{prospect.email}</a>} />}
            {(prospect.state || prospect.zip || prospect.timezone) && (
              <DetailRow Icon={Home} value={[prospect.state, prospect.zip, prospect.timezone].filter(Boolean).join(' · ')} />
            )}
          </DetailSection>

          {/* Pipeline Activity */}
          {(prospect.lastContact || prospect.appointmentTime || prospect.nextSteps || prospect.crm) && (
            <DetailSection title="Pipeline Activity">
              {prospect.appointmentTime && (
                <DetailRow Icon={Clock} label="Appointment" value={apptD?.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} valueClass="font-semibold" />
              )}
              {prospect.lastContact && (
                <DetailRow Icon={Activity} label="Last Contact" value={prospect.lastContact} />
              )}
              {prospect.nextSteps && (
                <DetailRow Icon={ArrowRight} label="Next Steps" value={prospect.nextSteps} valueClass="font-medium" />
              )}
              {prospect.crm && prospect.crm !== 'None' && (
                <DetailRow Icon={Tag} label="CRM" value={prospect.crm} />
              )}
              {prospect.referrer && (
                <DetailRow Icon={User} label="Referred By" value={prospect.referrer} />
              )}
            </DetailSection>
          )}

          {/* Coverage Needs */}
          {(prospect.policyType || prospect.income || prospect.quoteSize || prospect.startDate) && (
            <DetailSection title="Coverage Needs">
              {prospect.policyType && <DetailRow Icon={Briefcase} label="Policy Type" value={prospect.policyType} />}
              {prospect.income && <DetailRow Icon={DollarSign} label="Income" value={prospect.income} />}
              {prospect.quoteSize && <DetailRow Icon={DollarSign} label="Quote Size" value={prospect.quoteSize} valueClass="font-semibold text-emerald-700" />}
              {prospect.startDate && <DetailRow Icon={Calendar} label="Desired Start" value={prospect.startDate} />}
            </DetailSection>
          )}

          {/* Notes / Health */}
          {(prospect.situation || prospect.meds) && (
            <DetailSection title="Situation & Health">
              {prospect.meds && <DetailRow Icon={Pill} label="Meds / Conditions" value={prospect.meds} />}
              {prospect.situation && <DetailRow Icon={FileText} label="Notes" value={prospect.situation} />}
            </DetailSection>
          )}

          {/* Custom fields */}
          {settings.customFields?.length > 0 && Object.values(prospect.custom || {}).some(v => v !== '' && v != null) && (
            <DetailSection title="Custom Fields">
              {settings.customFields.map(cf => {
                const v = prospect.custom?.[cf.id];
                if (v === '' || v == null) return null;
                return <DetailRow key={cf.id} Icon={Tag} label={cf.label} value={String(v)} />;
              })}
            </DetailSection>
          )}
        </div>

        {/* Action footer */}
        <div className="bg-white border-t border-slate-200 rounded-b-2xl p-4 flex items-center justify-between gap-2 sticky bottom-0">
          <button onClick={() => onDelete(prospect.id)}
            className="text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
            <Trash2 size={14} /> Delete
          </button>
          <div className="flex gap-2">
            {isSold && (
              <button onClick={() => onConvertToLead(prospect)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
                <ArrowRight size={14} /> Convert to Lead
              </button>
            )}
            <button onClick={() => onEdit(prospect)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
              <Pencil size={14} /> Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Main View ----------
export default function ProspectsView({
  prospects = [],
  settings,
  onAdd,
  onUpdate,
  onDelete,
  onBulkAdd,
  onSaveSettings,
  onConvertToLead,
}) {
  const cfg = settings || defaultProspectSettings();
  const [view, setView] = useState('kanban'); // 'kanban' | 'list'
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [apptFilter, setApptFilter] = useState(''); // '' | 'today' | 'week' | 'upcoming' | 'overdue' | 'none'
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);  // read-only detail bubble
  const [showSettings, setShowSettings] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const fileRef = useRef(null);
  const dragId = useRef(null);

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    return prospects.filter(p => {
      if (p.archivedAt) return false;
      if (stageFilter && p.stage !== stageFilter) return false;
      if (apptFilter) {
        if (apptFilter === 'today'    && !isToday(p.appointmentTime)) return false;
        if (apptFilter === 'week'     && !isThisWeek(p.appointmentTime)) return false;
        if (apptFilter === 'upcoming' && !isUpcoming(p.appointmentTime)) return false;
        if (apptFilter === 'overdue'  && !isOverdueAppt(p.appointmentTime, p.stage)) return false;
        if (apptFilter === 'none'     && apptDate(p.appointmentTime)) return false;
      }
      if (!q) return true;
      const blob = `${p.name} ${p.phone} ${p.email} ${p.state} ${p.notes} ${p.situation} ${p.referrer}`.toLowerCase();
      return blob.includes(q);
    });
  }, [prospects, search, stageFilter, apptFilter]);

  const grouped = useMemo(() => {
    const map = new Map(cfg.stages.map(s => [s.id, []]));
    for (const p of visible) {
      if (!map.has(p.stage)) map.set(p.stage, []);
      map.get(p.stage).push(p);
    }
    return map;
  }, [visible, cfg.stages]);

  const totals = useMemo(() => {
    const active = prospects.filter(p => !p.archivedAt && !['SOLD', 'LOST'].includes(p.stage));
    const apptsToday = prospects.filter(p => p.appointmentTime && isToday(p.appointmentTime) && !p.archivedAt).length;
    const sold = prospects.filter(p => p.stage === 'SOLD').length;
    return { active: active.length, apptsToday, sold };
  }, [prospects]);

  const onDragStart = (e, id) => { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; };
  const onDrop = (stageId) => {
    if (!dragId.current) return;
    const p = prospects.find(x => x.id === dragId.current);
    if (p && p.stage !== stageId) onUpdate({ ...p, stage: stageId });
    dragId.current = null;
  };

  const startNew = () => setEditing(newProspect({ createdAt: '' }));
  // Click anywhere a row/card → open the read-only detail bubble.
  // The bubble has its own Edit button which switches to the form.
  const onView = (p) => setViewing(p);
  const onEdit = (p) => { setViewing(null); setEditing(p); };
  const onSave = (p) => {
    const isNew = !p.createdAt;
    const final = isNew ? { ...p, createdAt: new Date().toISOString() } : p;
    if (isNew) onAdd(final); else onUpdate(final);
    setEditing(null);
  };
  const onDeleteWrap = (id) => { onDelete(id); setEditing(null); };
  const onConvertWrap = (p) => {
    onConvertToLead({ ...p, createdAt: p.createdAt || new Date().toISOString() });
    setEditing(null);
  };

  // ----- Bulk selection helpers -----
  const allVisibleSelected = visible.length > 0 && visible.every(p => selected.has(p.id));
  const toggleOne = (id, e) => {
    if (e) e.stopPropagation();
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelected(s => {
        const next = new Set(s);
        visible.forEach(p => next.delete(p.id));
        return next;
      });
    } else {
      setSelected(s => {
        const next = new Set(s);
        visible.forEach(p => next.add(p.id));
        return next;
      });
    }
  };
  const clearSelection = () => setSelected(new Set());
  const bulkDelete = () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} prospect${selected.size !== 1 ? 's' : ''}? This can't be undone.`)) return;
    selected.forEach(id => onDelete(id));
    clearSelection();
  };
  const bulkSetStage = (stageId) => {
    if (selected.size === 0 || !stageId) return;
    selected.forEach(id => {
      const p = prospects.find(x => x.id === id);
      if (p && p.stage !== stageId) onUpdate({ ...p, stage: stageId });
    });
    clearSelection();
  };

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (f) setImportFile(f);
    if (fileRef.current) fileRef.current.value = '';
  };
  const onImportDone = (fresh, dups) => {
    if (fresh.length) onBulkAdd(fresh);
    setImportFile(null);
    alert(`Imported ${fresh.length} prospects${dups ? ` · ${dups} duplicates skipped` : ''}.`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Prospects</h1>
          <p className="text-sm text-slate-500">{totals.active} active · {totals.apptsToday} appt{totals.apptsToday !== 1 ? 's' : ''} today · {totals.sold} sold all-time</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls" onChange={onPickFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()}
            className="border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5">
            <Upload size={14} /> Import
          </button>
          <button onClick={() => setShowSettings(true)}
            className="border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5">
            <SettingsIcon size={14} /> Settings
          </button>
          <button onClick={startNew}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5">
            <Plus size={14} /> New Prospect
          </button>
        </div>
      </div>

      {/* Today panel */}
      <TodayPanel prospects={prospects} onEdit={onView} />

      {/* Bulk action bar — only when something is selected and we're in List view */}
      {selected.size > 0 && view === 'list' && (
        <div className="bg-indigo-600 text-white rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap shadow-lg">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{selected.size} selected</span>
            <button onClick={clearSelection} className="text-xs underline opacity-80 hover:opacity-100">clear</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              defaultValue=""
              onChange={(e) => { bulkSetStage(e.target.value); e.target.value = ''; }}
              className="bg-indigo-700 border border-indigo-500 text-white text-xs font-semibold rounded-lg px-3 py-1.5 cursor-pointer"
            >
              <option value="" disabled>Move to stage…</option>
              {cfg.stages.map(s => <option key={s.id} value={s.id} className="bg-white text-slate-900">{s.label}</option>)}
            </select>
            <button onClick={bulkDelete}
              className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5">
              <Trash2 size={12} /> Delete {selected.size}
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search name, phone, email..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All stages</option>
          {cfg.stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={apptFilter} onChange={e => setApptFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm" title="Filter by appointment time">
          <option value="">Any time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="upcoming">Upcoming</option>
          <option value="overdue">Overdue</option>
          <option value="none">No appointment</option>
        </select>
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setView('kanban')}
            className={`px-3 py-1.5 text-xs font-semibold rounded flex items-center gap-1.5 ${view === 'kanban' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            <LayoutGrid size={12} /> Kanban
          </button>
          <button onClick={() => setView('list')}
            className={`px-3 py-1.5 text-xs font-semibold rounded flex items-center gap-1.5 ${view === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
            <ListIcon size={12} /> List
          </button>
        </div>
      </div>

      {/* Empty state */}
      {prospects.length === 0 && (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
          <h3 className="text-lg font-bold text-slate-900 mb-1">No prospects yet</h3>
          <p className="text-sm text-slate-500 mb-4">Add your first prospect or import from a CSV/Excel file (your existing pipeline works).</p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={startNew} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold">+ New Prospect</button>
            <button onClick={() => fileRef.current?.click()} className="border border-slate-200 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold">Import file</button>
          </div>
        </div>
      )}

      {/* Kanban */}
      {prospects.length > 0 && view === 'kanban' && (
        <div className="overflow-x-auto pb-3">
          <div className="flex gap-3 min-w-min">
            {cfg.stages.map(s => (
              <KanbanColumn
                key={s.id}
                stage={s}
                prospects={grouped.get(s.id) || []}
                onEdit={onView}
                onDragStart={onDragStart}
                onDrop={onDrop}
              />
            ))}
          </div>
        </div>
      )}

      {/* List — compact 3-column layout: Name · Phone · Appt time + Stage.
          Click any row to open the read-only detail bubble. */}
      {prospects.length > 0 && view === 'list' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5 text-left border-b-2 border-slate-200 border-r border-slate-200 w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    className="cursor-pointer accent-indigo-600 w-4 h-4"
                    title="Select all visible"
                  />
                </th>
                <th className="px-4 py-2.5 text-left border-b-2 border-slate-200 border-r border-slate-200">Name</th>
                <th className="px-4 py-2.5 text-left border-b-2 border-slate-200 border-r border-slate-200 w-44">Phone</th>
                <th className="px-4 py-2.5 text-left border-b-2 border-slate-200 border-r border-slate-200 w-56">Appointment</th>
                <th className="px-4 py-2.5 text-right border-b-2 border-slate-200 w-40">Stage</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const st = cfg.stages.find(s => s.id === p.stage);
                const tu = timeUntil(p.appointmentTime);
                const apptStr = formatAppt(p.appointmentTime);
                const isSel = selected.has(p.id);
                return (
                  <tr
                    key={p.id}
                    onClick={() => onView(p)}
                    className={`cursor-pointer transition border-b border-slate-200 last:border-b-0 ${isSel ? 'bg-indigo-50' : 'hover:bg-indigo-50/40'}`}
                  >
                    <td className="px-3 py-3 border-r border-slate-200 align-middle" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={(e) => toggleOne(p.id, e)}
                        className="cursor-pointer accent-indigo-600 w-4 h-4"
                      />
                    </td>
                    <td className="px-4 py-3 border-r border-slate-200 align-middle">
                      <div className="font-semibold text-slate-900 truncate flex items-center gap-2">
                        {p.name || '(no name)'}
                        {p.indvOrFamily === 'Family' && (
                          <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">FAM</span>
                        )}
                      </div>
                      {p.source && (
                        <div className="text-[11px] text-slate-400 mt-0.5">{p.source}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-200 text-slate-700 align-middle">
                      {p.phone || <span className="text-slate-400 italic text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-200 align-middle">
                      {apptStr ? (
                        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium
                          ${tu?.soon ? 'bg-amber-100 text-amber-800' :
                            tu?.past ? 'bg-slate-100 text-slate-500' :
                            'bg-blue-50 text-blue-700'}`}>
                          <Clock size={11} />
                          <span>{apptStr}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-xs">No appointment</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle text-right">
                      <span
                        className="text-[11px] font-bold px-2.5 py-1 rounded-md whitespace-nowrap inline-block"
                        style={{
                          background: (st?.color || '#64748b') + '22',
                          color: st?.color || '#64748b',
                          border: `1px solid ${(st?.color || '#64748b')}44`,
                        }}
                      >
                        {st?.label || p.stage}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan="5" className="px-4 py-8 text-center text-slate-400 italic text-sm">No prospects match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <ProspectDetail
        open={!!viewing}
        prospect={viewing}
        settings={cfg}
        onClose={() => setViewing(null)}
        onEdit={onEdit}
        onDelete={(id) => { setViewing(null); onDeleteWrap(id); }}
        onConvertToLead={(p) => { setViewing(null); onConvertWrap(p); }}
      />
      <ProspectForm
        open={!!editing}
        prospect={editing}
        stages={cfg.stages}
        customFields={cfg.customFields}
        onSave={onSave}
        onClose={() => setEditing(null)}
        onDelete={onDeleteWrap}
        onConvertToLead={onConvertWrap}
      />
      <SettingsModal open={showSettings} settings={cfg} onSave={onSaveSettings} onClose={() => setShowSettings(false)} />
      <ImportWizard open={!!importFile} file={importFile} settings={cfg} prospects={prospects}
        onImport={onImportDone} onClose={() => setImportFile(null)} />
    </div>
  );
}
