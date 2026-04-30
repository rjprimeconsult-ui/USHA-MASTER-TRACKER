/**
 * Universal AI statement parser.
 *
 * Replaces the bespoke regex-based parsers in src/lib/statement.js with
 * an LLM that handles weekly advance statements, monthly account summaries,
 * and any layout variations USHA introduces over time.
 *
 * Returns the same shape as parseStatementPdf() so the existing
 * reconcileStatement() / applyStatement() flow consumes it unchanged.
 *
 * Required env: ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const STATEMENT_RUBRIC = `
You are extracting structured data from a USHEALTH ADVISORS agent statement PDF. There are two formats:

FORMAT A: Weekly Advance Statement
- Header has agent name (ALL CAPS), Title (FSL/WA), Agent ID, Period (m/d/yyyy - m/d/yyyy)
- Statement Summary block: "Advances", "Total Advance", "Miscellaneous", "Total Payout"
- ADVANCE DETAIL section: rows with Customer Name, Policy ID, Writing Agent, Product Description, App Date, Eff Date, Net Advance, Reserve Withheld
- CHARGEBACK DETAIL section: rows with negative reserve withheld (money pulled back)
- REINSTATEMENT DETAIL section: similar shape
- Miscellaneous section at the bottom: bonus rows with Type / Adjustment Type / Description / Payment Information / Transaction Date / Adjustment Amount

FORMAT B: Account Summary (Monthly Payout)
- Period: m/d/yyyy - m/d/yyyy
- "Factors Affecting Payouts" block with Primary / Secondary / Association Bonus / Total amounts
- Used for monthly residual + association bonus payouts (released on the 5th of next month)

WHAT TO EXTRACT (same for both formats):

1. header object:
   - owner: agent name in ALL CAPS as printed (e.g. "JULIO FERNANDEZ")
   - tier: 2-3 letter title (FSL, WA, RSL, MGA, etc.) — empty string if not visible
   - agentId: digits only, no leading zero stripping (preserve as printed, e.g. "00020008")
   - periodStart: m/d/yyyy
   - periodEnd: m/d/yyyy
   - advances: number — the "Advances" line in Statement Summary (positive)
   - totalPayout: number — the "Total Payout" line (positive)

2. advanceRows[] — every row in the ADVANCE DETAIL section. Each row:
   - customer: string (customer name as printed)
   - policyId: alphanumeric (e.g. "52Y2502220" — uppercase letters)
   - writingAgent: ALL CAPS agent name
   - productDesc: product name as printed (e.g. "PREMIER ADVANTAGE", "MEDGUARD III", "SECURE DENTAL PLUS")
   - netAdvance: positive number (the "Advance" or "Net Advance" column)
   - reserveWithheld: number (positive = amount held back; usually 0 on advance rows)
   - appDate: m/d/yyyy or empty
   - effDate: m/d/yyyy or empty

3. chargebackRows[] — every row in the CHARGEBACK DETAIL section. Same shape as advanceRows. The "reserveWithheld" field is the actual chargeback amount (the column shows it as negative in the PDF, but report it as POSITIVE here — caller takes Math.abs anyway).

4. reinstatementRows[] — every row in REINSTATEMENT DETAIL. Same shape.

5. bonusRows[] — every Miscellaneous-section row OR every Account Summary payout. Each row:
   - type: one of FTA_BONUS / PAR_BONUS / PRODUCTION_BONUS / RENEWAL_BONUS / FIRST_YEAR_BONUS / QUALITY_BONUS / ASSOCIATION_BONUS / RECRUITER_BONUS / BONUS
     - "PAR FTA" / "FTA PAR" / "FTA" -> FTA_BONUS
     - "PAR Personal" / "PP PAR" / "PAR" -> PAR_BONUS
     - "Renewal" / "Residual" / "Persistency" -> RENEWAL_BONUS
     - Production milestone bonuses ("65K Milestone", "Production Bonus") -> PRODUCTION_BONUS
     - Quality / retention / lifestyle bonuses -> QUALITY_BONUS
     - Association payouts -> ASSOCIATION_BONUS
     - First-year / new-business -> FIRST_YEAR_BONUS
     - Recruiter -> RECRUITER_BONUS
     - Anything else -> BONUS
   - label: human-readable description (e.g. "Production Bonus — 65K Milestone Bonus")
   - amount: positive number (strip $ and commas)
   - transactionDate: m/d/yyyy

CRITICAL RULES:

1. SKIP false-positive bonus rows. The Account Summary section sometimes contains
   "Beginning Balance", "Ending Balance", "E&O Charge", "Week Ending", "Reserve
   Adjustment", "Reserve Short", "Chargeback Reserve" — these are NOT bonuses,
   they are reserve-statement bookkeeping. Never include them in bonusRows.
   Skip any row whose description contains those phrases.
2. SKIP totals/header bleeds: rows whose middle text is a total ("Bonus Total",
   "YTD", "MTD", "Year-to-Date").
3. A real bonus description should be SHORT and SPECIFIC (e.g. "FTA PAR 2023
   Bonus (#24)"). If the captured description has 2+ separate \$amounts inside
   it, or contains parenthesized negatives like "(\$5,348.50)", or runs longer
   than ~100 chars, the regex bridged two unrelated rows — skip it.
4. Policy IDs: uppercase letters only. If you see "52v2502220" (lowercase v
   from OCR), normalize to "52V2502220".
5. For the Account Summary format (Format B), output ONE bonusRow with type
   "RENEWAL_BONUS", label "Monthly Payout — <Primary>+<Secondary>+<Association>
   breakdown", amount = Total, transactionDate = 5th of the month following
   periodEnd (e.g. period ends 1/31/2026 -> transactionDate "2/5/2026").
   advanceRows / chargebackRows / reinstatementRows are empty for Format B.
6. If you can't find a section (no chargebacks this week, no bonuses, etc.),
   return an empty array. Don't invent data.
7. Numbers: strip $ and commas. Negative parens in PDF (\$X) -> positive number.
   Reserve withheld is reported as positive (caller handles sign).
`.trim();

const STATEMENT_SCHEMA = {
  type: 'object',
  properties: {
    header: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        tier: { type: 'string' },
        agentId: { type: 'string' },
        periodStart: { type: 'string' },
        periodEnd: { type: 'string' },
        advances: { type: 'number' },
        totalPayout: { type: 'number' },
      },
      required: ['owner', 'periodStart', 'periodEnd', 'advances', 'totalPayout'],
      additionalProperties: false,
    },
    advanceRows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          customer: { type: 'string' },
          policyId: { type: 'string' },
          writingAgent: { type: 'string' },
          productDesc: { type: 'string' },
          netAdvance: { type: 'number' },
          reserveWithheld: { type: 'number' },
          appDate: { type: 'string' },
          effDate: { type: 'string' },
        },
        required: ['customer', 'policyId', 'writingAgent', 'netAdvance'],
        additionalProperties: false,
      },
    },
    chargebackRows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          customer: { type: 'string' },
          policyId: { type: 'string' },
          writingAgent: { type: 'string' },
          productDesc: { type: 'string' },
          netAdvance: { type: 'number' },
          reserveWithheld: { type: 'number' },
          appDate: { type: 'string' },
          effDate: { type: 'string' },
        },
        required: ['customer', 'policyId', 'writingAgent', 'reserveWithheld'],
        additionalProperties: false,
      },
    },
    reinstatementRows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          customer: { type: 'string' },
          policyId: { type: 'string' },
          writingAgent: { type: 'string' },
          productDesc: { type: 'string' },
          netAdvance: { type: 'number' },
          reserveWithheld: { type: 'number' },
          appDate: { type: 'string' },
          effDate: { type: 'string' },
        },
        required: ['customer', 'policyId'],
        additionalProperties: false,
      },
    },
    bonusRows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['FTA_BONUS', 'PAR_BONUS', 'PRODUCTION_BONUS', 'RENEWAL_BONUS', 'FIRST_YEAR_BONUS', 'QUALITY_BONUS', 'ASSOCIATION_BONUS', 'RECRUITER_BONUS', 'BONUS'] },
          label: { type: 'string' },
          amount: { type: 'number' },
          transactionDate: { type: 'string' },
          breakdown: { type: 'string', description: 'Optional: dollar breakdown like \'$X primary + $Y secondary\' for monthly payouts' },
        },
        required: ['type', 'label', 'amount', 'transactionDate'],
        additionalProperties: false,
      },
    },
    format: {
      type: 'string',
      enum: ['weekly_advance', 'account_summary', 'unknown'],
      description: 'Which kind of statement this is.',
    },
  },
  required: ['header', 'advanceRows', 'chargebackRows', 'reinstatementRows', 'bonusRows', 'format'],
  additionalProperties: false,
};

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

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: 'AI parser not configured. Set ANTHROPIC_API_KEY in Vercel env vars.',
      fallback: true,
    }, { status: 503 });
  }

  let file;
  try {
    const form = await req.formData();
    file = form.get('file');
    if (!file || typeof file === 'string') {
      return Response.json({ error: 'No PDF uploaded.' }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: `Couldn't read upload: ${e.message}` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name || 'statement.pdf';
  if (!filename.toLowerCase().endsWith('.pdf')) {
    return Response.json({ error: `Only PDF statements supported. Got "${filename}".` }, { status: 400 });
  }

  // Try text extraction first; fall back to vision for image PDFs
  let userContent;
  let extractedHint = '';
  try {
    const pdfText = await extractPdfText(buffer).catch(() => '');
    const cleanText = pdfText.replace(/\s+/g, ' ').trim();
    if (cleanText.length > 200) {
      userContent = [{
        type: 'text',
        text: `File: ${filename}\n\nParse this USHA statement PDF into structured JSON.\n\n--- FILE CONTENT ---\n${pdfText.slice(0, 200000)}`,
      }];
      extractedHint = `Extracted ${cleanText.length} chars of text from PDF.`;
    } else {
      // Image-based / scanned PDF
      const base64 = buffer.toString('base64');
      userContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        {
          type: 'text',
          text: `File: ${filename}\nType: image-based PDF — sent for vision processing.\n\nParse this USHA statement into structured JSON.`,
        },
      ];
      extractedHint = `Sent ${(buffer.length / 1024).toFixed(0)}KB PDF to vision.`;
    }
  } catch (e) {
    return Response.json({ error: `Couldn't extract PDF content: ${e.message}` }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  let resp;
  try {
    // Streaming required at 32K max_tokens to avoid the SDK's 10-min cap.
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5',
      // 32K so multi-page payout/advance statements don't truncate
      max_tokens: 32000,
      system: [
        { type: 'text', text: STATEMENT_RUBRIC, cache_control: { type: 'ephemeral' } },
      ],
      output_config: {
        format: { type: 'json_schema', schema: STATEMENT_SCHEMA },
      },
      messages: [{ role: 'user', content: userContent }],
    });
    resp = await stream.finalMessage();
  } catch (e) {
    console.error('[parse-statement-ai] Anthropic call failed:', e);
    const status = e?.status || 500;
    const message = e?.message || String(e);
    return Response.json({ error: `AI extraction failed: ${message}`, fallback: true }, { status });
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

  // Stamp every detail row with the statement period (so downstream
  // applyStatement can date-key chargebacks / overrides correctly). The
  // existing parseStatementPdf does this implicitly via _statementPeriod
  // on each row — replicate it here.
  const periodEnd = parsed.header?.periodEnd || '';
  const stampPeriod = (rows) => Array.isArray(rows)
    ? rows.map(r => ({ ...r, _statementPeriod: periodEnd }))
    : [];

  const result = {
    header: parsed.header,
    advanceRows: stampPeriod(parsed.advanceRows),
    rows: stampPeriod(parsed.advanceRows),  // backwards-compat alias
    chargebackRows: stampPeriod(parsed.chargebackRows),
    reinstatementRows: stampPeriod(parsed.reinstatementRows),
    bonusRows: parsed.bonusRows || [],
    isDetailOnly: false,
    format: parsed.format,
    _aiParsed: true,
    _extractedHint: extractedHint,
    _usage: {
      inputTokens: resp.usage.input_tokens,
      cachedReadTokens: resp.usage.cache_read_input_tokens || 0,
      outputTokens: resp.usage.output_tokens,
    },
  };

  console.log(`[parse-statement-ai] file=${filename} format=${parsed.format} adv=${result.advanceRows.length} cb=${result.chargebackRows.length} bonus=${result.bonusRows.length} input=${resp.usage.input_tokens} cached=${resp.usage.cache_read_input_tokens || 0} output=${resp.usage.output_tokens}`);

  return Response.json(result);
}
