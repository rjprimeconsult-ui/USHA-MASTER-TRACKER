/**
 * followupDraftGate.mjs — eligibility + draft-source assembly for
 * personalized follow-up drafts (Phase 1). Pure logic, unit-tested under
 * `node --test`.
 *
 * ONLY import: followupEngine.mjs (itself dependency-free). Keep it that
 * way — sibling app modules are unimportable under node:test
 * (extensionless imports), and this module also feeds sourceHash, so
 * everything here must be deterministic.
 *
 * Decides which prospects qualify for an AI-personalized follow-up draft
 * (evidence of a real conversation, in-scope stage, not opted out) and
 * assembles the source facts the drafting route may use. `meds` is never
 * read anywhere in this module (spec D5).
 *
 * Spec: docs/superpowers/specs/2026-07-27-personalized-followup-drafts-phase1-design.md §5, §8.1
 */

import { CHANNELS, OUTCOMES } from './followupEngine.mjs';

// ---------- Touch provenance (§5.1) ----------

// Duplicated from webforms.mjs rather than imported — a style choice to keep
// this module's dependency surface at zero. A test asserts the two literals
// stay in sync, so a rename over there cannot silently reclassify machine
// touches as agent touches.
export const WEBFORM_TOUCH_PREFIX = 'Submitted your website form again';

/**
 * True when a touchLog entry was logged by the agent (LogTouchSheet), not by
 * a machine writer. The three known writers:
 *   - LogTouchSheet: channel in CHANNELS, outcome in OUTCOMES  -> agent
 *   - applyOutreachEmail: lowercase 'email'/'sent', absent from both
 *     constant lists                                           -> machine
 *   - website-form re-submit: 'Other'/'Other' with a note starting
 *     WEBFORM_TOUCH_PREFIX — the note prefix is the ONLY discriminator,
 *     because agents can legitimately log Other/Other themselves -> machine
 */
export const isAgentTouch = (t) =>
  CHANNELS.includes(t?.channel) &&
  OUTCOMES.includes(t?.outcome) &&
  !String(t?.note || '').startsWith(WEBFORM_TOUCH_PREFIX);

// ---------- Opt-out gate (§5.4, D12) ----------

const OPT_OUT_KEYWORDS = [
  'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPT OUT', 'OPTOUT',
];

// The bound clears real opt-outs on one side ('STOP CALLING ME PLEASE' = 22)
// while ordinary replies that happen to open with a keyword stay eligible
// ('END OF THE MONTH WORKS FOR ME' = 29). Measured on the NORMALISED string,
// after stripping — 'stop texting me!!!!!!!!!' is 24 raw but 15 normalised.
const OPT_OUT_MAX_NORM_LENGTH = 25;

// Uppercase, then strip leading/trailing non-alphanumerics ONLY — interior
// characters and spaces are preserved. Stated exactly because a compliance
// gate cannot rest on "stripped of punctuation".
const normalizeOptOutBody = (body) =>
  String(body).toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');

// The rule: norm EQUALS a keyword, or norm starts with a keyword followed by
// a non-letter AND norm.length <= 25. The non-letter requirement keeps
// 'STOPPED...' from matching 'STOP'; the bound keeps sentence-initial
// keywords in ordinary replies ('End of the month works for me') from
// silently and permanently disabling the feature for that prospect.
const isOptOutBody = (body) => {
  const norm = normalizeOptOutBody(body);
  return OPT_OUT_KEYWORDS.some((kw) =>
    norm === kw ||
    (norm.length <= OPT_OUT_MAX_NORM_LENGTH &&
      norm.startsWith(kw) &&
      /[^A-Z]/.test(norm.charAt(kw.length)))
  );
};

/**
 * True when the prospect has opted out: any inbound TextDrip body matching
 * an opt-out keyword under the rule above, or any touch outcome of
 * 'Not interested'. Direction of error is deliberate — an unrecognised
 * opt-out is a compliance risk, so the inbound check does not require
 * isDrip !== true the way eligibility does. Never throws: textdripChat
 * exists only on synced prospects, so every read is optional-chained.
 */
export function isOptedOut(prospect) {
  const msgs = prospect?.textdripChat?.messages;
  if (Array.isArray(msgs) &&
      msgs.some((m) => m?.direction === 'in' && isOptOutBody(m?.body || ''))) {
    return true;
  }
  const log = Array.isArray(prospect?.touchLog) ? prospect.touchLog : [];
  return log.some((t) => t?.outcome === 'Not interested');
}

// ---------- The gate (§5.2) ----------

// Phase 1 scope (§1). GHOSTED has a working cadence but is excluded by
// Juan's decision; WEBBY_SET / WEBBY_CONFIRMED / APPOINTMENT_SET are Phase 2;
// SOLD / LOST are never drafted for.
const DRAFT_STAGES = ['PENDING_DECISION', 'FOLLOWUP_LATER', 'MISSED_APPT'];

// A genuine inbound TextDrip reply. Strict on purpose: normalizeMessage
// (textdrip.mjs) sets direction 'in' as the FALL-THROUGH — anything that is
// not type === 'receiver' reads as inbound, so a renamed API field or a
// malformed row would qualify a prospect. Hence the isDrip !== true and
// non-empty trimmed body requirements; drip copy is an automated campaign
// send, not a conversation.
const isGenuineInbound = (m) =>
  m?.direction === 'in' &&
  m?.isDrip !== true &&
  String(m?.body || '').trim() !== '';

const isNotedAgentTouch = (t) =>
  isAgentTouch(t) && String(t?.note || '').trim() !== '';

/**
 * Eligibility = evidence of a real conversation (D3). True when ALL of:
 *   1. stage is in Phase 1 scope;
 *   2. not opted out (§5.4); and
 *   3. either >= 1 agent touch with a non-empty trimmed note, or >= 1
 *      genuine inbound TextDrip reply.
 * `situation` alone never qualifies (D4) — that kills the "BENEPATH LEAD"
 * filler class without a length heuristic.
 */
export function isEligible(prospect) {
  if (!prospect) return false;
  if (!DRAFT_STAGES.includes(prospect.stage)) return false;
  if (isOptedOut(prospect)) return false;
  const log = Array.isArray(prospect.touchLog) ? prospect.touchLog : [];
  if (log.some(isNotedAgentTouch)) return true;
  const msgs = prospect.textdripChat?.messages;
  return Array.isArray(msgs) && msgs.some(isGenuineInbound);
}

// ---------- Source assembly (§5.5) ----------

const AGENT_NOTES_CAP = 3;
const TEXTDRIP_SUMMARY_MESSAGES = 6;
const TEXTDRIP_SUMMARY_MAX_CHARS = 800;

// Copied verbatim from mergeScript in FollowupNextStep.jsx — a .jsx file is
// unimportable under node --test, so the 3-line {time} formatter is
// duplicated here. Same output as the merged brief, so the brief and the
// source can never disagree about the appointment time.
const formatApptTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

// Same first-name derivation as mergeScript's {first}, for the same reason.
const firstNameOf = (prospect) =>
  (prospect?.name || '').trim().split(/\s+/)[0] || 'there';

// Transcript of the most recent TextDrip messages. BOTH sides render —
// §5.2's inbound-and-not-drip test decides eligibility, not the transcript;
// a one-sided list of the prospect's replies with the agent's questions
// removed is close to unreadable. Drip sends ARE excluded: automated
// campaign copy is not conversation. Speaker labels match
// /api/textdrip/extract-conversation so the two routes read alike.
function buildTextdripSummary(prospect) {
  const stored = prospect?.textdripChat?.messages;
  if (!Array.isArray(stored)) return '';
  // normalizeConversation stores newest-first, so the selected window must be
  // reversed to read oldest -> newest — a reversed transcript reads as a
  // backwards conversation.
  const lines = stored
    .filter((m) => m && m.isDrip !== true)
    .slice(0, TEXTDRIP_SUMMARY_MESSAGES)
    .reverse()
    .map((m) => `${m.direction === 'out' ? 'Agent' : 'Contact'}: ${m.body || ''}`);
  // Truncation: 800 chars of the joined string, dropping WHOLE messages from
  // the OLDEST end until it fits. Never a mid-word cut — a half-sentence is
  // worse than one fewer message — and this string feeds sourceHash, so the
  // rule must be deterministic.
  while (lines.length > 0 && lines.join('\n').length > TEXTDRIP_SUMMARY_MAX_CHARS) {
    lines.shift();
  }
  return lines.join('\n');
}

/**
 * Assemble the facts the drafting route may use, in this fixed order:
 *
 *   firstName        always (mergeScript's {first} derivation)
 *   agentNotes       the 3 most recent agent touches with notes, oldest ->
 *                    newest, each { at, outcome, note } — omitted when none
 *   situation        omitted when empty
 *   missedApptTime   ONLY for MISSED_APPT with an appointmentTime set —
 *                    when absent, the field is omitted entirely rather than
 *                    sending mergeScript's "our scheduled time" placeholder
 *                    as if it were a fact
 *   textdripSummary  ONLY when agentNotes is empty
 *
 * `meds` is never read. Callers never reach this for an ineligible prospect,
 * but it must not throw — with no notes and no textdripChat it returns
 * firstName (and situation when set) only.
 */
export function buildDraftSource(prospect) {
  const p = prospect || {};
  const source = { firstName: firstNameOf(p) };

  const log = Array.isArray(p.touchLog) ? p.touchLog : [];
  const agentNotes = log
    .filter(isNotedAgentTouch)
    // touchLog is append-order (oldest -> newest), so the 3 most recent are
    // the last 3 — already in the required oldest -> newest order.
    .slice(-AGENT_NOTES_CAP)
    .map((t) => ({ at: t.at, outcome: t.outcome, note: t.note }));
  if (agentNotes.length > 0) source.agentNotes = agentNotes;

  if (String(p.situation || '').trim() !== '') source.situation = p.situation;

  if (p.stage === 'MISSED_APPT' && p.appointmentTime) {
    source.missedApptTime = formatApptTime(p.appointmentTime);
  }

  if (agentNotes.length === 0) {
    const textdripSummary = buildTextdripSummary(p);
    if (textdripSummary !== '') source.textdripSummary = textdripSummary;
  }

  return source;
}

// ---------- Step purpose (§8.1) ----------

/**
 * Explicit purpose-per-step mapping for the drafting brief. A test asserts
 * each list's length matches the live DEFAULT_PLAYBOOK step counts.
 *
 * FOLLOWUP_LATER has NO breakup step — its final step is the monthly
 * check-in with onComplete: 'FOLLOWUP_LATER', a self-loop. Labelling it
 * breakup would instruct the model never to re-open a conversation whose
 * entire job is to re-open it.
 */
export const STEP_PURPOSES = {
  MISSED_APPT: ['reschedule_urgent', 'reschedule_urgent', 'reschedule', 'reschedule', 'breakup'],
  PENDING_DECISION: ['clarify', 'clarify', 'urgency', 'urgency', 'breakup'],
  FOLLOWUP_LATER: ['check_in', 'check_in', 'check_in', 'check_in'],
};

/**
 * Purpose for a stage + step index. Any index beyond the table maps to the
 * stage's LAST listed purpose — the playbook is read from storage, so
 * steps.length is not guaranteed, and an undefined purpose would leave the
 * prompt contract's bar 1 with no content. Unknown stage -> null.
 */
export function stepPurposeFor(stage, stepIndex) {
  const purposes = STEP_PURPOSES[stage];
  if (!Array.isArray(purposes) || purposes.length === 0) return null;
  const n = Math.floor(Number(stepIndex));
  const idx = Number.isFinite(n) ? Math.max(0, Math.min(n, purposes.length - 1)) : 0;
  return purposes[idx];
}
