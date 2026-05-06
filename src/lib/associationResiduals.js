/**
 * Association Bonus residual tracking.
 *
 * Parses USHA's CommissionDetail.csv (one row per active subscription
 * × per production month), extracts only the Association Bonus rows,
 * derives this agent's effective per-tier rate from observed payouts,
 * and aggregates the active subscriber book.
 *
 * The data model is intentionally isolated from the rest of PRIM:
 *   - Lives in storage keys `association_bonus_detail_v1` (the rows)
 *     and `agent_residual_rates_v1` (the derived rate table).
 *   - Never touches leads, advances, books expenses, or platform spend.
 *   - Provides agent-tier-aware rates that any other view can query
 *     via getAgentResidualRate(planId, rates).
 *
 * Re-importing the same file is idempotent thanks to the policyId +
 * appliedDate composite key. A March file uploaded after the April
 * file simply adds new period rows; nothing collides.
 */

import { productCodeToPlanId, ASSOCIATION_PRICING } from './constants';

// ---------- CSV parser (RFC-4180 lite) ----------

/**
 * Tiny CSV parser that handles quoted fields, escaped double-quotes,
 * embedded commas, and \r\n / \n line endings. Good enough for USHA's
 * CommissionDetail format (which is a clean export, not user-typed).
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue; // ignore — \n handles the line break
    if (c === '\n') {
      row.push(field);
      field = '';
      // Skip blank lines
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  // Final row (no trailing newline)
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

// ---------- Date helpers ----------

// Parse "M/D/YYYY" → "YYYY-MM-DD" (zero-padded). Returns null on failure.
function usDateToIso(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

// "Apr-26" → "2026-04". Returns null if it doesn't look like a short-month.
function shortMonthToIso(s) {
  if (!s || typeof s !== 'string') return null;
  const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                   Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const m = s.trim().match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const mm = months[m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase()];
  if (!mm) return null;
  // Two-digit year — pivot at 70 (so '26 = 2026, but '99 = 1999). USHA
  // exports use 20xx so this is safe.
  const yy = Number(m[2]);
  const yyyy = (yy >= 70 ? 1900 + yy : 2000 + yy);
  return `${yyyy}-${mm}`;
}

// ---------- Main parse: CSV → normalized residual rows ----------

/**
 * Parse a CommissionDetail.csv text into normalized rows.
 * Filters to MarketChannel = "Association Bonus" only.
 *
 * Returns:
 *   {
 *     rows:      Array<NormalizedRow>,
 *     warnings:  string[],           // non-fatal hints
 *     agentName: string | null,      // who the file is for
 *     agentNumber: string | null,
 *     periods:   string[],           // distinct YYYY-MM periods present
 *     unknownProducts: string[],     // products that didn't map to a plan id
 *   }
 *
 * Throws on a fatal shape problem (no MarketChannel column, etc.) so the
 * uploader can surface a clear error instead of silently importing zero rows.
 */
export function parseCommissionDetail(csvText) {
  const matrix = parseCsv(csvText);
  if (matrix.length === 0) throw new Error('Empty file.');

  const header = matrix[0].map(h => (h || '').trim());
  const idx = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const cols = {
    agentName:  idx('AgentName'),
    agentNum:   idx('AgentNumber'),
    channel:    idx('MarketChannel'),
    short:      idx('ShortName'),
    product:    idx('Product'),
    policyId:   idx('PolicyID'),
    customer:   idx('CustomerName'),
    effective:  idx('EffectiveDate'),
    applied:    idx('AppliedDate'),
    paid:       idx('PaidToDate'),
    priorAdj:   idx('PriorAdjustment'),
    premium:    idx('CommissionablePremiumAmount'),
    rate:       idx('CommissionRate'),
    asEarned:   idx('AsEarned'),
  };

  if (cols.channel < 0)   throw new Error('CSV missing required column: MarketChannel.');
  if (cols.policyId < 0)  throw new Error('CSV missing required column: PolicyID.');
  if (cols.product < 0)   throw new Error('CSV missing required column: Product.');
  if (cols.asEarned < 0)  throw new Error('CSV missing required column: AsEarned.');

  const warnings = [];
  const unknownProducts = new Set();
  const periodSet = new Set();
  const rows = [];

  let agentName = null;
  let agentNumber = null;

  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!r || r.length === 0) continue;

    const channel = (r[cols.channel] || '').trim();
    if (channel !== 'Association Bonus') continue; // skip everything else

    if (!agentName && cols.agentName >= 0)   agentName = (r[cols.agentName] || '').trim() || null;
    if (!agentNumber && cols.agentNum >= 0)  agentNumber = (r[cols.agentNum] || '').trim() || null;

    const productStr = (r[cols.product] || '').trim();
    const planId = productCodeToPlanId(productStr);
    if (!planId) unknownProducts.add(productStr);

    const productCode = (productStr.match(/^\s*(\d{4})/) || [, null])[1] || null;

    const period = shortMonthToIso(r[cols.short] || '') || null;
    if (period) periodSet.add(period);

    const asEarned = Number(r[cols.asEarned]) || 0;
    const isAdjustment = asEarned < 0
      || (cols.priorAdj >= 0 && (r[cols.priorAdj] || '').trim() !== '');

    rows.push({
      policyId:    (r[cols.policyId] || '').trim(),
      customer:    cols.customer >= 0 ? (r[cols.customer] || '').trim() : '',
      productCode,
      productLabel: productStr,
      planId, // null if we don't recognize the product
      period,
      effectiveDate: cols.effective >= 0 ? usDateToIso(r[cols.effective]) : null,
      appliedDate:   cols.applied   >= 0 ? usDateToIso(r[cols.applied])   : null,
      paidToDate:    cols.paid      >= 0 ? usDateToIso(r[cols.paid])      : null,
      premium: cols.premium >= 0 ? (Number(r[cols.premium]) || 0) : 0,
      rate:    cols.rate    >= 0 ? (Number(r[cols.rate])    || 0) : 0,
      asEarned,
      isAdjustment,
    });
  }

  if (rows.length === 0) {
    warnings.push('No Association Bonus rows found. Make sure this is a CommissionDetail export, not a different report.');
  }
  if (unknownProducts.size > 0) {
    warnings.push(
      `${unknownProducts.size} product code(s) not mapped to a plan tier: ${[...unknownProducts].slice(0, 5).join(', ')}${unknownProducts.size > 5 ? '…' : ''}. They\'ll still be imported and counted in totals, just not in the per-tier breakdown or projections.`
    );
  }

  return {
    rows,
    warnings,
    agentName,
    agentNumber,
    periods: [...periodSet].sort(),
    unknownProducts: [...unknownProducts],
  };
}

// ---------- Dedup + merge ----------

/**
 * Composite dedup key. Same policy can appear twice within one production
 * month (one negative reversal + one corrected positive — Cecilia Baxter
 * pattern in Julio's April file). Keying on policyId + appliedDate keeps
 * both rows distinct so the period total nets correctly.
 */
function rowKey(r) {
  return `${r.policyId}|${r.appliedDate || ''}|${r.period || ''}|${r.asEarned}`;
}

/**
 * Merge new rows into existing storage. Returns { merged, added, skipped }.
 * `added` = rows that were new. `skipped` = rows that were already present.
 */
export function mergeResidualRows(existing, incoming) {
  const seen = new Map();
  for (const r of existing) seen.set(rowKey(r), r);
  let added = 0;
  let skipped = 0;
  for (const r of incoming) {
    const k = rowKey(r);
    if (seen.has(k)) { skipped++; continue; }
    seen.set(k, r);
    added++;
  }
  // Sort by appliedDate descending so newest is first.
  const merged = [...seen.values()].sort((a, b) =>
    String(b.appliedDate || '').localeCompare(String(a.appliedDate || ''))
  );
  return { merged, added, skipped };
}

// ---------- Rate derivation ----------

/**
 * Given a set of residual rows, derive each agent-effective per-plan rate.
 *
 * For each planId, find the row with the most recent EffectiveDate and use
 * that AsEarned as the current rate. Older rows are kept as a "schedule"
 * showing rate progression over time — useful for diagnostic display
 * ("your rate went $20.50 → $23 → $28 in the last 18 months").
 *
 * Adjustment rows (negative AsEarned) are skipped — they'd skew the rate
 * lookup since a -$53.34 reversal isn't representative of the rate.
 *
 * Returns: { [planId]: { currentRate, lastEffective, schedule: [{effectiveAfter, rate}] } }
 */
export function deriveAgentRates(rows) {
  const byPlan = {};
  for (const r of rows) {
    if (!r.planId) continue;
    if (r.isAdjustment) continue;
    if (!r.effectiveDate) continue;
    if (!(r.asEarned > 0)) continue;
    (byPlan[r.planId] ||= []).push({ effective: r.effectiveDate, rate: r.asEarned });
  }

  const out = {};
  for (const planId of Object.keys(byPlan)) {
    // Group by rate to get distinct rate tiers, with the earliest effective
    // date that any policy at that rate started.
    const byRate = {};
    for (const o of byPlan[planId]) {
      if (!byRate[o.rate] || o.effective < byRate[o.rate]) byRate[o.rate] = o.effective;
    }
    // Sort schedule oldest → newest by the earliest effective date per rate.
    const schedule = Object.entries(byRate)
      .map(([rate, effective]) => ({ effectiveAfter: effective, rate: Number(rate) }))
      .sort((a, b) => a.effectiveAfter.localeCompare(b.effectiveAfter));

    // Current rate = the rate from the row with the most recent effective date overall.
    let lastEffective = null;
    let currentRate = null;
    for (const o of byPlan[planId]) {
      if (!lastEffective || o.effective > lastEffective) {
        lastEffective = o.effective;
        currentRate = o.rate;
      }
    }
    out[planId] = { currentRate, lastEffective, schedule };
  }
  return out;
}

/**
 * Look up the agent's effective rate for a plan. Falls back to the
 * baseline `ASSOCIATION_PRICING` table when we don't have agent-specific
 * data yet (brand-new user who hasn't uploaded a CommissionDetail).
 */
export function getAgentResidualRate(planId, agentRates) {
  const fromAgent = agentRates && agentRates[planId]?.currentRate;
  if (fromAgent != null && fromAgent > 0) return fromAgent;
  const baseline = ASSOCIATION_PRICING[planId]?.commission;
  return baseline || 0;
}

/**
 * Convenience: returns a tagged rate { rate, source } so the UI can show
 * "$28/mo (your contract)" vs "$18/mo (baseline — upload your CommissionDetail
 * for accurate rates)".
 */
export function getAgentResidualRateTagged(planId, agentRates) {
  const fromAgent = agentRates && agentRates[planId]?.currentRate;
  if (fromAgent != null && fromAgent > 0) return { rate: fromAgent, source: 'agent' };
  const baseline = ASSOCIATION_PRICING[planId]?.commission || 0;
  return { rate: baseline, source: baseline > 0 ? 'baseline' : 'unknown' };
}

// ---------- Name-match helpers (lead ↔ residual book) ----------

/**
 * Canonical name key for matching a PRIM lead against CommissionDetail rows.
 * Lowercased, punctuation stripped, suffix (Jr/Sr/II/III/IV) trimmed, then
 * reduced to "first-word last-word". Drops middle names and middle initials
 * so `"Sean H Catto"` and `"Sean Catto"` collide on the same key.
 *
 * Returns null if the input has no usable name content.
 *
 * Examples:
 *   "Matthew Adam Robertson Sr"   → "matthew robertson"
 *   "Kate L Coltman-Woodrich"     → "kate coltman woodrich" → "kate woodrich"
 *   "Donatello Dolcimascolo"      → "donatello dolcimascolo"
 *
 * Known limitation: typos in the surname (Dolcimascolo vs Dolcimascollo)
 * won't match — we'd need fuzzy matching to handle that, which adds risk
 * of false positives. We err on the side of "no match → projection" which
 * is honest, not wrong.
 */
export function normalizeNameKey(name) {
  if (!name || typeof name !== 'string') return null;
  let s = name.toLowerCase().trim();
  // Smart quotes / curly apostrophes / common punctuation → empty
  s = s.replace(/['’`.,]/g, '');
  // Hyphens, slashes, underscores → spaces (so hyphenated last names split)
  s = s.replace(/[-_/]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // Strip trailing suffix
  s = s.replace(/\s+(jr|sr|ii|iii|iv|2nd|3rd|4th)$/i, '').trim();
  if (!s) return null;
  const parts = s.split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/**
 * Build an index of residual rows keyed by normalized customer name.
 * Each entry holds every row for that name across all imported periods.
 */
export function buildBookIndex(rows) {
  const idx = new Map();
  for (const r of rows) {
    const key = normalizeNameKey(r.customer);
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(r);
  }
  return idx;
}

/**
 * Find the latest period across all residual rows ("YYYY-MM" or null).
 * Used to decide whether a matched policy is still active or has churned.
 */
export function latestPeriodOf(rows) {
  if (!rows || rows.length === 0) return null;
  const periods = [...new Set(rows.map(r => r.period).filter(Boolean))].sort();
  return periods.length ? periods[periods.length - 1] : null;
}

/**
 * Match a PRIM lead to its residual rows by normalized name.
 *
 * Returns one of three outcomes:
 *
 *   { matched: false }
 *     — name didn't appear in the imported book at all.
 *
 *   { matched: false, ambiguous: true, candidates }
 *     — the name matches multiple distinct policy IDs in the book. We
 *       refuse to auto-resolve so we never show wrong data; UI should
 *       fall back to projection and flag for the user.
 *
 *   { matched: true, currentMonthly, totalPaid, active, policyId, rowCount }
 *     — name maps to exactly one policy. `currentMonthly` is the NET
 *       AsEarned in the latest period (handles reversal+correction
 *       pairs like Cecilia Baxter cleanly), or null if the policy
 *       didn't appear in the latest period (likely churned). `totalPaid`
 *       is NET across every imported period.
 */
export function matchLeadToBook(lead, index, latestPeriod) {
  if (!lead || !index || index.size === 0) return { matched: false };
  const key = normalizeNameKey(lead.name);
  if (!key) return { matched: false };
  const rows = index.get(key);
  if (!rows || rows.length === 0) return { matched: false };

  const policyIds = new Set(rows.map(r => r.policyId).filter(Boolean));
  if (policyIds.size > 1) {
    return { matched: false, ambiguous: true, candidates: [...policyIds] };
  }

  const totalPaid = rows.reduce((s, r) => s + (Number(r.asEarned) || 0), 0);

  let currentMonthly = null;
  let active = false;
  if (latestPeriod) {
    const latestRows = rows.filter(r => r.period === latestPeriod);
    if (latestRows.length > 0) {
      const net = latestRows.reduce((s, r) => s + (Number(r.asEarned) || 0), 0);
      // Treat any non-zero net as "active" (negative = chargeback-this-month
      // but the policy is still on file). Truly churned = no rows in latest period.
      active = true;
      currentMonthly = net > 0 ? net : 0;
    }
  }

  return {
    matched: true,
    currentMonthly,
    totalPaid: Math.round(totalPaid * 100) / 100,
    active,
    policyId: [...policyIds][0] || null,
    rowCount: rows.length,
  };
}

// ---------- Aggregations for the Associations dashboard ----------

/**
 * Net total earned over the rows (sum of AsEarned, including negative
 * adjustments so chargebacks reduce the total honestly).
 */
export function netEarned(rows) {
  return rows.reduce((s, r) => s + Number(r.asEarned || 0), 0);
}

/**
 * Active subscriber book = unique policy IDs in the most-recent period
 * we've seen, minus any whose latest entry is a reversal.
 */
export function activeBook(rows) {
  if (rows.length === 0) return { period: null, count: 0, monthly: 0, byPlan: {} };
  const periods = [...new Set(rows.map(r => r.period).filter(Boolean))].sort();
  const latest = periods[periods.length - 1];
  if (!latest) return { period: null, count: 0, monthly: 0, byPlan: {} };
  const inPeriod = rows.filter(r => r.period === latest);

  // Net per policy (a policy might have a reversal + correction in same period).
  const netByPolicy = new Map();
  const planByPolicy = new Map();
  for (const r of inPeriod) {
    netByPolicy.set(r.policyId, (netByPolicy.get(r.policyId) || 0) + r.asEarned);
    if (!planByPolicy.has(r.policyId)) planByPolicy.set(r.policyId, r.planId || 'OTHER');
  }
  const byPlan = {};
  let monthly = 0;
  let count = 0;
  for (const [pid, net] of netByPolicy.entries()) {
    if (!(net > 0)) continue;
    const planId = planByPolicy.get(pid) || 'OTHER';
    byPlan[planId] ||= { count: 0, monthly: 0 };
    byPlan[planId].count += 1;
    byPlan[planId].monthly += net;
    monthly += net;
    count += 1;
  }
  return { period: latest, count, monthly, byPlan };
}

/**
 * Period-by-period total (net) for a trend chart.
 * Returns [{ period: 'YYYY-MM', total }, ...] sorted oldest → newest.
 */
export function periodTotals(rows) {
  const byPeriod = {};
  for (const r of rows) {
    if (!r.period) continue;
    byPeriod[r.period] = (byPeriod[r.period] || 0) + r.asEarned;
  }
  return Object.entries(byPeriod)
    .map(([period, total]) => ({ period, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Estimate YTD residuals when the agent only has ONE monthly snapshot.
 *
 * Method: for each customer with a positive payout in the latest period,
 * take their EffectiveDate, count how many calendar months of the current
 * year they've been active (Jan through the snapshot month), and multiply
 * by their latest rate. Sum across customers.
 *
 * Caveats (transparent in the UI label):
 *  - Slightly overstates customers whose contract rate bumped mid-year
 *    (e.g. a Tier 6 customer earning $23 in Jan, $28 from Feb onward
 *     gets counted at $28 × 4 = $112 instead of $23 + $28×3 = $107).
 *  - Customers who churned earlier in the year are NOT counted (we only
 *    see survivors), so the estimate trends slightly low if churn happened.
 *
 * Net effect: usually within ~2% of the truth. Good enough for "what did
 * I earn YTD" without forcing the agent to chase down older monthly files.
 *
 * Returns { year, monthsCovered, estimatedTotal }. Year and monthsCovered
 * derived from the snapshot period.
 */
export function estimateYtdFromSnapshot(rows) {
  if (!rows || rows.length === 0) return { year: null, monthsCovered: 0, estimatedTotal: 0 };
  const latest = latestPeriodOf(rows);
  if (!latest) return { year: null, monthsCovered: 0, estimatedTotal: 0 };

  const [yearStr, monthStr] = latest.split('-');
  const year = Number(yearStr);
  const snapshotMonth = Number(monthStr); // 1-12
  if (!year || !snapshotMonth) return { year: null, monthsCovered: 0, estimatedTotal: 0 };

  // Use the snapshot period as the source of "currently active customers"
  // — that's the only month we have a definitive list for.
  const snapshot = rows.filter(r => r.period === latest);

  // Net per policy in this period (one customer can have a reversal +
  // correction in same period). We want their effective monthly rate.
  const net = new Map();
  const eff = new Map();
  for (const r of snapshot) {
    const k = r.policyId || `${r.customer}|${r.productCode}`;
    net.set(k, (net.get(k) || 0) + (Number(r.asEarned) || 0));
    if (!eff.has(k) && r.effectiveDate) eff.set(k, r.effectiveDate);
  }

  let total = 0;
  for (const [k, monthlyNet] of net.entries()) {
    if (!(monthlyNet > 0)) continue;
    const effIso = eff.get(k);
    let monthsActive = snapshotMonth; // assume Jan through snapshot
    if (effIso) {
      const [effY, effM] = effIso.split('-').map(Number);
      if (effY > year) {
        monthsActive = 0; // came in after the snapshot year — shouldn't reach here
      } else if (effY === year) {
        // Came in this year — count from their effective month forward
        monthsActive = Math.max(0, snapshotMonth - effM + 1);
      }
      // effY < year → all months Jan-snapshot apply (initial value already correct)
    }
    if (monthsActive <= 0) continue;
    total += monthlyNet * monthsActive;
  }

  return {
    year: String(year),
    monthsCovered: snapshotMonth,
    estimatedTotal: Math.round(total * 100) / 100,
  };
}

/**
 * YTD total for the calendar year of the most-recent period.
 * Includes negative adjustments (honest net).
 */
export function ytdTotal(rows) {
  if (rows.length === 0) return { year: null, total: 0 };
  const periods = [...new Set(rows.map(r => r.period).filter(Boolean))].sort();
  const latest = periods[periods.length - 1];
  if (!latest) return { year: null, total: 0 };
  const year = latest.slice(0, 4);
  const total = rows
    .filter(r => r.period && r.period.startsWith(year))
    .reduce((s, r) => s + r.asEarned, 0);
  return { year, total: Math.round(total * 100) / 100 };
}
