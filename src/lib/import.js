/**
 * Spreadsheet → Tracker lead import.
 *
 * Supports the "USHA preset" — an xlsx with sheets named
 * "2026 PORTAL CLIENTS" and "BOUGHT LEAD TRACKER" that we join by name.
 */

import * as XLSX from 'xlsx';
import { uid, today } from './utils';
import { mkLead } from './seed';
import { nameKey as fuzzyNameKey } from './statement';

export const USHA_SHEET_PORTAL = '2026 PORTAL CLIENTS';
export const USHA_SHEET_BOUGHT = 'BOUGHT LEAD TRACKER';

/** Read an uploaded File into a parsed XLSX workbook. */
export async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array' });
}

/** Find a sheet by fuzzy match (case-insensitive, whitespace-insensitive, partial ok). */
export function findSheet(wb, ...keywords) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (const name of wb.SheetNames) {
    const n = norm(name);
    if (keywords.every(k => n.includes(norm(k)))) return name;
  }
  return null;
}

/** True when both USHA preset sheets can be found (fuzzy match). */
export function hasUshaPreset(wb) {
  return !!findSheet(wb, 'portal', 'client') && !!findSheet(wb, 'bought', 'lead');
}

/** Resolve the actual sheet names used in this workbook (fuzzy). */
export function resolveUshaSheets(wb) {
  return {
    portal: findSheet(wb, 'portal', 'client'),
    bought: findSheet(wb, 'bought', 'lead'),
  };
}

/** Normalize a raw cell string. */
const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const cleanMulti = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' ');

/** Parse currency-ish strings: "$591.71", "(1,200.00)" → 591.71, -1200.00 */
export function parseCurrency(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, (x) => (x === '(' ? '-' : ''));
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Parse dates like "1/5/2026", "01/05/26", "2026-01-05" → ISO yyyy-mm-dd. */
export function parseDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // m/d/yy or m/d/yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = (parseInt(yy) > 50 ? '19' : '20') + yy;
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  // Excel serial date number
  const n = Number(s);
  if (Number.isFinite(n) && n > 10000 && n < 80000) {
    const ms = (n - 25569) * 86400 * 1000; // Excel epoch
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

/** Skip rows that are section headers / dividers, not real leads. */
const MONTH_NAMES = new Set(['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']);
const SKIP_NAMES  = new Set([
  ...MONTH_NAMES, 'UNDERWRITTEN', 'BOOK OF BUSINESS 2026', 'NAME',
  'TAKEN RATE', 'TOTAL', 'MONTH TOTALS',
  // Sub-section labels observed in real USHA spreadsheets
  "HA'S", 'HAS', 'ACA WRAP', 'ACA', 'GI', 'UW', 'OTHERS',
]);
function isSkipRow(name) {
  const u = String(name || '').toUpperCase().trim();
  if (!u) return true;
  if (SKIP_NAMES.has(u)) return true;
  if (u.startsWith('IF NUMBER')) return true;
  return false;
}

/**
 * Stronger heuristic used after the name-check: a real lead row should have
 * SOME contact info (phone or email) OR a policy number. Anything with all
 * three blank is a divider/header — safe to skip.
 */
function isDividerRow(phone, email, policyNo) {
  return !phone && !email && !policyNo;
}

/**
 * Normalize POLICY STATUS + UW STATUS cells → tracker stage.
 *
 * Rules (priority top → down):
 *   1. POLICY STATUS is the final outcome; use it first.
 *        PAID / APPROVED / P NOTE  → Issued
 *        WITHDRAWN                 → Withdrawn
 *        DECLINED                  → Declined
 *        NOT TAKEN                 → Not taken
 *   2. If POLICY STATUS is blank, fall back to UW STATUS.
 *        APPROVED                  → Issued  (per user: underwriting-approved = issued)
 *        DECLINE / DECLINED        → Declined
 *        WITHDRAWN                 → Withdrawn
 *        PENDING                   → Submitted
 *   3. Both blank → Submitted (still waiting on underwriting).
 */
export function normalizeStage(policyStatus, uwStatus) {
  const ps = String(policyStatus || '').toUpperCase().trim();
  const uw = String(uwStatus || '').toUpperCase().trim();

  if (ps === 'PAID' || ps === 'APPROVED' || ps === 'P NOTE') return 'Issued';
  if (ps === 'WITHDRAWN') return 'Withdrawn';
  if (ps === 'DECLINED')  return 'Declined';
  if (ps === 'NOT TAKEN') return 'Not taken';

  if (uw === 'APPROVED')                      return 'Issued';
  if (uw === 'DECLINE' || uw === 'DECLINED')  return 'Declined';
  if (uw === 'WITHDRAWN')                     return 'Withdrawn';
  if (uw === 'PENDING')                       return 'Pending';

  return 'Pending';
}

/** Main Product name normalization — matches common abbreviations too. */
export function normalizeMainProduct(raw) {
  const u = String(raw || '').toUpperCase().trim();
  // Full names
  if (u === 'PREMIER ADVANTAGE')  return 'PREMIER ADVANTAGE';
  if (u === 'PREMIER CHOICE')     return 'PREMIER CHOICE';
  if (u === 'SECURE ADVANTAGE')   return 'SECURE ADVANTAGE';
  if (u === 'HEALTH ACCESS' || u === 'HEALTH ACCESS III') return 'HEALTH ACCESS III';
  if (u === 'ACA WRAP')           return 'ACA WRAP';
  if (u === 'SUPPY')              return 'SUPPY';
  // Abbreviations commonly seen in agent spreadsheets
  if (u === 'PREMIER ADV' || u === 'PREM ADV' || u === 'PA')       return 'PREMIER ADVANTAGE';
  if (u === 'SECURE ADV'  || u === 'SEC ADV'  || u === 'SA')       return 'SECURE ADVANTAGE';
  if (u === 'PREMIER CHO' || u === 'PREM CHOICE' || u === 'PC')    return 'PREMIER CHOICE';
  if (u === 'HA' || u === 'HA III' || u === 'HEALTH ACC')          return 'HEALTH ACCESS III';
  if (u === 'ACA')                                                 return 'ACA WRAP';
  return ''; // unknown → leave blank
}

/** Association Plan name normalization. */
export function normalizeAssociation(raw) {
  const u = String(raw || '').toUpperCase().trim();
  const known = [
    'EXECUTIVE DIAMOND', 'DIAMOND', 'EMERALD', 'SAPPHIRE', 'RUBY',
    'PEARL', 'NO ASS.', 'ABC ELITE', 'ABC EXECUTIVE', 'ABC ENTREPRENEUR',
    'SUPPY', 'PRO WRAP',
  ];
  if (known.includes(u)) return u;
  // Common variants
  if (u === 'HA ELITE')        return 'ABC ELITE';
  if (u === 'HA EXECUTIVE')    return 'ABC EXECUTIVE';
  if (u === 'HA ENTREPRENEUR') return 'ABC ENTREPRENEUR';
  if (u === 'NO ASSOCIATION' || u === 'NONE' || u === 'NO ASS') return 'NO ASS.';
  return '';
}

export function normalizeCrm(raw) {
  const u = String(raw || '').toUpperCase().trim();
  if (['RINGY', 'TEXTDRIP', 'VANILLA', 'GOOGLE'].includes(u)) return u;
  return 'RINGY';
}

export function normalizeCategory(raw) {
  const u = String(raw || '').toUpperCase().trim();
  const known = ['AGED', 'SHARED', 'REFERRAL', 'DIALER', 'REPEAT CLIENT', 'JACKPOT', 'D7', 'GOOGLE LEADS'];
  if (known.includes(u)) return u;
  return 'AGED';
}

export function normalizeCampaign(raw) {
  const u = String(raw || '').toUpperCase().trim();
  const known = [
    'AGED.50','AGED.25','AGED.35','AGED1.00','AGED.20','AGED.15','AGED.17',
    'PREMIUM SHARED','STANDARD SHARED','HIGH EXCLUSIVE','ELITE EXCLUSIVE',
    'D7 BIZZ LEAD','JESUS BURGA LEADS',
  ];
  if (known.includes(u)) return u;
  return 'AGED.25';
}

/**
 * Parse PORTAL CLIENTS rows into partial lead objects.
 * Column indexes based on observed layout (A=0 ... T=19).
 */
function parsePortalSheet(wb) {
  const sheetName = findSheet(wb, 'portal', 'client');
  const ws = sheetName ? wb.Sheets[sheetName] : null;
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

  const leads = [];
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    const name = cleanMulti(r[0]);
    if (isSkipRow(name)) continue;

    const policyNo = clean(r[9]);
    const phone = clean(r[3]);
    const email = clean(r[4]);
    // Any row with no phone, email, OR policy number is a section divider in
    // disguise (e.g. "HA's", "ACA Wrap", sub-headers). Skip them.
    if (isDividerRow(phone, email, policyNo)) continue;

    const notes = [cleanMulti(r[14]), policyNo ? `Policy ${policyNo}` : ''].filter(Boolean).join(' · ');

    // Age — column B. USHA rule: over-50 declines are excluded from Taken Rate.
    const ageRaw = clean(r[1]);
    const age = ageRaw && !Number.isNaN(parseInt(ageRaw, 10)) ? parseInt(ageRaw, 10) : 0;

    leads.push({
      // Key is POLICY NUMBER when available (unique per policy row), falling
      // back to name + row index. This lets one client have multiple policies
      // (each a distinct lead) without them overwriting each other.
      _rowKey: policyNo ? `policy:${policyNo}` : `name-row:${name.toLowerCase()}:${i}`,
      _nameKey: fuzzyNameKey(name), // for BOUGHT lookup (strips middle initials, suffixes)
      policyNumber: policyNo,
      name,
      age,
      state: clean(r[2]),
      phone,
      email,
      closedDate: parseDate(r[5]),
      associationStartDate: parseDate(r[6]),
      associationPlan: normalizeAssociation(r[8]),
      mainProduct: normalizeMainProduct(r[10]),
      leadCategory: normalizeCategory(r[11]),
      crm: normalizeCrm(r[12]),
      notes,
      stage: normalizeStage(r[16], r[15]),
      mainProductPremium: parseCurrency(r[18]),
    });
  }
  return leads;
}

/**
 * Parse BOUGHT LEAD TRACKER rows → { nameKey → {leadCost, dealValue, campaign, crm, dateAdded} }
 * Column indexes: A(0)=NAME, C(2)=MONTH SOLD, D(3)=DAY PURCHASED, E(4)=DATE SOLD,
 *                 F(5)=CRM, G(6)=CAMPAIGN, H(7)=PRICE, I(8)=COMMISSION
 */
function parseBoughtSheet(wb) {
  const sheetName = findSheet(wb, 'bought', 'lead');
  const ws = sheetName ? wb.Sheets[sheetName] : null;
  if (!ws) return {};
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const byName = {};
  for (let i = 5; i < rows.length; i++) {
    const r = rows[i];
    const name = cleanMulti(r[0]);
    if (isSkipRow(name)) continue;
    // Real BOUGHT rows always have at least a price (r[7]) OR commission (r[8])
    // OR a date. Rows with nothing but a name are sub-section dividers.
    const price = clean(r[7]);
    const commission = clean(r[8]);
    const dateSold = clean(r[4]);
    if (!price && !commission && !dateSold) continue;
    const key = fuzzyNameKey(name);
    // Title-case the raw name so BOUGHT-only rows render nicely:
    // "donna swanson" → "Donna Swanson". If already mixed case, leave it.
    const titled = /[a-z]/.test(name) && /[A-Z]/.test(name)
      ? name
      : name.toLowerCase().replace(/\b(\w)/g, c => c.toUpperCase());
    // Prefer the last record per name (most recent edits, often more complete)
    byName[key] = {
      name: titled,
      dateAdded: parseDate(r[3]),
      closedDate: parseDate(r[4]),
      crm: normalizeCrm(r[5]),
      campaign: normalizeCampaign(r[6]),
      leadCost: parseCurrency(r[7]),
      dealValue: parseCurrency(r[8]),
    };
  }
  return byName;
}

/**
 * Merge both sheets into one array of partial leads.
 *
 * Key insight: each PORTAL row = one policy = one distinct lead. A single
 * customer can have MULTIPLE policies (e.g., declined on one plan, later
 * approved on another). So we key PORTAL rows by `_rowKey` (policy number
 * when available, row-index fallback) — never by name, which would lose
 * duplicate-name rows.
 *
 * BOUGHT attaches to the FIRST matching PORTAL lead by customer name (one
 * lead-purchase pays for one deal; if a client has multiple policies from
 * the same lead buy, cost belongs to the first). BOUGHT-only names become
 * their own leads (stage = Issued per user: all bought-and-closed).
 */
function mergeSources(portalLeads, boughtByName) {
  const merged = [];                 // array of partial leads
  const boughtUsed = new Set();      // which BOUGHT nameKeys are already attached
  const stats = { total: 0, fromBoth: 0, portalOnly: 0, boughtOnly: 0, byStage: {}, sample: [] };

  // Seed with every PORTAL row
  for (const p of portalLeads) {
    const b = boughtByName[p._nameKey];
    let _source = 'portal';
    let _bought = null;
    if (b && !boughtUsed.has(p._nameKey)) {
      _bought = b;
      boughtUsed.add(p._nameKey);
      _source = 'both';
    }
    merged.push({ ...p, _source, _bought });
  }

  // Any BOUGHT name we didn't attach above → its own lead
  for (const [key, b] of Object.entries(boughtByName)) {
    if (boughtUsed.has(key)) continue;
    merged.push({
      _rowKey: `bought:${key}`,
      _nameKey: key,
      name: b.name || key.replace(/\b\w/g, c => c.toUpperCase()),
      stage: 'Issued',
      _source: 'bought',
      _bought: b,
    });
  }

  // Stats
  for (const m of merged) {
    stats.total += 1;
    if (m._source === 'both') stats.fromBoth += 1;
    else if (m._source === 'portal') stats.portalOnly += 1;
    else if (m._source === 'bought') stats.boughtOnly += 1;
    stats.byStage[m.stage] = (stats.byStage[m.stage] || 0) + 1;
  }

  return { merged, stats };
}

/**
 * Build final Lead objects by joining both sheets.
 * Returns { leads, stats }.
 */
export function buildImportFromUsha(wb, { batchId, tier = 'WA' } = {}) {
  const portalLeads = parsePortalSheet(wb);
  const boughtByName = parseBoughtSheet(wb);
  const { merged, stats } = mergeSources(portalLeads, boughtByName);

  const leads = merged.map(m => {
    const b = m._bought;
    const dateAdded = b?.dateAdded || m.closedDate || today();
    const closedDate = m.closedDate || b?.closedDate || dateAdded;
    return mkLead({
      name: m.name,
      age: m.age || 0,
      email: m.email || '',
      phone: m.phone || '',
      state: m.state || '',
      source: 'CRM',
      stage: m.stage,
      owner: 'Me',
      notes: m.notes || '',
      dateAdded,
      closedDate,
      lastTouch: closedDate,
      crm: b?.crm || m.crm || 'RINGY',
      campaign: b?.campaign || 'AGED.25',
      leadCategory: m.leadCategory || 'AGED',
      leadCost: b?.leadCost ?? 0,
      dealValue: b?.dealValue ?? 0,
      mainProduct: m.mainProduct || '',
      mainProductPremium: m.mainProductPremium || 0,
      associationPlan: m.associationPlan || '',
      associationStartDate: m.associationStartDate || closedDate,
      advanceMonths: 7.5,
      importBatchId: batchId,
      importedAt: new Date().toISOString(),
    });
  });

  return { leads, stats };
}

/**
 * Backfill mode — don't create new leads, just patch missing fields
 * (age, state, leadCost, mainProductPremium, notes) on leads already in
 * the tracker. Matches by policy number (primary) or name (fallback).
 *
 * Returns { updates, stats } where `updates` is an array of
 * { leadId, patch } describing what to merge into each existing lead.
 */
export function buildBackfillFromUsha(wb, existingLeads) {
  const portalLeads = parsePortalSheet(wb);
  const boughtByName = parseBoughtSheet(wb);

  // Index existing leads by policy number, then by name
  const leadsByPolicy = new Map();
  const leadsByName = new Map();
  for (const l of existingLeads) {
    if (l.policyNumber) leadsByPolicy.set(l.policyNumber, l);
    const k = fuzzyNameKey(l.name || '');
    if (k) {
      if (!leadsByName.has(k)) leadsByName.set(k, []);
      leadsByName.get(k).push(l);
    }
  }

  const updates = [];
  const stats = { matched: 0, skipped: 0, portalOnly: 0 };

  for (const p of portalLeads) {
    // Prefer policy number match, fallback to name
    let lead = null;
    if (p.policyNumber && leadsByPolicy.has(p.policyNumber)) {
      lead = leadsByPolicy.get(p.policyNumber);
    } else {
      const candidates = leadsByName.get(p._nameKey) || [];
      // If multiple leads share the name, prefer one whose main product matches
      lead = candidates.find(l => l.mainProduct === p.mainProduct) || candidates[0] || null;
    }
    if (!lead) { stats.skipped += 1; continue; }
    stats.matched += 1;

    const b = boughtByName[p._nameKey];
    const patch = {};
    // Only fill in fields that are empty/default on the existing lead
    if ((!lead.age || lead.age === 0) && p.age) patch.age = p.age;
    if (!lead.state && p.state) patch.state = p.state;
    if (!lead.phone && p.phone) patch.phone = p.phone;
    if (!lead.email && p.email) patch.email = p.email;
    if ((!lead.mainProductPremium || lead.mainProductPremium === 0) && p.mainProductPremium) patch.mainProductPremium = p.mainProductPremium;
    if ((!lead.leadCost || lead.leadCost === 0) && b?.leadCost) patch.leadCost = b.leadCost;
    if ((!lead.dealValue || lead.dealValue === 0) && b?.dealValue) patch.dealValue = b.dealValue;
    if (!lead.associationStartDate && p.associationStartDate) patch.associationStartDate = p.associationStartDate;
    if ((!lead.notes || !lead.notes.trim()) && p.notes) patch.notes = p.notes;

    if (Object.keys(patch).length > 0) updates.push({ leadId: lead.id, patch });
  }

  return { updates, stats };
}

/** Dry-preview for the UI: same merge logic, plus sample rows. */
export function previewImportFromUsha(wb) {
  const portalLeads = parsePortalSheet(wb);
  const boughtByName = parseBoughtSheet(wb);
  const { merged, stats } = mergeSources(portalLeads, boughtByName);

  stats.sample = merged.slice(0, 5).map(m => ({
    name: m.name,
    stage: m.stage,
    mainProduct: m.mainProduct || '',
    premium: m.mainProductPremium || 0,
    assoc: m.associationPlan || '',
    source: m._source,
    bought: m._bought ? { cost: m._bought.leadCost, commission: m._bought.dealValue } : null,
  }));
  return stats;
}

/* ======================================================================
   GENERIC MAPPER — fallback for spreadsheets that don't follow the USHA
   preset (single sheet, custom columns, agent's own "book of business"
   format). Same UX as the prospect import wizard: read first sheet,
   detect headers automatically, let the user remap, build leads.
   ====================================================================== */

// Maps free-form header strings to canonical Lead field keys.
// Order matters — more specific patterns first.
const LEAD_HEADER_MAP = [
  { keys: [/^name$/i, /full\s*name/i, /^client$/i, /customer/i], field: 'name' },
  { keys: [/policy\s*(no|num|number|#)/i, /^policy$/i], field: 'policyNumber' },
  { keys: [/phone/i, /^cell$/i, /mobile/i, /^tel/i], field: 'phone' },
  { keys: [/^e-?mail$/i, /email/i], field: 'email' },
  { keys: [/^state$/i, /^st$/i], field: 'state' },
  { keys: [/^age$/i], field: 'age' },
  { keys: [/^zip/i], field: 'zip' },
  { keys: [/main\s*product/i, /product/i, /^plan$/i, /coverage/i], field: 'mainProduct' },
  { keys: [/association/i, /assoc/i], field: 'associationPlan' },
  { keys: [/monthly\s*premium/i, /premium/i], field: 'mainProductPremium' },
  { keys: [/policy\s*status/i, /^status$/i, /^stage$/i], field: 'policyStatus' },
  { keys: [/uw\s*status/i, /underwriting/i], field: 'uwStatus' },
  { keys: [/(close|sold|issued|app(lication)?)\s*date/i, /^date\s*sold$/i, /effective\s*date/i], field: 'closedDate' },
  { keys: [/(association|assoc)\s*start/i], field: 'associationStartDate' },
  { keys: [/lead\s*cost/i, /^cost$/i, /lead\s*price/i], field: 'leadCost' },
  { keys: [/deal\s*value/i, /commission/i, /advance/i], field: 'dealValue' },
  { keys: [/lead\s*category/i, /^category$/i, /^type$/i], field: 'leadCategory' },
  { keys: [/^crm$/i], field: 'crm' },
  { keys: [/campaign/i], field: 'campaign' },
  { keys: [/^source$/i, /lead\s*from/i], field: 'source' },
  { keys: [/^owner$/i, /agent/i], field: 'owner' },
  { keys: [/notes/i, /comments/i, /situation/i], field: 'notes' },
];

export function detectLeadFieldFromHeader(header) {
  const s = String(header || '').trim();
  if (!s) return null;
  for (const { keys, field } of LEAD_HEADER_MAP) {
    if (keys.some(re => re.test(s))) return field;
  }
  return null;
}

/**
 * Find the row in a workbook sheet that's most likely the header row by
 * counting how many cells in it look like recognized lead-field headers.
 * Returns { idx, headers, rows }.
 */
export function readSheetForGenericImport(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { idx: -1, headers: [], rows: [] };
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  if (!data.length) return { idx: -1, headers: [], rows: [] };

  let bestIdx = 0, bestScore = -1;
  for (let i = 0; i < Math.min(data.length, 12); i++) {
    const row = data[i] || [];
    let score = 0;
    for (const cell of row) if (detectLeadFieldFromHeader(cell)) score++;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  if (bestScore <= 0) {
    // Fallback: first non-empty row
    for (let i = 0; i < Math.min(data.length, 6); i++) {
      if (data[i].some(c => String(c || '').trim())) { bestIdx = i; break; }
    }
  }
  const headers = (data[bestIdx] || []).map(c => String(c || '').trim());
  const rows = data.slice(bestIdx + 1).filter(r => r.some(c => String(c || '').trim()));
  return { idx: bestIdx, headers, rows };
}

/**
 * Build leads from a generic mapping.
 *   wb         the workbook
 *   sheetName  the sheet to read
 *   mapping    { [colIdx]: 'name' | 'phone' | ... }
 *   defaults   tracker-required fallbacks (crm, source, leadCategory, etc.)
 *   batchId    string for undo grouping
 */
export function buildImportFromGeneric(wb, sheetName, mapping, defaults = {}, batchId = `batch_${uid()}`) {
  const { rows } = readSheetForGenericImport(wb, sheetName);
  const leads = [];
  let skipped = 0;

  for (const row of rows) {
    const raw = {};
    for (const [colIdxStr, field] of Object.entries(mapping)) {
      if (!field) continue;
      const v = row[Number(colIdxStr)];
      if (v == null || v === '') continue;
      raw[field] = String(v).trim();
    }
    // Skip rows with no name AND no policy AND no phone — almost certainly a divider
    if (!raw.name && !raw.policyNumber && !raw.phone) { skipped++; continue; }
    if (raw.name && isSkipRow(raw.name)) { skipped++; continue; }

    const stage = normalizeStage(raw.policyStatus, raw.uwStatus);
    const lead = mkLead({
      _batchId: batchId,
      name: raw.name || '',
      age: raw.age ? parseInt(raw.age, 10) || 0 : 0,
      email: raw.email || '',
      phone: raw.phone || '',
      state: raw.state || '',
      stage,
      policyNumber: raw.policyNumber || '',
      mainProduct: raw.mainProduct ? normalizeMainProduct(raw.mainProduct) : (defaults.mainProduct || ''),
      mainProductPremium: raw.mainProductPremium ? parseCurrency(raw.mainProductPremium) : 0,
      associationPlan: raw.associationPlan ? normalizeAssociation(raw.associationPlan) : '',
      associationStartDate: parseDate(raw.associationStartDate) || null,
      closedDate: parseDate(raw.closedDate) || (stage === 'Issued' ? today() : null),
      leadCost: raw.leadCost ? parseCurrency(raw.leadCost) : 0,
      dealValue: raw.dealValue ? parseCurrency(raw.dealValue) : 0,
      leadCategory: raw.leadCategory ? normalizeCategory(raw.leadCategory) : (defaults.leadCategory || 'AGED'),
      crm: raw.crm ? normalizeCrm(raw.crm) : (defaults.crm || 'RINGY'),
      campaign: raw.campaign ? normalizeCampaign(raw.campaign) : (defaults.campaign || 'AGED.25'),
      source: raw.source || defaults.source || 'CRM',
      owner: raw.owner || defaults.owner || 'You',
      notes: raw.notes || '',
      dateAdded: parseDate(raw.closedDate) || today(),
    });
    leads.push(lead);
  }

  return {
    leads,
    stats: {
      total: leads.length,
      skipped,
      byStage: leads.reduce((acc, l) => { acc[l.stage] = (acc[l.stage] || 0) + 1; return acc; }, {}),
    },
  };
}
