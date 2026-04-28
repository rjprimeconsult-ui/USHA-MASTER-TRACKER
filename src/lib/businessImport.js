/**
 * Business Books — bank statement / receipt CSV import.
 *
 * Reads a bank or credit-card export (Date / Description / Amount columns),
 * splits debits vs credits into expenses vs income, and pre-classifies each
 * row with smart keyword rules. The user reviews and can re-categorize any
 * row before committing.
 */

import * as XLSX from 'xlsx';
import { uid } from './utils';

// Keyword rules for guessing expense category from a transaction description.
// Order matters: more specific patterns checked first.
const EXPENSE_KEYWORDS = [
  // Lead acquisition — checked FIRST so "LEADS MARKETPLACE" doesn't fall into Marketing.
  // These directly buy lead lists / aged leads / vendor splits — they go into CPA math.
  { cat: 'LEAD_INVESTMENT', patterns: [/leads?\s*marketplace/i, /lead\s*vendor/i, /lead\s*purchase/i, /lead\s*buy/i, /\baged\s*leads?\b/i, /jesus\s*burga/i, /\busha\s*leads?\b/i, /lead\s*list/i, /\bringy\s*leads/i, /facebook\s*lead/i, /google\s*ads\s*split/i, /\bgoogle\s*ads(?!\s*spend)/i, /^leads?$/i, /\bchev(rolet)?\s*credits?/i, /\bbenepath/i, /\bnectar\b/i, /^smartfinancial/i] },
  { cat: 'OFFICE_RENT',    patterns: [/\boffice\s*rent\b/i, /\bfsl\s*rent\b/i, /\boffice\s*pack\b/i, /\boffice\s*split\b/i, /\bdesk\s*rent\b/i] },
  { cat: 'TRAVEL',         patterns: [/airbnb/i, /\bmarriott\b/i, /\bhilton\b/i, /\bhyatt\b/i, /\baloft\b/i, /\bsheraton\b/i, /\bwyndham\b/i, /\bbest\s*western\b/i, /booking\.com/i, /\bexpedia\b/i, /\bvrbo\b/i, /\bdelta\b/i, /\bunited\s*air/i, /\bsouthwest\s*air/i, /\bjetblue\b/i, /\bspirit\s*air/i, /\bamerican\s*air/i, /\bfrontier\s*air/i, /\balaska\s*air/i, /\bairline\b/i, /\bflight\b/i, /work\s*trip/i, /company\s*trip/i, /\bexcursion\b/i] },
  { cat: 'RECRUITING',     patterns: [/\brecruit/i] },
  { cat: 'TEAM_INCENTIVES', patterns: [/incentive\s*for\s*agents?/i, /agent\s*incentive/i, /outing\s*with\s*top\s*producers?/i, /dinner\s*for\s*top\s*producers?/i, /lunch\s*for\s*top\s*producers?/i, /lunch\s*for\s*agents?/i, /dinner\s*for\s*agents?/i, /team\s*incentive/i, /team\s*outing/i, /team\s*meal/i, /coffee\s*team/i, /coffee\s*for\s*the\s*team/i, /uber\s*eats\s*for\s*the\s*team/i, /bfast\s*for\s*team/i, /breakfast\s*for\s*team/i, /gift\s*for\s*top\s*producer/i, /top\s*producer/i, /^team\s+(uber\s*eats|wings|pizza|coffee|breakfast|bfast|lunch|dinner|food|meal|snack|donuts?|bagels?|tacos?)/i] },
  { cat: 'MARKETING',      patterns: [/facebook\s*ads/i, /\bmeta\b.*ads/i, /linkedin.*ads/i, /tiktok.*ads/i, /mailchimp/i, /constant\s*contact/i, /hootsuite/i, /buffer/i] },
  { cat: 'SOFTWARE',       patterns: [/notion/i, /slack/i, /zoom/i, /google\s*workspace/i, /gsuite/i, /microsoft\s*365/i, /office\s*365/i, /adobe/i, /dropbox/i, /\baws\b/i, /github/i, /openai/i, /anthropic/i, /claude/i, /chat\s*gpt/i, /chatgpt/i, /figma/i, /canva/i, /calendly/i, /textdrip/i, /\bringy\b/i, /vanilla\s*soft/i, /vanillasoft/i, /only\s*sales/i, /text\s*cred/i, /\bvs\b\s*cred/i, /vsoft\s*cred/i, /\bcami's\s*vs\b/i, /\bvs\s*creds?$/i] },
  { cat: 'VEHICLE',        patterns: [/\bshell\b/i, /chevron/i, /\bexxon\b/i, /\bmobil\b/i, /\b76\b/i, /\barco\b/i, /\bbp\b/i, /valero/i, /circle\s*k/i, /7-?eleven/i, /gas\s*station/i, /\bfuel\b/i, /\buber\b(?!\s*eats)/i, /\blyft\b/i, /\bparking\b/i, /\btoll\b/i, /sunpass/i, /\bdmv\b/i, /jiffy\s*lube/i, /oil\s*change/i, /car\s*payment/i, /car\s*lease/i, /car\s*insurance/i, /commute\s*to\s*work/i] },
  { cat: 'MEALS',          patterns: [/restaurant/i, /\bcafe\b/i, /starbucks/i, /chipotle/i, /chick-?fil-?a/i, /mcdonald/i, /subway/i, /panera/i, /uber\s*eats/i, /doordash/i, /grubhub/i, /postmates/i, /pizza/i, /\bdeli\b/i, /\bdiner\b/i, /work\s*food/i, /meal\s*plan/i, /eat\s*clean/i, /^breakfast$/i, /^lunch$/i, /^dinner$/i, /^bfast$/i, /\bwings\b/i] },
  { cat: 'OFFICE',         patterns: [/staples/i, /office\s*depot/i, /amazon\.?com/i, /amzn\s*mktp/i, /\bamazon\b/i, /walmart/i, /\btarget\b/i, /\bups\b/i, /fedex/i, /usps/i, /post\s*office/i, /office\s*supplies/i] },
  { cat: 'PHONE_INTERNET', patterns: [/at\s*&\s*t/i, /verizon/i, /comcast/i, /xfinity/i, /spectrum/i, /\bt-?mobile\b/i, /sprint/i, /cox\s*comm/i, /\bvonage\b/i, /ringcentral/i, /\bcricket\b/i, /\binternet\b/i] },
  { cat: 'PROFESSIONAL',   patterns: [/\be&o\b/i, /\bnaifa\b/i, /licensing/i, /\binsurance\s*license/i, /license\s*fee/i, /\blicense\b/i, /quickbooks/i, /turbotax/i, /\bcpa\b/i, /accountant/i, /accounting/i, /attorney/i, /lawyer/i, /\btax\b/i, /\blexisnexis\b/i, /\bnipr\b/i, /sircon/i, /^llc$/i, /\bllc\s*(fee|filing|annual)/i, /\bsunbiz\b/i, /annual\s*report/i, /registered\s*agent/i] },
  { cat: 'HEALTHCARE',     patterns: [/\bcvs\b/i, /walgreens/i, /pharmacy/i, /\bclinic\b/i, /hospital/i, /\bmedical\b/i, /\bdental\b/i, /dentist/i, /\bvision\b/i, /\bdoctor/i, /\bdds\b/i] },
  { cat: 'COACHING',       patterns: [/\bcoach/i, /\bmentor/i, /\btraining/i, /\bseminar/i, /\bworkshop/i, /\bconference/i, /\bsummit/i, /\bmastermind/i] },
];

// Keyword rules for income classification (positive amounts).
// Lead-related commissions are excluded — those flow through Issued leads.
const INCOME_KEYWORDS = [
  { cat: 'BONUS',      patterns: [/\bbonus\b/i, /\bincentive\b/i, /\bspiff\b/i, /\bcontest\b/i] },
  { cat: 'OVERRIDE',   patterns: [/\boverride\b/i, /\bod\b/i, /\bmanager\s*comm/i] },
  { cat: 'RENEWAL',    patterns: [/\brenewal/i, /\bresidual/i, /trail/i] },
];

export function classifyExpense(description) {
  const s = String(description || '').trim();
  if (!s) return 'OTHER_EXPENSE';
  for (const { cat, patterns } of EXPENSE_KEYWORDS) {
    if (patterns.some(p => p.test(s))) return cat;
  }
  return 'OTHER_EXPENSE';
}

export function classifyIncome(description) {
  const s = String(description || '').trim();
  if (!s) return 'OTHER_INCOME';
  for (const { cat, patterns } of INCOME_KEYWORDS) {
    if (patterns.some(p => p.test(s))) return cat;
  }
  return 'OTHER_INCOME';
}

// ---------- Account / bank detection ----------
// First try the filename (Chase exports often include "Chase" in the name),
// then fall back to scanning a few transaction descriptions for clearing-house
// merchants that identify the account itself.
const FILENAME_HINTS = [
  { pattern: /chase\b/i,                      account: 'Chase' },
  { pattern: /bofa|bank.?of.?america/i,        account: 'Bank of America' },
  { pattern: /\bamex\b|american.?express|^activity[\s(\d).-]*\.csv$/i, account: 'American Express' },
  { pattern: /capital.?one/i,                  account: 'Capital One' },
  { pattern: /discover/i,                      account: 'Discover' },
  { pattern: /\bciti\b/i,                      account: 'Citi' },
  { pattern: /wells.?fargo/i,                  account: 'Wells Fargo' },
  { pattern: /us.?bank/i,                      account: 'US Bank' },
  { pattern: /apple.?card/i,                   account: 'Apple Card' },
  { pattern: /paypal/i,                        account: 'PayPal' },
  { pattern: /venmo/i,                         account: 'Venmo' },
  { pattern: /cash.?app/i,                     account: 'Cash App' },
  { pattern: /\bnavy.?federal/i,               account: 'Navy Federal' },
  { pattern: /\bschwab/i,                      account: 'Charles Schwab' },
  { pattern: /chime/i,                         account: 'Chime' },
];

const DESC_HINTS = [
  { pattern: /chase\.com|chase\s*card/i,                       account: 'Chase' },
  { pattern: /amex\s*epayment|americanexpress/i,                account: 'American Express' },
  { pattern: /bofa|bankofamerica|bk\s*of\s*amer/i,              account: 'Bank of America' },
  { pattern: /capital\s*one/i,                                  account: 'Capital One' },
  { pattern: /discover/i,                                       account: 'Discover' },
  { pattern: /wells\s*fargo/i,                                  account: 'Wells Fargo' },
];

/** Detect the bank/account from filename, with fallback to scanning descriptions. */
export function detectAccount(filename = '', sampleDescriptions = []) {
  for (const { pattern, account } of FILENAME_HINTS) {
    if (pattern.test(filename)) return account;
  }
  for (const desc of sampleDescriptions.slice(0, 30)) {
    const s = String(desc || '');
    for (const { pattern, account } of DESC_HINTS) {
      if (pattern.test(s)) return account;
    }
  }
  return null;
}

/** Heuristic: detect form of payment from a single transaction's description. */
const PAYMENT_METHOD_RULES = [
  { method: 'Check',    patterns: [/^check\s*#?\s*\d/i, /\bchk\b\s*\d/i] },
  { method: 'ACH',      patterns: [/\bach\b/i, /\bdirect\s*(deposit|debit)/i] },
  { method: 'Zelle',    patterns: [/\bzelle\b/i] },
  { method: 'Venmo',    patterns: [/\bvenmo\b/i] },
  { method: 'PayPal',   patterns: [/\bpaypal\b/i] },
  { method: 'Cash App', patterns: [/cash\s*app/i] },
  { method: 'Wire',     patterns: [/\bwire\b/i] },
  { method: 'ATM',      patterns: [/\batm\b/i, /cash\s*withdrawal/i] },
  { method: 'POS',      patterns: [/\bpos\b/i, /point\s*of\s*sale/i, /debit\s*card\s*purchase/i] },
];

export function detectPaymentMethod(description) {
  const s = String(description || '').trim();
  if (!s) return null;
  for (const { method, patterns } of PAYMENT_METHOD_RULES) {
    if (patterns.some(p => p.test(s))) return method;
  }
  return null;
}

// ---------- Header detection (handles common bank export formats) ----------
const HEADER_CATEGORIES = {
  DATE:        [/^date$/i, /^trans(action)?\s*date/i, /posted/i, /^post\s*date/i],
  AMOUNT:      [/^amount$/i, /^transaction\s*amount/i],
  DEBIT:       [/^debit$/i, /^withdrawal/i, /^charges?$/i],
  CREDIT:      [/^credit$/i, /^deposit/i, /^payment/i],
  DESCRIPTION: [/description/i, /memo/i, /payee/i, /details/i, /merchant/i, /transaction/i],
};

// Detect a credit-card export. AMEX/Apple Card/Discover/Capital One credit
// statements use the OPPOSITE sign convention from bank checking accounts:
//   Positive amount = charge (purchase) -> expense for the user
//   Negative amount = payment to card    -> NOT an expense (it's a transfer)
// We detect via filename hints, header signature ("Extended Details" /
// "Appears On Your Statement As" are AMEX tell-tales), or a heuristic on the
// data shape.
const CREDIT_CARD_FILENAME = /\bamex\b|american.?express|apple.?card|discover|capital.?one|\bcredit.?card\b|\bcc\b|^activity\b/i;
const AMEX_HEADER_TOKENS = [/extended\s*details/i, /appears\s*on\s*your\s*statement/i, /\breference\b/i];

function looksLikeCreditCard({ filename = '', headerCells = [], rows = [], dateCol = -1, descCol = -1, amtCol = -1 }) {
  // 1. Filename hint
  if (CREDIT_CARD_FILENAME.test(String(filename))) return true;
  // 2. AMEX-style header signature
  const headerStr = headerCells.map(c => String(c || '')).join(' ');
  if (AMEX_HEADER_TOKENS.some(p => p.test(headerStr))) return true;
  // 3. Heuristic: in a credit card export, the vast majority of rows are
  //    positive (charges) with a few large negatives (payments). In a bank
  //    checking export the opposite is roughly true, AND there's typically
  //    a steady stream of incoming deposits. If we see >70% positive rows
  //    AND descriptions look merchant-y (no "DIRECT DEPOSIT" / "PAYROLL" /
  //    "ACH CREDIT" markers), call it a credit card.
  if (amtCol === -1 || rows.length < 5) return false;
  let pos = 0, neg = 0;
  let depositMarkers = 0;
  for (const row of rows) {
    const v = parseAmount(row?.[amtCol]);
    if (v == null || v === 0) continue;
    if (v > 0) pos++; else neg++;
    if (descCol !== -1) {
      const d = String(row[descCol] || '');
      if (/direct\s*deposit|payroll|ach\s*credit|interest\s*paid|wire\s*in/i.test(d)) depositMarkers++;
    }
  }
  const total = pos + neg;
  if (total < 5) return false;
  return (pos / total) > 0.7 && depositMarkers === 0;
}

function categorizeHeader(cell) {
  const s = String(cell || '').trim();
  if (!s) return null;
  for (const [cat, patterns] of Object.entries(HEADER_CATEGORIES)) {
    if (patterns.some(p => p.test(s))) return cat;
  }
  return null;
}

function parseDate(cell) {
  if (cell == null || cell === '') return null;
  if (cell instanceof Date) {
    const y = cell.getFullYear();
    const m = String(cell.getMonth() + 1).padStart(2, '0');
    const d = String(cell.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(cell).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    let mm, dd;
    if (a > 12 && b <= 12)      { dd = a; mm = b; }
    else                         { mm = a; dd = b; }
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    let yy = m[3];
    if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 30000 && n < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

function parseAmount(cell) {
  if (cell == null || cell === '') return null;
  const s = String(cell).replace(/[$,]/g, '').replace(/\s/g, '').trim();
  if (!s || s === '-' || s === '—') return null;
  // handle parens for negatives, e.g. "(45.00)"
  const neg = /^\(.*\)$/.test(s);
  const clean = s.replace(/[()]/g, '');
  const n = Number(clean);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// ---------- Don Julio expense sheet ----------
// Specific format: Month, Date, Category, Item, Cost, Description, Purpose, Card paid with
// "Card paid with" → account name (CHASE BIZZ DEBIT, CHASE BIZZ CC, AMEX, etc.)
// Description + Purpose feed the category classifier together with the Item.
//
// Detected by header signature when all 4 of {Month, Date, Item, Cost} appear in the same row.

const MONTH_NAMES = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };

function isDonJulioHeader(headerRow) {
  const norm = headerRow.map(c => String(c || '').trim().toLowerCase());
  return (
    norm.includes('month') &&
    norm.includes('date') &&
    norm.includes('item') &&
    norm.includes('cost')
  );
}

function findColumnIndex(headerRow, ...names) {
  const norm = headerRow.map(c => String(c || '').trim().toLowerCase());
  for (const n of names) {
    const i = norm.indexOf(n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

function inferYear(filename = '') {
  const m = String(filename).match(/(20\d{2})/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

// Map "Card paid with" cell value to a friendly account name
function mapCardToAccount(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  if (/CHASE.*BIZZ.*DEBIT|CHASE.*BUS.*DEBIT/i.test(s)) return 'Chase Business Debit';
  if (/CHASE.*BIZZ.*CC|CHASE.*BUS.*CC|CHASE.*CREDIT/i.test(s)) return 'Chase Business CC';
  if (/CHASE/i.test(s))                                       return 'Chase';
  if (/\bAMEX\b|AMERICAN\s*EXPRESS/i.test(s))                 return 'American Express';
  if (/BOFA|BANK.*AMERICA/i.test(s))                          return 'Bank of America';
  if (/CAPITAL\s*ONE/i.test(s))                               return 'Capital One';
  if (/DISCOVER/i.test(s))                                    return 'Discover';
  if (/WELLS\s*FARGO/i.test(s))                               return 'Wells Fargo';
  if (/APPLE\s*CARD/i.test(s))                                return 'Apple Card';
  if (/PAYPAL/i.test(s))                                      return 'PayPal';
  if (/VENMO/i.test(s))                                       return 'Venmo';
  // Fallback: title-case the original
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// Combined classifier — concatenates Item + Description + Purpose so the
// stronger of the three wins. Description "INCENTIVE FOR AGENTS" beats
// "CHIPOTLE" so a $15 Chipotle for the team gets correctly tagged.
function classifyDonJulioRow({ item, description, purpose }) {
  const combined = [description, purpose, item].filter(Boolean).join(' | ');
  return classifyExpense(combined);
}

export function parseDonJulioExpenseSheet(rows, filename = '') {
  // Find header row (first 6 rows max)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    if (isDonJulioHeader(rows[i] || [])) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return null;

  const header = rows[headerIdx];
  const monthCol = findColumnIndex(header, 'month');
  const dateCol  = findColumnIndex(header, 'date');
  const itemCol  = findColumnIndex(header, 'item');
  const costCol  = findColumnIndex(header, 'cost');
  const descCol  = findColumnIndex(header, 'description');
  const purpCol  = findColumnIndex(header, 'purpose');
  const cardCol  = findColumnIndex(header, 'card paid with', 'card', 'paid with');

  const year = inferYear(filename);
  const expenses = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const monthRaw = String(row[monthCol] || '').trim().toLowerCase().slice(0, 4);
    const dayRaw   = String(row[dateCol]  || '').trim();
    const item     = String(row[itemCol]  || '').trim();
    const costRaw  = String(row[costCol]  || '').trim();

    // Skip blank placeholder rows (have month but no real content)
    if (!item || item === '-') continue;
    const month = MONTH_NAMES[monthRaw] || MONTH_NAMES[monthRaw.slice(0, 3)];
    const day   = Number(dayRaw);
    if (!month || !Number.isFinite(day) || day < 1 || day > 31) continue;

    const amount = parseAmount(costRaw);
    if (amount == null || amount === 0) continue;

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const description = descCol !== -1 ? String(row[descCol] || '').trim() : '';
    const purpose     = purpCol !== -1 ? String(row[purpCol] || '').trim() : '';
    const card        = cardCol !== -1 ? String(row[cardCol] || '').trim() : '';

    expenses.push({
      id: uid(),
      date: dateStr,
      category: classifyDonJulioRow({ item, description, purpose }),
      amount: Math.abs(amount),
      vendor: item.slice(0, 80),
      notes: [description, purpose].filter(p => p && p !== item).join(' · ').slice(0, 120),
      account: mapCardToAccount(card),
      paymentMethod: null,
      attachment: null,
      _source: 'donjulio_expenses',
    });
  }

  expenses.sort((a, b) => b.date.localeCompare(a.date));
  return expenses;
}

export async function readSheetRows(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
}

/**
 * Read every sheet in a workbook. Used by multi-sheet formats like the
 * Harrison-style "$Activity - <MONTH> <YR>" weekly trackers.
 */
export async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array', cellDates: true });
}

// ---------- Harrison-style $Activity weekly tracker ----------
// One workbook with many sheets named "$Activity - <MONTH> <YR>". Each
// sheet has Money In/Out transactions in columns B/C/D as triplets:
//   B: date (m/d/yy)
//   C: item description (e.g. "Text Creds", "Leads", "team uber eats")
//   D: amount as "$-90" / " $-1,000" / "$81" — negative = expense
//
// We scan each $Activity sheet, pull every triplet that's a real
// transaction (date present, item not "{Blank}", amount not " $-   "),
// classify via the existing keyword rules, and combine into one list.

// Accept sheet names with or without a year suffix:
//   "$Activity - JAN 26"      (most common — month + 2-digit year)
//   "$Activity - APRIL 2026"   (full month name + 4-digit year)
//   "$Activity - AUGUST"       (no year — falls back to row dates)
// The TEMPLATE sheet is explicitly excluded.
const ACTIVITY_SHEET_NAME_RE = /^\$?\s*Activity\s*-\s*[A-Za-z]+(\s*\d{2,4})?\s*$/i;
const ACTIVITY_TEMPLATE_RE = /template/i;

function isActivitySheetName(name) {
  const t = String(name || '').trim();
  if (!t) return false;
  if (ACTIVITY_TEMPLATE_RE.test(t)) return false;
  return ACTIVITY_SHEET_NAME_RE.test(t);
}

// Detect by scanning sheet names for the $Activity pattern. Returns true
// if we find at least one matching sheet.
export function isHarrisonActivityWorkbook(wb) {
  if (!wb || !Array.isArray(wb.SheetNames)) return false;
  return wb.SheetNames.some(isActivitySheetName);
}

// Extract transactions from a single $Activity sheet.
function parseActivitySheet(ws, sheetName) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const date = parseDate(r[1]);
    const item = String(r[2] || '').trim();
    const amt  = parseAmount(r[3]);
    if (!date || !item) continue;
    if (item === '{Blank}' || /^select\s+source$/i.test(item)) continue;
    if (amt == null || amt === 0) continue;
    out.push({ date, item, amount: amt, sheet: sheetName });
  }
  return out;
}

// Aggregate every $Activity sheet in the workbook into one expense+income list.
export function parseHarrisonActivityWorkbook(wb) {
  const allTx = [];
  for (const sheetName of wb.SheetNames) {
    if (!isActivitySheetName(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const tx = parseActivitySheet(ws, sheetName);
    allTx.push(...tx);
  }
  // Split into expenses (negative) and income (positive). Classify each.
  const expenses = [];
  const income = [];
  for (const t of allTx) {
    if (t.amount < 0) {
      expenses.push({
        id: uid(),
        date: t.date,
        category: classifyExpense(t.item),
        amount: Math.abs(t.amount),
        vendor: t.item.slice(0, 80),
        notes: `From sheet "${t.sheet}"`,
        account: '',
        paymentMethod: null,
        attachment: null,
        _source: 'activity',
      });
    } else {
      income.push({
        id: uid(),
        date: t.date,
        category: classifyIncome(t.item),
        amount: t.amount,
        source: t.item.slice(0, 80),
        notes: `From sheet "${t.sheet}"`,
        account: '',
        paymentMethod: null,
        attachment: null,
        _source: 'activity',
      });
    }
  }
  expenses.sort((a, b) => b.date.localeCompare(a.date));
  income.sort((a, b) => b.date.localeCompare(a.date));
  return { expenses, income };
}

/**
 * Parse a bank/credit-card statement file into pre-classified expense + income rows.
 *
 * Returns: {
 *   format: 'bank' | 'unknown' | 'empty',
 *   expenses: [{id, date, category, amount, vendor, notes, _source}],
 *   income:   [{id, date, category, amount, source, notes, _source}],
 * }
 */
export async function parseBusinessFile(file) {
  // Harrison-style activity workbook check first — it spans multiple
  // sheets named "$Activity - <MONTH> <YR>". If we see that pattern,
  // sweep them all instead of just sheet 0.
  const wb = await readWorkbook(file);
  if (isHarrisonActivityWorkbook(wb)) {
    const { expenses, income } = parseHarrisonActivityWorkbook(wb);
    return {
      format: 'activity',
      expenses,
      income,
      detectedAccount: null,
      sheetCount: wb.SheetNames.filter(isActivitySheetName).length,
    };
  }

  // Other formats use first-sheet rows
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) : [];
  if (!rows || rows.length === 0) {
    return { format: 'empty', expenses: [], income: [], detectedAccount: null };
  }

  // Don Julio expense sheet check first — it has its own column layout
  // (Month, Date, Category, Item, Cost, Description, Purpose, Card paid with).
  const djExpenses = parseDonJulioExpenseSheet(rows, file.name || '');
  if (djExpenses) {
    return {
      format: 'donjulio',
      expenses: djExpenses,
      income: [],
      // For multi-card sheets, leave detected account empty so user picks "All cards"
      // or each row keeps its already-assigned account from the parser.
      detectedAccount: null,
    };
  }

  // Find header row (standard bank statement formats)
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const cats = rows[i].map(categorizeHeader).filter(Boolean);
    if (cats.length >= 2) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) {
    return { format: 'unknown', expenses: [], income: [], detectedAccount: null };
  }

  const cats = rows[headerRowIdx].map(categorizeHeader);
  const dateCol   = cats.indexOf('DATE');
  const descCol   = cats.indexOf('DESCRIPTION');
  const amtCol    = cats.indexOf('AMOUNT');
  const debitCol  = cats.indexOf('DEBIT');
  const creditCol = cats.indexOf('CREDIT');

  if (dateCol === -1 || (amtCol === -1 && debitCol === -1 && creditCol === -1)) {
    return { format: 'unknown', expenses: [], income: [], detectedAccount: null };
  }

  // Credit cards flip the sign convention vs bank checking.
  const dataRows = rows.slice(headerRowIdx + 1);
  const isCreditCard = looksLikeCreditCard({
    filename: file.name || '',
    headerCells: rows[headerRowIdx] || [],
    rows: dataRows,
    dateCol, descCol, amtCol,
  });

  const expenses = [];
  const income = [];
  const sampleDescriptions = [];

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dateStr = parseDate(row[dateCol]);
    if (!dateStr) continue;

    const desc = descCol !== -1 ? String(row[descCol] || '').trim() : '';
    sampleDescriptions.push(desc);

    // Determine amount + direction
    let amt = null;
    if (amtCol !== -1) {
      amt = parseAmount(row[amtCol]);
    } else {
      const debit  = debitCol  !== -1 ? parseAmount(row[debitCol])  : null;
      const credit = creditCol !== -1 ? parseAmount(row[creditCol]) : null;
      if (debit && debit !== 0)        amt = -Math.abs(debit);
      else if (credit && credit !== 0) amt =  Math.abs(credit);
    }
    if (amt == null || amt === 0) continue;
    // Flip sign for credit-card statements: charges (positive) become
    // expenses (negative in our internal convention), payments (negative)
    // become "income" (which we'll route to OTHER_INCOME — really a transfer
    // from checking, but we surface them so the user can verify).
    if (isCreditCard) amt = -amt;

    const paymentMethod = detectPaymentMethod(desc);

    if (amt < 0) {
      expenses.push({
        id: uid(),
        date: dateStr,
        category: classifyExpense(desc),
        amount: Math.abs(amt),
        vendor: desc.slice(0, 80),
        notes: '',
        account: '',          // filled in by user / auto-detect at preview time
        paymentMethod,        // null if not detectable
        attachment: null,
        _source: 'bank',
      });
    } else {
      income.push({
        id: uid(),
        date: dateStr,
        category: classifyIncome(desc),
        amount: amt,
        source: desc.slice(0, 80),
        notes: '',
        account: '',
        paymentMethod,
        attachment: null,
        _source: 'bank',
      });
    }
  }

  // Sort newest first
  expenses.sort((a, b) => b.date.localeCompare(a.date));
  income.sort((a, b) => b.date.localeCompare(a.date));

  // Detect account from filename + a sample of descriptions
  const detectedAccount = detectAccount(file.name || '', sampleDescriptions);

  return { format: 'bank', expenses, income, detectedAccount, isCreditCard };
}

/**
 * Dedup against existing entries.
 *
 * Match key = date | amount (2dp) | normalized vendor.
 *
 * We intentionally exclude `category` from the key — the user may
 * re-categorize an entry after import, or our auto-classifier may improve
 * between imports, and a transaction that's the same date+amount+vendor is
 * still the same transaction regardless. Vendor is normalized (trimmed,
 * lowercased, collapsed whitespace) so trivial format differences don't
 * cause false-fresh entries.
 */
function vendorKeyFor(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function dedupEntries(newEntries, existingEntries, vendorKey = 'vendor') {
  const keyOf = (e) => `${e.date}|${Number(e.amount || 0).toFixed(2)}|${vendorKeyFor(e[vendorKey])}`;
  const seen = new Set(existingEntries.map(keyOf));
  const fresh = [];
  const duplicate = [];
  for (const e of newEntries) {
    const k = keyOf(e);
    if (seen.has(k)) duplicate.push(e);
    else { fresh.push(e); seen.add(k); }
  }
  return { fresh, duplicate };
}
