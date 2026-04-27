/**
 * Platform Expenses — file import.
 *
 * Auto-detects two formats:
 *  1. Don Julio budget sheet — multi-block side-by-side: DATE | PLATFORM | AMOUNT | PLATFORM | AMOUNT | REASON
 *     (each block = one month, repeated horizontally for Jan/Feb/Mar/Apr...)
 *  2. Bank/credit card statement — generic: Date | Description | Amount
 *     Uses merchant patterns to classify into TD / RINGY / VANILLA. Anything
 *     that doesn't match a known merchant is dropped.
 */

import * as XLSX from 'xlsx';
import { uid } from './utils';

// Merchant text patterns → platform id
// Order matters: more specific patterns first
// Specific merchant patterns only — generic abbreviations like "TD" alone would
// false-positive on bank statements ("TD BANK", "AUTOPAY TD AMERITRADE", etc.).
const MERCHANT_PATTERNS = [
  { platform: 'TD',      patterns: [/\btextdrip\b/i, /text\s*drip/i] },
  { platform: 'VANILLA', patterns: [/vanilla\s*soft/i, /vanillasoft/i] },
  { platform: 'RINGY',   patterns: [/\bringy\b/i] },
];

export function classifyPlatform(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  for (const { platform, patterns } of MERCHANT_PATTERNS) {
    if (patterns.some(p => p.test(s))) return platform;
  }
  return null;
}

// Normalize a header cell to a category for column detection
const HEADER_CATEGORIES = {
  DATE:        [/^date$/i, /^trans(action)?\s*date/i, /posted/i, /^day$/i],
  PLATFORM:    [/^platform$/i, /^vendor$/i, /^merchant$/i],
  AMOUNT:      [/^amount$/i, /^charge/i, /^debit$/i, /^total$/i],
  REASON:      [/^reason$/i, /^purpose$/i, /^category$/i],
  DESCRIPTION: [/description/i, /memo/i, /payee/i, /details/i],
};

function categorizeHeader(cell) {
  const s = String(cell || '').trim();
  if (!s) return null;
  for (const [cat, patterns] of Object.entries(HEADER_CATEGORIES)) {
    if (patterns.some(p => p.test(s))) return cat;
  }
  return null;
}

/** Parse a date cell into "YYYY-MM-DD" or null. */
function parseDate(cell) {
  if (cell == null || cell === '') return null;
  if (cell instanceof Date) {
    const y = cell.getFullYear();
    const m = String(cell.getMonth() + 1).padStart(2, '0');
    const d = String(cell.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(cell).trim();
  // "01/15/2026" or "1/15/26" — assume MM/DD/YYYY (US default) but if the first
  // segment > 12 the file is DD/MM/YYYY (European) and we swap.
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    let mm, dd;
    if (a > 12 && b <= 12)      { dd = a; mm = b; } // DD/MM/YYYY
    else                         { mm = a; dd = b; } // MM/DD/YYYY (default)
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    let yy = m[3];
    if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  // "2026-01-15"
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const mm = String(m[2]).padStart(2, '0');
    const dd = String(m[3]).padStart(2, '0');
    return `${m[1]}-${mm}-${dd}`;
  }
  // Excel serial number (days since 1899-12-30)
  const n = Number(s);
  if (Number.isFinite(n) && n > 30000 && n < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    const y = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  return null;
}

function parseAmount(cell) {
  if (cell == null || cell === '') return 0;
  const s = String(cell).replace(/[$,]/g, '').replace(/\s/g, '').trim();
  if (!s || s === '-' || s === '—') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/** Read uploaded file (xlsx/csv) and pull the first sheet's rows as an array of arrays. */
export async function readSheetRows(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
}

/**
 * Detect format. Don Julio sheets have 2+ "DATE" columns (one per month block).
 * Bank statements have a single date column + a description.
 */
export function detectFormat(rows) {
  if (!rows || rows.length === 0) return 'empty';

  // Find a header row (first row with at least 2 categorizable headers).
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cats = rows[i].map(categorizeHeader).filter(Boolean);
    if (cats.length >= 2) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) return 'unknown';

  const cats = rows[headerRowIdx].map(categorizeHeader);
  const dateCount = cats.filter(c => c === 'DATE').length;
  const platformCount = cats.filter(c => c === 'PLATFORM').length;

  if (dateCount >= 2 || platformCount >= 2) return 'donjulio';
  if (cats.includes('DESCRIPTION') || cats.includes('AMOUNT')) return 'bank';
  return 'unknown';
}

/** Parse the Don Julio multi-block sheet. */
export function parseDonJulio(rows) {
  // Find header row
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cats = rows[i].map(categorizeHeader).filter(Boolean);
    if (cats.length >= 2) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) return [];

  const header = rows[headerRowIdx].map(categorizeHeader);

  // Identify blocks: each block starts at a DATE column.
  // Within a block, look for PLATFORM/AMOUNT pairs and an optional REASON.
  const blocks = [];
  let cur = null;
  for (let i = 0; i < header.length; i++) {
    const cat = header[i];
    if (cat === 'DATE') {
      if (cur) blocks.push(cur);
      cur = { dateCol: i, pairs: [], reasonCol: null };
    } else if (cur && cat === 'PLATFORM') {
      // The next AMOUNT column belongs to this PLATFORM
      const amountCol = i + 1 < header.length && header[i + 1] === 'AMOUNT' ? i + 1 : null;
      if (amountCol != null) cur.pairs.push({ platformCol: i, amountCol });
    } else if (cur && cat === 'REASON') {
      cur.reasonCol = i;
    }
  }
  if (cur) blocks.push(cur);

  const entries = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    for (const block of blocks) {
      const dateStr = parseDate(row[block.dateCol]);
      if (!dateStr) continue;
      const reason = block.reasonCol != null
        ? String(row[block.reasonCol] || '').trim() || 'CREDIT REFILL'
        : 'CREDIT REFILL';

      for (const p of block.pairs) {
        const amount = parseAmount(row[p.amountCol]);
        if (amount <= 0) continue;
        const platformText = String(row[p.platformCol] || '').trim().toUpperCase();
        let platform = null;
        if (['TD', 'TEXTDRIP'].includes(platformText)) platform = 'TD';
        else if (platformText === 'RINGY') platform = 'RINGY';
        else if (['VANILLA', 'VANILLASOFT', 'VS'].includes(platformText)) platform = 'VANILLA';
        else platform = classifyPlatform(platformText);
        if (!platform) continue;

        entries.push({
          id: uid(),
          date: dateStr,
          platform,
          amount,
          reason: reason.toUpperCase(),
          notes: '',
          _source: 'donjulio',
        });
      }
    }
  }
  return entries;
}

/** Parse a bank/credit card statement CSV. */
export function parseBank(rows) {
  // Find header row
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cats = rows[i].map(categorizeHeader).filter(Boolean);
    if (cats.length >= 2) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) return [];

  const cats = rows[headerRowIdx].map(categorizeHeader);
  const dateCol   = cats.indexOf('DATE');
  const descCol   = cats.indexOf('DESCRIPTION');
  const amountCol = cats.indexOf('AMOUNT');

  if (dateCol === -1 || amountCol === -1) return [];

  const entries = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dateStr = parseDate(row[dateCol]);
    if (!dateStr) continue;
    const desc = descCol !== -1 ? String(row[descCol] || '').trim() : '';
    const platform = classifyPlatform(desc);
    if (!platform) continue;
    const amount = parseAmount(row[amountCol]);
    if (amount <= 0) continue;

    entries.push({
      id: uid(),
      date: dateStr,
      platform,
      amount,
      reason: 'CREDIT REFILL',
      notes: desc.slice(0, 80),
      _source: 'bank',
    });
  }
  return entries;
}

/** High-level entrypoint: read a file and return detected entries + format. */
export async function parsePlatformFile(file) {
  const rows = await readSheetRows(file);
  const format = detectFormat(rows);
  let entries = [];
  if (format === 'donjulio') entries = parseDonJulio(rows);
  else if (format === 'bank')      entries = parseBank(rows);
  // sort newest first
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return { format, entries, rowCount: rows.length };
}

/**
 * Dedup against existing expenses. Match key = date|platform|amount.
 * Returns { fresh, duplicate } split.
 */
export function dedupAgainst(newEntries, existingEntries) {
  const seen = new Set(existingEntries.map(e => `${e.date}|${e.platform}|${Number(e.amount)}`));
  const fresh = [];
  const duplicate = [];
  for (const e of newEntries) {
    const k = `${e.date}|${e.platform}|${Number(e.amount)}`;
    if (seen.has(k)) duplicate.push(e);
    else { fresh.push(e); seen.add(k); }
  }
  return { fresh, duplicate };
}
