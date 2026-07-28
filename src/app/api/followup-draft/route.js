/**
 * POST /api/followup-draft
 *
 * Drafts a personalized follow-up message for one prospect at one cadence
 * step (spec: docs/superpowers/specs/2026-07-27-personalized-followup-drafts-phase1-design.md §8).
 * The AI always drafts fresh — the brief is purpose + register, never raw
 * material to paraphrase (D6). All caps (attempts, Redo) are enforced
 * client-side (§8.3); this route is stateless.
 *
 * Body: {
 *   brief:       string   — the mergeScript-rendered stock script (§8.1)
 *   stepPurpose: string   — reschedule_urgent | reschedule | clarify | urgency | check_in | breakup
 *   source:      object   — buildDraftSource() output (§5.5): firstName,
 *                           agentNotes[{at,outcome,note}], situation?,
 *                           missedApptTime?, textdripSummary?
 *   previous:    string[] — earlier drafts in this sequence (D8)
 *   rejected:    string[] — drafts the agent hit Redo on (§8.3)
 * }
 *
 * Returns: { text } or { insufficient: true }
 * Errors:  503 { unavailable: true }  — ANTHROPIC_API_KEY missing (checked
 *                                       BEFORE auth), service env missing,
 *                                       or the profile load failed (DB blip
 *                                       is not a tier denial). §10 — client
 *                                       writes no cache entry, burns no
 *                                       attempts.
 *          401                        — auth failure
 *          403 { upgradeRequired }    — tier gate: drafts are Pro+ (feature
 *                                       flag `followup_drafts`); client
 *                                       writes nothing
 *          400                        — malformed request body
 *          502 { malformed: true }    — model output unusable ({token} or
 *                                       empty text; never passed through)
 *          502 { error }              — Anthropic call failed
 *
 * Auth: Supabase bearer token → requireUserId, then a service-client profile
 * load + canAccessBetaFeature('followup_drafts') — same check the UI runs.
 *
 * Required env: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).
 * SECURITY: Prospect content (brief, source, previous, rejected) is NEVER
 * logged, on success or on any error path (§12).
 *
 * Required env: ANTHROPIC_API_KEY. Optional: FOLLOWUP_DRAFT_MODEL.
 */

import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// ---- Drafting system prompt (§8.2 — the eight hard bars) ----
// Framed as "write the message this moment calls for" (D6) — NEVER as
// "rewrite the following": rewrite framing produces paraphrase, the same
// sentence with one bolted-on clause, exactly the templated feel this
// feature exists to remove.
const DRAFT_PROMPT = `
You write the single text (SMS) follow-up message this moment calls for, sent by a health-coverage agent to a prospect they have been talking with.

You are given the step's purpose, a brief, and the facts known about this prospect. The brief is the stock script for this step: it tells you the message's purpose, register, and length ONLY. It is not raw material — never rewrite, rephrase, or lightly rework the brief. Write a fresh message grounded in this prospect's own facts.

STEP PURPOSES:
- reschedule_urgent: they just missed an appointment; get a new time quickly.
- reschedule: they missed an appointment; get a new time on the calendar.
- clarify: they are deciding; surface and resolve whatever is holding the decision up.
- urgency: they are deciding; give an honest nudge to decide soon.
- check_in: a periodic check-in; re-open the conversation and ask what has changed.
- breakup: the final message of the sequence; a graceful goodbye that leaves the door open.

HARD RULES:
1. Keep the step's purpose. A breakup never becomes a pitch; a check_in never becomes a goodbye.
2. Use ONLY facts present in the supplied prospect facts. No inference, no gap-filling. Never mention a job, a family detail, an event, or anything else that is not explicitly in the facts.
3. NEVER reference health, medical conditions, medications, or treatment — even when the facts contain them. Refer to coverage needs in general terms only.
4. No claims: no savings figures, no rates, no approval promises, no guarantees.
5. Texting length: stay within one sentence of the brief's length.
6. Do not repeat anything from the earlier drafts or the rejected drafts supplied.
7. No {placeholder} tokens of any kind, and do not invent a signature or a name for the agent.
8. If nothing specific to this prospect is worth saying, set insufficient to true rather than padding out a generic message.
9. NEVER name a specific date, time, or appointment slot. You cannot see the agent's calendar, so any slot you name may already be booked — and a prospect who accepts it creates a conflict the agent has to walk back. Ask when they are free, or offer to send times, but never state one. This holds even when the brief invites times ("want me to text you 2 times to pick from?") — mirror the offer, do not fill it in.

OUTPUT: JSON matching the schema. When insufficient is true, text is the empty string. Otherwise text is the message and insufficient is false.
`.trim();

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'The drafted follow-up message. Empty string when insufficient is true.',
    },
    insufficient: {
      type: 'boolean',
      description: 'True when nothing specific to this prospect is worth saying (hard rule 8).',
    },
  },
  required: ['text', 'insufficient'],
  additionalProperties: false,
};

// Any surviving template token means the model echoed the brief's raw form —
// never rendered raw into the agent's textarea (§8.1, §10).
const PLACEHOLDER_RE = /\{[a-z]+\}/i;

// ---- Render the buildDraftSource() payload (§5.5) into prompt text ----
// Defensive on shape: the route trusts the client's assembly but must not
// throw on a missing optional field.
function renderSource(source) {
  const lines = [];
  const firstName = typeof source.firstName === 'string' ? source.firstName.trim() : '';
  if (firstName) lines.push(`First name: ${firstName}`);
  const situation = typeof source.situation === 'string' ? source.situation.trim() : '';
  if (situation) lines.push(`Situation: ${situation}`);
  const missedApptTime = typeof source.missedApptTime === 'string' ? source.missedApptTime.trim() : '';
  if (missedApptTime) lines.push(`Missed appointment time: ${missedApptTime}`);
  const agentNotes = Array.isArray(source.agentNotes) ? source.agentNotes : [];
  if (agentNotes.length > 0) {
    lines.push('Agent notes from logged touches (oldest to newest):');
    for (const n of agentNotes) {
      lines.push(`- [${n?.at || ''}] (${n?.outcome || ''}) ${n?.note || ''}`);
    }
  }
  const textdripSummary = typeof source.textdripSummary === 'string' ? source.textdripSummary.trim() : '';
  if (textdripSummary) {
    lines.push('SMS conversation (oldest to newest):');
    lines.push(textdripSummary);
  }
  return lines.join('\n');
}

// ---- Render prior drafts as a numbered block; skip non-string/empty rows ----
function renderDraftList(heading, drafts) {
  const items = drafts
    .filter((d) => typeof d === 'string' && d.trim())
    .map((d, i) => `${i + 1}. ${d.trim()}`);
  if (items.length === 0) return '';
  return `\n${heading}\n${items.join('\n')}\n`;
}

// ---- Main handler ----

export async function POST(req) {
  // Missing key is checked BEFORE auth (§10): 503 { unavailable: true } is a
  // distinguishable "feature is absent" signal — the client writes no cache
  // entry and does not increment attempts. Without it a missing key would
  // burn 2 attempts on every eligible prospect and look like a model failure.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ unavailable: true }, { status: 503 });
  }

  // Auth-gate — mirrors all other AI routes
  const { requireUserId } = await import('@/lib/apiAuth');
  const auth = await requireUserId(req);
  if (auth instanceof Response) return auth;

  // Tier gate (Pro+) — defense in depth; the UI also gates this. Mirrors the
  // email/send pattern: load the profile with the service client, then run
  // the same canAccessBetaFeature check the client ran. A 403 tells the
  // client to write NO cache entry and burn no attempts (mid-session
  // downgrade shows the stock script, nothing else).
  const { createClient } = await import('@supabase/supabase-js');
  const { canAccessBetaFeature } = await import('@/lib/featureFlags');
  const svcUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcUrl || !svcKey) {
    // Distinct log so a misconfigured (e.g. preview) deploy doesn't read as
    // "feature silently absent" with zero signal — env names only, no content.
    console.error('[followup-draft] service env missing (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL) — tier gate cannot run');
    return Response.json({ unavailable: true }, { status: 503 });
  }
  const svc = createClient(svcUrl, svcKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile, error: profileErr } = await svc
    .from('profiles')
    .select('id, email, subscription_status, subscription_tier, trial_ends_at, is_complimentary, is_admin')
    .eq('id', auth)
    .maybeSingle();
  if (profileErr) {
    // A DB blip is NOT a tier denial: 503 unavailable → the client writes no
    // cache entry and burns no attempts, and the draft regenerates next open.
    console.error('[followup-draft] profile load failed:', profileErr.code || profileErr.message);
    return Response.json({ unavailable: true }, { status: 503 });
  }
  if (!profile) {
    return Response.json({ error: 'profile not found' }, { status: 403 });
  }
  const access = canAccessBetaFeature('followup_drafts', profile);
  if (!access.canAccess) {
    return Response.json({ upgradeRequired: true }, { status: 403 });
  }

  // Minimal body validation. Error responses name the offending field only —
  // request content is never echoed and never logged, in any path (§12).
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const brief = body?.brief;
  const stepPurpose = body?.stepPurpose;
  const source = body?.source;
  const previous = body?.previous;
  const rejected = body?.rejected;
  if (typeof brief !== 'string' || !brief.trim()) {
    return Response.json({ error: 'brief must be a non-empty string.' }, { status: 400 });
  }
  if (typeof stepPurpose !== 'string' || !stepPurpose.trim()) {
    return Response.json({ error: 'stepPurpose must be a non-empty string.' }, { status: 400 });
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return Response.json({ error: 'source must be an object.' }, { status: 400 });
  }
  if (!Array.isArray(previous)) {
    return Response.json({ error: 'previous must be an array.' }, { status: 400 });
  }
  if (!Array.isArray(rejected)) {
    return Response.json({ error: 'rejected must be an array.' }, { status: 400 });
  }

  const sourceText = renderSource(source);
  const userContent = [
    `STEP PURPOSE: ${stepPurpose.trim()}`,
    '',
    'BRIEF (purpose, register, and length only — not raw material):',
    brief,
    '',
    'PROSPECT FACTS (the only facts you may use):',
    sourceText || '(none)',
    renderDraftList('EARLIER DRAFTS IN THIS SEQUENCE (do not repeat anything from these):', previous),
    renderDraftList('DRAFTS THE AGENT REJECTED (write something meaningfully different):', rejected),
    'Write the message this moment calls for.',
  ].join('\n');

  const model = process.env.FOLLOWUP_DRAFT_MODEL || 'claude-haiku-4-5';
  const client = new Anthropic({ apiKey });

  let resp;
  try {
    // Match the proven working pattern in textdrip/extract-conversation:
    // stream + finalMessage with output_config (non-streaming create errors).
    const stream = client.messages.stream({
      model,
      max_tokens: 1024,
      system: [{ type: 'text', text: DRAFT_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
      output_config: { format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
    });
    resp = await stream.finalMessage();
  } catch (e) {
    // Non-fatal — client records status 'failed' and retries per §7.4 rule 2.
    // Log API error metadata only; never request or response content.
    console.error('[followup-draft] Anthropic call failed:', e?.status, e?.message);
    return Response.json({ error: 'Draft generation failed.' }, { status: 502 });
  }

  const textBlock = resp?.content?.find((b) => b.type === 'text');
  let parsed;
  try {
    let jsonText = (textBlock?.text || '').trim();
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) jsonText = fence[1].trim();
    parsed = JSON.parse(jsonText);
  } catch {
    // Unusable model output — same class as a placeholder leak: never passed
    // through, never logged (§10, §12).
    return Response.json({ malformed: true }, { status: 502 });
  }

  // Log aggregate only — NEVER prospect content or draft text (§12)
  console.log(
    `[followup-draft] model=${model} ` +
    `input=${resp.usage?.input_tokens} output=${resp.usage?.output_tokens}`
  );

  if (parsed?.insufficient === true) {
    return Response.json({ insufficient: true });
  }

  // Post-validate (§8.1, §10): a draft with a surviving {token} or no content
  // is malformed — never rendered raw into the agent's textarea.
  const text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
  if (!text || PLACEHOLDER_RE.test(text)) {
    return Response.json({ malformed: true }, { status: 502 });
  }

  return Response.json({ text });
}
