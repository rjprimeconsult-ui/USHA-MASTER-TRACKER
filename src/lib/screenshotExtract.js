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

  // Indv / Family heuristic — Dependents section presence
  if (/\bDependent(s)?\b/i.test(text)) {
    out.indvOrFamily = 'Family';
  }

  return out;
}

/**
 * Run Tesseract.js on an image File or Blob.
 * Returns a Promise that resolves to { rawText, parsed }.
 */
export async function extractDealFromImage(file, onProgress) {
  const Tesseract = (await import('tesseract.js')).default;
  const { data: { text } } = await Tesseract.recognize(file, 'eng', {
    logger: m => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(Math.round(m.progress * 100));
      }
    },
  });
  return { rawText: text, parsed: parseDealFromText(text) };
}
