/**
 * Universal AI lead importer.
 *
 * Accepts any spreadsheet, CSV, or PDF (text or image) and returns a
 * normalized list of lead records ready to insert into the tracker.
 *
 * Pipeline mirrors /api/import-expenses-ai:
 *   1. Detect file type
 *   2. Extract content (XLSX/CSV -> text, PDF -> pdfjs or vision)
 *   3. Send to Claude Haiku 4.5 with strict JSON schema
 *   4. Return structured leads
 *
 * Required env: ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import {
  STAGES as STAGE_DEFS,
  MAIN_PRODUCTS as MAIN_PRODUCT_DEFS,
  ADDON_PRODUCTS as ADDON_PRODUCT_DEFS,
  ASSOCIATION_PLANS as ASSOCIATION_PLAN_DEFS,
  CRMS as CRM_DEFS,
  SOURCES as SOURCE_DEFS,
  LEAD_CATEGORIES as LEAD_CATEGORY_DEFS,
} from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Single source of truth — derive ID arrays from the canonical defs in
// src/lib/constants.js. Adding/renaming a stage or product in one place
// updates the AI rubric automatically.
const STAGES = STAGE_DEFS.map(s => s.id);
const MAIN_PRODUCTS = MAIN_PRODUCT_DEFS.map(p => p.id);
const ADDON_PRODUCTS = ADDON_PRODUCT_DEFS.map(p => p.id);
const ASSOCIATION_PLANS = ASSOCIATION_PLAN_DEFS.map(p => p.id);
const CRMS = CRM_DEFS.map(c => c.id);
const SOURCES = [...SOURCE_DEFS];
const LEAD_CATEGORIES = LEAD_CATEGORY_DEFS.map(c => c.id);

// Cached system prompt — large, stable, repeated across calls. Re-imports
// hit the prompt cache for ~0.1x input cost.
const LEAD_RUBRIC = `
You are extracting insurance lead records from documents for a USHA agent's tracker. Each lead is a person who purchased (or was submitted for) one or more insurance policies.

STAGES (lead.stage — pick exactly one):
- Pending: deal submitted to underwriting, awaiting decision (UW Status PENDING with no final POLICY STATUS, or a row with no UW/Policy status set)
- Issued: deal approved + paid (POLICY STATUS = PAID / APPROVED / "P NOTE", or UW STATUS = APPROVED with no negative POLICY STATUS)
- Declined: underwriting rejected (POLICY STATUS = DECLINED or UW STATUS = DECLINE/DECLINED)
- Not taken: client chose not to proceed (POLICY STATUS = NOT TAKEN)
- Withdrawn: agent withdrew the application (POLICY STATUS = WITHDRAWN or UW STATUS = WITHDRAWN)

MAIN PRODUCTS (lead.mainProduct — pick exactly one of these canonical IDs, or leave empty):
- PREMIER ADVANTAGE: matches "PA", "Prem Adv", "Premier Adv", "Premier Advantage", "PremierAdvantage", "PremierAdvantage Fixed Indemnity"
- PREMIER CHOICE: matches "PC", "Prem Choice", "Premier Choice", "PremierChoice"
- SECURE ADVANTAGE: matches "SA", "Sec Adv", "Secure Adv", "Secure Advantage", "SecureAdvantage"
- SECUREADVANTAGE CONVERSION: matches "SA Conversion", "SecureAdvantage Conversion", "SA Conv", "Conversion Plan"
- HEALTH ACCESS III: matches "HA", "HA III", "Health Access", "Health Access III", "HealthAccess"
- ACA WRAP: matches "ACA", "ACA Wrap"
- SUPPY: matches "Suppy" exactly

ADD-ON PRODUCTS (lead.products array — these are supplemental, not main):
- MEDGUARD III: matches "MedGuard", "Med Guard", "MedGuard III", "MedGuard II"
- PREMIERVISION: matches "PremierVision", "Premier Vision"
- DENTAL / SECUREDENTAL: matches "Secure Dental", "Secure Dental Plus", "SecureDental", "Dental", "Dental Plus", "ASSO/DENTAL/VISION" (the dental component)
- ACCIDENT PROTECTOR: matches "Accident Protector", "AccidentProtector", "AP" (note: distinct from "SECURE ADV ACCIDENT" / "SECUREADVANTAGE ACCIDENT" which is a Secure Advantage variant, NOT this standalone product)
- INCOME PROTECTOR: matches "Income Protector", "IncomeProtector", "IP"
- LIFE PROTECTOR II: matches "Life Protector", "Life Protector II", "LP", "LP II", "LifeProtector"

ASSOCIATION PLANS (lead.associationPlan — pick one of these or leave empty):
EXECUTIVE DIAMOND, DIAMOND, EMERALD, SAPPHIRE, RUBY, PEARL, NO ASS., ABC ELITE, ABC EXECUTIVE, ABC ENTREPRENEUR, SUPPY, PRO WRAP
- "NO ASSOCIATION", "NONE", "NO ASS" all map to "NO ASS."
- "HA ELITE" -> "ABC ELITE"; "HA EXECUTIVE" -> "ABC EXECUTIVE"; "HA ENTREPRENEUR" -> "ABC ENTREPRENEUR"

CRM (lead.crm — pick one): RINGY, TEXTDRIP, VANILLA, GOOGLE, BENEPATH — leave empty if unclear. "Benepath" / "Bennys" / "Bennies" all map to BENEPATH.
SOURCE (lead.source — pick one): Website, Referral, Facebook, Google, LinkedIn, Cold Call, Event, CRM, Dialer, Other.
LEAD CATEGORY (lead.leadCategory — pick one): AGED, SHARED, REFERRAL, DIALER, REPEAT CLIENT, JACKPOT, D7, GOOGLE LEADS, BENEPATH. Use BENEPATH when the lead source is the Benepath lead vendor (variants: "Benepath", "Bennys", "Bennies").
PAY TYPE (lead.payType — pick one): "advance" (default — paid upfront as advance) or "as_earned" (paid monthly as client pays premium).
- "ADVANCED", "ADV" -> "advance"
- "AS EARNED", "AS-EARNED" -> "as_earned"

AGE / AGE BUCKET:
- If the file has an exact age column, set lead.age to that integer and leave ageBucket empty.
- If exact age is not in the file but context suggests over-50 ("senior", "Medicare-eligible", "65+ plan", "retirees", "spouse 67", "born 1955"), set ageBucket = "OVER_50" and leave age = 0.
- If context suggests under-50 ("young family", "millennial plan", "born 1990"), set ageBucket = "UNDER_50" and leave age = 0.
- If neither signal exists, leave both empty (age = 0, ageBucket = '').
- Do NOT guess an exact age from "senior" or similar phrases — the bucket exists for that case.
- GROUPED BOOKS (important — common layout): agents often organize a book under demographic SECTION HEADERS, e.g. a row that just says "Over 50" (or "Under 50", "50+", "65+", "Seniors", "Medicare") followed by the clients that belong to that group. In that case: (a) SKIP the header row — it is NOT a client, never create a lead named "Over 50"; and (b) apply that grouping as the ageBucket (OVER_50 / UNDER_50) for every client listed beneath it until the next section header. This recovers the agent's intent instead of mislabeling clients.

FAMILY MEMBERS — capture spouse + dependents:
When a row indicates a family policy (Indv/Family = "Family", or notes mention "spouse", "wife", "husband", "dependent", "fam 2", "family of 3", "+ kids", etc.), populate the dependents array. Each entry has:
  - name (full name as printed)
  - relationship ("spouse" | "child" | "other")
  - dob (YYYY-MM-DD if available, else empty)

Sources of dependent names:
- A dedicated "Spouse" / "Dependents" / "Family" column
- Free-form notes that say "wife: Mary Smith DOB 5/12/1985" or "spouse Jane Doe"
- A "Names" column listing multiple people separated by commas / slashes
- DOB columns with multiple dates (paired with names if present)

Why it matters: if the primary applicant is declined but the spouse gets approved, USHA pays out under the SPOUSE's name on the weekly statement. Capturing them on the lead protects the commission attribution. Don't skip this when the data is in the file.

CRITICAL RULES:
1. Skip section headers, totals, subtotals, divider rows ("January", "FEBRUARY", "BOOK 2026", "TOTALS", "MONTH TOTALS", "TAKEN RATE", "UNDERWRITTEN", "HA's", etc.). This INCLUDES demographic/category grouping headers: "Over 50", "Under 50", "50+", "65+", "Seniors", "Medicare", "Retirees", "Aged", "Shared", "Referral", "Google Leads" — when these appear alone on a row they are GROUP labels, not people.
2. Skip blank rows.
3. Every lead must have at minimum a NAME, and that name must be a real PERSON'S name. NEVER use a demographic, age, or category label as a name (e.g. "Over 50", "Under 50", "Medicare", "Seniors", "Aged", "Shared", "Referral"). If a row's only name candidate is such a label, it is a section header — skip it, do NOT create a lead named after the category. (This caused a real incident: a grouped book imported dozens of clients all named "Over 50", which then looked like duplicates.)
4. Normalize phone numbers to (XXX) XXX-XXXX format if possible.
5. Normalize dates to YYYY-MM-DD. Spreadsheets often have m/d/yy or m/d/yyyy — interpret 2-digit years as 20XX (years 51-99 -> 19XX, 00-50 -> 20XX).
6. State must be a 2-letter US state code if possible.
7. Premium values strip currency formatting and use the monthly amount. If only annual is given, divide by 12.
8. Policy numbers are typically alphanumeric (e.g. "52Y2502220", "02N2198380"). Preserve case as-is.
9. If multiple products are listed, pick the one main product first (PREMIER ADVANTAGE / PREMIER CHOICE / SECURE ADVANTAGE / HEALTH ACCESS III / ACA WRAP / SUPPY); everything else goes into the products array as add-ons.
10. The "POLICY TYPE" column in book-of-business sheets is typically the main product, NOT just any text — apply the canonical mapping above.
11. Notes field can carry stuff that doesn't fit elsewhere — original POLICY TYPE text if it didn't map, special situations, sub-agent name, etc.
12. Don't invent fields. If the row doesn't have an email, leave email empty. Don't guess phones from names.

Return an empty leads array if the document has no extractable lead-level data (only summaries, only narrative, etc.).
`.trim();

const LEAD_SCHEMA = {
  type: 'object',
  properties: {
    leads: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' },
          ageBucket: {
            type: 'string',
            enum: ['', 'OVER_50', 'UNDER_50'],
            description: 'Use ONLY when exact age is unknown. Set OVER_50 for "senior", "Medicare-eligible", "65+", and similar cues. Set UNDER_50 for "young family", "under 50", and similar cues. Leave empty when age is provided as an exact number or no age signal exists.',
          },
          phone: { type: 'string' },
          email: { type: 'string' },
          state: { type: 'string', description: '2-letter US state code' },
          zip: { type: 'string' },
          policyNumber: { type: 'string' },
          mainProduct: { type: 'string', enum: ['', ...MAIN_PRODUCTS] },
          mainProductPremium: { type: 'number', description: 'Monthly premium' },
          products: {
            type: 'array',
            description: 'Add-on products only (not the main product)',
            items: { type: 'string', enum: ADDON_PRODUCTS },
          },
          associationPlan: { type: 'string', enum: ['', ...ASSOCIATION_PLANS] },
          stage: { type: 'string', enum: STAGES },
          closedDate: { type: 'string', description: 'YYYY-MM-DD or empty' },
          payType: { type: 'string', enum: ['advance', 'as_earned'] },
          crm: { type: 'string', enum: ['', ...CRMS] },
          leadCategory: { type: 'string', enum: ['', ...LEAD_CATEGORIES] },
          source: { type: 'string', enum: ['', ...SOURCES] },
          notes: { type: 'string' },
          dependents: {
            type: 'array',
            description: 'Family members on the policy (spouse + dependents). Crucial for partial-issuance commission tracking.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Full name as printed' },
                relationship: { type: 'string', enum: ['spouse', 'child', 'other'] },
                dob: { type: 'string', description: 'YYYY-MM-DD or empty' },
              },
              required: ['name', 'relationship'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'stage', 'payType'],
        additionalProperties: false,
      },
    },
    summary: {
      type: 'object',
      properties: {
        totalLeads: { type: 'integer' },
        byStage: { type: 'object', additionalProperties: { type: 'integer' } },
        format: { type: 'string', description: '"book of business", "USHA portal export", "weekly statement", "lead list", etc.' },
      },
      required: ['totalLeads', 'byStage', 'format'],
      additionalProperties: false,
    },
  },
  required: ['leads', 'summary'],
  additionalProperties: false,
};

// ---- File extraction (same as expenses route) ----

function extractXlsxText(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const parts = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    parts.push(`### Sheet: ${name}`);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    for (const row of rows) {
      if (!row.some(c => String(c || '').trim())) continue;
      parts.push(row.map(c => String(c ?? '')).join('\t'));
    }
    parts.push('');
  }
  return parts.join('\n');
}

async function extractPdfText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const txt = content.items.map(it => it.str).join(' ');
    pages.push(`--- Page ${i} ---\n${txt}`);
  }
  return pages.join('\n');
}

function detectFileType(filename, buffer) {
  const ln = String(filename || '').toLowerCase();
  if (ln.endsWith('.csv')) return 'csv';
  if (ln.endsWith('.xlsx') || ln.endsWith('.xls')) return 'xlsx';
  if (ln.endsWith('.pdf')) return 'pdf';
  if (ln.endsWith('.png') || ln.endsWith('.jpg') || ln.endsWith('.jpeg') || ln.endsWith('.webp')) return 'image';
  if (buffer.length >= 4) {
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'pdf';
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) return 'xlsx';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image';
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image';
  }
  return 'unknown';
}

function imageMediaType(filename) {
  const ln = String(filename || '').toLowerCase();
  if (ln.endsWith('.png')) return 'image/png';
  if (ln.endsWith('.webp')) return 'image/webp';
  if (ln.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

// ---- Main handler ----

export async function POST(req) {
  // Auth-gate this route so Anthropic spend is only billed for valid
  // user sessions — previously any anonymous POST could trigger an
  // import + drive cost.
  const { requireUserId } = await import('@/lib/apiAuth');
  const auth = await requireUserId(req);
  if (auth instanceof Response) return auth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: 'AI importer not configured. Set ANTHROPIC_API_KEY in Vercel env vars.',
      fallback: true,
    }, { status: 503 });
  }

  let file;
  let userRubric = '';
  try {
    const form = await req.formData();
    file = form.get('file');
    if (!file || typeof file === 'string') {
      return Response.json({ error: 'No file uploaded.' }, { status: 400 });
    }
    const rubricRaw = form.get('userRubric');
    if (typeof rubricRaw === 'string') userRubric = rubricRaw.slice(0, 1500);
  } catch (e) {
    return Response.json({ error: `Couldn't read upload: ${e.message}` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name || 'upload';
  const fileType = detectFileType(filename, buffer);

  // Agent's free-form rubric overlay — appended to user message so the
  // cached system prompt stays warm.
  const userRubricText = userRubric.trim()
    ? `\n\n--- AGENT'S OWN RUBRIC NOTES (apply on top of standard rubric) ---\n${userRubric.trim()}\n--- END AGENT NOTES ---`
    : '';

  let userContent;
  let extractedHint = '';

  try {
    if (fileType === 'xlsx' || fileType === 'csv') {
      const text = extractXlsxText(buffer);
      const truncated = text.length > 200000 ? text.slice(0, 200000) + '\n[...truncated]' : text;
      userContent = [{
        type: 'text',
        text: `File: ${filename}\nType: ${fileType.toUpperCase()}\n\nExtract every lead as structured JSON.${userRubricText}\n\n--- FILE CONTENT ---\n${truncated}`,
      }];
      extractedHint = `Parsed ${text.split('\n').length} rows from spreadsheet.`;
    } else if (fileType === 'pdf') {
      const pdfText = await extractPdfText(buffer).catch(() => '');
      const cleanText = pdfText.replace(/\s+/g, ' ').trim();
      if (cleanText.length > 200) {
        userContent = [{
          type: 'text',
          text: `File: ${filename}\nType: PDF (text-extractable)\n\nExtract every lead as structured JSON.${userRubricText}\n\n--- FILE CONTENT ---\n${pdfText.slice(0, 200000)}`,
        }];
        extractedHint = `Extracted ${cleanText.length} chars of text from PDF.`;
      } else {
        const base64 = buffer.toString('base64');
        userContent = [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          {
            type: 'text',
            text: `File: ${filename}\nType: PDF (image-based — sent for vision processing).\n\nExtract every lead as structured JSON.${userRubricText}`,
          },
        ];
        extractedHint = `Sent ${(buffer.length / 1024).toFixed(0)}KB PDF to vision.`;
      }
    } else if (fileType === 'image') {
      const base64 = buffer.toString('base64');
      const mediaType = imageMediaType(filename);
      userContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        {
          type: 'text',
          text: `File: ${filename}\nType: Image (sent for vision processing).\n\nExtract every lead visible in this image as structured JSON.`,
        },
      ];
      extractedHint = `Sent ${(buffer.length / 1024).toFixed(0)}KB image to vision.`;
    } else {
      return Response.json({ error: `Unsupported file type. Got "${filename}". Supported: .xlsx, .xls, .csv, .pdf, .png, .jpg, .webp.` }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: `Couldn't extract file content: ${e.message}` }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  let resp;
  try {
    // Streaming required when max_tokens is large enough that latency could
    // exceed the SDK's 10-min non-stream cap.
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5',
      // 32K so book-of-business files with 200+ leads don't truncate
      max_tokens: 32000,
      system: [
        { type: 'text', text: LEAD_RUBRIC, cache_control: { type: 'ephemeral' } },
      ],
      output_config: {
        format: { type: 'json_schema', schema: LEAD_SCHEMA },
      },
      messages: [{ role: 'user', content: userContent }],
    });
    resp = await stream.finalMessage();
  } catch (e) {
    console.error('[import-leads-ai] Anthropic call failed:', e);
    const status = e?.status || 500;
    const message = e?.message || String(e);
    return Response.json({
      error: `AI extraction failed: ${message}`,
      fallback: true,
    }, { status });
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

  console.log(`[import-leads-ai] file=${filename} type=${fileType} leads=${parsed.leads?.length || 0} input=${resp.usage.input_tokens} cached_read=${resp.usage.cache_read_input_tokens || 0} output=${resp.usage.output_tokens}`);

  return Response.json({
    leads: parsed.leads || [],
    summary: parsed.summary || { totalLeads: 0, byStage: {}, format: 'unknown' },
    extractedHint,
    usage: {
      inputTokens: resp.usage.input_tokens,
      cachedReadTokens: resp.usage.cache_read_input_tokens || 0,
      cachedWriteTokens: resp.usage.cache_creation_input_tokens || 0,
      outputTokens: resp.usage.output_tokens,
    },
  });
}
