/**
 * POST /api/textdrip/extract-conversation
 *
 * Layer B: AI-extracts qualifying fields from a TextDrip SMS transcript.
 * Called ONLY for newly-created prospects (first import) — never on updates
 * or re-syncs (cost control enforced by the client).
 *
 * Body: { messages: [{ direction: 'in'|'out', body: string, at: string }] }
 *
 * Returns: { situation, meds, appointmentTime, dobs, indvOrFamily, quoteSize }
 * All fields are strings; empty string when nothing found.
 *
 * Auth: Supabase bearer token → requireUserId.
 * SECURITY: Message bodies are NEVER logged.
 *
 * Required env: ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// ---- SMS extraction system prompt (mirrors import-prospects-ai SMS HISTORY section) ----
const EXTRACTION_PROMPT = `
You are extracting qualifying information from a TextDrip SMS conversation between an insurance agent and a prospect.

Your goal is to extract ONLY what is clearly stated or strongly implied in the conversation. Do NOT invent data.

FIELDS TO EXTRACT:
- situation: Concise qualifying context (≤500 chars). Coverage needs, timing, budget, objections, household situation. No UI labels, boilerplate, or agent script text.
- meds: Health notes — lean to GENERAL IMPRESSIONS ("has health concerns", "takes medication") over clinical specifics. NEVER log medication names or diagnoses verbatim unless the source explicitly states them. Lean conservative.
- appointmentTime: If a specific appointment was clearly agreed (e.g. "Friday at 2pm", "11am tomorrow"), output it as "YYYY-MM-DDTHH:mm" (24-hour, local). Each message line is prefixed with its [timestamp] — use those to resolve relative dates like "tomorrow"/"Friday". Otherwise empty string.
- dobs: Date(s) of birth or age(s) — if multiple household members mentioned, comma-separated (e.g. "1980-03-15, 1982-07-20" or "42, 40, 12"). Single person if only one mentioned. Empty if not stated.
- indvOrFamily: "Family" if spouse, kids, or multiple household members are clearly mentioned. "Indv" otherwise.
- quoteSize: A monthly premium or budget figure if mentioned (e.g. "$350/mo"). Empty if not stated.

PHI GUIDANCE:
- Never reference ACA WRAP as a product (treat ACA/marketplace/"Obama" only as coverage-need context).
- Health conditions: lean to general impressions ("has health concerns") over clinical specifics.
- Do NOT invent appointments, names, or numbers not present in the conversation.
- If the conversation is empty or has no qualifying context, return all empty strings.
`.trim();

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    situation:       { type: 'string', description: 'Qualifying context ≤500 chars. No UI labels/boilerplate.' },
    meds:            { type: 'string', description: 'General health impressions only. No clinical PHI.' },
    appointmentTime: { type: 'string', description: '"YYYY-MM-DDTHH:mm" (24h local) if clearly agreed, else empty string. Resolve relative dates from the [timestamps].' },
    dobs:            { type: 'string', description: 'DOB(s) or age(s), comma-separated for family. Empty if not stated.' },
    indvOrFamily:    { type: 'string', enum: ['Indv', 'Family'], description: '"Family" if multiple household members mentioned.' },
    quoteSize:       { type: 'string', description: 'Monthly premium or budget if stated. Empty otherwise.' },
  },
  required: ['situation', 'meds', 'appointmentTime', 'dobs', 'indvOrFamily', 'quoteSize'],
  additionalProperties: false,
};

// ---- Build a transcript string from normalised messages ----
function buildTranscript(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  // Messages arrive newest-first from normalizeConversation; reverse for chronological order
  const chronological = [...messages].reverse();
  return chronological.map(m => {
    const speaker = m.direction === 'out' ? 'Agent' : 'Contact';
    const when = m.at ? `[${m.at}] ` : '';
    return `${when}${speaker}: ${m.body || ''}`;
  }).join('\n');
}

// ---- Main handler ----

export async function POST(req) {
  // Auth-gate — mirrors all other AI routes
  const { requireUserId } = await import('@/lib/apiAuth');
  const auth = await requireUserId(req);
  if (auth instanceof Response) return auth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'AI extraction not configured. Set ANTHROPIC_API_KEY.' }, { status: 503 });
  }

  let messages;
  try {
    const body = await req.json();
    messages = body?.messages;
    if (!Array.isArray(messages)) {
      return Response.json({ error: 'messages must be an array.' }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: `Invalid JSON body: ${e.message}` }, { status: 400 });
  }

  const transcript = buildTranscript(messages);
  if (!transcript.trim()) {
    // Empty conversation — return empty fields immediately (no AI call)
    return Response.json({
      situation: '', meds: '', appointmentTime: '',
      dobs: '', indvOrFamily: 'Indv', quoteSize: '',
    });
  }

  const client = new Anthropic({ apiKey });

  let resp;
  try {
    // Match the proven working pattern in import-prospects-ai: stream +
    // finalMessage with output_config (non-streaming create errors here).
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: [{ type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Extract qualifying fields from this SMS conversation:\n\n${transcript}`,
      }],
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    });
    resp = await stream.finalMessage();
  } catch (e) {
    // Non-fatal — client will keep prospect without AI fields
    console.error('[textdrip/extract-conversation] Anthropic call failed:', e?.status, e?.message);
    return Response.json({ error: `AI extraction failed: ${e?.message}` }, { status: 502 });
  }

  const textBlock = resp?.content?.find(b => b.type === 'text');
  if (!textBlock) {
    return Response.json({ error: 'AI returned no text block.' }, { status: 500 });
  }

  let parsed;
  try {
    let jsonText = textBlock.text.trim();
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) jsonText = fence[1].trim();
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return Response.json({ error: `AI returned invalid JSON: ${e.message}` }, { status: 500 });
  }

  // Log aggregate only — NEVER log message bodies or extracted PHI fields
  console.log(
    `[textdrip/extract-conversation] model=claude-haiku-4-5 ` +
    `input=${resp.usage?.input_tokens} output=${resp.usage?.output_tokens}`
  );

  return Response.json({
    situation:       parsed.situation       || '',
    meds:            parsed.meds            || '',
    appointmentTime: parsed.appointmentTime || '',
    dobs:            parsed.dobs            || '',
    indvOrFamily:    parsed.indvOrFamily    || 'Indv',
    quoteSize:       parsed.quoteSize       || '',
  });
}
