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
import {
  EXPENSE_CATEGORIES as EXPENSE_CATEGORY_DEFS,
  INCOME_CATEGORIES as INCOME_CATEGORY_DEFS,
  PLATFORMS as PLATFORM_DEFS,
  PLATFORM_REASONS as PLATFORM_REASON_DEFS,
} from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Allow up to 5 minutes — Vision on a multi-page bank statement PDF
// (Chase, Amex, etc) can take 60-180s on cold starts.
export const maxDuration = 300;

// Single source of truth — derive ID arrays from the canonical defs in
// src/lib/constants.js so adding/renaming a category in one place updates
// every downstream consumer (forms, badges, AI prompts).
const EXPENSE_CATEGORIES = EXPENSE_CATEGORY_DEFS.map(c => c.id);
const INCOME_CATEGORIES = INCOME_CATEGORY_DEFS.map(c => c.id);
const PLATFORMS = PLATFORM_DEFS.map(p => p.id);
const PLATFORM_REASONS = [...PLATFORM_REASON_DEFS];

// The classification rubric. Cached as a system-prompt prefix so repeat
// calls are ~0.1× input cost.
const CATEGORY_RUBRIC = `
You are extracting transactions from financial documents for an insurance agent's bookkeeping app. Each row must be routed to ONE of three buckets:

  1) PLATFORMS — CRM platform charges that get tracked separately from Books because they feed the agent's True-CPA calculation. Use this whenever a row clearly relates to one of:
       - TD (TextDrip): "Text Creds", "TextDrip", "TextDrip credits", "td credits", "TXTDRIP", any reference to TextDrip subscription/refill.
       - RINGY: "Ringy", "Ringy credits", "Ringy subscription", "RINGY.AI", "Ringy.com".
       - VANILLA (VanillaSoft): "VanillaSoft", "Vanilla Soft", "VS Creds", "VS credits", "cami's vs", "vsoft creds".
     For these rows, output a "platformExpenses[]" entry with platformId set to TD / RINGY / VANILLA — DO NOT also add them to "transactions".

     PLATFORM "vendor" FIELD — REQUIRED. Always copy the original transaction description from the file verbatim (e.g. "TEXTDRIP CREDS", "TEXTDRIP*MONTHLY", "RINGY CREDS REFILL"). The user reviews this in the wizard. Empty vendor strings are NOT acceptable.

     PLATFORM "reason" — pick using these concrete patterns (do NOT default to OTHER for platform rows):
       • CREDIT REFILL — variable / round-dollar top-ups: "creds", "credits", "credit refill", "refill", "topup", "top up", "buy credits". Most ad-hoc TextDrip/Ringy/VanillaSoft charges fall here. ALSO use this when the description is missing/blank but the amount is a typical refill range ($20-$500). When in doubt for a platform row, prefer CREDIT REFILL over OTHER.
       • MONTHLY SUBSCRIPTION — recurring same-amount charges, "monthly", "subscription", "membership", "plan", "*Monthly", or canonical subscription prices (e.g. TextDrip ~$34.99/mo, Ringy ~$99-$149/mo). If you see the same amount on roughly the same day-of-month across multiple rows, it's MONTHLY SUBSCRIPTION.
       • RENEWAL — only when the description literally says "renewal" or "annual renewal".
       • CREDIT REFILL/RENEWAL — combo line items that mention both refill and renewal in one charge.
       • OTHER — reserved for genuinely ambiguous platform charges (rare). Do NOT use OTHER as a lazy fallback for platform rows.

     KNOWN FORMAT — RINGY BILLING HISTORY EXPORT
     Recognize this format by ANY of these signals (the file rarely says "Ringy" by name):
       - Filename matches "BillingHistory_*.csv" or "BillingHistory*.csv"
       - Header row exactly: Item, Amount, Status, Paid On
       - Item column contains values like "Fund account balance", "Fund team accounts for [Name]", "Transfer funds to agent for [Name]", "30-day subscription"
     EVERY row in this format is a Ringy platform charge — output them as platformExpenses[] with platformId=RINGY. Specifically:
       - "Fund account balance" → reason=CREDIT REFILL, vendor="Fund account balance"
       - "Fund team accounts for [Name]" → reason=CREDIT REFILL, vendor="Fund team accounts for [Name]" (keep the name in the vendor)
       - "Transfer funds to agent for [Name]" → reason=CREDIT REFILL, vendor="Transfer funds to agent for [Name]" (these stay Ringy platform credits — NOT AGENT_PAYOUT, since the money never leaves Ringy's wallet)
       - "30-day subscription" → reason=MONTHLY SUBSCRIPTION, vendor="30-day subscription" (the canonical Ringy monthly fee, typically $99 or $119)
       - Any other Ringy billing-history row → reason=CREDIT REFILL by default
     Skip rows where Status is anything other than "Paid" (e.g. "Refunded", "Failed", "Pending"). Date format is "MM-DD-YYYY h:mm am/pm" — normalize to YYYY-MM-DD.

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
- AGENT_PAYOUT: payments to downline / sub-agents — split commissions, agent payouts, override payouts to a producing agent. Look for descriptions like "agent split", "split to [name]", "payout to [agent]", "1099 to agent", "downline payout", Zelle/Venmo/CashApp transfers explicitly to another agent on the team. This is money the user pays OUT of their commissions to another agent. NOT to be confused with OVERRIDE income (which is money IN from the user's downline).
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
// no commentary, no fences. Built per-request so custom category IDs
// (passed by the client) join the enum dynamically.
function buildTransactionSchema(allowedCategoryIds) {
  return {
    type: 'object',
    properties: {
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            vendor: {
              type: 'string',
              description: 'REQUIRED. Original merchant or item description from the file, cleaned up (strip extra whitespace, remove trailing transaction codes/store numbers but keep the merchant name). Never empty — if the row has no merchant, use a short description of the line.',
              minLength: 1,
            },
            amount: { type: 'number', description: 'Absolute value, positive number' },
            direction: { type: 'string', enum: ['expense', 'income'] },
            category: { type: 'string', enum: allowedCategoryIds },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'How sure are you about (direction, category)? "high" = obvious match (e.g. "AT&T" -> PHONE_INTERNET). "medium" = reasonable inference but ambiguous (e.g. "Costco" could be office, meals, or other). "low" = guessing — vendor is unfamiliar OR description is terse. The user reviews low-confidence rows first.',
            },
            notes: { type: 'string', description: 'Any helpful context (account, sheet name, etc.). Optional.' },
          },
          required: ['date', 'vendor', 'amount', 'direction', 'category', 'confidence'],
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
            reason: {
              type: 'string',
              enum: PLATFORM_REASONS,
              description: 'CREDIT REFILL is the default for platform top-ups. MONTHLY SUBSCRIPTION for recurring same-amount charges. RENEWAL only when the description says "renewal". OTHER is a last resort — never use OTHER just because the description is short.',
            },
            vendor: {
              type: 'string',
              description: 'REQUIRED. Original transaction description copied from the file verbatim — e.g. "TEXTDRIP CREDS", "RINGY*MONTHLY", "TXTDRIP CREDIT REFILL". Never empty.',
              minLength: 1,
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'How sure about platformId + reason? high/medium/low.',
            },
            notes: { type: 'string' },
          },
          required: ['date', 'platformId', 'amount', 'reason', 'vendor', 'confidence'],
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
}

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

// Race a promise against a timer — if the PDF extractor hangs on a
// malformed/encrypted file we don't want it eating the whole 300s budget.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    )),
  ]);
}

async function extractPdfText(buffer) {
  // pdfjs-dist legacy build runs in Node without a worker
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const doc = await withTimeout(
    pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise,
    20000,
    'PDF document load'
  );
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await withTimeout(doc.getPage(i), 5000, `PDF page ${i} load`);
    const content = await withTimeout(page.getTextContent(), 5000, `PDF page ${i} text`);
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
  // Top-level safety net: ANY uncaught error becomes a JSON error response,
  // never a Vercel HTML/plain-text page that the client can't parse.
  try {
    return await handlePOST(req);
  } catch (e) {
    console.error('[import-expenses-ai] Uncaught error:', e);
    return Response.json({
      error: `Server error: ${e?.message || String(e)}`,
      fallback: true,
    }, { status: 500 });
  }
}

async function handlePOST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: 'AI importer not configured. Set ANTHROPIC_API_KEY in Vercel env vars.',
      fallback: true,
    }, { status: 503 });
  }

  const startedAt = Date.now();
  let file;
  let vendorHints = []; // [{ vendor, direction, category?, platformId? }]
  let customCategories = []; // [{ id, label, direction: 'expense'|'income' }]
  let userRubric = ''; // free-form agent-supplied rubric overlay
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
    const customRaw = form.get('customCategories');
    if (typeof customRaw === 'string' && customRaw.length > 0) {
      try {
        const parsed = JSON.parse(customRaw);
        if (Array.isArray(parsed)) {
          customCategories = parsed
            .filter(c => c && typeof c.id === 'string' && typeof c.label === 'string')
            .slice(0, 50);
        }
      } catch { /* ignore — customs are optional */ }
    }
    const rubricRaw = form.get('userRubric');
    if (typeof rubricRaw === 'string') {
      userRubric = rubricRaw.slice(0, 1500);
    }
  } catch (e) {
    return Response.json({ error: `Couldn't read upload: ${e.message}` }, { status: 400 });
  }

  // Merge user-defined custom categories into the enum lists + rubric.
  const customExpenseIds = customCategories.filter(c => c.direction === 'expense').map(c => c.id);
  const customIncomeIds  = customCategories.filter(c => c.direction === 'income').map(c => c.id);
  const allowedExpenseCats = [...EXPENSE_CATEGORIES, ...customExpenseIds];
  const allowedIncomeCats  = [...INCOME_CATEGORIES,  ...customIncomeIds];
  const allowedAllCats     = [...allowedExpenseCats, ...allowedIncomeCats];

  // Render a "USER CUSTOM CATEGORIES" hint block so the AI knows what each
  // custom ID is for. Appended to the user message, not cached.
  const renderCustomCats = (cats) => {
    if (!cats?.length) return '';
    const lines = cats.map(c => `  ${c.id} (${c.direction}): "${c.label}"`);
    return `\n\n--- USER CUSTOM CATEGORIES (route into these when a row matches the label semantically) ---\n${lines.join('\n')}`;
  };
  const customCatsText = renderCustomCats(customCategories);

  // Agent's own rubric overlay — appended after standard rubric to bias
  // classifications without invalidating the cached system prompt.
  const userRubricText = userRubric.trim()
    ? `\n\n--- AGENT'S OWN RUBRIC NOTES (apply on top of standard rubric — these reflect this specific agent's preferences) ---\n${userRubric.trim()}\n--- END AGENT NOTES ---`
    : '';

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
        text: `File: ${filename}\nType: ${fileType.toUpperCase()}\n\nExtract every transaction as structured JSON.${hintsText}${customCatsText}${userRubricText}\n\n--- FILE CONTENT ---\n${truncated}`,
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
          text: `File: ${filename}\nType: PDF (text-extractable)\n\nExtract every transaction as structured JSON.${hintsText}${customCatsText}${userRubricText}\n\n--- FILE CONTENT ---\n${pdfText.slice(0, 200000)}`,
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
            text: `File: ${filename}\nType: PDF (image-based — sent for vision processing).\n\nExtract every transaction as structured JSON.${hintsText}${customCatsText}${userRubricText}`,
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
    // Streaming is required by the SDK whenever max_tokens is high enough
    // that the worst-case latency could exceed 10 minutes. We don't need
    // per-event handling — `.finalMessage()` waits for completion and
    // returns the same shape as a non-stream `.create()` response.
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5',
      // 32K so multi-month bank statements don't truncate. Haiku 4.5
      // supports up to 64K output.
      max_tokens: 32000,
      // Cache the (large, stable) rubric so repeat calls on multi-file
      // imports cost ~0.1× on the system prompt.
      system: [
        { type: 'text', text: CATEGORY_RUBRIC, cache_control: { type: 'ephemeral' } },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: buildTransactionSchema(allowedAllCats),
        },
      },
      messages: [{ role: 'user', content: userContent }],
    });
    resp = await stream.finalMessage();
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

  // Detect truncation BEFORE attempting to parse — gives a clearer error
  // than "Unterminated string in JSON at position 40028" which is what
  // users saw before. stop_reason='max_tokens' means the model ran out
  // of output budget mid-response.
  const hitTokenLimit = resp.stop_reason === 'max_tokens';

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    if (hitTokenLimit) {
      return Response.json({
        error:
          `This file has too many transactions for one extraction call ` +
          `(AI ran out of output budget mid-response). Try splitting the ` +
          `statement into 2-3 smaller files (e.g. half the month per file) ` +
          `and importing each separately.`,
        truncated: true,
        partialChars: textBlock.text.length,
        fallback: true,
      }, { status: 500 });
    }
    return Response.json({
      error: `AI returned invalid JSON: ${e.message}`,
      raw: textBlock.text.slice(0, 500),
      fallback: true,
    }, { status: 500 });
  }

  // Log usage for cost tracking
  console.log(`[import-expenses-ai] file=${filename} type=${fileType} txs=${parsed.transactions?.length || 0} platforms=${parsed.platformExpenses?.length || 0} input=${resp.usage.input_tokens} cached_read=${resp.usage.cache_read_input_tokens || 0} output=${resp.usage.output_tokens}`);

  // Format fingerprint — lightweight signal so the client can pre-fill
  // defaults next time the same kind of file shows up. Filename pattern
  // (e.g. "Chase_*.pdf") + fileType + page/row count gives enough signal
  // to recognize "this is a repeat of a previous import shape".
  const filenamePattern = (filename || '').replace(/\d{2,}/g, '#');
  const fingerprint = {
    filenamePattern,
    fileType,
    sizeBytes: buffer.length,
  };

  const durationMs = Date.now() - startedAt;

  return Response.json({
    transactions: parsed.transactions || [],
    platformExpenses: parsed.platformExpenses || [],
    summary: parsed.summary || { totalExpenses: 0, totalIncome: 0, format: 'unknown' },
    extractedHint,
    fingerprint,
    durationMs,
    usage: {
      inputTokens: resp.usage.input_tokens,
      cachedReadTokens: resp.usage.cache_read_input_tokens || 0,
      cachedWriteTokens: resp.usage.cache_creation_input_tokens || 0,
      outputTokens: resp.usage.output_tokens,
    },
  });
}
