/**
 * Bulk AI re-categorization.
 *
 * After a rubric improvement (e.g. the platform-OTHER fix, or an agent
 * tweaks their custom categories), users want to re-run their existing
 * Books rows against the current AI rubric without re-uploading source
 * files. This endpoint takes a list of {id, vendor, amount, currentCategory}
 * rows and returns suggestions {id, suggestedCategory, suggestedDirection,
 * confidence, reason} for each.
 *
 * Cheap path: send the list as a compact CSV-ish prompt to Haiku 4.5.
 * The strict JSON schema keeps the response shape stable.
 *
 * Required env: ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  EXPENSE_CATEGORIES as EXPENSE_CATEGORY_DEFS,
  INCOME_CATEGORIES as INCOME_CATEGORY_DEFS,
} from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Batches stay small (client chunks at ~100 rows), but give plenty of
// headroom for cold starts.
export const maxDuration = 300;

const EXPENSE_CATEGORIES = EXPENSE_CATEGORY_DEFS.map(c => c.id);
const INCOME_CATEGORIES = INCOME_CATEGORY_DEFS.map(c => c.id);

const RECATEGORIZE_RUBRIC = `
You are a bookkeeping assistant for a USHA insurance agent. Given a list of existing transactions
{id, vendor, amount, currentCategory, currentDirection}, propose a better classification
where one is clearly wrong, and leave it the same when the current is reasonable.

Apply the same category rubric used during initial Smart Import:

EXPENSE CATEGORIES:
- LEAD_INVESTMENT: lead purchases (aged leads, USHA leads, Ringy leads, Benepath, "leads", "chev credits"). Direct cost-per-acquisition spend.
- SOFTWARE: subscriptions other than TD/Ringy/VanillaSoft (Calendly, ChatGPT, Notion, Slack, Zoom, Adobe).
- MARKETING: Facebook ads, Google ads (general), Meta ads, mailchimp.
- OFFICE_RENT: office rent, FSL rent, desk rent, co-working.
- OFFICE: office supplies, Amazon, Staples, shipping (UPS/FedEx).
- RECRUITING: agent recruiting expenses, candidate outings.
- TEAM_INCENTIVES: team meals/coffee/wings/pizza for the team or top producers.
- TRAVEL: hotels (Airbnb, Marriott, Hilton), flights, work trips, conferences.
- VEHICLE: gas stations (Shell, Chevron, Exxon, BP, 76, Arco), Uber/Lyft (transport), parking, tolls, oil change, car insurance.
- MEALS: solo client lunches, restaurants, Uber Eats / DoorDash for self, Starbucks, Chipotle.
- PROFESSIONAL: E&O, NAIFA, license fees, NIPR, sircon, CPA, attorney, LLC fees.
- PHONE_INTERNET: AT&T, Verizon, Comcast, Xfinity, T-Mobile, internet.
- HEALTHCARE: CVS, Walgreens, doctor, dentist, medical, dental.
- COACHING: business coach, mentor, training, seminar, mastermind.
- AGENT_PAYOUT: payments to downline / sub-agents — split commissions, agent payouts. Money OUT to another agent.
- OTHER_EXPENSE: legitimate business expense that doesn't fit any other bucket.

INCOME CATEGORIES:
- BONUS, OVERRIDE, RENEWAL, OTHER_INCOME

CRITICAL:
1. If currentCategory is reasonable, return suggestedCategory = currentCategory and confidence "high".
2. Only propose a change when the current is clearly wrong (e.g. "AT&T" tagged SOFTWARE -> change to PHONE_INTERNET).
3. Apply USER PREFERENCES (vendor->category mappings supplied in the user message) as ground truth.
4. If the user has provided custom category IDs (also in the user message), they're equally valid targets.
5. Confidence: "high" = obvious, "medium" = reasonable inference, "low" = guessing.
`.trim();

function buildSchema(allowedCategoryIds) {
  return {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Original row id, echoed back unchanged' },
            suggestedDirection: { type: 'string', enum: ['expense', 'income'] },
            suggestedCategory: { type: 'string', enum: allowedCategoryIds },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: { type: 'string', description: '1 sentence: why this category fits.' },
          },
          required: ['id', 'suggestedDirection', 'suggestedCategory', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  };
}

export async function POST(req) {
  try {
    return await handle(req);
  } catch (e) {
    console.error('[recategorize-ai] Uncaught error:', e);
    return Response.json({ error: `Server error: ${e?.message || String(e)}` }, { status: 500 });
  }
}

async function handle(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'AI not configured (missing ANTHROPIC_API_KEY).' }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.rows)) {
    return Response.json({ error: 'Bad request — expected { rows: [{id, vendor, amount, currentCategory, currentDirection}, ...] }' }, { status: 400 });
  }

  // Hard cap per call. Client should chunk requests above this. Smaller
  // batches keep individual calls fast (<30s) and avoid output-token caps.
  const rows = body.rows.slice(0, 100);
  if (rows.length === 0) {
    return Response.json({ suggestions: [] });
  }

  const vendorHints = Array.isArray(body.vendorHints) ? body.vendorHints.slice(0, 100) : [];
  const customCategories = Array.isArray(body.customCategories) ? body.customCategories.slice(0, 50) : [];
  const userRubric = typeof body.userRubric === 'string' ? body.userRubric.slice(0, 1500) : '';

  const customExpenseIds = customCategories.filter(c => c.direction === 'expense').map(c => c.id);
  const customIncomeIds  = customCategories.filter(c => c.direction === 'income').map(c => c.id);
  const allowedAll = [...EXPENSE_CATEGORIES, ...customExpenseIds, ...INCOME_CATEGORIES, ...customIncomeIds];

  const renderHints = (hints) => {
    if (!hints?.length) return '';
    const lines = hints.map(h => `  "${h.vendor}" -> ${h.direction || 'expense'} / ${h.category || 'OTHER_EXPENSE'}`);
    return `\n\n--- USER PREFERENCES ---\n${lines.join('\n')}`;
  };
  const renderCustomCats = (cats) => {
    if (!cats?.length) return '';
    const lines = cats.map(c => `  ${c.id} (${c.direction}): "${c.label}"`);
    return `\n\n--- USER CUSTOM CATEGORIES ---\n${lines.join('\n')}`;
  };
  const userRubricText = userRubric.trim()
    ? `\n\n--- AGENT'S OWN RUBRIC NOTES ---\n${userRubric.trim()}\n--- END AGENT NOTES ---`
    : '';

  // Compact CSV form keeps tokens low — for 500 rows of ~50 tokens each
  // we're at ~25K input tokens, well within budget.
  const rowsCsv = rows.map(r =>
    `${r.id}\t${(r.vendor || '').replace(/\t/g, ' ')}\t${r.amount}\t${r.currentDirection || 'expense'}\t${r.currentCategory || ''}`
  ).join('\n');

  const userText =
    `Re-classify these existing transactions. For each row, propose a better (direction, category) IF the current is clearly wrong. Otherwise echo the current values back.${renderHints(vendorHints)}${renderCustomCats(customCategories)}${userRubricText}\n\n--- ROWS (id\\tvendor\\tamount\\tcurrentDirection\\tcurrentCategory) ---\n${rowsCsv}`;

  const client = new Anthropic({ apiKey });
  const startedAt = Date.now();

  let resp;
  try {
    resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16000,
      system: [
        { type: 'text', text: RECATEGORIZE_RUBRIC, cache_control: { type: 'ephemeral' } },
      ],
      output_config: {
        format: { type: 'json_schema', schema: buildSchema(allowedAll) },
      },
      messages: [{ role: 'user', content: userText }],
    });
  } catch (e) {
    console.error('[recategorize-ai] Anthropic call failed:', e);
    return Response.json({ error: `AI re-categorize failed: ${e?.message || String(e)}` }, { status: e?.status || 500 });
  }

  const textBlock = resp.content.find(b => b.type === 'text');
  if (!textBlock) return Response.json({ error: 'AI returned no text block.' }, { status: 500 });

  let parsed;
  try { parsed = JSON.parse(textBlock.text); }
  catch (e) {
    return Response.json({ error: `AI returned invalid JSON: ${e.message}`, raw: textBlock.text.slice(0, 500) }, { status: 500 });
  }

  return Response.json({
    suggestions: parsed.suggestions || [],
    durationMs: Date.now() - startedAt,
    usage: {
      inputTokens: resp.usage.input_tokens,
      cachedReadTokens: resp.usage.cache_read_input_tokens || 0,
      outputTokens: resp.usage.output_tokens,
    },
  });
}
