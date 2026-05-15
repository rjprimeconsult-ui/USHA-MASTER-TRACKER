/**
 * USHA portal screenshot OCR + structured extraction.
 *
 * Pipeline:
 *   1. Run Tesseract.js on the image -> raw text blob
 *   2. Pattern-match the text against known USHA portal layouts
 *   3. Map fuzzy product names to canonical Main / Add-on IDs the rest
 *      of the app already understands.
 */

// ---------- Pattern catalog ----------
//
// These regexes target the visible USHA portal "deal detail" card. They
// tolerate OCR noise (extra spaces, dropped punctuation, lowercase letters
// where uppercase belongs, common O<->0 / l<->1 confusions) by being
// deliberately loose.
const PATTERNS = {
  status: /\b(Issued|Pending|Submitted|Active|Declined|Withdrawn|Lapsed|Cancelled)\b/i,

  // Customer name — first multi-word ALL-CAPS line. Accept letters with
  // O/0 noise; we'll title-case after.
  name: /\b([A-Z][A-Z'.\- ]{1,40}\s[A-Z][A-Z'.\- ]{1,40})\b/,

  // Master policy ID — letter-prefixed alphanumeric. Case-insensitive
  // because OCR often reads "Y" as "v" or "y", and "I" as "1" or "l".
  policyId: /\b(\d{1,3}[A-Za-z]\d{4,}[A-Za-z0-9]?)\b/,

  monthlyPremium: /Monthly\s*Premium:?\s*\$?\s*([\d,]+\.\d{2})/i,
  applicationDate: /Application:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  paidToDate: /Paid\s*to\s*Date:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  effectiveDate: /Effective\s*Date:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,

  gender: /\b(Male|Female)\b/i,

  // DOB: "08/29/1996 (29)" — date plus age in parens. Loose date pattern.
  dob: /\b(\d{1,2}[\/\-]\d{1,2}[\/\-](?:19|20)\d{2})\s*\(\s*\d{1,3}\s*\)/,

  // Phone — much more lenient. Capture any 10-digit run, accepting common
  // OCR errors (O <-> 0). We don't require parens or specific separators.
  // We then re-format consistently.
  phone: /(\(?\s*[\dOQqo]{3}\s*\)?[\s\-.]*[\dOQqo]{3}[\s\-.]*[\dOQqo]{4})/,

  // Email — accept common OCR substitutions. We anchor on the @ sign.
  email: /([A-Z0-9._%+\-]+\s*@\s*[A-Z0-9.\-]+\.[A-Z]{2,})/i,

  zip: /\b(\d{5})(?:-\d{4})?\b/,
  state: /,?\s*\b([A-Z]{2})\s+\d{5}\b/,
};

// ---------- Product catalog ----------
//
// Maps the prose product names that show up in USHA portal screenshots to
// the canonical IDs in src/lib/constants.js. Each entry has:
//   - canonical: the ID stored on the lead
//   - patterns: regex variants we expect to see in OCR output
//   - bucket: 'main' | 'addon'
//
// Bucket determines whether the match becomes lead.mainProduct or goes
// into lead.products (add-ons). When multiple main products match (rare),
// the FIRST in this list wins.
const PRODUCT_CATALOG = [
  // ----- MAIN PRODUCTS -----
  // ORDER MATTERS — the more-specific variants must come first so the
  // generic "Secure Advantage" doesn't swallow "Secure Advantage Conversion"
  { canonical: 'SECUREADVANTAGE CONVERSION', bucket: 'main',
    patterns: [/\bSecure\s*Advantage\s*Conversion\b/i, /\bSecureAdvantage\s*Conversion\b/i, /\bSA\s*Conversion\b/i] },
  { canonical: 'PREMIER ADVANTAGE', bucket: 'main',
    patterns: [/\bPremier\s*Advantage\s*Fixed\s*Indemnity\b/i, /\bPremierAdvantage\b/i, /\bPremier\s*Advantage\b/i] },
  { canonical: 'PREMIER CHOICE', bucket: 'main',
    patterns: [/\bPremier\s*Choice\b/i, /\bPremierChoice\b/i] },
  { canonical: 'SECURE ADVANTAGE', bucket: 'main',
    patterns: [/\bSecure\s*Advantage\b/i, /\bSecureAdvantage\b/i] },
  { canonical: 'HEALTH ACCESS III', bucket: 'main',
    patterns: [/\bHealth\s*Access\s*III\b/i, /\bHealth\s*Access\s*3\b/i, /\bHA\s*III\b/i, /\bHealthAccess\b/i] },
  { canonical: 'SUPPY', bucket: 'main',
    patterns: [/\bSuppy\b/i] },
  { canonical: 'ACA WRAP', bucket: 'main',
    patterns: [/\bACA\s*Wrap\b/i] },

  // ----- ADD-ON PRODUCTS -----
  { canonical: 'MEDGUARD III', bucket: 'addon',
    patterns: [/\bMed\s*Guard\s*III\b/i, /\bMedGuard\s*III\b/i, /\bMed\s*Guard\b/i, /\bMedGuard\b/i] },
  { canonical: 'PREMIERVISION', bucket: 'addon',
    patterns: [/\bPremier\s*Vision\b/i, /\bPremierVision\b/i] },
  { canonical: 'DENTAL / SECUREDENTAL', bucket: 'addon',
    patterns: [/\bSecure\s*Dental\s*Plus\b/i, /\bSecureDental\b/i, /\bSecure\s*Dental\b/i, /\bDental\s*Plus\b/i, /\bDental\b/i] },
  { canonical: 'ACCIDENT PROTECTOR', bucket: 'addon',
    patterns: [/\bAccident\s*Protector\b/i, /\bAccidentProtector\b/i] },
  { canonical: 'INCOME PROTECTOR', bucket: 'addon',
    patterns: [/\bIncome\s*Protector\b/i, /\bIncomeProtector\b/i] },
  { canonical: 'LIFE PROTECTOR II', bucket: 'addon',
    patterns: [/\bLife\s*Protector\s*II\b/i, /\bLifeProtector\s*II\b/i, /\bLife\s*Protector\b/i, /\bLifeProtector\b/i] },
];

// Find every product mentioned. Each canonical product matches at most
// once even if multiple of its pattern variants appear in the text.
function findProducts(text) {
  const matches = []; // { canonical, bucket, index }
  const seen = new Set();
  for (const entry of PRODUCT_CATALOG) {
    if (seen.has(entry.canonical)) continue;
    for (const re of entry.patterns) {
      const m = text.match(re);
      if (m) {
        matches.push({ canonical: entry.canonical, bucket: entry.bucket, index: m.index });
        seen.add(entry.canonical);
        break;
      }
    }
  }
  matches.sort((a, b) => a.index - b.index);
  return matches;
}

// ---------- Field utilities ----------

// Title Case from ALL CAPS, preserving apostrophes/hyphens
function titleCase(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function toIsoDate(s) {
  if (!s) return '';
  const m = String(s).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return '';
  let yy = m[3];
  if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
  return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

// Normalize phone string: keep digits only, accept O/Q/q/o as 0
function normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw)
    .replace(/[OoQq]/g, '0')   // common OCR confusions for 0
    .replace(/\D/g, '');
  if (digits.length < 10) return '';
  // Take last 10 digits in case there's a country code prefix
  const d = digits.slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Clean up an email — remove spaces, lowercase
function normalizeEmail(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s+/g, '').toLowerCase();
}

// Aggressive email finder. OCR often mangles the @ sign — we've seen it
// read as `(`, `[`, `Q`, `&`, `e`, or dropped entirely. We try four
// strategies in order: clean match, single-char-replacement, domain-anchored
// reconstruction, and finally bare username + domain run-together.
const EMAIL_TLDS = ['com', 'net', 'org', 'edu', 'gov', 'io', 'co', 'us', 'info', 'biz', 'me', 'app'];
const TLD_GROUP = `(?:${EMAIL_TLDS.join('|')})`;

function extractEmail(text) {
  if (!text) return '';
  const t = text.replace(/[‘’]/g, "'");

  // 1) Standard match
  let m = t.match(new RegExp(`([A-Z0-9._%+\\-]{2,})\\s*@\\s*([A-Z0-9.\\-]+\\.${TLD_GROUP})\\b`, 'i'));
  if (m) return normalizeEmail(`${m[1]}@${m[2]}`);

  // 2) @ misread as a single common substitute character
  m = t.match(new RegExp(`([A-Z0-9._%+\\-]{2,})\\s*[\\(\\[\\{&Qq]\\s*([A-Z0-9.\\-]+\\.${TLD_GROUP})\\b`, 'i'));
  if (m) return normalizeEmail(`${m[1]}@${m[2]}`);

  // 3) Domain-anchored: find a known TLD ending, walk backward to grab the
  // local part. Helps when @ vanished entirely or got replaced by spaces.
  const domRe = new RegExp(`\\b([A-Z][A-Z0-9\\-]+\\.${TLD_GROUP})\\b`, 'i');
  const dm = t.match(domRe);
  if (dm) {
    const before = t.slice(0, dm.index);
    // Last word-ish run preceding the domain — at least 3 chars of allowed
    // username characters, possibly with stray punctuation between it and
    // the domain.
    const userMatch = before.match(/([A-Z0-9][A-Z0-9._%+\-]{2,})[\s@(\[\{&Qq]*$/i);
    if (userMatch) return normalizeEmail(`${userMatch[1]}@${dm[1]}`);
  }

  // 4) @ present but dot before TLD missing — "user@GMAILCOM".
  // Real-world OCR loss: USHA portal small text often loses the period.
  const KNOWN_DOMAINS = ['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'aol', 'comcast', 'live', 'msn'];
  for (const dom of KNOWN_DOMAINS) {
    const re = new RegExp(`([A-Z0-9._%+\\-]{2,})\\s*[@&Qq(\\[\\{]\\s*${dom}\\s*(com|net|org)\\b`, 'i');
    const rm = t.match(re);
    if (rm) return normalizeEmail(`${rm[1]}@${dom}.${rm[2]}`);
  }

  // 5) Run-together: "celesteeliz96gmail.com" — @ missing, dot present
  for (const dom of KNOWN_DOMAINS) {
    const re = new RegExp(`([A-Z0-9._%+\\-]{2,})${dom}\\.${TLD_GROUP}\\b`, 'i');
    const rm = t.match(re);
    if (rm) return normalizeEmail(`${rm[1]}@${dom}.com`);
  }

  // 6) Run-together: "celesteeliz96gmailcom" — @ AND dot missing
  for (const dom of KNOWN_DOMAINS) {
    const re = new RegExp(`([A-Z0-9._%+\\-]{2,})${dom}(com|net|org)\\b`, 'i');
    const rm = t.match(re);
    if (rm) return normalizeEmail(`${rm[1]}@${dom}.${rm[2]}`);
  }

  return '';
}

// Reject obvious false-positive policy IDs (e.g. ZIP+suffix, dates)
function isPlausiblePolicyId(s) {
  if (!s) return false;
  const t = String(s);
  if (t.length < 6) return false;
  if (/^\d+$/.test(t)) return false;       // pure digits = not a policy ID
  if (/^\d{1,2}\/\d/.test(t)) return false; // looks like a date
  return true;
}

/**
 * Parse the raw OCR text into a structured deal record.
 * Every field is optional — caller can review + edit before saving.
 */
// Extract structured dependents from a USHA portal screenshot's
// "Dependents" panel. Returns an array of { name, relationship, dob }.
// Skips the primary applicant if their name accidentally falls inside
// the section (defensive — some layouts show the primary at the top).
function extractDependents(rawText, primaryName) {
  if (!rawText) return [];
  const flat = String(rawText).replace(/\s+/g, ' ');
  // Find the "Dependents" section header and capture the chunk that follows
  // up to the next major section ("APS Notes", "Call Notes", "Policies",
  // "Print Detail", "Reset", or end of text).
  const sectionRe = /Dependents\s+([\s\S]*?)(?=APS\s*Notes|Call\s*Notes|Policies|Print\s*Detail|Primary\s*Information|Reset|$)/i;
  const sectionM = flat.match(sectionRe);
  if (!sectionM) return [];
  const section = sectionM[1];

  // Each dependent row has these signals (any subset):
  //   - ALL-CAPS name (1+ words)
  //   - Relationship word: Dependent | Spouse | Child
  //   - DOB pattern: m/d/yyyy or m/d/yy
  //   - Gender: Male | Female
  //
  // The cleanest anchor is the relationship label. Match every occurrence
  // and capture the all-caps name preceding it + the date+gender after.
  const ROW_RE = /\b([A-Z][A-Z'.\- ]{1,40}[A-Z])\s+(Dependent|Spouse|Child)\b[\s\S]{0,80}?(?:(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{4}|\d{2})))?(?:[\s\S]{0,30}?\(?\s*\d{1,3}\s*\)?)?(?:[\s\S]{0,30}?\b(Male|Female)\b)?/gi;

  const out = [];
  const seen = new Set();
  const primaryKey = String(primaryName || '').toLowerCase().replace(/\s+/g, ' ').trim();

  for (const m of section.matchAll(ROW_RE)) {
    const rawName = (m[1] || '').replace(/\s+/g, ' ').trim();
    if (!rawName || rawName.length < 3) continue;
    const titled = titleCase(rawName);
    const key = titled.toLowerCase();
    if (seen.has(key)) continue;
    if (key === primaryKey) continue; // skip primary if it bled in
    seen.add(key);

    const rel = String(m[2] || 'other').toLowerCase();
    const relationship = rel === 'spouse' ? 'spouse' : rel === 'child' ? 'child' : 'other';
    // "Dependent" by itself doesn't tell us spouse vs child — leave as 'other'
    // unless we can infer from age (DOB).

    const dob = m[3] ? toIsoDate(m[3]) : '';
    out.push({ name: titled, relationship, dob });
  }
  return out;
}

export function parseDealFromText(rawText) {
  const text = String(rawText || '').replace(/[''`]/g, "'");
  const flat = text.replace(/\s+/g, ' ').trim();

  const out = {
    raw: rawText,
    name: '',
    policyNumber: '',
    monthlyPremium: 0,
    applicationDate: '',
    effectiveDate: '',
    paidToDate: '',
    stage: '',
    gender: '',
    dob: '',
    phone: '',
    email: '',
    state: '',
    zip: '',
    indvOrFamily: 'Indv',
    products: [],         // canonical IDs (add-ons)
    mainProduct: '',      // canonical ID
    dependents: [],       // [{ name, relationship, dob }]
    confidence: {},
  };

  // Status -> map to lead stage
  const statusM = flat.match(PATTERNS.status);
  if (statusM) {
    const v = statusM[1].toLowerCase();
    if (v === 'issued' || v === 'active')          out.stage = 'Issued';
    else if (v === 'pending' || v === 'submitted') out.stage = 'Pending';
    else if (v === 'declined' || v === 'lapsed' || v === 'cancelled') out.stage = 'Declined';
    else if (v === 'withdrawn')                     out.stage = 'Withdrawn';
  }

  // Customer name
  const nameM = text.match(PATTERNS.name);
  if (nameM) out.name = titleCase(nameM[1].trim());

  // Policy ID — take FIRST plausible match. Uppercase the letter portion
  // so OCR'd "52v2502220" becomes "52V2502220".
  const polMatches = [...text.matchAll(/(\d{1,3}[A-Za-z]\d{4,}[A-Za-z0-9]?)/g)];
  for (const m of polMatches) {
    if (isPlausiblePolicyId(m[1])) {
      out.policyNumber = m[1].toUpperCase();
      break;
    }
  }

  // Monthly premium
  const premM = flat.match(PATTERNS.monthlyPremium);
  if (premM) out.monthlyPremium = Number(premM[1].replace(/,/g, ''));

  // Dates
  const appM = flat.match(PATTERNS.applicationDate);
  if (appM) out.applicationDate = toIsoDate(appM[1]);
  const effM = flat.match(PATTERNS.effectiveDate);
  if (effM) out.effectiveDate = toIsoDate(effM[1]);
  const paidM = flat.match(PATTERNS.paidToDate);
  if (paidM) out.paidToDate = toIsoDate(paidM[1]);

  // Person details
  const genderM = flat.match(PATTERNS.gender);
  if (genderM) out.gender = titleCase(genderM[1]);
  const dobM = flat.match(PATTERNS.dob);
  if (dobM) out.dob = toIsoDate(dobM[1]);

  // Contact — phone (try lenient regex, then extract digits)
  const phoneM = flat.match(PATTERNS.phone);
  if (phoneM) {
    const normalized = normalizePhone(phoneM[1]);
    if (normalized) out.phone = normalized;
  }
  // Email — multi-strategy fallback for OCR-mangled @ symbols
  out.email = extractEmail(text);

  // Location
  const stateM = flat.match(PATTERNS.state);
  if (stateM) out.state = stateM[1];
  const zipM = flat.match(PATTERNS.zip);
  if (zipM) out.zip = zipM[1];

  // Products — split into main vs add-ons via the catalog.
  // Main product priority order is the order in PRODUCT_CATALOG.
  const matches = findProducts(text);
  const main = matches.find(m => m.bucket === 'main');
  if (main) out.mainProduct = main.canonical;
  out.products = matches.filter(m => m.bucket === 'addon').map(m => m.canonical);

  // Indv / Family heuristic — Dependents section present AND populated.
  // The USHA portal always shows the "Dependents" heading even when there
  // are none; "There are no dependents to display" was being read as
  // proof of dependents and flagging the lead Family.
  const hasNoDependentsCopy = /no\s+dependents?\s+to\s+display/i.test(text);
  const hasDependentRow = /\bDependent\b/i.test(text) && !hasNoDependentsCopy;
  if (hasDependentRow) {
    out.indvOrFamily = 'Family';
  }

  // ---- Structured dependent extraction ----
  //
  // The USHA portal "Dependents" panel lists each family member as:
  //   <ALL CAPS NAME>   <Relationship>     (e.g. "SCOTTY ABLES   Dependent")
  //   <m/d/yyyy or m/d/yy> (<age>)         (e.g. "12/23/2025 (0)")
  //   <Male|Female>
  //
  // After OCR + whitespace flattening these often land as a continuous
  // string like:
  //   "Dependents Q SCOTTY ABLES Dependent A 12/23/2025 (0) Male ..."
  // (Q / A are icon glyphs that OCR converts to letters — we ignore them.)
  //
  // Strategy: find the "Dependents" section header, then within the next
  // ~600 chars, repeatedly match: <name> <relationship> <date+age?> <gender?>
  out.dependents = extractDependents(text, out.name);

  return out;
}

/**
 * Convert an AI-extracted record (matching the /api/extract-screenshot-ai
 * schema) into the same shape as parseDealFromText so the import wizard
 * doesn't care which path produced the data.
 *
 * The two differences are:
 *   - AI returns addressStreet + addressCity as separate fields; we don't
 *     show street/city in the wizard form today, so we fold them into a
 *     single notes-ready string the caller can preserve.
 *   - AI returns age as a separate integer; the regex path computes age
 *     from dob if needed downstream.
 */
function aiToParsed(ai) {
  if (!ai || typeof ai !== 'object') return null;
  return {
    raw: '[AI-extracted]',
    name: ai.name || '',
    policyNumber: ai.policyNumber || '',
    monthlyPremium: Number(ai.monthlyPremium) || 0,
    applicationDate: ai.applicationDate || '',
    effectiveDate: ai.effectiveDate || '',
    paidToDate: ai.paidToDate || '',
    stage: ai.stage || '',
    gender: ai.gender || '',
    dob: ai.dob || '',
    age: Number(ai.age) || 0,
    phone: ai.phone || '',
    email: ai.email || '',
    addressStreet: ai.addressStreet || '',
    addressCity: ai.addressCity || '',
    state: ai.state || '',
    zip: ai.zip || '',
    indvOrFamily: ai.indvOrFamily || 'Indv',
    products: Array.isArray(ai.products) ? ai.products : [],
    mainProduct: ai.mainProduct || '',
    associationPlan: ai.associationPlan || '',
    dependents: Array.isArray(ai.dependents) ? ai.dependents : [],
    confidence: { source: 'ai' },
  };
}

/**
 * Downsample large screenshots before upload. USHA portal screenshots come
 * in at 1500-2200px wide which is overkill for Vision — Anthropic actually
 * downscales anything over 1568px anyway. Shrinking to 1200px wide on the
 * client cuts upload size 3-4x AND speeds up Vision processing.
 *
 * Failures here are non-fatal — caller falls back to the original file.
 */
async function downsampleImage(file, maxDim = 1200, quality = 0.85) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return file;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(img.width, img.height);
      // Already small enough? Skip the canvas round-trip.
      if (longest <= maxDim) {
        resolve(file);
        return;
      }
      const scale = maxDim / longest;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Canvas toBlob failed'));
          const renamed = file.name.replace(/\.\w+$/, '.jpg');
          resolve(new File([blob], renamed, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

/**
 * Try AI extraction first (Claude Vision, much higher accuracy on small
 * text like emails / phones / DOBs). Falls back to Tesseract.js if the
 * API is missing, errors, returns nothing usable, OR doesn't respond
 * within 25 seconds.
 *
 * onProgress is preserved so the UI's progress indicator works on both
 * paths (AI = stepped 0/30/85/100; Tesseract = real OCR percentage).
 */
export async function extractDealFromImage(file, onProgress) {
  // Downsample first — speeds up both paths and reduces Vision API cost.
  // Falls back to original file if the canvas path errors.
  let workingFile = file;
  try {
    workingFile = await downsampleImage(file, 1200, 0.85);
  } catch (e) {
    console.warn('[screenshotExtract] downsample failed, using original:', e?.message || e);
  }

  // ---- Path 1: AI extraction via Vision API ----
  try {
    onProgress?.(15);
    const fd = new FormData();
    fd.append('file', workingFile);
    const controller = new AbortController();
    // 45s — generous to absorb Vercel cold-start latency on the first
    // call (function spin-up can add 5-10s before our code even starts).
    // Subsequent calls within the same warm function are 3-8s typically.
    // Still well under Vercel's 60s function timeout so we get a clean
    // abort + fallback rather than HTTP-504 from the platform.
    const timer = setTimeout(() => controller.abort(), 45_000);
    onProgress?.(30);
    let res;
    try {
      // Auth-gated endpoint — lazy-import authedFetch to keep this
       // OCR module usable from non-React contexts that don't ship the
       // supabase client.
      const { authedFetch } = await import('./authedFetch');
      res = await authedFetch('/api/extract-screenshot-ai', {
        method: 'POST',
        body: fd,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    onProgress?.(85);
    if (res.ok) {
      const data = await res.json();
      if (data?.parsed) {
        const parsed = aiToParsed(data.parsed);
        if (parsed && (parsed.name || parsed.policyNumber)) {
          onProgress?.(100);
          return { rawText: '[Claude Vision API]', parsed, usedAi: true, usage: data.usage };
        }
      }
    } else {
      const err = await res.text().catch(() => '');
      console.warn('[screenshotExtract] AI path returned non-OK', res.status, err);
    }
  } catch (e) {
    if (e?.name === 'AbortError') {
      console.warn('[screenshotExtract] AI path timed out at 25s — falling back to Tesseract');
    } else {
      console.warn('[screenshotExtract] AI path failed, falling back to Tesseract:', e?.message || e);
    }
  }

  // ---- Path 2: Tesseract fallback (free, offline-capable) ----
  onProgress?.(0);
  const Tesseract = (await import('tesseract.js')).default;
  const { data: { text } } = await Tesseract.recognize(workingFile, 'eng', {
    logger: m => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(Math.round(m.progress * 100));
      }
    },
  });
  return { rawText: text, parsed: parseDealFromText(text), usedAi: false };
}
