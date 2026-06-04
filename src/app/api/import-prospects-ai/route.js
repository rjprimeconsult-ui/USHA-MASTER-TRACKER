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
export const maxDuration = 300;

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

POLICY TYPE (prospect.policyType — pick exactly one of these canonical product codes, or leave empty):
- PA: matches "PA", "Prem Adv", "Premier Advantage", "PremierAdvantage"
- PC: matches "PC", "Prem Choice", "Premier Choice", "PremierChoice"
- SA: matches "SA", "Sec Adv", "Secure Advantage", "SecureAdvantage"
- HA: matches "HA", "HA III", "Health Access", "Health Access III", "HealthAccess"
- WRAP: matches "ACA", "ACA Wrap", "Wrap"
- SUPPY: matches "Suppy" exactly
Leave policyType empty when the file's product field is something generic ("Health", "Life", "Medicare", "Individual Health", "Dental") that does not map to one of the six codes above. Do NOT invent values outside this list.

INDV/FAMILY (prospect.indvOrFamily — pick exactly one of: "Indv", "Family", "Small Bizz", "Employer 5-10"):
- "Indv" — single person, no spouse / dependents listed
- "Family" — has spouse / kids / dependents listed (also infer from family-of-N notes)
- "Small Bizz" — small-business owner buying coverage for themselves (often LLC, S-corp, sole proprietor mentioned in notes); fewer than ~5 employees
- "Employer 5-10" — employer-group coverage for a business with roughly 5-10 employees (notes might say "group plan", "5 employees", "small group")

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

CRM SCREENSHOT RECOGNITION
You will often receive screenshots from agents' dialer CRMs. Recognize these layouts and map them to prospect fields. IGNORE all UI chrome, buttons, call scripts, and post-call DISPOSITION controls — those are NOT the prospect's stage.

VANILLASOFT (single-lead detail card):
- Left card: Name; mailing address (city/STATE/zip); E-Mail; phone(s). "Lead Source" here is the VENDOR (e.g. "Julio Fernandez Leads") → put it in leadVendor. "Added on" date → use for the aged rule below. IGNORE Contact ID, Contact Owner, Agent Name, Contact Team, Lead Tier.
- Middle "Primary Info" table: Age, DOB → dobs; Household Income → income; Medication Taken → meds (health notes); "Best Phone"/"All Phone String" → phone; Campaign → note it in situation; Comment / Agent Remarks → situation.
- Right "Comments" panel: the agent's conversation notes → fold into situation. Health conditions/medications mentioned → meds.
- IGNORE the call-script flowchart and the right-side disposition button rail (.reTRY, DNC, IDNC, No Show, Snooze 7/30/90, DISC/Wrong, Has USHA, Unins, MED, Obama, Spanish, NoLicense, Denies Req, Duplicate).

RINGY ("View Lead" card, often with an SMS HISTORY screenshot):
- Card: Name; phone; email; address (city/STATE/zip); BIRTHDAY → dobs; Quote → quoteSize; Local time → timezone. The notes box text (e.g. "BENEPATH LEAD") → leadVendor + situation.
- TAGS drive the source/vendor: a "Marketplace Aged" tag → source = "Aged Lead". A "Marketplace Paid" / "Marketplace" tag → a fresh paid marketplace lead; if the notes name a vendor (e.g. Benepath) set source to that vendor when it's one of the allowed sources, else "Web Lead"; always record the vendor + paid/aged in leadVendor. "Received on" date → use for the aged rule.
- IGNORE: Sale amount, Commission, Cost for lead, Click-to-call / Disposition buttons, NEW FIELD, and workflow tags like "Active Conversation", "Not called", "No SMS drips", "Text Back(No 1st Response)".
- SMS HISTORY screenshots: summarize the conversation into situation (concise, ≤500 chars). Also extract clearly-stated details: if multiple household members are mentioned set indvOrFamily = "Family" and list their ages/genders in dobs/situation; health needs (e.g. "wants medical insurance", conditions) → meds; any budget/premium figure → quoteSize; if an appointment was clearly agreed (e.g. "Friday at 2pm") set appointmentTime (ISO 8601, infer the date relative to the conversation dates). Do NOT invent data not present.

AGED-LEAD RULE (both CRMs): if the lead's "Added on" / "Received on" date is more than 30 days before today, set source = "Aged Lead" (this overrides). Otherwise use the vendor/tag logic above.

STAGE: for a freshly-imported CRM lead with no clear PRIM stage, default stage to "PENDING_DECISION". The agent will choose the real stage during import review — do not infer stage from CRM dispositions.

SITUATION: capture ONLY meaningful qualifying context — the prospect's coverage needs, timing, budget, objections, and household. Do NOT copy UI labels, field names, button/tag text, disposition names, call-script wording, or boilerplate. If there's no real qualifying context, leave it short or empty.

NEVER reference or add ACA WRAP (it is a supplementary product excluded from PRIM); if a conversation mentions ACA/marketplace/"Obama", treat it only as the prospect's need context, not a product to record.
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
          indvOrFamily: { type: 'string', enum: ['Indv', 'Family', 'Small Bizz', 'Employer 5-10'] },
          dobs: { type: 'string', description: 'DOB or comma-separated DOBs for family' },
          income: { type: 'string' },
          quoteSize: { type: 'string' },
          policyType: { type: 'string', enum: ['', ...POLICY_TYPES] },
          meds: { type: 'string', description: 'Health notes — general impressions only, avoid clinical PHI' },
          situation: { type: 'string', description: 'Qualifying context ONLY — needs, timing, budget, objections, household. No UI labels/buttons/boilerplate. ≤500 chars.' },
          startDate: { type: 'string', description: 'YYYY-MM-DD or empty' },
          source: { type: 'string', enum: ['', ...SOURCES] },
          referrer: { type: 'string', description: 'Name of referrer if source = Referral' },
          leadVendor: { type: 'string', description: 'Who the lead came from + type if shown, e.g. "Benepath · paid", "Julio Fernandez Leads · exclusive", "Marketplace Aged". Empty if unknown.' },
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
        format: { type: 'string', description: '"pipeline spreadsheet", "CRM export", "screenshot", etc.' },
      },
      required: ['totalProspects', 'format'],
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
  // Auth-gate so Anthropic spend is billed only for valid sessions.
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

  let files;
  let userRubric = '';
  try {
    const form = await req.formData();
    files = form.getAll('file').filter(f => f && typeof f !== 'string');
    if (!files.length) {
      return Response.json({ error: 'No file uploaded.' }, { status: 400 });
    }
    const rubricRaw = form.get('userRubric');
    if (typeof rubricRaw === 'string') userRubric = rubricRaw.slice(0, 1500);
  } catch (e) {
    return Response.json({ error: `Couldn't read upload: ${e.message}` }, { status: 400 });
  }

  let fileInfos;
  try {
    fileInfos = await Promise.all(files.map(async f => {
      const buffer = Buffer.from(await f.arrayBuffer());
      const filename = f.name || 'upload';
      return { buffer, filename, type: detectFileType(filename, buffer) };
    }));
  } catch (e) {
    return Response.json({ error: `Couldn't read upload: ${e.message}` }, { status: 400 });
  }

  // Agent's free-form rubric overlay — appended to user message.
  const userRubricText = userRubric.trim()
    ? `\n\n--- AGENT'S OWN RUBRIC NOTES (apply on top of standard rubric) ---\n${userRubric.trim()}\n--- END AGENT NOTES ---`
    : '';

  let userContent;
  let extractedHint = '';
  const model = 'claude-haiku-4-5';
  // Vision + output_config/json_schema causes constrained-sampling HANGS on
  // Vercel (function spins to the timeout with no Anthropic error) — confirmed
  // in /api/extract-screenshot-ai. So for image uploads we DON'T use
  // output_config; we ask for JSON in a fenced block and parse it. Text/
  // spreadsheet/PDF uploads keep using output_config (reliable for text).
  const hasImages = fileInfos.some(fi => fi.type === 'image');

  try {
    if (hasImages) {
      const imageFiles = fileInfos.filter(fi => fi.type === 'image');
      userContent = [
        ...imageFiles.map(fi => ({
          type: 'image',
          source: { type: 'base64', media_type: imageMediaType(fi.filename), data: fi.buffer.toString('base64') },
        })),
        {
          type: 'text',
          text: `${imageFiles.length} screenshot(s) attached. Extract every prospect. IMPORTANT: multiple screenshots may show the SAME person (e.g. a CRM lead card PLUS that person's SMS conversation) — MERGE those into ONE prospect by matching name/phone. Different people = separate prospects. Follow the CRM SCREENSHOT RECOGNITION rules in the system prompt for field mapping.

Return ONLY a JSON object inside a single \`\`\`json code block (no prose, no preamble):
{
  "prospects": [
    {
      "name": string, "phone": string, "email": string,
      "state": "XX (2-letter)", "zip": string, "timezone": string,
      "indvOrFamily": "Indv" | "Family" | "Small Bizz" | "Employer 5-10",
      "dobs": string, "income": string, "quoteSize": string,
      "policyType": "" or one of [${POLICY_TYPES.map(s => `"${s}"`).join(', ')}],
      "meds": "general health notes only", "situation": "qualifying context ONLY (needs/timing/budget/objections/household) — no UI labels/buttons/boilerplate, <=500 chars",
      "startDate": "YYYY-MM-DD or ''",
      "source": "" or one of [${SOURCES.map(s => `"${s}"`).join(', ')}],
      "referrer": string, "leadVendor": string,
      "crm": one of [${CRMS.map(s => `"${s}"`).join(', ')}],
      "stage": one of [${DEFAULT_STAGES.map(s => `"${s}"`).join(', ')}],
      "appointmentTime": "ISO 8601 datetime or YYYY-MM-DD or ''",
      "nextSteps": string, "lastContact": "YYYY-MM-DD or ''"
    }
  ],
  "summary": { "totalProspects": integer, "format": "screenshot" }
}${userRubricText}`,
        },
      ];
      extractedHint = `Sent ${imageFiles.length} screenshot(s) to vision.`;
    } else {
      // Non-image: operate on first file only (xlsx/csv/pdf)
      const { buffer, filename, type: fileType } = fileInfos[0];
      if (fileType === 'xlsx' || fileType === 'csv') {
        const text = extractXlsxText(buffer);
        const truncated = text.length > 200000 ? text.slice(0, 200000) + '\n[...truncated]' : text;
        userContent = [{
          type: 'text',
          text: `File: ${filename}\nType: ${fileType.toUpperCase()}\n\nExtract every prospect as structured JSON.${userRubricText}\n\n--- FILE CONTENT ---\n${truncated}`,
        }];
        extractedHint = `Parsed ${text.split('\n').length} rows from spreadsheet.`;
      } else if (fileType === 'pdf') {
        const pdfText = await extractPdfText(buffer).catch(() => '');
        const cleanText = pdfText.replace(/\s+/g, ' ').trim();
        if (cleanText.length > 200) {
          userContent = [{
            type: 'text',
            text: `File: ${filename}\nType: PDF (text-extractable)\n\nExtract every prospect as structured JSON.${userRubricText}\n\n--- FILE CONTENT ---\n${pdfText.slice(0, 200000)}`,
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
              text: `File: ${filename}\nType: PDF (image-based — sent for vision processing).\n\nExtract every prospect as structured JSON.${userRubricText}`,
            },
          ];
          extractedHint = `Sent ${(buffer.length / 1024).toFixed(0)}KB PDF to vision.`;
        }
      } else {
        return Response.json({ error: `Unsupported file type. Got "${filename}". Supported: .xlsx, .xls, .csv, .pdf, .png, .jpg, .webp.` }, { status: 400 });
      }
    }
  } catch (e) {
    return Response.json({ error: `Couldn't extract file content: ${e.message}` }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  let resp;
  try {
    // Streaming required at 32K max_tokens to avoid the SDK's 10-min cap.
    const streamParams = {
      model,
      // 32K so big prospect pipelines don't truncate
      max_tokens: 32000,
      system: [
        { type: 'text', text: PROSPECT_RUBRIC, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userContent }],
    };
    // Structured outputs (output_config) only for TEXT inputs. For images it
    // hangs (constrained-sampling on Vercel) — the image prompt asks for fenced
    // JSON instead, parsed below.
    if (!hasImages) {
      streamParams.output_config = { format: { type: 'json_schema', schema: PROSPECT_SCHEMA } };
    }
    const stream = client.messages.stream(streamParams);
    resp = await stream.finalMessage();
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
    // Strip a ```json … ``` fence if present (the image path returns fenced
    // JSON; the output_config path returns raw JSON — both handled here).
    let jsonText = textBlock.text.trim();
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) jsonText = fence[1].trim();
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return Response.json({
      error: `AI returned invalid JSON: ${e.message}`,
      raw: textBlock.text.slice(0, 500),
      fallback: true,
    }, { status: 500 });
  }

  const logFilename = fileInfos.map(fi => fi.filename).join(', ');
  const logType = fileInfos.map(fi => fi.type).join(', ');
  console.log(`[import-prospects-ai] file=${logFilename} type=${logType} model=${model} prospects=${parsed.prospects?.length || 0} input=${resp.usage.input_tokens} cached_read=${resp.usage.cache_read_input_tokens || 0} output=${resp.usage.output_tokens}`);

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
