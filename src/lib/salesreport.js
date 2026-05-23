/**
 * USHA SalesReport (xlsx) importer — treats USHA's own export as ground truth.
 *
 * Input shape: one row per PRODUCT per policy submission. Columns:
 *   AppID | Name | Product | Status | PC | Submit | Effective | Issue | PaidTo | Agent | Premium | Fees | Assoc | Total
 *
 * Premium is ANNUALIZED VALUE (AV) = monthly × 12. The tracker stores monthly.
 *
 * Grouping: rows with the same AppID base (first 10 chars, strip last suffix
 * letter) represent ONE policy submission / deal. E.g., "52Y250222F",
 * "52Y250222G", "52Y250222L" all belong to the same deal.
 *
 * Within a deal:
 *   - Suffix F (or similar) typically carries the main product row.
 *   - G = Critical Illness (MedGuard) add-on.
 *   - L = Dental add-on.
 *   - J = Premier Vision add-on.
 *   - S = Association plan.
 *   - B / C / D = Secure Advantage bundle components (sum into main premium).
 *
 * We collapse each deal into a single tracker-shaped lead record.
 */

import * as XLSX from 'xlsx';
import { nameKey } from './statement';

// ---- product name → internal bucket
const MAIN_PRODUCT_PATTERNS = [
  { re: /^PREMIERADVANTAGE/i, id: 'PREMIER ADVANTAGE' },
  { re: /^PREMIERCHOICE/i,    id: 'PREMIER CHOICE' },
  { re: /^HEALTHACCESS/i,     id: 'HEALTH ACCESS III' },
  { re: /^SECURE ADV SICKNESS/i, id: 'SECURE ADVANTAGE' }, // the "primary" SA row
];

// Products that accumulate INTO the main Secure Advantage bundle premium
const SA_BUNDLE_PATTERNS = [
  /^SECURE ADV SICKNESS/i,
  /^SECURE ADV ACCIDENT/i,
  /^SECADV HLTH WELL PLS/i,
  /^SECADV HLTH PLUS/i,
];

// Products that accumulate INTO the Premier Choice bundle premium
const PC_BUNDLE_PATTERNS = [
  /^PREMIERCHOICE/i,
  /^PREMCH HEALTH WELL/i,
];

// Add-on product patterns → internal add-on ID
const ADDON_PATTERNS = [
  { re: /^CRITICAL ILLNESS/i,            id: 'MEDGUARD III' },
  { re: /^PREMIERVISION/i,               id: 'PREMIERVISION' },
  { re: /^SECUREDENTAL/i,                id: 'DENTAL / SECUREDENTAL' },
  { re: /^HA-SECDENTPLUS/i,              id: 'DENTAL / SECUREDENTAL' },
];

// Association patterns → internal association plan ID
const ASSOC_PATTERNS = [
  { re: /EXECDIAMOND/i, id: 'EXECUTIVE DIAMOND' },
  { re: /^AIBCDIAMOND/i, id: 'DIAMOND' },
  { re: /EMERALD/i,     id: 'EMERALD' },
  { re: /SAPPHIRE/i,    id: 'SAPPHIRE' },
  { re: /RUBY/i,        id: 'RUBY' },
  { re: /ABCELITE/i,         id: 'ABC ELITE' },
  { re: /ABCEXECUTIVE/i,     id: 'ABC EXECUTIVE' },
  { re: /ABCENTREPRENEUR/i,  id: 'ABC ENTREPRENEUR' },
  { re: /^AIBC PRO/i,   id: 'PRO WRAP' },
];

const STATUS_MAP = {
  'In Force':  'Issued',
  'Not Taken': 'Not taken',
  'Declined':  'Declined',
  'Withdrawn': 'Withdrawn',
  'Pending':   'Pending',
  'Canceled':  'Withdrawn', // treat as withdrawn; chargebacks from statement reconcile handle the $ side
};

const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' ');
const money = v => {
  const n = parseFloat(String(v || '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const parseDate = v => {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = (parseInt(yy) > 50 ? '19' : '20') + yy;
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return null;
};

// Convert "LAST, FIRST" → "FIRST LAST"
function flipName(lastFirst) {
  const s = clean(lastFirst);
  const m = s.match(/^([^,]+),\s*(.+)$/);
  if (!m) return s;
  const last = m[1].trim();
  const first = m[2].trim();
  // Title-case the result since source is all-caps
  return (first + ' ' + last)
    .toLowerCase()
    .replace(/\b(\w)/g, c => c.toUpperCase());
}

function matchAddonId(product) {
  for (const p of ADDON_PATTERNS) if (p.re.test(product)) return p.id;
  return null;
}
function matchAssocId(product) {
  for (const p of ASSOC_PATTERNS) if (p.re.test(product)) return p.id;
  return null;
}
function matchMainId(product) {
  for (const p of MAIN_PRODUCT_PATTERNS) if (p.re.test(product)) return p.id;
  return null;
}
function isSABundle(product) { return SA_BUNDLE_PATTERNS.some(re => re.test(product)); }
function isPCBundle(product) { return PC_BUNDLE_PATTERNS.some(re => re.test(product)); }

/**
 * Parse the workbook → array of deals.
 *
 * Two-pass grouping:
 *   Pass 1: group rows by AppID-base. These are the "main deal" groupings
 *           (main product + its directly-related addons share the same base).
 *   Pass 2: for association-only groups (no main product found), attach them
 *           to the customer's nearest-date main deal. That merges AIBC/ABC/SCA
 *           association records (which have a separate AppID family) onto
 *           the correct parent deal.
 */
export function parseSalesReport(wb) {
  const sheetName = wb.SheetNames.find(n => /sales\s*report/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { deals: [], allRows: 0 };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

  const byDeal = new Map(); // key: name|appIdBase → deal
  let allRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const appId = clean(r[0]);
    const rawName = clean(r[1]);
    const product = clean(r[2]);
    const status = clean(r[3]);
    const submitDate = parseDate(r[5]);
    const effDate = parseDate(r[6]);
    const issueDate = parseDate(r[7]);
    const agentName = clean(r[9]);
    const premiumAV = money(r[10]);
    const assocPremiumAV = money(r[12]);

    if (!appId || !rawName) continue;
    allRows++;

    const base = appId.length > 1 ? appId.slice(0, -1) : appId;
    const key = `${nameKey(rawName)}|${base}`;
    if (!byDeal.has(key)) {
      byDeal.set(key, {
        appIdBase: base,
        nameKey: nameKey(rawName),
        name: flipName(rawName),
        agent: agentName,
        mainProduct: '',
        mainMonthlyPremium: 0,
        associationPlan: '',
        associationMonthlyPremium: 0,
        addons: [],
        stageVotes: {},
        mainRowStatus: null,
        submitDate: null,
        effDate: null,
        issueDate: null,
        policyNumbers: [],
        _debug: [],
      });
    }
    const deal = byDeal.get(key);
    deal.policyNumbers.push(appId);
    if (submitDate && (!deal.submitDate || submitDate < deal.submitDate)) deal.submitDate = submitDate;
    if (effDate && (!deal.effDate || effDate > deal.effDate)) deal.effDate = effDate;
    if (issueDate && (!deal.issueDate || issueDate > deal.issueDate)) deal.issueDate = issueDate;
    deal.stageVotes[status] = (deal.stageVotes[status] || 0) + 1;

    const mainId = matchMainId(product);
    const addonId = matchAddonId(product);
    const assocId = matchAssocId(product);

    if (isSABundle(product)) {
      if (!deal.mainProduct) deal.mainProduct = 'SECURE ADVANTAGE';
      if (/SICKNESS/i.test(product)) deal.mainRowStatus = status;
      deal.mainMonthlyPremium += premiumAV / 12;
    } else if (isPCBundle(product)) {
      if (!deal.mainProduct) deal.mainProduct = 'PREMIER CHOICE';
      if (/^PREMIERCHOICE/i.test(product)) deal.mainRowStatus = status;
      deal.mainMonthlyPremium += premiumAV / 12;
    } else if (mainId) {
      if (!deal.mainProduct) { deal.mainProduct = mainId; deal.mainRowStatus = status; }
      deal.mainMonthlyPremium += premiumAV / 12;
    } else if (addonId) {
      deal.addons.push({ id: addonId, monthlyPremium: premiumAV / 12, rawProduct: product });
    } else if (assocId) {
      deal.associationPlan = assocId;
      deal.associationMonthlyPremium = (assocPremiumAV > 0 ? assocPremiumAV : premiumAV) / 12;
    } else if (/S$/i.test(appId)) {
      // Unmapped product, but the AppID ends in 'S' — USHA's strong
      // convention for an association-tier row (associations ship in a
      // separate AppID family from the main policy, e.g. 72D…S vs 52Z…J).
      // Mark as an association orphan so Pass 2 still merges it onto the
      // customer's main deal instead of leaking out as a duplicate lead.
      deal.associationPlan = product || 'OTHER';
      deal.associationMonthlyPremium = (assocPremiumAV > 0 ? assocPremiumAV : premiumAV) / 12;
      deal._debug.push(`Inferred-as-association by AppID-S: "${product}" at ${appId}`);
    } else {
      deal._debug.push(`UNMAPPED "${product}" at ${appId}`);
    }
  }

  // Pass 2: merge orphan groups (no main product) into the customer's
  // nearest main deal. Two flavors:
  //   - orphanAssociations: recognized as association rows (associationPlan
  //     set, either via product pattern or AppID-S fallback). Carry their
  //     plan + premium onto the target.
  //   - orphanNoMain: neither mainProduct nor associationPlan recognized —
  //     stragglers from unfamiliar product strings. Still attach their
  //     policyNumbers to the customer's main deal so they don't surface as
  //     duplicate, empty-looking leads.
  // Helper: pick the candidate main deal with the closest submit date.
  const pickClosest = (orphan, candidates) => {
    candidates.sort((a, b) => {
      const diffA = Math.abs(new Date(a.submitDate || '1970-01-01') - new Date(orphan.submitDate || '1970-01-01'));
      const diffB = Math.abs(new Date(b.submitDate || '1970-01-01') - new Date(orphan.submitDate || '1970-01-01'));
      return diffA - diffB;
    });
    return candidates[0];
  };

  const deals = [];
  const orphanAssociations = [];
  const orphanNoMain = [];
  for (const d of byDeal.values()) {
    if (d.mainProduct) deals.push(d);
    else if (d.associationPlan) orphanAssociations.push(d);
    else orphanNoMain.push(d);
  }

  for (const orphan of orphanAssociations) {
    const candidates = deals.filter(d => d.nameKey === orphan.nameKey && d.mainProduct);
    if (candidates.length === 0) {
      // No main deal for this customer — keep orphan as its own entry
      deals.push(orphan);
      continue;
    }
    const target = pickClosest(orphan, candidates);
    if (!target.associationPlan) {
      target.associationPlan = orphan.associationPlan;
      target.associationMonthlyPremium = orphan.associationMonthlyPremium;
    }
    target.policyNumbers.push(...orphan.policyNumbers);
  }

  for (const orphan of orphanNoMain) {
    const candidates = deals.filter(d => d.nameKey === orphan.nameKey && d.mainProduct);
    if (candidates.length === 0) {
      // Truly standalone — keep as-is so we don't silently drop data.
      deals.push(orphan);
      continue;
    }
    const target = pickClosest(orphan, candidates);
    target.policyNumbers.push(...orphan.policyNumbers);
    target._debug.push(...orphan._debug);
  }

  // Finalize stages
  for (const d of deals) {
    let chosenStatus = d.mainRowStatus;
    if (!chosenStatus) {
      chosenStatus = Object.entries(d.stageVotes).sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    d.stage = STATUS_MAP[chosenStatus] || 'Pending';
    d.closedDate = d.submitDate || d.effDate || d.issueDate;
  }

  return { deals, allRows };
}

/**
 * Compare parsed deals to existing tracker leads.
 * Returns diffs: missing (in report, not in tracker), mismatched (stage or product differs),
 * and extras (in tracker, not in report).
 */
export function gapDetect(deals, leads) {
  // Index existing tracker leads by policy number (primary) and name (fallback).
  //
  // CRITICAL: A lead's policyNumber field can hold multiple comma-joined IDs
  // (e.g. "52Y2502220, 52Y250222F") when one customer has multiple policies —
  // dealToLead() does this on import. Split on commas/pipes/whitespace so
  // EVERY individual policyId routes back to the same lead. Without this,
  // re-uploading the same SalesReport creates duplicates because the next
  // gapDetect can't match its single-policyId deals against the joined-string
  // lead.policyNumber.
  const leadsByPolicy = new Map();
  const leadsByName = new Map();
  for (const l of leads) {
    if (l.policyNumber) {
      const ids = String(l.policyNumber)
        .split(/[,;|\s]+/)
        .map(p => p.trim().toUpperCase())
        .filter(Boolean);
      for (const pid of ids) {
        if (!leadsByPolicy.has(pid)) leadsByPolicy.set(pid, l);
      }
    }
    const nk = nameKey(l.name);
    if (nk) {
      if (!leadsByName.has(nk)) leadsByName.set(nk, []);
      leadsByName.get(nk).push(l);
    }
  }

  const missing = [];
  const mismatched = [];
  const matchedLeadIds = new Set();

  for (const d of deals) {
    // Try to match by any of this deal's policy numbers first.
    // Uppercase to match the index, since OCR sometimes flips case.
    let matchedLead = null;
    for (const pid of d.policyNumbers) {
      const norm = String(pid || '').trim().toUpperCase();
      if (leadsByPolicy.has(norm)) {
        matchedLead = leadsByPolicy.get(norm);
        break;
      }
    }
    // If no policy match, try name + product match (when same customer has multiple policies,
    // pick the one with same main product; otherwise pick first by name)
    if (!matchedLead) {
      const candidates = leadsByName.get(d.nameKey) || [];
      matchedLead = candidates.find(l => l.mainProduct === d.mainProduct) || candidates[0] || null;
    }

    if (!matchedLead) {
      missing.push(d);
    } else {
      matchedLeadIds.add(matchedLead.id);
      // Check for mismatches
      const issues = [];
      if (matchedLead.stage !== d.stage) {
        issues.push({ kind: 'stage', current: matchedLead.stage, expected: d.stage });
      }
      if (matchedLead.mainProduct !== d.mainProduct && d.mainProduct) {
        issues.push({ kind: 'mainProduct', current: matchedLead.mainProduct, expected: d.mainProduct });
      }
      if (issues.length > 0) {
        mismatched.push({ deal: d, lead: matchedLead, issues });
      }
    }
  }

  // Extras: tracker leads not represented in the SalesReport
  const extras = leads.filter(l => !matchedLeadIds.has(l.id));

  return { missing, mismatched, extras };
}

/**
 * Build a tracker-shaped lead from a SalesReport deal.
 * Optionally merge in cost data from a BOUGHT-style map (keyed by nameKey).
 */
export function dealToLead(deal, mkLead, boughtCostMap = null) {
  const lead = mkLead({
    name: deal.name,
    source: 'CRM',
    stage: deal.stage,
    owner: 'Me',
    policyNumber: deal.policyNumbers.join(', '),
    notes: `Imported from SalesReport · policies: ${deal.policyNumbers.join(', ')}`,
    dateAdded: deal.submitDate || deal.closedDate,
    closedDate: deal.closedDate,
    lastTouch: deal.closedDate,
    // SalesReport (USHA portal export) doesn't carry CRM / Campaign
    // info, so leave these blank instead of fabricating defaults the
    // user didn't pick. They can fill these in via Closed Deals
    // inline edit or the lead form.
    crm: '',
    campaign: '',
    leadCategory: '',
    leadCost: 0,
    dealValue: 0,
    mainProduct: deal.mainProduct,
    mainProductPremium: Math.round(deal.mainMonthlyPremium * 100) / 100,
    associationPlan: deal.associationPlan,
    associationStartDate: deal.stage === 'Issued' ? (deal.effDate || deal.closedDate) : null,
    advanceMonths: 7.5,
    products: deal.addons.map(a => ({ id: a.id, premium: Math.round(a.monthlyPremium * 100) / 100 })),
  });

  // If BOUGHT map has this customer, pull in leadCost + campaign + crm
  if (boughtCostMap) {
    const key = deal.nameKey;
    if (boughtCostMap[key]) {
      const b = boughtCostMap[key];
      if (b.leadCost) lead.leadCost = b.leadCost;
      if (b.campaign) lead.campaign = b.campaign;
      if (b.crm)      lead.crm = b.crm;
      if (b.dateAdded) lead.dateAdded = b.dateAdded;
    }
  }
  return lead;
}
