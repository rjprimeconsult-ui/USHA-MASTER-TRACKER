/**
 * Universal AI expense importer.
 *
 * Accepts any spreadsheet, CSV, or PDF (text or image) and returns a
 * normalized list of {date, vendor, amount, direction, category}
 * transactions ready to insert into Books.
 *
 * Pipeline:
 *   1. Detect file type by extension + magic bytes
 *   2. Extract content:
 *        XLSX/CSV   -> read all sheets as TSV-ish text (deterministic)
 *        PDF text   -> extract via pdfjs-dist
 *        PDF image  -> base64 + send to Claude Vision
 *   3. Send to Claude Haiku 4.5 with a strict JSON schema constraint
 *   4. Return the structured transaction list
 *
 * Claude does the smart work: figures out the file's structure, finds
 * transactions vs headers vs totals, classifies into our categories.
 *
 * Required env: ANTHROPIC_API_KEY
 * Optional fall-back: when the key is missing or the API errors, we
 * return { error, fallback: true } and the client can downshift to
 * the existing keyword classifier.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Allow up to 60s — Vision on a multi-page PDF can take a while.
export const maxDuration = 60;

// Categories Claude must pick from. Kept inline (not imported) so this
// route can run on the edge if we ever move it there. Keep in sync with
// src/lib/constants.js.
const EXPENSE_CATEGORIES = [
  'LEAD_INVESTMENT', 'OFFICE_RENT', 'OFFICE', 'SOFTWARE', 'MARKETING',
  'RECRUITING', 'TEAM_INCENTIVES', 'TRAVEL', 'VEHICLE', 'MEALS',
  'PROFESSIONAL', 'PHONE_INTERNET', 'HEALTHCARE', 'COACHING', 'OTHER_EXPENSE',
];
const INCOME_CATEGORIES = [
  'BONUS', 'OVERRIDE', 'RENEWAL', 'OTHER_INCOME',
];
// Platforms tracked separately from Books — these CRM expenses appear
// throughout most agents' spreadsheets and feed the True CPA calculation.
const PLATFORMS = ['TD', 'RINGY', 'VANILLA']; // TD = TextDrip, VANILLA = VanillaSoft
const PLATFORM_REASONS = ['CREDIT REFILL', 'CREDIT REFILL/RENEWAL', 'MONTHLY SUBSCRIPTION', 'RENEWAL', 'OTHER'];

// The classification rubric. Cached as a system-prompt prefix so repeat
// calls are ~0.1× input cost.
const CATEGORY_RUBRIC = `
You are extracting transactions from financial documents for an insurance agent's bookkeeping app. Each row must be routed to ONE of three buckets:

  1) PLATFORMS — CRM platform charges that get tracked separately from Books because they feed the agent's True-CPA calculation. Use this whenever a row clearly relates to one of:
       - TD (TextDrip): "Text Creds", "TextDrip", "TextDrip credits", "td credits", any reference to TextDrip subscription/refill.
       - RINGY: "Ringy", "Ringy credits", "Ringy subscription".
       - VANILLA (VanillaSoft): "VanillaSoft", "Vanilla Soft", "VS Creds", "VS credits", "cami's vs", "vsoft creds".
     For these rows, output a "platformExpenses[]" entry with platformId set to TD / RINGY / VANILLA — DO NOT also add them to "transactions".
     Reason should be CREDIT REFILL when the row is a top-up (most "creds" / "credits" rows), MONTHLY SUBSCRIPTION when periodic, RENEWAL when explicitly a renewal, otherwise OTHER.

  2) BOOKS expenses — every other money-out item. Goes into "transactions[]" with direction = "expense" and one of the EXPENSE CATEGORIES below.

  3) BOOKS income — money-in items. Goes into "transactions[]" with direction = "income" and one of the INCOME CATEGORIES below.

EXPENSE CATEGORIES (when direction = expense, NOT a platform row):
- LEAD_INVESTMENT: lead purchases (aged leads, USHA leads, Ringy leads, Benepath, lead vendors, "leads", "chev credits"). Direct cost-per-acquisition spend. NOTE: "Ringy leads" goes here (LEAD_INVESTMENT) — but a plain "Ringy" subscription/credits charge goes to PLATFORMS as platformId=RINGY.
- SOFTWARE: subscriptions other than TD/Ringy/VanillaSoft (Calendly, AI tools like ChatGPT/Claude, Notion, Slack, Zoom, dev tools, Adobe, etc.).
- MARKETING: Facebook ads, Google ads (general, not lead-specific), Meta ads, mailchimp.
- OFFICE_RENT: office rent, FSL rent, desk rent, co-working.
- OFFICE: office supplies, Amazon, Staples, shipping (UPS/FedEx).
- RECRUITING: agent recruiting expenses, candidate outings.
- TEAM_INCENTIVES: team meals/coffee/wings/pizza/uber-eats explicitly for the team or top producers (NOT solo meals — those are MEALS).
- TRAVEL: hotels (Airbnb, Marriott, Hilton), flights, work trips, conferences.
- VEHICLE: gas stations (Shell, Chevron, Exxon, BP, 76, Arco), Uber/Lyft (transport, NOT eats), parking, tolls, oil change, car insurance.
- MEALS: solo client lunches, restaurant meals, Uber Eats / DoorDash for self (no "team" prefix), Starbucks, Chipotle, etc.
- PROFESSIONAL: E&O, NAIFA, license fees, NIPR, sircon, CPA, accountant, attorney, LLC fees, sunbiz, registered agent.
- PHONE_INTERNET: AT&T, Verizon, Comcast, Xfinity, T-Mobile, internet.
- HEALTHCARE: CVS, Walgreens, doctor, dentist, medical, dental, pharmacy.
- COACHING: business coach, mentor, training, seminar, mastermind.
- OTHER_EXPENSE: legitimate business expense that doesn't fit any other bucket.

INCOME CATEGORIES (when amount represents money IN):
- BONUS: production bonus, milestone bonus, contest spiff, incentive payment.
- OVERRIDE: leader/manager override commission.
- RENEWAL: renewal commission, residual income, trail commission.
- OTHER_INCOME: any other income, including transfers, refunds, miscellaneous.

CRITICAL RULES:
1. Skip section headers, totals, subtotals, divider rows, blank rows, "{Blank}" placeholders.
2. Skip rows that are obviously summaries ("MONTH TOTAL", "Q1 TOTALS", "Beginning Balance", "Ending Balance").
3. Skip rows where the description contains reserve-statement noise: "E&O Charge", "Week Ending", "Reserve Adjustment", "Chargeback Reserve".
4. Negative amounts in spreadsheets typically mean expenses (money out). Positive amounts typically mean income (money in). Use this signal but verify against the description.
5. For credit-card statements, charges are typically positive (money out — direction: "expense"). Payments to the card are negative (transfer — direction: "income" or skip).
6. Infer the year from context if dates lack one (sheet name like "JAN 26" -> 2026; "APR 25" -> 2025).
7. Normalize dates to YYYY-MM-DD.
8. Strip currency formatting from amounts. Use absolute value (the sign is captured in "direction").
9. Vendor/description should be terse and clean — strip repeated whitespace, keep the meaningful merchant or item name.
10. If you genuinely cannot tell what category fits, use OTHER_EXPENSE or OTHER_INCOME — don't guess.

Return an empty transactions array if the document has no extractable transaction-level data (only summaries, only narrative text, etc.).

USER PREFERENCES:
The user's message may include a "USER PREFERENCES" block with prior {vendor -> direction/category} mappings the user has personally confirmed in past imports. When you encounter a vendor in the file that matches OR closely resembles one of these (after lowercasing and ignoring trailing store numbers / transaction codes), you MUST use the user's preferred direction and category instead of guessing from the rubric. This includes routing to platforms when the user has previously routed a similar vendor there. Treat the preferences as ground truth — they reflect this specific user's bookkeeping style.
`.trim();

// JSON schema Claude must conform to. Strict mode means valid JSON,
// no commentary, no fences.
const TRANSACTION_SCHEMA = {
  type: 'object',
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          vendor: { type: 'string', description: 'Merchant or item description, terse' },
          amount: { type: 'number', description: 'Absolute value, positive number' },
          direction: { type: 'string', enum: ['expense', 'income'] },
          category: { type: 'string', enum: [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES] },
          notes: { type: 'string', description: 'Any helpful context (account, sheet name, etc.). Optional.' },
        },
        required: ['date', 'vendor', 'amount', 'direction', 'category'],
        additionalProperties: false,
      },
    },
    platformExpenses: {
      type: 'array',
      description: 'CRM-platform charges (Ringy, TextDrip, VanillaSoft). Tracked separately from Books because they feed the True CPA calculation.',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          platformId: { type: 'string', enum: PLATFORMS, description: 'TD = TextDrip, VANILLA = VanillaSoft' },
          amount: { type: 'number', description: 'Absolute value, positive number' },
          reason: { type: 'string', enum: PLATFORM_REASONS },
          vendor: { type: 'string', description: 'Original line-item description as printed' },
          notes: { type: 'string' },
        },
        required: ['date', 'platformId', 'amount', 'reason'],
        additionalProperties: false,
      },
    },
    summary: {
      type: 'object',
      properties: {
        totalExpenses: { type: 'number' },
        totalIncome: { type: 'number' },
        totalPlatforms: { type: 'number' },
        format: { type: 'string', description: 'Best-guess label: "bank statement", "credit card", "weekly tracker", "expense ledger", etc.' },
      },
      required: ['totalExpenses', 'totalIncome', 'format'],
      additionalProperties: false,
    },
  },
  required: ['transactions', 'platformExpenses', 'summary'],
  additionalProperties: false,
};

// ---- File extraction helpers ----

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
  // pdfjs-dist legacy build runs in Node without a worker
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

// Detect file type from filename and bytes
function detectFileType(filename, buffer) {
  const ln = String(filename || '').toLowerCase();
  if (ln.endsWith('.csv')) return 'csv';
  if (ln.endsWith('.xlsx') || ln.endsWith('.xls')) return 'xlsx';
  if (ln.endsWith('.pdf')) return 'pdf';
  // Magic byte check fallback
  if (buffer.length >= 4) {
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'pdf'; // %PDF
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) return 'xlsx'; // PK zip
  }
  return 'unknown';
}

// ---- Main handler ----

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: 'AI importer not configured. Set ANTHROPIC_API_KEY in Vercel env vars.',
      fallback: true,
    }, { status: 503 });
  }

  let file;
  let vendorHints = []; // [{ vendor, direction, category?, platformId? }]
  try {
    const form = await req.formData();
    file = form.get('file');
    if (!file || typeof file === 'string') {
      return Response.json({ error: 'No file uploaded.' }, { status: 400 });
    }
    const hintsRaw = form.get('vendorHints');
    if (typeof hintsRaw === 'string' && hintsRaw.length > 0) {
      try {
        const parsed = JSON.parse(hintsRaw);
        if (Array.isArray(parsed)) vendorHints = parsed.slice(0, 100);
      } catch { /* ignore — hints are optional */ }
    }
  } catch (e) {
    return Response.json({ error: `Couldn't read upload: ${e.message}` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name || 'upload';
  const fileType = detectFileType(filename, buffer);

  // Render the vendor-hints block once — appended to the user message so it
  // doesn't bust the system-prompt cache.
  const renderHints = (hints) => {
    if (!hints?.length) return '';
    const lines = hints.map(h => {
      if (h.direction === 'platform' && h.platformId) {
        return `  "${h.vendor}" -> PLATFORM (${h.platformId})`;
      }
      return `  "${h.vendor}" -> ${h.direction || 'expense'} / ${h.category || 'OTHER_EXPENSE'}`;
    });
    return `\n\n--- USER PREFERENCES (apply these mappings when vendors match) ---\n${lines.join('\n')}`;
  };
  const hintsText = renderHints(vendorHints);

  // Build the user-message content depending on file type
  let userContent;
  let extractedHint = '';

  try {
    if (fileType === 'xlsx' || fileType === 'csv') {
      const text = extractXlsxText(buffer);
      // Cap input size — 200K chars ~= 50K tokens, well under Haiku's 200K window
      const truncated = text.length > 200000 ? text.slice(0, 200000) + '\n[...truncated]' : text;
      userContent = [{
        type: 'text',
        text: `File: ${filename}\nType: ${fileType.toUpperCase()}\n\nExtract every transaction as structured JSON.${hintsText}\n\n--- FILE CONTENT ---\n${truncated}`,
      }];
      extractedHint = `Parsed ${text.split('\n').length} rows from spreadsheet.`;
    } else if (fileType === 'pdf') {
      // Try text extraction first; if too sparse, fall through to vision
      const pdfText = await extractPdfText(buffer).catch(() => '');
      const cleanText = pdfText.replace(/\s+/g, ' ').trim();
      if (cleanText.length > 200) {
        // Digital PDF — use text path
        userContent = [{
          type: 'text',
          text: `File: ${filename}\nType: PDF (text-extractable)\n\nExtract every transaction as structured JSON.${hintsText}\n\n--- FILE CONTENT ---\n${pdfText.slice(0, 200000)}`,
        }];
        extractedHint = `Extracted ${cleanText.length} chars of text from PDF.`;
      } else {
        // Image-based PDF — send the whole document to vision
        const base64 = buffer.toString('base64');
        userContent = [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          {
            type: 'text',
            text: `File: ${filename}\nType: PDF (image-based — sent for vision processing).\n\nExtract every transaction as structured JSON.${hintsText}`,
          },
        ];
        extractedHint = `Sent ${(buffer.length / 1024).toFixed(0)}KB PDF to vision.`;
      }
    } else {
      return Response.json({ error: `Unsupported file type. Got "${filename}". Supported: .xlsx, .xls, .csv, .pdf.` }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: `Couldn't extract file content: ${e.message}` }, { status: 400 });
  }

  // ---- Call Claude Haiku ----

  const client = new Anthropic({ apiKey });

  let resp;
  try {
    resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16000,
      // Cache the (large, stable) rubric so repeat calls on multi-file
      // imports cost ~0.1× on the system prompt.
      system: [
        { type: 'text', text: CATEGORY_RUBRIC, cache_control: { type: 'ephemeral' } },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: TRANSACTION_SCHEMA,
        },
      },
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (e) {
    console.error('[import-expenses-ai] Anthropic call failed:', e);
    const status = e?.status || 500;
    const message = e?.message || String(e);
    return Response.json({
      error: `AI extraction failed: ${message}`,
      fallback: true,
    }, { status });
  }

  // Pull text content (json_schema output guarantees first block is text/JSON)
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

  // Log usage for cost tracking
  console.log(`[import-expenses-ai] file=${filename} type=${fileType} txs=${parsed.transactions?.length || 0} platforms=${parsed.platformExpenses?.length || 0} input=${resp.usage.input_tokens} cached_read=${resp.usage.cache_read_input_tokens || 0} output=${resp.usage.output_tokens}`);

  return Response.json({
    transactions: parsed.transactions || [],
    platformExpenses: parsed.platformExpenses || [],
    summary: parsed.summary || { totalExpenses: 0, totalIncome: 0, format: 'unknown' },
    extractedHint,
    usage: {
      inputTokens: resp.usage.input_tokens,
      cachedReadTokens: resp.usage.cache_read_input_tokens || 0,
      cachedWriteTokens: resp.usage.cache_creation_input_tokens || 0,
      outputTokens: resp.usage.output_tokens,
    },
  });
}
