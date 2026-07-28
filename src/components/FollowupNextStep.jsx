'use client';
import { Copy, Check, Clock, CheckCircle2, BellOff, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { playbookForStage, dueStatus } from '@/lib/followupEngine.mjs';
import { isEligible, buildDraftSource, stepPurposeFor } from '@/lib/followupDraftGate.mjs';
import { makeStepKey, sourceHash, shouldRegenerate, rotatePrevious } from '@/lib/followupDraftCache.mjs';
import { authedFetch } from '@/lib/authedFetch';

const STATE_STYLE = {
  overdue:   { cls: 'border-rose-200 bg-rose-50',    chip: 'bg-rose-100 text-rose-700' },
  due_today: { cls: 'border-amber-200 bg-amber-50',  chip: 'bg-amber-100 text-amber-800' },
  ontrack:   { cls: 'border-indigo-200 bg-indigo-50/40', chip: 'bg-indigo-100 text-indigo-700' },
  snoozed:   { cls: 'border-slate-200 bg-slate-50',  chip: 'bg-slate-100 text-slate-600' },
};

function mergeScript(script, prospect, agentName) {
  const first = (prospect.name || '').trim().split(/\s+/)[0] || 'there';
  const time = prospect.appointmentTime
    ? new Date(prospect.appointmentTime).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : 'our scheduled time';
  return String(script).replace(/{first}/g, first).replace(/{agent}/g, agentName || 'your agent').replace(/{time}/g, time);
}

// In-flight de-duplication for draft generation (spec §6.1). Its real job is
// RE-ENTRANCY, not concurrent mounts — there is exactly one mount site (§9.2).
// Keys are `${prospectId}:${sourceHash}`; an entry is added before the request
// fires and deleted SYNCHRONOUSLY in the effect cleanup (the request's own
// `finally` is only a backstop for the settled, non-unmount path — a
// finally-only delete lands a microtask too late and deadlocks StrictMode).
const inFlightDrafts = new Set();

/**
 * The one draft-generation runner — auto, Personalize, and Redo all come
 * through here, so the §10 failure mapping exists exactly once. Module-level
 * on purpose: every reactive value and state setter arrives as a parameter,
 * keeping the calling effect's body setState-free (no setter is invoked
 * anywhere in its synchronous call graph). State updates land only in
 * promise continuations, after the first await.
 *
 * An aborted request writes NOTHING to the cache (§6.1) — the prospect is
 * simply un-drafted and regenerates on next open; a `pending` marker would
 * never be cleared.
 */
async function generateFollowupDraft({
  controller, brief, stepPurpose, source, stepKey, srcHash, cached,
  rotate, reset, mode = 'auto', rejectedOverride = null,
  saveEntry, setBusyState, setLocalTextState,
}) {
  // Rule 3 rotates BEFORE the request and sends the updated `previous` in
  // that same request (§7.4) — rotating on write-back would blind the model
  // to the immediately-preceding draft.
  const previous = rotate ? rotatePrevious(cached) : (Array.isArray(cached?.previous) ? cached.previous : []);
  const baseAttempts = reset ? 0 : (Number(cached?.attempts) || 0);
  const rejected = rejectedOverride ?? (reset ? [] : (Array.isArray(cached?.rejected) ? cached.rejected : []));
  const aborted = () => controller?.signal?.aborted === true;
  // Yield one microtask before touching state: under StrictMode the effect
  // cleanup's abort lands synchronously before this continuation runs.
  await Promise.resolve();
  if (aborted()) return;
  setBusyState(true);
  try {
    let res;
    try {
      res = await authedFetch('/api/followup-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, stepPurpose, source, previous, rejected }),
        signal: controller?.signal,
      });
    } catch {
      if (aborted()) return; // aborted → nothing written; regenerates on next open
      if (mode !== 'redo') {
        saveEntry({ status: 'failed', text: '', edited: false, stepKey, sourceHash: srcHash, at: new Date().toISOString(), attempts: baseAttempts + 1, previous, rejected });
      }
      return;
    }
    if (aborted()) return;
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body → status mapping below */ }
    if (aborted()) return;

    if (res.ok && typeof data?.text === 'string' && data.text.trim() !== '') {
      saveEntry({ status: 'ok', text: data.text, edited: false, stepKey, sourceHash: srcHash, at: new Date().toISOString(), attempts: 0, previous, rejected });
      setLocalTextState(null); // show the fresh entry text, drop any stale edit
      return;
    }
    // Redo keeps the current draft on ANY non-success — clobbering an ok
    // entry with 'failed'/'insufficient' would destroy the agent's draft.
    if (mode === 'redo') return;
    // 503 { unavailable } — key missing server-side: the feature is simply
    // absent. NO cache entry, attempts NOT incremented (§10).
    if (res.status === 503 && data?.unavailable === true) return;
    // Auth failure — stock script, nothing written (§10).
    if (res.status === 401) return;
    // 403 { upgradeRequired } — tier gate (server-side, defense in depth).
    // Only reachable when the client gate is bypassed or the plan changed
    // mid-session: stock script, nothing written, no attempts burned.
    if (res.status === 403) return;
    if (res.ok && data?.insufficient === true) {
      saveEntry({ status: 'insufficient', text: '', edited: false, stepKey, sourceHash: srcHash, at: new Date().toISOString(), attempts: baseAttempts, previous, rejected });
      return;
    }
    // Everything else — 5xx, 502 { malformed }, unexpected shape — is a
    // failure: attempts++, retried per §7.4 rule 2 until the cap of 2.
    saveEntry({ status: 'failed', text: '', edited: false, stepKey, sourceHash: srcHash, at: new Date().toISOString(), attempts: baseAttempts + 1, previous, rejected });
  } finally {
    setBusyState(false);
  }
}

/**
 * Outer component (spec §6.2): computes steps, status, idx, step, dueLabel,
 * style, and the merged brief, and keeps BOTH existing early returns. It
 * holds NO hooks — a hook here would sit after a conditional return, and an
 * agent logging the final touch would flip status to 'done', drop the hook
 * count, and take down the prospect drawer. All hooks live in FollowupCard;
 * key={prospect.id} guarantees card state resets between prospects.
 */
export default function FollowupNextStep({ prospect, playbook, agentName, onLogTouch, onSnooze, now = new Date().toISOString(), draft = null, onSaveDraft, draftsEntitled = null }) {
  const steps = playbookForStage(playbook, prospect.stage);
  if (steps.length === 0) return null;

  const status = dueStatus(prospect, now);
  if (status.state === 'done') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2 text-sm text-emerald-800">
        <CheckCircle2 size={16} /> Follow-up sequence complete for this stage.
      </div>
    );
  }

  const idx = Math.min(prospect.cadence?.stepIndex || 0, steps.length - 1);
  const step = steps[idx];
  const stockText = mergeScript(step.script, prospect, agentName);
  const style = STATE_STYLE[status.state] || STATE_STYLE.ontrack;
  const dueLabel = status.state === 'overdue' ? `${status.daysLate}d overdue`
    : status.state === 'due_today' ? 'Due today'
    : status.state === 'snoozed' ? 'Snoozed'
    : status.nextDueAt ? `Due ${new Date(status.nextDueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';

  return (
    <FollowupCard
      key={prospect.id}
      prospect={prospect}
      steps={steps}
      idx={idx}
      step={step}
      status={status}
      style={style}
      dueLabel={dueLabel}
      stockText={stockText}
      draft={draft}
      onSaveDraft={onSaveDraft}
      draftsEntitled={draftsEntitled}
      onLogTouch={onLogTouch}
      onSnooze={onSnooze}
    />
  );
}

/**
 * Inner card (spec §6.2): owns the ENTIRE card body and ALL hooks. The
 * ineligible path renders exactly today's card — stock script, Copy script,
 * Log touch, snooze — byte-identical output, no AI call.
 *
 * Draft display: `localText` is null until the agent types — null means
 * "show the cached entry's text", so a regeneration (or a draft arriving
 * after a remount) flows straight through from the prop.
 */
function FollowupCard({ prospect, steps, idx, step, status, style, dueLabel, stockText, draft, onSaveDraft, draftsEntitled, onLogTouch, onSnooze }) {
  const [copied, setCopied] = useState(false);
  const [localText, setLocalText] = useState(null);
  const [busy, setBusy] = useState(false);

  // Pure, cheap, deterministic per render — recomputing beats memo deps here.
  const eligible = isEligible(prospect);
  const source = eligible ? buildDraftSource(prospect) : null;
  const stepKey = makeStepKey(prospect.stage, prospect.cadence?.stepIndex, steps.length);
  const srcHash = eligible ? sourceHash(stepKey, source) : null;
  // Tier gate: drafts are Pro+ (featureFlags `followup_drafts`). Entitlement
  // is TRI-STATE: true / false / null(unknown — profile loading or errored).
  // It rides through canDraft, so EVERY path — auto-generate, Personalize,
  // Redo, and even displaying a previously cached draft — shuts off together
  // and a Starter agent sees exactly the pre-feature card.
  const canDraft = draftsEntitled === true && eligible && typeof onSaveDraft === 'function';
  // Upgrade hint (Pro lever): ONLY when a real profile says not entitled —
  // never on null, so a paying agent is never flashed the pitch while the
  // profile loads (review must-fix #2). Shown only where the feature WOULD
  // have fired — an eligible prospect with a real conversation — so the
  // pitch is concrete, never a blanket banner.
  const showProHint = draftsEntitled === false && eligible && typeof onSaveDraft === 'function';

  // Only a usable entry for the step the card is RENDERING is displayed — a
  // draft cached for a previous step never shows under this step's heading.
  const showDraft = canDraft && draft?.status === 'ok' &&
    typeof draft.text === 'string' && draft.text.trim() !== '' &&
    draft.stepKey === stepKey;
  const displayText = showDraft ? (localText ?? draft.text) : stockText;
  const rejectedCount = Array.isArray(draft?.rejected) ? draft.rejected.length : 0;
  const redoCapReached = rejectedCount >= 3;
  // Personalize (§6.3) is the manual trigger for the SAME generation path —
  // shown only when not-yet-due, and only when shouldRegenerate would fire
  // (an insufficient/exhausted entry gets no affordance, per §9.2; an
  // existing ok draft replaces the button with the draft footer).
  const showPersonalize = canDraft && !showDraft &&
    (status.state === 'ontrack' || status.state === 'snoozed') &&
    shouldRegenerate(draft ?? null, stepKey, srcHash).generate;

  // Provenance (§9.2) — derived from the source branch that fed the draft.
  const newestNote = source?.agentNotes?.length ? source.agentNotes[source.agentNotes.length - 1] : null;
  const provenance = newestNote
    ? `Personalized from your note on ${new Date(newestNote.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : 'Personalized from the SMS conversation';

  // Live values for the unmount persist (§6.4): a naive cleanup closure would
  // capture first-render state and write the PRE-EDIT text. This effect runs
  // after every render, so the [] cleanup below always reads current values.
  const liveRef = useRef({ save: null });
  useEffect(() => {
    if (showDraft) {
      liveRef.current.save = (localText != null && localText !== draft.text)
        ? () => onSaveDraft({ text: localText, edited: true })
        : null;
    } else if (localText == null) {
      // localText only returns to null via a successful regeneration
      // (setLocalTextState(null) in the runner) or by never being edited —
      // either way the kept closure is stale, so drop it before the unmount
      // write can resurrect an older edit over the newer draft (review N1;
      // reachable because Redo carries no abort controller).
      liveRef.current.save = null;
    }
    // Otherwise (showDraft false, localText still holding an edit): KEEP the
    // last closure. When showDraft flips false mid-session — entitlement flap
    // on a profile error, or a stepKey advance — the unmount write preserves
    // the agent's in-progress edit instead of destroying it (must-fix #3).
  });
  useEffect(() => () => { liveRef.current.save?.(); }, []);

  // Assemble this render's inputs for the module-level runner. Setters are
  // passed BY REFERENCE — never called here — so the effect below stays
  // setState-free (react-hooks/set-state-in-effect); updates happen only in
  // the runner's promise continuations.
  const startGeneration = ({ controller = null, rotate, reset, mode = 'auto', rejectedOverride = null }) =>
    generateFollowupDraft({
      controller,
      brief: stockText,
      stepPurpose: stepPurposeFor(prospect.stage, idx) || 'check_in',
      source,
      stepKey,
      srcHash,
      cached: draft ?? null,
      rotate,
      reset,
      mode,
      rejectedOverride,
      saveEntry: onSaveDraft,
      setBusyState: setBusy,
      setLocalTextState: setLocalText,
    });

  // Auto-generate when due (§6). Deps are [prospect.id, srcHash,
  // draftsEntitled] ONLY — firing is bounded by the persisted cache
  // (shouldRegenerate, §7.4) plus the module-level in-flight Set; depending
  // on `status` or `now` identity is the unbounded billed loop §6.1 exists
  // to prevent. `draftsEntitled` IS a dep (review must-fix #2): entitlement
  // resolves null→true AFTER mount when the profile round-trip finishes, and
  // without the dep an entitled agent's overdue prospect would never draft
  // until a full drawer remount. It settles to a stable boolean, so it can't
  // loop. The stale-closure reads of status/draft are deliberate: do NOT add
  // them, and do NOT silence the exhaustive-deps warning (§6.2 — one
  // accepted warning).
  useEffect(() => {
    if (!canDraft) return undefined;
    if (status.state !== 'overdue' && status.state !== 'due_today') return undefined;
    const decision = shouldRegenerate(draft ?? null, stepKey, srcHash);
    if (!decision.generate) return undefined;
    const key = `${prospect.id}:${srcHash}`;
    if (inFlightDrafts.has(key)) return undefined;
    inFlightDrafts.add(key);
    const controller = new AbortController();
    startGeneration({ controller, rotate: decision.rotatePrevious, reset: decision.resetCounters })
      .catch(() => {})
      .finally(() => { inFlightDrafts.delete(key); }); // backstop, non-unmount path
    return () => {
      // SYNCHRONOUS delete, then abort — see §6.1: the effect re-runs in the
      // same commit under StrictMode and must not see a stale in-flight key.
      inFlightDrafts.delete(key);
      controller.abort();
    };
  }, [prospect.id, srcHash, draftsEntitled]);

  // Manual trigger, same generation path and caps as the auto route (§6.3).
  const personalize = () => {
    if (busy || !canDraft) return;
    const decision = shouldRegenerate(draft ?? null, stepKey, srcHash);
    if (!decision.generate) return;
    const key = `${prospect.id}:${srcHash}`;
    if (inFlightDrafts.has(key)) return;
    inFlightDrafts.add(key);
    startGeneration({ rotate: decision.rotatePrevious, reset: decision.resetCounters })
      .catch(() => {})
      .finally(() => { inFlightDrafts.delete(key); });
  };

  // Redo (§8.3): the DISPLAYED draft — live edits included — is what the
  // agent rejected; it rides along so the model can't return a near-clone.
  // Cap 3 per sourceHash, then the button disables with the editing hint.
  const redo = () => {
    if (busy || !canDraft || !showDraft || redoCapReached) return;
    const rejectedList = Array.isArray(draft?.rejected) ? draft.rejected : [];
    const newRejected = [...rejectedList, displayText].slice(0, 3);
    const key = `${prospect.id}:${srcHash}`;
    if (inFlightDrafts.has(key)) return;
    inFlightDrafts.add(key);
    startGeneration({ rotate: false, reset: false, mode: 'redo', rejectedOverride: newRejected })
      .catch(() => {})
      .finally(() => { inFlightDrafts.delete(key); });
  };

  // Persist an edit on blur (§7.2 — never per keystroke). Skipped when the
  // text matches the stored entry, so a focus-and-blur writes nothing.
  const persistEdit = () => {
    if (!showDraft || localText == null || localText === draft.text) return;
    onSaveDraft({ text: localText, edited: true });
  };

  // Copy copies what is ON SCREEN (§9.1, D10): the live textarea value when a
  // draft is displayed, the stock script otherwise.
  const copy = async () => {
    try { await navigator.clipboard.writeText(displayText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <div className={`rounded-xl border p-3 ${style.cls}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Clock size={14} /> Step {idx + 1} of {steps.length} · {step.channel}
        </div>
        {dueLabel && <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.chip}`}>{dueLabel}</span>}
      </div>
      {showDraft ? (
        <textarea
          value={displayText}
          onChange={(e) => setLocalText(e.target.value)}
          onBlur={persistEdit}
          rows={4}
          className="w-full text-sm text-slate-900 bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      ) : (
        <div className="text-sm text-slate-900 bg-white border border-slate-200 rounded-lg p-2.5 whitespace-pre-wrap shadow-sm">{stockText}</div>
      )}
      {showDraft && (
        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-slate-500">
          <Sparkles size={11} className="text-violet-600 flex-shrink-0" />
          <span>{provenance}{redoCapReached ? ' — Try editing it directly.' : ''}</span>
        </div>
      )}
      {busy && !showDraft && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] font-semibold text-slate-500">
          <Loader2 size={12} className="animate-spin" /> Personalizing…
        </div>
      )}
      {showProHint && (
        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-slate-500">
          <Sparkles size={11} className="text-violet-600 flex-shrink-0" />
          <span>PRIM can write this follow-up from your own notes — a <span className="font-semibold text-slate-600">Pro</span> feature. Upgrade in Profile → Subscription.</span>
        </div>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={copy} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded-lg px-2.5 py-1.5">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : (showDraft ? 'Copy' : 'Copy script')}
        </button>
        {showDraft && (
          <button
            onClick={redo}
            disabled={busy || redoCapReached}
            title={redoCapReached ? 'Try editing it directly.' : 'Draft a different message'}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Redo
          </button>
        )}
        {showPersonalize && (
          <button
            onClick={personalize}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} className="text-violet-600" />} Personalize
          </button>
        )}
        <button onClick={onLogTouch} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-sm font-bold">
          Log touch
        </button>
      </div>
      {onSnooze && (
        <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
          <BellOff size={12} /> Snooze:
          <button onClick={() => onSnooze(3)} className="font-semibold text-slate-600 hover:text-slate-900 underline">3 days</button>
          <button onClick={() => onSnooze(7)} className="font-semibold text-slate-600 hover:text-slate-900 underline">1 week</button>
        </div>
      )}
    </div>
  );
}
