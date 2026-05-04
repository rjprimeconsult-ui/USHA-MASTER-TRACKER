'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  X, Settings, BookOpen, History, Brain, DollarSign, Trash2, AlertCircle,
  CheckCircle2, Loader2, FileText, Eye, ChevronDown, ChevronRight, Save, Plus,
} from 'lucide-react';
import { loadUserRubric, saveUserRubric, MAX_RUBRIC_LENGTH } from '@/lib/userRubric';
import {
  loadImportHistory, deleteImportHistoryEntry, clearImportHistory, summarizeUsage,
} from '@/lib/importHistory';
import { loadVendorMemory, saveVendorMemory, recordVendor, normalizeVendor } from '@/lib/vendorMemory';
import { useCategoriesAll } from '@/lib/customCategories';
import { PLATFORMS } from '@/lib/constants';

/**
 * Per-agent settings hub.
 *
 * Tabs:
 *   - Rubric: free-form notes the user can add to bias the AI in their style
 *   - History: every Smart Import they've run (audit trail + reuse)
 *   - Vendor memory: confirmed vendor->category mappings (clear/inspect)
 *   - Cost: per-month AI spend rollup
 */
export default function AgentSettingsPanel({ open, onClose }) {
  const [tab, setTab] = useState('rubric');
  const [rubric, setRubric] = useState({ expense: '', lead: '', prospect: '' });
  const [rubricDraft, setRubricDraft] = useState({ expense: '', lead: '', prospect: '' });
  const [savingRubric, setSavingRubric] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [history, setHistory] = useState({ entries: [] });
  const [vendorMemory, setVendorMemory] = useState({});
  const [historyExpanded, setHistoryExpanded] = useState(null);

  useEffect(() => {
    if (!open) return;
    loadUserRubric().then(r => { setRubric(r); setRubricDraft(r); });
    loadImportHistory().then(setHistory);
    loadVendorMemory().then(setVendorMemory);
  }, [open]);

  // Hooks MUST be declared before any early return. React tracks hooks by
  // call order — if `open` is false on one render and true on the next,
  // any hook below an early return would shift position and crash with
  // React error #310.
  // `since` recomputes each render — that's fine because the memo only
  // re-runs when [history, since30d] change, and since30d only changes
  // every minute or so (the millisecond drift doesn't affect the rollup).
  // eslint-disable-next-line react-hooks/purity
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const usage30d = useMemo(() => summarizeUsage(history.entries, since30d), [history, since30d]);
  const usageAllTime = useMemo(() => summarizeUsage(history.entries), [history]);

  if (!open) return null;

  const dirty = JSON.stringify(rubric) !== JSON.stringify(rubricDraft);

  const persistRubric = async () => {
    setSavingRubric(true);
    try {
      const saved = await saveUserRubric(rubricDraft);
      setRubric(saved);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } finally {
      setSavingRubric(false);
    }
  };

  const vendorMemoryCount = Object.keys(vendorMemory || {}).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-br from-indigo-50 to-violet-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg">
              <Settings size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">PRIM Settings</h2>
              <p className="text-xs text-slate-500">Tune the AI to your style — your rubric, your history, your memory</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-200 px-5 bg-white flex gap-1">
          <TabBtn active={tab === 'rubric'} onClick={() => setTab('rubric')} icon={<BookOpen size={14} />} label="My Rubric" />
          <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={<History size={14} />} label={`History (${history.entries.length})`} />
          <TabBtn active={tab === 'memory'} onClick={() => setTab('memory')} icon={<Brain size={14} />} label={`Vendor memory (${vendorMemoryCount})`} />
          <TabBtn active={tab === 'cost'} onClick={() => setTab('cost')} icon={<DollarSign size={14} />} label="AI cost" />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'rubric' && (
            <div className="space-y-4">
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900 mb-1">What is "My Rubric"?</p>
                <p>Free-form notes (1-3 sentences each) that get added to the AI's instructions for every Smart Import. Use them to teach the AI your specific habits — vendor names it doesn't know yet, categories you always prefer, edge cases it tends to miss.</p>
              </div>
              <RubricField
                label="Expense / Income imports"
                hint='e.g. "I always file Costco runs as Office Supplies, not Meals." or "TextDrip charges might appear as TXTDR LLC on my Amex statement."'
                value={rubricDraft.expense}
                onChange={(v) => setRubricDraft(r => ({ ...r, expense: v }))}
              />
              <RubricField
                label="Lead imports"
                hint='e.g. "Leads from Maria are always D7 Bizz Lead category, even if the source column says Other."'
                value={rubricDraft.lead}
                onChange={(v) => setRubricDraft(r => ({ ...r, lead: v }))}
              />
              <RubricField
                label="Prospect imports"
                hint='e.g. "Calls marked WEBBY in my CRM should map to WEBBY_SET stage, not APPOINTMENT_SET."'
                value={rubricDraft.prospect}
                onChange={(v) => setRubricDraft(r => ({ ...r, prospect: v }))}
              />
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500">
                  {savedFlash && <span className="text-emerald-700 flex items-center gap-1"><CheckCircle2 size={12} /> Saved — applies on next import</span>}
                </div>
                <button
                  onClick={persistRubric}
                  disabled={!dirty || savingRubric}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
                >
                  {savingRubric ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save changes
                </button>
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-2">
              {history.entries.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  No imports yet — your run history will show up here.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-slate-500">{history.entries.length} most-recent import{history.entries.length !== 1 ? 's' : ''}</div>
                    <button
                      onClick={async () => { if (window.confirm('Clear all import history?')) { await clearImportHistory(); setHistory({ entries: [] }); } }}
                      className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1"
                    >
                      <Trash2 size={11} /> Clear all
                    </button>
                  </div>
                  {history.entries.map(entry => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      expanded={historyExpanded === entry.id}
                      onToggle={() => setHistoryExpanded(historyExpanded === entry.id ? null : entry.id)}
                      onDelete={async () => { await deleteImportHistoryEntry(entry.id); setHistory(h => ({ entries: h.entries.filter(e => e.id !== entry.id) })); }}
                    />
                  ))}
                </>
              )}
            </div>
          )}

          {tab === 'memory' && (
            <div className="space-y-3">
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900 mb-1">Vendor memory ({vendorMemoryCount})</p>
                <p>Confirmed mappings the AI applies automatically on future imports. Delete a mapping to let the AI re-decide next time, or add a new rule below to set one up before your next import.</p>
              </div>

              <ManualRuleForm
                onAdd={async (rule) => {
                  const next = recordVendor({ ...vendorMemory }, rule);
                  setVendorMemory(next);
                  await saveVendorMemory(next);
                }}
              />

              {vendorMemoryCount === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  No vendor memory yet — add a rule above, or every category you confirm in Smart Import gets remembered here.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-end mb-2">
                    <button
                      onClick={async () => { if (window.confirm('Clear all vendor memory? The AI will re-classify these vendors from scratch on the next import.')) { await saveVendorMemory({}); setVendorMemory({}); } }}
                      className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1"
                    >
                      <Trash2 size={11} /> Clear all
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {Object.entries(vendorMemory).slice(0, 200).map(([vendor, info]) => {
                      const safe = info && typeof info === 'object' ? info : {};
                      return (
                        <div key={vendor} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900 truncate">{vendor}</div>
                            <div className="text-[10px] text-slate-500">
                              {safe.direction === 'platform'
                                ? `→ Platform / ${safe.platformId || '?'}`
                                : `→ ${safe.direction || 'expense'} / ${safe.category || '?'}`}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              const next = { ...vendorMemory }; delete next[vendor];
                              setVendorMemory(next); await saveVendorMemory(next);
                            }}
                            title="Forget this mapping"
                            className="text-slate-400 hover:text-red-600 p-1"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {vendorMemoryCount > 200 && (
                    <div className="text-[11px] text-slate-400 text-center pt-2">
                      Showing first 200 of {vendorMemoryCount} mappings.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'cost' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-1">Last 30 days</div>
                <div className="text-2xl font-bold text-slate-900">
                  ${(usage30d.totalCents / 100).toFixed(4)}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {usage30d.count} import{usage30d.count !== 1 ? 's' : ''} · {usage30d.totalTokens.toLocaleString()} tokens total
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">All time (last 50 imports kept)</div>
                <div className="text-xl font-bold text-slate-900">
                  ${(usageAllTime.totalCents / 100).toFixed(4)}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {usageAllTime.count} import{usageAllTime.count !== 1 ? 's' : ''} · {usageAllTime.totalTokens.toLocaleString()} tokens
                </div>
              </div>
              <p className="text-[11px] text-slate-400">
                Pricing: Claude Haiku 4.5 — $1/M input, $0.10/M cached read, $5/M output.
                Most imports cost a fraction of a cent.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center gap-2 p-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={async () => {
              try {
                const { resetOnboarding } = await import('@/lib/onboarding');
                await resetOnboarding();
                // Trigger a full reload so the auto-launch effect fires
                // and the tour appears immediately. Cleaner than threading
                // another open-signal through three components.
                window.location.reload();
              } catch (e) {
                alert('Couldn\'t replay the tour: ' + (e?.message || e));
              }
            }}
            className="text-xs text-indigo-700 hover:text-indigo-900 underline-offset-2 hover:underline"
            title="Re-run the onboarding tour from the beginning"
          >
            Replay tour
          </button>
          <button onClick={onClose} className="bg-slate-700 hover:bg-slate-800 text-white px-5 py-2 rounded-lg text-sm font-semibold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-2.5 text-sm font-medium flex items-center gap-1.5 border-b-2 transition ${active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
    >
      {icon} {label}
    </button>
  );
}

function RubricField({ label, hint, value, onChange }) {
  const used = (value || '').length;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-semibold text-slate-900">{label}</label>
        <span className={`text-[10px] ${used > MAX_RUBRIC_LENGTH * 0.9 ? 'text-amber-700' : 'text-slate-400'}`}>
          {used}/{MAX_RUBRIC_LENGTH}
        </span>
      </div>
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={hint}
        rows={3}
        maxLength={MAX_RUBRIC_LENGTH}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}

function HistoryRow({ entry, expanded, onToggle, onDelete }) {
  const total = (entry?.counts?.transactions || 0) + (entry?.counts?.platforms || 0) + (entry?.counts?.leads || 0) + (entry?.counts?.prospects || 0);
  const isError = !!entry?.error;
  // Note: outer element is a div + onClick rather than a <button> so the
  // nested delete button doesn't violate the no-button-in-button HTML rule
  // (React 19 / Next 16 hydration is strict about this).
  return (
    <div className={`border rounded-lg overflow-hidden ${isError ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="w-full flex items-center gap-2 p-3 hover:bg-slate-50/60 text-left cursor-pointer"
      >
        {expanded ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
        {isError ? <AlertCircle size={14} className="text-red-600 flex-shrink-0" /> : <FileText size={14} className="text-slate-500 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">{entry?.filename || 'upload'}</div>
          <div className="text-[10px] text-slate-500">
            {entry?.runAt ? new Date(entry.runAt).toLocaleString() : '—'} · {entry?.kind || 'unknown'}
            {entry?.durationMs > 0 && ` · ${(entry.durationMs / 1000).toFixed(1)}s`}
            {!isError && total > 0 && ` · ${total} rows extracted`}
          </div>
        </div>
        {isError && <span className="text-[9px] font-bold uppercase bg-red-100 text-red-700 border border-red-300 rounded px-1.5 py-0.5 flex-shrink-0">Failed</span>}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete entry"
          className="text-slate-400 hover:text-red-600 p-1 flex-shrink-0"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-100 text-xs space-y-2">
          {isError ? (
            <div className="text-red-700">{entry.error}</div>
          ) : (
            <>
              {entry.counts && Object.keys(entry.counts).length > 0 && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {Object.entries(entry.counts).map(([k, v]) => (
                    <span key={k} className="bg-slate-100 rounded px-1.5 py-0.5">
                      {k}: <b>{v}</b>
                    </span>
                  ))}
                </div>
              )}
              {entry.usage && (
                <div className="text-[10px] text-slate-500">
                  Tokens: {entry.usage.inputTokens?.toLocaleString() || 0} input
                  {entry.usage.cachedReadTokens > 0 && ` + ${entry.usage.cachedReadTokens.toLocaleString()} cached`}
                  {' · '}{entry.usage.outputTokens?.toLocaleString() || 0} output
                </div>
              )}
              {entry.fingerprint && (
                <div className="text-[10px] text-slate-500">
                  Pattern: <code className="bg-slate-100 rounded px-1">{entry.fingerprint.filenamePattern}</code> ({entry.fingerprint.fileType})
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Manual rule entry — lets the user pre-seed a vendor → category mapping
 * without needing to do an import first. Useful for "I know I'm starting
 * to use Costco for office supplies, set the rule now."
 *
 * Direction selector switches between Books (expense / income with category
 * dropdown) and Platforms (platformId dropdown). All categories pull from
 * the merged built-in + custom list so user-defined buckets work too.
 */
function ManualRuleForm({ onAdd }) {
  const { expense: EXPENSE_CATEGORIES, income: INCOME_CATEGORIES } = useCategoriesAll();
  const [vendor, setVendor] = useState('');
  const [direction, setDirection] = useState('expense');
  const [category, setCategory] = useState('OTHER_EXPENSE');
  const [platformId, setPlatformId] = useState('RINGY');
  const [error, setError] = useState('');
  const [savedFlash, setSavedFlash] = useState('');

  // Reset category when direction flips so the dropdown matches
  const onChangeDirection = (d) => {
    setDirection(d);
    if (d === 'expense') setCategory('OTHER_EXPENSE');
    else if (d === 'income') setCategory('OTHER_INCOME');
  };

  const submit = async () => {
    const v = vendor.trim();
    setError('');
    if (v.length < 2) { setError('Vendor must be at least 2 characters.'); return; }
    const normalized = normalizeVendor(v);
    if (!normalized) { setError('That vendor name normalizes to empty. Try a different name.'); return; }

    if (direction === 'platform') {
      await onAdd({ vendor: v, direction: 'platform', platformId });
    } else {
      await onAdd({ vendor: v, direction, category });
    }
    setSavedFlash(`Saved: "${v}" → ${direction === 'platform' ? `Platform / ${platformId}` : `${direction} / ${category}`}`);
    setVendor('');
    setTimeout(() => setSavedFlash(''), 2500);
  };

  const cats = direction === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  return (
    <div className="bg-gradient-to-br from-emerald-50/70 to-violet-50/70 border border-emerald-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Plus size={14} className="text-emerald-700" />
        <h3 className="text-sm font-semibold text-slate-900">Add a rule manually</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
        <div className="md:col-span-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vendor / description</label>
          <input
            value={vendor}
            onChange={e => setVendor(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. Costco, Comcast Xfinity, AT&amp;T"
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="md:col-span-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Route to</label>
          <select
            value={direction}
            onChange={e => onChangeDirection(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
          >
            <option value="expense">Books expense</option>
            <option value="income">Books income</option>
            <option value="platform">Platform (Ringy/TextDrip/VanillaSoft)</option>
          </select>
        </div>
        <div className="md:col-span-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            {direction === 'platform' ? 'Platform' : 'Category'}
          </label>
          {direction === 'platform' ? (
            <select
              value={platformId}
              onChange={e => setPlatformId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
            >
              {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          ) : (
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
            >
              {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
        </div>
        <div className="md:col-span-2">
          <button
            type="button"
            onClick={submit}
            disabled={!vendor.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg px-3 py-1.5 text-sm font-semibold flex items-center justify-center gap-1"
          >
            <Plus size={14} /> Add rule
          </button>
        </div>
      </div>
      {error && (
        <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}
      {savedFlash && (
        <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
          <CheckCircle2 size={12} /> {savedFlash}
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-2">
        Rules apply on the next import. Vendor names are normalized (lowercased, store numbers stripped) — &quot;AT&amp;T&quot; will match &quot;AT&amp;T MOBILITY 12345&quot; and similar variants.
      </p>
    </div>
  );
}
