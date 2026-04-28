/**
 * USHA portal screenshot OCR + structured extraction.
 *
 * Pipeline:
 *   1. Run Tesseract.js on the image -> raw text blob
 *   2. Pattern-match the text against known USHA portal layouts
 *   3. Return a normalized {name, phone, email, ...} object the
 *      caller maps onto a new Lead.
 *
 * Tesseract is loaded lazily so the ~3MB worker only ships when an
 * agent actually opens the screenshot importer.
 */

// ---------- Pattern catalog ----------
//
// These regexes target the visible USHA portal "deal detail" card. They
// tolerate OCR noise (extra spaces, dropped punctuation, mixed case) by
// being deliberately loose.
const PATTERNS = {
  // Status badge — the green "Issued" / "Pending" / etc. pill at the top
  status: /\b(Issued|Pending|Submitted|Active|Declined|Withdrawn|Lapsed|Cancelled)\b/i,

  // Customer name — usually the FIRST all-caps multi-word line, often
  // followed by the policy ID line. We capture as "Last Name First Name"
  // or "First Last" — caller can tidy.
  name: /\b([A-Z][A-Z'.\- ]{2,40}\s[A-Z][A-Z'.\- ]{2,40})\b/,

  // Master policy ID — letter-prefixed alphanumeric, e.g. 52Y2502220
  policyId: /\b(\d{1,3}[A-Z]\d{4,}[A-Z0-9]?)\b/,

  // Money line: "Monthly Premium: $599.42"
  monthlyPremium: /Monthly\s*Premium:?\s*\$?\s*([\d,]+\.\d{2})/i,

  // Application date: "Application: 04/23/2026"
  applicationDate: /Application:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,

  // Paid to Date: "Paid to Date: 05/23/2026"
  paidToDate: /Paid\s*to\s*Date:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,

  // Effective Date: "Effective Date: 05/23/2026"
  effectiveDate: /Effective\s*Date:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,

  // Gender (under Primary Information)
  gender: /\b(Male|Female)\b/i,

  // DOB: "08/29/1996 (29)" — date plus age in parens
  dob: /\b(\d{1,2}[\/\-]\d{1,2}[\/\-](?:19|20)\d{2})\s*\(\s*\d{1,3}\s*\)/,

  // Phone: "(337) 580-4728" — handle OCR variants
  phone: /\(?\s*(\d{3})\s*\)?[\s\-.]+(\d{3})[\s\-.]+(\d{4})\b/,

  // Email — standard
  email: /([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i,

  // ZIP code (5 digits at end of address line)
  zip: /\b(\d{5})(?:-\d{4})?\b/,

  // State — 2-letter US state code preceded by a comma or space, before ZIP
  state: /,\s*([A-Z]{2})\s+\d{5}\b/,
};

// Known USHA product names (extend as we encounter new ones)
const KNOWN_PRODUCTS = [
  'MedGuard III', 'MedGuard II', 'MedGuard',
  'PremierAdvantage Fixed Indemnity', 'PremierAdvantage', 'Premier Advantage',
  'Premier Choice', 'Secure Advantage',
  'Secure Dental Plus', 'Secure Dental', 'Secure Vision', 'Secure Hearing',
  'Health Access III', 'Health Access II', 'Health Access',
  'Critical Illness', 'Accident', 'Life',
];

// Find every product mentioned in the OCR text; preserve order of first occurrence
function findProducts(text) {
  const found = [];
  const seen = new Set();
  for (const p of KNOWN_PRODUCTS) {
    const re = new RegExp(p.replace(/\s+/g, '\\s+'), 'i');
    const m = text.match(re);
    if (m && !seen.has(p)) {
      found.push({ name: p, index: m.index });
      seen.add(p);
    }
  }
  // Sort by appearance order
  return found.sort((a, b) => a.index - b.index).map(p => p.name);
}

// Normalize a name from ALL CAPS to Title Case
function titleCase(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// Convert M/D/YYYY to YYYY-MM-DD
function toIsoDate(s) {
  if (!s) return '';
  const m = String(s).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return '';
  let yy = m[3];
  if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
  return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

/**
 * Parse the raw OCR text into a structured deal record.
 * Every field is optional — caller can review + edit before saving.
 */
export function parseDealFromText(rawText) {
  const text = String(rawText || '').replace(/’/g, "'");
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
    products: [],
    mainProduct: '',
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
    out.confidence.stage = 'high';
  }

  // Customer name — first ALL CAPS run that's not a product or city
  const nameM = text.match(PATTERNS.name);
  if (nameM) {
    out.name = titleCase(nameM[1].trim());
    out.confidence.name = 'medium';
  }

  // Policy ID
  const polM = text.match(PATTERNS.policyId);
  if (polM) {
    out.policyNumber = polM[1];
    out.confidence.policyNumber = 'high';
  }

  // Monthly premium
  const premM = flat.match(PATTERNS.monthlyPremium);
  if (premM) {
    out.monthlyPremium = Number(premM[1].replace(/,/g, ''));
    out.confidence.monthlyPremium = 'high';
  }

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

  // Contact
  const phoneM = flat.match(PATTERNS.phone);
  if (phoneM) out.phone = `(${phoneM[1]}) ${phoneM[2]}-${phoneM[3]}`;
  const emailM = flat.match(PATTERNS.email);
  if (emailM) out.email = emailM[1].toLowerCase();

  // Location
  const stateM = flat.match(PATTERNS.state);
  if (stateM) out.state = stateM[1];
  const zipM = flat.match(PATTERNS.zip);
  if (zipM) out.zip = zipM[1];

  // Products
  const products = findProducts(text);
  out.products = products;
  out.mainProduct = products[0] || '';

  // Indv / Family heuristic — Dependents section presence
  if (/\bDependent(s)?\b/i.test(text)) {
    out.indvOrFamily = 'Family';
  }

  return out;
}

/**
 * Run Tesseract.js on an image File or Blob.
 * Returns a Promise that resolves to { rawText, parsed }.
 *
 * Lazy-loads tesseract.js so the heavy worker only ships when used.
 */
export async function extractDealFromImage(file, onProgress) {
  // Dynamic import keeps tesseract.js out of the main bundle
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
