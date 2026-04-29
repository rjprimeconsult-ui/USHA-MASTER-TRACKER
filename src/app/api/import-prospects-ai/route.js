/**
 * Universal AI prospect importer.
 *
 * Same architecture as /api/import-leads-ai but the schema captures
 * pre-deal pipeline fields (stage, lead source, appointment time,
 * follow-up dates, CRM, situation/notes) instead of issued-policy fields.
 *
 * Required env: ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import {
  DEFAULT_PROSPECT_STAGES as STAGE_DEFS,
  PROSPECT_SOURCES,
  PROSPECT_CRMS,
  PROSPECT_POLICY_TYPES,
} from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Single source of truth — derive ID arrays from src/lib/constants.js so a
// new prospect stage anywhere in the app updates the AI rubric automatically.
const DEFAULT_STAGES = STAGE_DEFS.map(s => s.id);
const SOURCES = [...PROSPECT_SOURCES];
const CRMS = [...PROSPECT_CRMS];
const POLICY_TYPES = [...PROSPECT_POLICY_TYPES];

const PROSPECT_RUBRIC = `
You are extracting prospect (pre-deal pipeline) records from a USHA agent's documents. Each prospect is someone an agent is working with BEFORE the deal closes — appointment scheduled, quoted, follow-up needed, etc. Once a prospect closes, they become a Lead — but until then they live in the Prospects tab.

STAGES (prospect.stage — pick exactly one of these canonical IDs):
- WEBBY_SET: web appointment scheduled but not yet confirmed
- WEBBY_CONFIRMED: web appointment confirmed
- APPOINTMENT_SET: live appointment scheduled (phone or in-person)
- MISSED_APPT: prospect missed their scheduled appointment
- PENDING_DECISION: presented + waiting on prospect's decision
- FOLLOWUP_LATER: shopping later / outside the buying window — needs follow-up in days/weeks
- GHOSTED: stopped responding, no clear next action
- SOLD: deal closed — usually means we should convert to a Lead
- LOST: explicitly declined / not interested

When mapping FROM other pipeline column names:
- "New", "Fresh", "Just Added" -> use PENDING_DECISION (we don't have a "New" bucket)
- "Webby" / "Online appt" / "Zoom Booked" / "Web Schld" -> WEBBY_SET
- "Confirmed Webby" / "Webby Confirmed" -> WEBBY_CONFIRMED
- "Appt Set" / "Appointment Set" / "Phone Appointment" -> APPOINTMENT_SET
- "Missed", "No Show", "NS" -> MISSED_APPT
- "Pres Complete" / "Presentation Done" / "Quoted" / "Pending" / "Awaiting Decision" -> PENDING_DECISION
- "Follow-Up" / "FU" / "F/U DTR" / "Later Date" / "Shopping" / "Wasn't the Right" -> FOLLOWUP_LATER
- "Ghosted" / "No Response" / "Unreachable" -> GHOSTED
- "Sold" / "Closed" / "Won" / "Paid" -> SOLD
- "Lost" / "Dead" / "Not Interested" / "Declined" -> LOST

LEAD SOURCES (prospect.source — pick exactly one or empty string):
- Referral: matches "Referral", "Referred", "Word of mouth", named-person referrals
- Google Ads: matches "Google", "Google Ads", "Google Lead"
- Facebook Ads: matches "Facebook", "Meta", "FB", "Facebook Ad"
- Web Lead: matches "Web", "Website", "USHA web lead", "Online lead"
- Aged Lead: matches "Aged", "Aged Lead", "TD Aged", "Ringy Aged"
- Major League: matches "Major League", "ML", "MP" + variants
- Bizz Lead: matches "Bizz Lead", "Business Lead", "BL"
- Cold Call: matches "Cold", "Cold Call", "Dialer"
- Other: anything that doesn't match above (Imarye, VSoft, EXCLUSIVE HIGH, MP Prem Shared, etc. — these are agent-specific lead vendors so map to Other and put the vendor name in notes)

CRM (prospect.crm — pick exactly one):
- TextDrip / Ringy / VanillaSoft / None

POLICY TYPE (prospect.policyType — pick one or empty):
- Individual Health / Family Health / Short-Term / Medicare / Dental/Vision / Life / Other
- "Indv" / "Individual" -> Individual Health
- "Fam" / "Family" -> Family Health (also infer from family-of-N notes, dependents listed)

INDV/FAMILY (prospect.indvOrFamily — pick exactly one):
- "Indv" or "Family" — infer from prospect's profile (single person -> Indv, has spouse/kids/dependents listed -> Family)

CRITICAL RULES:
1. Skip section header rows. Spreadsheets often group prospects under headers like "APPOINTMENT SET", "WEBBY CONFIRMED", "GHOSTED/PENDING DECISIONS", "REFERRALS", "GOOGLE ADS LEADS", "MAJOR LEAGUE ONLY". These are CATEGORY HEADERS, not prospects — skip them.
2. Skip rows with no name (or where name is "Later Date", "Sold", "Confirmed", or other status-text-as-name-cell artifacts).
3. Every prospect must have at minimum a NAME. Phone or email is strongly preferred but not required.
4. Normalize phone to (XXX) XXX-XXXX.
5. Normalize dates to YYYY-MM-DD. 2-digit years: 51-99 -> 19XX, 00-50 -> 20XX.
6. State should be a 2-letter US code if possible.
7. The "Situation" / "Notes" column often contains freeform context — preserve it in the situation field. Trim to ~500 chars max.
8. NEVER put medical/clinical info in the meds field unless the source already has it — the app discourages PHI. If the source has medication names, you CAN copy them since the source is the user's own data, but lean toward general impressions ("has health concerns") over clinical specifics.
9. If a row has BOTH a "Date" column (when prospect was added) AND a "Last Contact / F/U" column, use Date for createdAt context and put the F/U date in lastContact (YYYY-MM-DD).
10. Appointment time: prefer the "Appointment Time" column. Format: ISO 8601 datetime if possible, otherwise YYYY-MM-DD.
11. Quote Size: a dollar amount, often the monthly premium. Keep currency formatting in the source string but extract the number into quoteSize.

Return an empty prospects array if the document has no extractable prospect-level data.
`.trim();

const PROSPECT_SCHEMA = {
  type: 'object',
  properties: {
    prospects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          state: { type: 'string' },
          zip: { type: 'string' },
          timezone: { type: 'string' },
          indvOrFamily: { type: 'string', enum: ['Indv', 'Family'] },
          dobs: { type: 'string', description: 'DOB or comma-separated DOBs for family' },
          income: { type: 'string' },
          quoteSize: { type: 'string' },
          policyType: { type: 'string', enum: ['', ...POLICY_TYPES] },
          meds: { type: 'string', description: 'Health notes — general impressions only, avoid clinical PHI' },
          situation: { type: 'string', description: 'Free-form context, ≤500 chars' },
          startDate: { type: 'string', description: 'YYYY-MM-DD or empty' },
          source: { type: 'string', enum: ['', ...SOURCES] },
          referrer: { type: 'string', description: 'Name of referrer if source = Referral' },
          crm: { type: 'string', enum: CRMS },
          stage: { type: 'string', enum: DEFAULT_STAGES },
          appointmentTime: { type: 'string', description: 'ISO 8601 datetime or YYYY-MM-DD or empty' },
          nextSteps: { type: 'string' },
          lastContact: { type: 'string', description: 'YYYY-MM-DD or empty' },
        },
        required: ['name', 'stage'],
        additionalProperties: false,
      },
    },
    summary: {
      type: 'object',
      properties: {
        totalProspects: { type: 'integer' },
        byStage: { type: 'object', additionalProperties: { type: 'integer' } },
        format: { type: 'string', description: '"pipeline spreadsheet", "CRM export", "screenshot", etc.' },
      },
      required: ['totalProspects', 'byStage', 'format'],
      additionalProperties: false,
    },
  },
  required: ['prospects', 'summary'],
  additionalProperties: false,
};

// ---- File extraction (mirror leads route) ----

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: 'AI importer not configured. Set ANTHROPIC_API_KEY in Vercel env vars.',
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
    return Response.json({ error: `Couldn't read upload: ${e.message}` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name || 'upload';
  const fileType = detectFileType(filename, buffer);

  let userContent;
  let extractedHint = '';

  try {
    if (fileType === 'xlsx' || fileType === 'csv') {
      const text = extractXlsxText(buffer);
      const truncated = text.length > 200000 ? text.slice(0, 200000) + '\n[...truncated]' : text;
      userContent = [{
        type: 'text',
        text: `File: ${filename}\nType: ${fileType.toUpperCase()}\n\nExtract every prospect as structured JSON.\n\n--- FILE CONTENT ---\n${truncated}`,
      }];
      extractedHint = `Parsed ${text.split('\n').length} rows from spreadsheet.`;
    } else if (fileType === 'pdf') {
      const pdfText = await extractPdfText(buffer).catch(() => '');
      const cleanText = pdfText.replace(/\s+/g, ' ').trim();
      if (cleanText.length > 200) {
        userContent = [{
          type: 'text',
          text: `File: ${filename}\nType: PDF (text-extractable)\n\nExtract every prospect as structured JSON.\n\n--- FILE CONTENT ---\n${pdfText.slice(0, 200000)}`,
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
            text: `File: ${filename}\nType: PDF (image-based — sent for vision processing).\n\nExtract every prospect as structured JSON.`,
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
          text: `File: ${filename}\nType: Image (sent for vision processing).\n\nExtract every prospect visible in this image as structured JSON.`,
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
    resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16000,
      system: [
        { type: 'text', text: PROSPECT_RUBRIC, cache_control: { type: 'ephemeral' } },
      ],
      output_config: {
        format: { type: 'json_schema', schema: PROSPECT_SCHEMA },
      },
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (e) {
    console.error('[import-prospects-ai] Anthropic call failed:', e);
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

  console.log(`[import-prospects-ai] file=${filename} type=${fileType} prospects=${parsed.prospects?.length || 0} input=${resp.usage.input_tokens} cached_read=${resp.usage.cache_read_input_tokens || 0} output=${resp.usage.output_tokens}`);

  return Response.json({
    prospects: parsed.prospects || [],
    summary: parsed.summary || { totalProspects: 0, byStage: {}, format: 'unknown' },
    extractedHint,
    usage: {
      inputTokens: resp.usage.input_tokens,
      cachedReadTokens: resp.usage.cache_read_input_tokens || 0,
      cachedWriteTokens: resp.usage.cache_creation_input_tokens || 0,
      outputTokens: resp.usage.output_tokens,
    },
  });
}
