/**
 * AI-powered USHA portal screenshot extraction.
 *
 * Replaces (with Tesseract as fallback) the client-side OCR that was
 * misreading small text — agents kept seeing missing DOB/phone/age,
 * garbled emails ("ME@JORDYNFRIEDMAN.COM" parsed as
 * "2026@megiordynfriedman.com"), and partial addresses.
 *
 * Pipeline:
 *   1. Receive the image as multipart form (one field "file").
 *   2. Send to Claude Haiku 4.5 Vision with a strict JSON schema so the
 *      model returns structured data we can plug straight into the lead
 *      form — no client-side regex needed.
 *   3. Return the structured fields plus the model's raw response so the
 *      caller can inspect / debug.
 *
 * Caller behavior on failure: the client falls back to Tesseract so this
 * endpoint missing or erroring doesn't break the feature.
 *
 * Required env: ANTHROPIC_API_KEY (already set for the Smart Import).
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  MAIN_PRODUCTS,
  ADDON_PRODUCTS,
  ASSOCIATION_PLANS,
} from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAIN_IDS = MAIN_PRODUCTS.map(p => p.id);
const ADDON_IDS = ADDON_PRODUCTS.map(p => p.id);
const ASSOCIATION_IDS = ASSOCIATION_PLANS.map(p => p.id);

// Stable system prompt — cached by Anthropic when the same content is
// sent on repeat calls. Tells the model what fields to extract and how
// to normalize them. Kept terse — Vision-based extraction needs less
// hand-holding than text-only.
const SYSTEM_PROMPT = `
You extract structured deal data from USHA (USHEALTH Advisors) portal screenshots.

The screenshot shows a customer detail page with: customer name, policy number, stage (Issued / Pending / Active / Declined), monthly premium, primary info (gender, DOB with age in parens, phone, email, address), policies list (including the master Association policy + any add-ons + main product), and optionally a Dependents section.

You will return a JSON object that conforms to the provided schema. Rules:

- name: Title Case the all-caps name shown at the top.
- policyNumber: Take the master policy ID shown near the customer name. Uppercase letters. Format like "52Y2667120".
- monthlyPremium: numeric, in dollars.
- applicationDate, effectiveDate, paidToDate: normalize to YYYY-MM-DD.
- stage: map the badge text — "Issued" or "Active" → "Issued", "Pending" or "Submitted" → "Pending", "Declined" or "Lapsed" or "Cancelled" → "Declined", "Withdrawn" → "Withdrawn".
- gender: "Male" or "Female".
- dob: Use the DATE shown alongside the age in parens (e.g. "04/22/1999 (27)" → dob = "1999-04-22").
- age: Use the number IN PARENS if shown. Otherwise compute from dob if possible.
- phone: Format as "(XXX) XXX-XXXX". Read carefully — these are clean text in USHA portal screenshots.
- email: Read carefully and exactly. USHA emails are typed in caps but you should lowercase them. Do NOT invent characters. If unsure, return empty string.
- addressStreet: full street line (e.g. "6537 NW 39TH TER"). Title Case.
- addressCity: city (e.g. "Boca Raton"). Title Case.
- state: 2-letter uppercase state abbreviation.
- zip: 5-digit ZIP (drop +4 if present).
- indvOrFamily: "Family" if a Dependents section is shown with at least one dependent, otherwise "Indv".
- mainProduct: pick the canonical ID from MAIN_PRODUCTS_LIST. Map common variants: "PremierAdvantage Fixed Indemnity" → "PREMIER ADVANTAGE", "Secure Advantage" → "SECURE ADVANTAGE", "Premier Choice" → "PREMIER CHOICE", etc.
- products: array of canonical IDs from ADDONS_LIST. Map: "MedGuard III" → "MEDGUARD III", "Secure Dental Plus" / "SecureDental" → "DENTAL / SECUREDENTAL", "PremierVision" → "PREMIERVISION", "Accident Protector" → "ACCIDENT PROTECTOR", "Income Protector" → "INCOME PROTECTOR", "Life Protector II" → "LIFE PROTECTOR II".
- associationPlan: pick the canonical ID from ASSOCIATIONS_LIST based on what the "Association" policy line says. Map: "Executive Diamond" → "EXECUTIVE DIAMOND", "Tier 5 Diamond" / "Diamond" → "DIAMOND", "Tier 4 Emerald" / "Emerald" → "EMERALD", "Tier 3 Sapphire" → "SAPPHIRE", "Tier 2 Ruby" → "RUBY", "Tier 1 Pearl" → "PEARL", "ABC Elite" → "ABC ELITE", "ABC Executive" → "ABC EXECUTIVE", "ABC Entrepreneur" → "ABC ENTREPRENEUR". Return "" if no Association policy is shown.
- dependents: array. For each dependent row, extract name (Title Case), relationship ("spouse" / "child" / "other"), dob (YYYY-MM-DD). Skip the primary customer if they bleed in. Return [] if no Dependents section.

Quality bar: only fill fields you can READ on the image. Don't guess. Empty strings / null are acceptable for any field. Don't fabricate dates, addresses, or contact info.
`.trim();

function buildSchema() {
  return {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Title-cased primary customer name' },
      policyNumber: { type: 'string' },
      monthlyPremium: { type: 'number' },
      applicationDate: { type: 'string', description: 'YYYY-MM-DD' },
      effectiveDate: { type: 'string', description: 'YYYY-MM-DD' },
      paidToDate: { type: 'string', description: 'YYYY-MM-DD' },
      stage: {
        type: 'string',
        enum: ['Issued', 'Pending', 'Declined', 'Not taken', 'Withdrawn', ''],
      },
      gender: { type: 'string', enum: ['Male', 'Female', ''] },
      dob: { type: 'string', description: 'YYYY-MM-DD or empty' },
      age: { type: 'integer', description: 'Integer 0-120, or 0 if unknown' },
      phone: { type: 'string', description: '(XXX) XXX-XXXX format' },
      email: { type: 'string', description: 'lowercase email, or empty' },
      addressStreet: { type: 'string' },
      addressCity: { type: 'string' },
      state: { type: 'string', description: '2-letter uppercase state' },
      zip: { type: 'string', description: '5-digit ZIP' },
      indvOrFamily: { type: 'string', enum: ['Indv', 'Family'] },
      mainProduct: {
        type: 'string',
        enum: ['', ...MAIN_IDS],
        description: 'Canonical main product ID, or empty if not detected',
      },
      products: {
        type: 'array',
        items: { type: 'string', enum: ADDON_IDS },
        description: 'Canonical add-on product IDs',
      },
      associationPlan: {
        type: 'string',
        enum: ['', ...ASSOCIATION_IDS],
        description: 'Canonical association plan ID, or empty',
      },
      dependents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            relationship: { type: 'string', enum: ['spouse', 'child', 'other'] },
            dob: { type: 'string', description: 'YYYY-MM-DD or empty' },
          },
          required: ['name', 'relationship'],
          additionalProperties: false,
        },
      },
    },
    required: [
      'name', 'policyNumber', 'stage', 'phone', 'email',
      'state', 'zip', 'indvOrFamily', 'mainProduct', 'products',
      'dependents',
    ],
    additionalProperties: false,
  };
}

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: 'AI extraction not configured. Set ANTHROPIC_API_KEY in Vercel env vars.',
      fallback: true,
    }, { status: 503 });
  }

  let file;
  try {
    const form = await req.formData();
    file = form.get('file');
    if (!file || typeof file === 'string') {
      return Response.json({ error: 'No file uploaded.' }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: `Couldn't read upload: ${e?.message || String(e)}` }, { status: 400 });
  }

  // 4MB limit — generous for a single PNG/JPG screenshot.
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > 4 * 1024 * 1024) {
    return Response.json({ error: 'Screenshot too large (max 4MB).' }, { status: 400 });
  }

  // Determine media type. Default to PNG for unknown/octet-stream so the
  // model never rejects the image outright.
  let mediaType = file.type || 'image/png';
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mediaType)) mediaType = 'image/png';
  const base64 = buffer.toString('base64');

  const startedAt = Date.now();
  console.log(`[extract-screenshot-ai] start · image=${(buffer.length / 1024).toFixed(0)}KB · type=${mediaType}`);
  const client = new Anthropic({ apiKey });
  let resp;
  try {
    // Non-streaming for this route — the JSON-schema response is small
    // (under 1500 output tokens) so we don't benefit from streaming's
    // back-pressure handling, and streaming adds overhead that pushed
    // total latency over 25s on cold-start Vercel functions.
    resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      output_config: {
        format: { type: 'json_schema', schema: buildSchema() },
      },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: 'Extract structured deal data from this USHA portal screenshot.',
          },
        ],
      }],
    });
    console.log(`[extract-screenshot-ai] anthropic done in ${Date.now() - startedAt}ms · in=${resp.usage.input_tokens} out=${resp.usage.output_tokens}`);
  } catch (e) {
    console.error('[extract-screenshot-ai] Anthropic call failed:', e);
    return Response.json({
      error: `AI extraction failed: ${e?.message || String(e)}`,
      fallback: true,
    }, { status: e?.status || 500 });
  }

  const textBlock = resp.content.find(b => b.type === 'text');
  if (!textBlock) {
    return Response.json({ error: 'AI returned no text block.', fallback: true }, { status: 500 });
  }
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    return Response.json({
      error: `AI returned invalid JSON: ${e.message}`,
      raw: textBlock.text.slice(0, 500),
      fallback: true,
    }, { status: 500 });
  }

  console.log(`[extract-screenshot-ai] success in ${Date.now() - startedAt}ms · usage in=${resp.usage.input_tokens} out=${resp.usage.output_tokens}`);

  return Response.json({
    parsed,
    durationMs: Date.now() - startedAt,
    usage: {
      inputTokens: resp.usage.input_tokens,
      cachedReadTokens: resp.usage.cache_read_input_tokens || 0,
      outputTokens: resp.usage.output_tokens,
    },
  });
}
