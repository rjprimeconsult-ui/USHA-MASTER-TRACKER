/**
 * USHA Weekly Advance Statement (PDF) parser + reconciler.
 *
 * Parses the text out of the PDF, extracts ADVANCE DETAIL rows, and groups by
 * customer. Each customer gets a summed Net Advance across all their policy
 * rows (one row per product/add-on).
 *
 * The PDF text shape (based on a real FSL statement):
 *   Header: Agent Name, Title: <TIER>, Agent ID, Period, Reserve/Statement summaries
 *   ADVANCE DETAIL section: one row per policy product with these columns:
 *     Writing Agent | Product Desc | Policy ID | Customer Name | Policy App Date
 *     | Policy Eff Date | Term Reason | Non Comm | Split% | Comm Premium
 *     | Adv Mos | Rate | Total Advanced | Reserve Withheld | Net Advance
 *   REINSTATEMENT DETAIL section at the end (small).
 *
 * We detect rows by anchoring on the Policy ID pattern (e.g. 52Y242093F) and
 * using the two dates that follow as right-boundary for the customer name.
 */

// pdfjs-dist is ONLY imported lazily inside parseStatementPdf() (it references
// DOMMatrix which doesn't exist in the Node SSR environment). Do not import
// pdfjs-dist at module-eval time.
let pdfjsLib = null;
async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('pdfjs-dist');
  try {
    const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.toString();
  } catch {
    // If worker URL resolution fails (some bundlers), fall back to disabling the worker.
    // pdfjs will run on the main thread — slower but still correct.
  }
  return pdfjsLib;
}

const POLICY_ID_RE = /\b(\d{2}[A-Z]\d{6}[A-Z]?)\b/;
const DATE_RE      = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
const MONEY_RE     = /-?\$[\d,]+\.\d{2}/g;
const PCT_RE       = /(\d{1,3}(?:\.\d{1,2})?)%/;

/** Extract all text pages concatenated, preserving page boundaries. */
async function getPdfText(file) {
  const lib = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const task = lib.getDocument({ data: buffer });
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Join strings with a space; use newlines where pdfjs indicates line breaks.
    let pageText = '';
    let prevY = null;
    for (const item of content.items) {
      const y = item.transform ? item.transform[5] : null;
      if (prevY !== null && y !== null && Math.abs(y - prevY) > 1) {
        pageText += '\n';
      } else if (pageText && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
        pageText += ' ';
      }
      pageText += item.str;
      prevY = y;
    }
    pages.push(pageText);
  }
  await pdf.destroy();
  return pages.join('\n\n');
}

/** Clean raw dollar string → number. Returns 0 for missing. */
function money(s) {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Extract header metadata (owner, tier, period) from the text. */
function parseHeader(text) {
  // Owner / tier / agentId are always at the very top (first 2000 chars is safe).
  const top = text.slice(0, 2000);
  const ownerMatch = top.match(/^\s*([A-Z][A-Z' .-]+[A-Z])\s*\n.*?Title:\s*(\w+)/s);
  const idMatch = top.match(/Agent ID:\s*(\w+)/);
  // Period and totals live in page footers — sometimes past 2000 chars in
  // long statements. Search the whole document so we always find them.
  const periodMatch = text.match(/Period:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const advancesMatch = top.match(/Advances\s+\$?([\d,]+\.\d{2})/);
  const totalPayoutMatch = top.match(/Total Payout\s+\$?([\d,]+\.\d{2})/);

  return {
    owner: ownerMatch?.[1]?.trim() || '',
    tier:  ownerMatch?.[2]?.trim() || '',
    agentId: idMatch?.[1]?.trim() || '',
    periodStart: periodMatch?.[1] || '',
    periodEnd:   periodMatch?.[2] || '',
    advances:    money(advancesMatch?.[1]),
    totalPayout: money(totalPayoutMatch?.[1]),
  };
}

/**
 * Split the statement into labeled segments by detail section.
 * Returns [{ type: 'advance'|'chargeback'|'reinstatement', text }, ...].
 */
function splitSections(flat) {
  const SECTION_HEADERS = [
    { re: /ADVANCE DETAIL/g,      type: 'advance' },
    { re: /CHARGEBACK DETAIL/g,   type: 'chargeback' },
    { re: /REINSTATEMENT DETAIL/g, type: 'reinstatement' },
  ];
  const markers = [];
  for (const h of SECTION_HEADERS) {
    for (const m of flat.matchAll(h.re)) markers.push({ idx: m.index, type: h.type, len: m[0].length });
  }
  markers.sort((a, b) => a.idx - b.idx);
  const sections = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].idx + markers[i].len;
    const end = i + 1 < markers.length ? markers[i + 1].idx : flat.length;
    sections.push({ type: markers[i].type, text: flat.slice(start, end) });
  }
  return sections;
}

/**
 * Parse one section of detail rows (ADVANCE, CHARGEBACK, or REINSTATEMENT).
 * Row extraction is identical across all 3 — chargebacks just have negative
 * "Total Advanced" amounts.
 *
 * When an `owner` name is supplied, rows whose writing agent matches the
 * owner are clearly own-sales even if the caps-scan mis-groups words.
 */
function parseDetailRows(sectionText, owner = '', type = 'advance') {
  const flat = sectionText;
  const ownerUpper = owner.toUpperCase().trim();
  const policyMatches = [...flat.matchAll(new RegExp(POLICY_ID_RE.source, 'g'))];
  const rows = [];

  for (let i = 0; i < policyMatches.length; i++) {
    const m = policyMatches[i];
    const policyId = m[0];
    const policyStart = m.index;

    // Segment before this policy = from end of previous policy to this one.
    const prevEnd = i === 0 ? 0 : policyMatches[i - 1].index + policyMatches[i - 1][0].length;
    const beforeSegment = flat.slice(prevEnd, policyStart).trim();

    // --- WRITING AGENT + PRODUCT ---
    let writingAgent = '';
    let productDesc = '';

    if (ownerUpper && beforeSegment.toUpperCase().includes(ownerUpper)) {
      // Own-sales row: owner name anchors the segment.
      const upperSeg = beforeSegment.toUpperCase();
      const idx = upperSeg.lastIndexOf(ownerUpper);
      writingAgent = beforeSegment.slice(idx, idx + ownerUpper.length);
      productDesc = beforeSegment.slice(idx + ownerUpper.length).trim();
    } else {
      // Override row. Scan FORWARD past prev-row garbage (dates, $ amounts,
      // mixed-case customer names) to find the agent name, then consume up to
      // 3 consecutive pure-caps letter-only words. Stop at the first known
      // product token — that word and everything after is the product desc.
      const words = beforeSegment.split(' ').filter(Boolean);
      const isPureCaps = (w) => /^[A-Z][A-Z']+$/.test(w) && w.length >= 2 && w.length <= 20;
      const PRODUCT_FIRST_WORDS = new Set([
        'MEDGUARD', 'PREMIER', 'PREM', 'PREMIERVISION',
        'SECURE', 'SECUREADVANTAGE', 'SECUREDENTAL',
        'ACCIDENT', 'INCOME', 'LIFE', 'HEALTHACCESS',
        'DENTAL', 'VISION',
      ]);
      const isProductToken = (w) => PRODUCT_FIRST_WORDS.has(w);
      const qualifies = (w) => isPureCaps(w) && !isProductToken(w);

      // Find the start of the agent name — a run of at least 2 consecutive
      // pure-caps non-product words. This filters out column-header orphans
      // like "ID" (from "Policy ID") that would otherwise get picked up.
      let start = -1;
      for (let k = 0; k < words.length - 1; k++) {
        if (qualifies(words[k]) && qualifies(words[k + 1])) {
          start = k;
          break;
        }
      }

      if (start >= 0) {
        // Consume up to 3 consecutive pure-caps non-product words
        let end = start;
        while (end < words.length && end - start < 3 && qualifies(words[end])) end++;
        writingAgent = words.slice(start, end).join(' ');
        productDesc  = words.slice(end).join(' ');
      } else {
        writingAgent = 'UNKNOWN';
        productDesc  = beforeSegment;
      }
    }

    // --- CUSTOMER NAME + DATES + MONEY ---
    const afterStart = policyStart + policyId.length;
    const nextPolicyStart = i + 1 < policyMatches.length ? policyMatches[i + 1].index : flat.length;
    let afterSegment = flat.slice(afterStart, nextPolicyStart);

    // Stop at the section's "Total:" summary row — otherwise the last row of a
    // section bleeds into the totals and inflates Reserve Withheld / Total Advanced.
    const totalIdx = afterSegment.search(/\bTotal:/i);
    if (totalIdx >= 0) afterSegment = afterSegment.slice(0, totalIdx);

    const dateIter = [...afterSegment.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)];
    if (dateIter.length < 2) continue;

    const customer = afterSegment.slice(0, dateIter[0].index).replace(/\s+/g, ' ').trim();
    let afterDates = afterSegment.slice(dateIter[1].index + dateIter[1][0].length);

    // Belt-and-suspenders: also strip anything after "Total:" in afterDates.
    const totalIdx2 = afterDates.search(/\bTotal:/i);
    if (totalIdx2 >= 0) afterDates = afterDates.slice(0, totalIdx2);

    const moneys = (afterDates.match(MONEY_RE) || []).map(money);
    if (moneys.length < 3) continue;

    // Each row has at most 5 money fields (NonComm, Premium, TotalAdvanced,
    // ReserveWithheld, NetAdvance). Anything more means we grabbed extra cells
    // from the next row or a totals row — cap at the first 5 we find to stay
    // aligned to the rightmost 3 positions.
    if (moneys.length > 5) moneys.length = 5;

    const netAdvance = moneys[moneys.length - 1];
    const reserveWithheld = moneys[moneys.length - 2];
    const totalAdvanced = moneys[moneys.length - 3];
    const commPremium = moneys.length >= 5 ? moneys[moneys.length - 5] : 0;

    const pctMatches = [...afterDates.matchAll(/(\d{1,3}(?:\.\d{1,2})?)%/g)];
    const rate = pctMatches.length > 0 ? parseFloat(pctMatches[pctMatches.length - 1][1]) / 100 : 0;

    rows.push({
      type,
      writingAgent, productDesc, policyId, customer,
      netAdvance, reserveWithheld, totalAdvanced, commPremium, rate,
      appDate: dateIter[0][1],
      effDate: dateIter[1][1],
    });
  }

  return rows;
}

/**
 * Parse every detail section in the statement text.
 * Returns three arrays: advanceRows, chargebackRows, reinstatementRows.
 */
function parseAllDetailSections(text, owner = '') {
  const flat = text.replace(/\s+/g, ' ');
  const sections = splitSections(flat);
  const out = { advanceRows: [], chargebackRows: [], reinstatementRows: [] };
  for (const s of sections) {
    const rows = parseDetailRows(s.text, owner, s.type);
    if (s.type === 'advance')       out.advanceRows.push(...rows);
    else if (s.type === 'chargeback') out.chargebackRows.push(...rows);
    else if (s.type === 'reinstatement') out.reinstatementRows.push(...rows);
  }
  return out;
}

/**
 * Scan the full statement text for Miscellaneous-section bonus rows.
 *
 * Real USHA statement format (table in the Miscellaneous section):
 *   Type            | Adjustment Type | Adjustment Description       | Payment Information       | Transaction Date | Adjustment Amount
 *   Production Bonus | PAR FTA        | FTA PAR 2023 Bonus (#24)     | Paid by EFT on 04/02/2026 | 4/2/2026         | $1,245.25
 *   Production Bonus | PAR Personal   | PP PAR 2023 Bonus (#24)      | Paid by EFT on 04/02/2026 | 4/2/2026         | $1,949.42
 *
 * After PDF text extraction & whitespace flattening these rows become a
 * continuous string. We match the "Type" word at the start, capture
 * everything up to the last date+amount pair, and pull out the transaction
 * date and amount.
 *
 * Returns: [{ label, amount, type, transactionDate }]
 */
export function parseBonuses(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const out = [];
  const seen = new Set();

  // The "Type" column values we recognize as bonuses.
  // Order matters — longest first so "Override Bonus" wins over "Bonus" etc.
  const BONUS_TYPES = [
    'Production\\s+Bonus',
    'Override\\s+Bonus',
    'Renewal\\s+Bonus',
    'Association\\s+Bonus',
    'Recruiter\\s+Bonus',
    'Recruiting\\s+Bonus',
    'First[\\s-]?Year\\s+Bonus',
    'Quality\\s+Bonus',
    'Retention\\s+Bonus',
    'Persistency\\s+Bonus',
    'Bonus',
  ].join('|');

  // Match: <Type> + middle content (lazy) + transaction date + amount
  //
  // Lazy `.+?` with the required date-then-amount tail forces the regex to
  // find the LAST date before the amount (it backtracks past any inner date
  // like "Paid by EFT on <date>" until the trailing transaction date).
  //
  // We previously used [^\$]+? to avoid greediness, but that broke rows where
  // the Adjustment Description itself contains a "$" (e.g. "$65K Milestone"
  // for a Production Bonus). Lazy `.+?` is safe here because the trailing
  // date+amount anchor is specific enough to find the right boundary.
  const ROW_RE = new RegExp(
    `\\b(${BONUS_TYPES})\\b\\s+(.+?)\\s+(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})\\s+(\\$-?[\\d,]+\\.\\d{2})`,
    'gi'
  );

  for (const m of flat.matchAll(ROW_RE)) {
    const typeName = m[1].replace(/\s+/g, ' ').trim();
    const middleRaw = (m[2] || '').trim();
    const dateStr = m[3];
    const amount = money(m[4]);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    // Skip header / total bleeds (e.g. "Bonus Total" rows, table headers)
    if (/total|column|year[\s-]?to[\s-]?date|\bytd\b|\bmtd\b|summary/i.test(middleRaw)) continue;

    // Account Summary / Reserve sections: tables with column headers like
    // "Beginning Balance" and rows like "E&O Charge $X" can splice into a
    // false "<Bonus Type>...<random date>...<random amount>" match. Reject
    // any match whose middle contains telltale reserve-statement words.
    if (/\b(beginning\s+balance|ending\s+balance|e\s*&\s*o\s+charge|week\s+ending|reserve\s+(adjustment|short|withheld|balance)|advance\s+reserve|chargeback|reinstatement)\b/i.test(middleRaw)) continue;

    // A real bonus row has at most ONE "$amount" inside the middle (the
    // breakdown / "Paid by EFT" tail). If we see 2+ separate dollar amounts
    // or any parenthesized negative, the regex bridged two unrelated rows
    // and the trailing capture isn't actually this bonus's amount.
    const dollarHits = (middleRaw.match(/\$\s*-?\(?[\d,]+\.\d{2}\)?/g) || []).length;
    if (dollarHits >= 2) continue;
    if (/\(\s*\$/.test(middleRaw)) continue; // parenthesized negative ($)
    if (middleRaw.length > 100) continue;     // sanity cap on description length

    // Strip trailing "Paid by ... on <date>" so the label stays readable
    const middle = middleRaw.replace(/\s*Paid\s*by\s*[A-Za-z]+\s*on\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/i, '').trim();
    if (!middle) continue;

    // Title-case the bonus type while keeping ALL-CAPS acronyms
    const niceType = typeName.replace(/\b\w+/g, w =>
      /^[A-Z]{2,5}$/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()
    );
    const label = `${niceType} — ${middle}`.slice(0, 120);

    const key = `${label}|${amount.toFixed(2)}|${dateStr}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Classify based on the Adjustment Type / Description text
    let type = 'BONUS';
    const blob = `${typeName} ${middle}`;
    if      (/\bPAR\s*FTA\b|\bFTA\s*PAR\b|\bFTA\b/i.test(blob))    type = 'FTA_BONUS';
    else if (/\bPAR\s*Personal\b|\bPP\s*PAR\b|\bPAR\b/i.test(blob)) type = 'PAR_BONUS';
    else if (/association/i.test(blob))                              type = 'ASSOCIATION_BONUS';
    else if (/recruit/i.test(blob))                                  type = 'RECRUITER_BONUS';
    else if (/renewal|residual|persistency/i.test(blob))             type = 'RENEWAL_BONUS';
    else if (/first[\s-]?year|new\s*business/i.test(blob))           type = 'FIRST_YEAR_BONUS';
    else if (/quality|retention|lifestyle/i.test(blob))              type = 'QUALITY_BONUS';
    else if (/production/i.test(blob))                                type = 'PRODUCTION_BONUS';

    out.push({ label, amount, type, transactionDate: dateStr });
  }

  // ---------- USHEALTH Account Summary PDF format ----------
  // pdfjs extracts text in label-then-value order:
  //   "Total Payout: FINAL $1,541.28 $154.81 $0.00 $1,696.09 ..."
  //   The 4 amounts after FINAL are: Primary, Secondary, Association, Total.
  //   Release month appears as "MMM-YYYY" much later in the text (after Note:).
  //
  // Period appears earlier as "Period: M/D/YYYY - M/D/YYYY". Release date =
  // 5th of the month FOLLOWING the period end (per the "Note: Final Payout
  // determinization to be made by the 5th of each month" footer).
  const MONTH_NUMS = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, SEPT:9, OCT:10, NOV:11, DEC:12 };

  const nextMonthFifth = (periodEndStr) => {
    const m = String(periodEndStr || '').match(/^(\d{1,2})\/\d{1,2}\/(\d{2,4})/);
    if (!m) return null;
    let mo = Number(m[1]);
    let yr = m[2];
    if (yr.length === 2) yr = (Number(yr) > 50 ? '19' : '20') + yr;
    yr = Number(yr);
    mo += 1;
    if (mo > 12) { mo = 1; yr += 1; }
    return `${String(mo).padStart(2, '0')}/05/${yr}`;
  };

  // Strategy 1 (PRIMARY): "Total Payout: FINAL $A $B $C $D" — pdfjs layout.
  // The 4 amounts in order are Primary, Secondary, Association Bonus, Total.
  const totalPayoutRe = /Total\s+Payout\s*:?\s*FINAL\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/gi;
  for (const m of flat.matchAll(totalPayoutRe)) {
    const primary     = money(m[1]);
    const secondary   = money(m[2]);
    const association = money(m[3]);
    const total       = money(m[4]);

    // Sanity check: 4th should equal sum of first 3 (within $0.05)
    if (Math.abs((primary + secondary + association) - total) > 0.05) continue;
    if (!Number.isFinite(total) || total <= 0) continue;

    // Find the period end near this match for release date derivation.
    // Period is at the top of the document — search the whole flat string.
    const periodMatch = flat.match(/Period:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const periodEnd = periodMatch ? periodMatch[2] : null;
    const releaseDate = periodEnd ? nextMonthFifth(periodEnd) : null;

    const breakdownParts = [];
    if (primary > 0)     breakdownParts.push(`Primary $${primary.toFixed(2)}`);
    if (secondary > 0)   breakdownParts.push(`Secondary $${secondary.toFixed(2)}`);
    if (association > 0) breakdownParts.push(`Association Bonus $${association.toFixed(2)}`);

    const key = `MonthlyPayout|${total.toFixed(2)}|${releaseDate || periodEnd || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label: 'Monthly Payout (residual + association)',
      amount: total,
      type: 'RENEWAL_BONUS',
      transactionDate: releaseDate || periodEnd,
      breakdown: breakdownParts.join(' · '),
    });
  }

  // Strategy 2 (LEGACY): "FINAL <MMM>-<YYYY>" inline format — older statement
  // layout where the release month is right after FINAL.
  for (const fa of flat.matchAll(/FINAL\s+([A-Z]{3,4})-?\s*(\d{4})/gi)) {
    const mon = fa[1].toUpperCase().slice(0, 3);
    const yr = fa[2];
    const monthNum = MONTH_NUMS[mon];
    if (!monthNum) continue;

    let primary = null, secondary = null, association = null, total = null;

    // Strategy 1 (primary): the 4 amounts appear in sequence after the FINAL
    // marker — Primary, Secondary, Association Bonus, Total. This is the
    // observed layout when pdfjs/pdftotext extracts the Account Summary block.
    const tail = flat.slice(fa.index + fa[0].length, fa.index + fa[0].length + 400);
    const tailAmounts = [...tail.matchAll(/\$\s*([\d,]+\.\d{2})/g)].map(am => money(am[1]));
    if (tailAmounts.length >= 4) {
      const [a, b, c, d] = tailAmounts.slice(0, 4);
      // Verify: 4th should equal sum of first 3 (within $0.05 rounding)
      if (Math.abs((a + b + c) - d) < 0.05) {
        [primary, secondary, association, total] = [a, b, c, d];
      }
    }

    // Strategy 2: label-anchored — only used if Strategy 1 didn't match.
    // pdfjs may sometimes interleave labels and values differently.
    if (total == null) {
      const winStart = Math.max(0, fa.index - 400);
      const winEnd = Math.min(flat.length, fa.index + 600);
      const win = flat.slice(winStart, winEnd);
      const findAmount = (labelRe, dist = 120) => {
        const m = win.match(labelRe);
        if (!m) return null;
        const t = win.slice(m.index + m[0].length, m.index + m[0].length + dist);
        const amt = t.match(/\$\s*([\d,]+\.\d{2})/);
        return amt ? money(amt[1]) : null;
      };
      primary     = findAmount(/\bPrimary\s*:?/i);
      secondary   = findAmount(/\bSecondary\s*:?/i);
      association = findAmount(/\bAssociation\s+Bonus\s*:?/i);
      total       = findAmount(/\bTotal\s+Payout\s*:?/i);
    }

    // Strategy 3: in the wider window, find 4 amounts where one = sum of others.
    if (total == null || !Number.isFinite(total) || total <= 0) {
      const winStart2 = Math.max(0, fa.index - 200);
      const winEnd2 = Math.min(flat.length, fa.index + 600);
      const winAmounts = [...flat.slice(winStart2, winEnd2).matchAll(/\$\s*([\d,]+\.\d{2})/g)]
        .map(am => money(am[1])).slice(0, 8);
      for (let i = 0; i < winAmounts.length; i++) {
        const sumOthers = winAmounts.reduce((s, v, j) => i === j ? s : s + v, 0);
        if (Math.abs(sumOthers - winAmounts[i]) < 0.05 && winAmounts[i] > 0) {
          total = winAmounts[i];
          const others = winAmounts.filter((_, j) => j !== i);
          if (primary == null)     primary     = others[0] || 0;
          if (secondary == null)   secondary   = others[1] || 0;
          if (association == null) association = others[2] || 0;
          break;
        }
      }
    }

    // Strategy 4 (last resort): if we have 3 components but no total, sum them.
    if ((total == null || total <= 0) && primary != null && secondary != null && association != null) {
      total = primary + secondary + association;
    }

    if (!Number.isFinite(total) || total <= 0) continue;

    const releaseDate = `${String(monthNum).padStart(2, '0')}/05/${yr}`;
    const breakdownParts = [];
    if (primary != null     && primary > 0)     breakdownParts.push(`Primary $${primary.toFixed(2)}`);
    if (secondary != null   && secondary > 0)   breakdownParts.push(`Secondary $${secondary.toFixed(2)}`);
    if (association != null && association > 0) breakdownParts.push(`Association Bonus $${association.toFixed(2)}`);

    const key = `MonthlyPayout|${total.toFixed(2)}|${releaseDate}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label: 'Monthly Payout (residual + association)',
      amount: total,
      type: 'RENEWAL_BONUS',
      transactionDate: releaseDate,
      breakdown: breakdownParts.join(' · '),
    });
  }

  // ---------- Fallback: explicit "Total: $X" Account Summary block ----------
  // Older format with a clean "Total: $X" line. Kept as a fallback in case any
  // statement uses this layout instead of "Total Payout: FINAL MMM-YYYY ..."
  const summaryBlocks = [...flat.matchAll(/Factors\s+Affecting\s+Payouts([\s\S]{0,1500}?)(?:Note:|$)/gi)];
  for (const sb of summaryBlocks) {
    const block = sb[1] || '';
    const releaseMatch = block.match(/Release\s*Date:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    const releaseDate = releaseMatch ? releaseMatch[1] : null;
    // Look for "Total:" specifically (not "Total Payout:") followed by an amount
    const totalMatch = block.match(/\bTotal\s*:\s*\$?(-?[\d,]+\.\d{2})/i);
    if (!totalMatch) continue;
    const total = money(totalMatch[1]);
    if (!Number.isFinite(total) || total <= 0) continue;

    const m1 = block.match(/\bPrimary\s*:\s*\$?(-?[\d,]+\.\d{2})/i);
    const m2 = block.match(/\bSecondary\s*:\s*\$?(-?[\d,]+\.\d{2})/i);
    const m3 = block.match(/\bAssociation\s+Bonus\s*:\s*\$?(-?[\d,]+\.\d{2})/i);
    const breakdown = [
      m1 ? `Primary $${m1[1]}` : null,
      m2 ? `Secondary $${m2[1]}` : null,
      m3 ? `Association Bonus $${m3[1]}` : null,
    ].filter(Boolean).join(' · ');

    const key = `MonthlyPayout|${total.toFixed(2)}|${releaseDate || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      label: 'Monthly Payout (residual + association)',
      amount: total,
      type: 'RENEWAL_BONUS',
      transactionDate: releaseDate,
      breakdown,
    });
  }

  // NOTE: We intentionally DO NOT parse section TOTALS lines from the long
  // Commission Statement Detail PDFs (the 28-page override-agent reports).
  // Those section totals include override-agent commissions and don't match
  // the agent's actual payout — the user must upload the 1-page Account
  // Summary PDF (which has the "Factors Affecting Payouts" block + a Total
  // line) for accurate income capture. The Account Summary block is parsed
  // above by the `summaryBlocks` loop.

  return out;
}

// Detect when someone uploads a Commission Statement Detail PDF (which has
// section TOTALS lines but no Account Summary block) so we can show a helpful
// "wrong PDF, upload the Account Summary instead" message.
export function isCommissionDetailPdf(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const hasSectionTotals = /"(SECONDARY|PRIMARY|ASSOCIATION\s+BONUS)"\s+TOTALS/i.test(flat);
  const hasAccountSummary = /Factors\s+Affecting\s+Payouts/i.test(flat);
  return hasSectionTotals && !hasAccountSummary;
}

// Detect a PRELIMINARY-status Account Summary. USHA only finalizes the
// monthly payout on the 5th of the following month — until then the PDF
// shows "Payout Status: PRELIMINARY" and amounts can still change. We
// don't want to record preliminary amounts as income (could later not
// match what's actually paid), so we surface a clear message in the UI
// instead of treating it as a parse failure.
export function isPreliminaryAccountSummary(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const hasFactors = /Factors\s+Affecting\s+Payouts/i.test(flat);
  const isPrelim = /Payout\s+Status:?\s*PRELIMINARY/i.test(flat);
  return hasFactors && isPrelim;
}

// Pull the period from an Account Summary so we can tell the user when
// the final payout is expected to be released.
export function getAccountSummaryPeriod(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const m = flat.match(/Period:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (!m) return null;
  return { periodStart: m[1], periodEnd: m[2] };
}

/** Full public API: parse a PDF into a clean structured statement object. */
export async function parseStatementPdf(file) {
  const text = await getPdfText(file);
  const header = parseHeader(text);
  const { advanceRows, chargebackRows, reinstatementRows } = parseAllDetailSections(text, header.owner);
  const bonusRows = parseBonuses(text);
  const isDetailOnly = isCommissionDetailPdf(text);
  // Keep `rows` for backwards-compat with older callers
  return { header, rows: advanceRows, advanceRows, chargebackRows, reinstatementRows, bonusRows, isDetailOnly, _rawText: text };
}

/** Levenshtein edit distance between two strings (O(n*m), tiny names so fine). */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = dp[j];
      dp[j] = Math.min(
        dp[j - 1] + 1,
        dp[j] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = cur;
    }
  }
  return dp[b.length];
}

/** Similarity score from 0 (totally different) to 1 (identical) based on edit distance. */
export function nameSimilarity(a, b) {
  const A = nameKey(a), B = nameKey(b);
  if (!A || !B) return 0;
  const max = Math.max(A.length, B.length);
  return max === 0 ? 0 : 1 - levenshtein(A, B) / max;
}

/**
 * For a single unmatched customer name, return the top N candidate tracker
 * leads by similarity, filtered to those above `threshold`. Results sorted
 * by score descending.
 */
export function suggestCandidates(customerName, leads, { limit = 5, threshold = 0.55 } = {}) {
  const scored = leads.map(l => ({ lead: l, score: nameSimilarity(customerName, l.name) }));
  return scored
    .filter(x => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Normalize a customer name for fuzzy matching — ORDER-INSENSITIVE.
 *
 * Steps:
 *   1. Lowercase and strip non-letter characters (keep apostrophes).
 *   2. Drop common name suffixes (jr, sr, ii, iii, iv).
 *   3. Drop single-letter words (middle initials) — "Deng L Ashirin" = "Deng Ashirin".
 *   4. Sort the remaining tokens alphabetically so "First Last" and "Last, First" produce the same key.
 *
 * This is safe because real client names won't have the same tokens in a
 * different meaningful order — "john smith" and "smith john" are the same person.
 */
export function nameKey(name) {
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/\b[a-z]\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  tokens.sort();
  return tokens.join(' ');
}

/**
 * Given a parsed statement + current tracker leads, compute a reconciliation plan:
 *   - ownSales: rows where Writing Agent matches the statement owner
 *   - overrides: rows where Writing Agent does NOT match the owner
 *   - matched: per-customer groups of own-sales rows that match a tracker lead
 *   - unmatched: per-customer groups that have no match in the tracker
 */
export function reconcileStatement(parsed, leads) {
  const { header, advanceRows = parsed.rows || [], chargebackRows = [], reinstatementRows = [], bonusRows = [] } = parsed;
  const ownerKey = nameKey(header.owner);

  // Build BOTH a full-name map AND a first+last fallback map.
  // A single nameKey can hold multiple leads (same customer, multiple policies).
  const leadsByFullKey = new Map();    // full nameKey → leads[]
  const leadsByShortKey = new Map();   // first+last only → leads[]
  const firstLastKey = (n) => {
    const nk = nameKey(n);
    const parts = nk.split(' ').filter(Boolean);
    if (parts.length < 2) return nk;
    return `${parts[0]} ${parts[parts.length - 1]}`;
  };
  // Index each lead by EVERY name on the policy — primary applicant plus
  // any spouse / dependents. When a partial issuance comes back under the
  // spouse's name (primary declined, spouse approved), the statement row
  // still routes back to the right lead.
  const indexLeadByName = (lead, rawName) => {
    if (!rawName) return;
    const fk = nameKey(rawName);
    const sk = firstLastKey(rawName);
    if (fk) {
      if (!leadsByFullKey.has(fk)) leadsByFullKey.set(fk, []);
      const arr = leadsByFullKey.get(fk);
      if (!arr.includes(lead)) arr.push(lead);
    }
    if (sk && sk !== fk) {
      if (!leadsByShortKey.has(sk)) leadsByShortKey.set(sk, []);
      const arr = leadsByShortKey.get(sk);
      if (!arr.includes(lead)) arr.push(lead);
    }
  };
  for (const l of leads) {
    indexLeadByName(l, l.name);
    // Also index by every dependent's name (spouse, kids, etc.)
    if (Array.isArray(l.dependents)) {
      for (const dep of l.dependents) {
        if (dep?.name) indexLeadByName(l, dep.name);
      }
    }
  }
  const findLeads = (rawName) => {
    const fk = nameKey(rawName);
    if (leadsByFullKey.has(fk)) return leadsByFullKey.get(fk);
    const sk = firstLastKey(rawName);
    if (leadsByShortKey.has(sk)) return leadsByShortKey.get(sk);
    return [];
  };

  // --- ADVANCES (own + overrides) ---
  const ownSales = [];
  const overrideAdvances = [];
  for (const r of advanceRows) {
    if (nameKey(r.writingAgent) === ownerKey) ownSales.push(r);
    else overrideAdvances.push(r);
  }

  const byCustomer = new Map();
  for (const r of ownSales) {
    const k = nameKey(r.customer);
    if (!k) continue;
    if (!byCustomer.has(k)) byCustomer.set(k, { key: k, name: r.customer, rows: [], total: 0 });
    const entry = byCustomer.get(k);
    entry.rows.push(r);
    entry.total += r.netAdvance;
  }
  // Customer → all tracker leads with matching name (multiple policies allowed)
  const matched = [];
  const unmatched = [];
  for (const entry of byCustomer.values()) {
    const matches = findLeads(entry.name);
    if (matches.length > 0) {
      const perLead = entry.total / matches.length;
      matches.forEach(lead => {
        matched.push({
          ...entry,
          leadId: lead.id,
          currentStage: lead.stage,
          currentDealValue: lead.dealValue,
          leadName: lead.name,
          leadPolicyNumber: lead.policyNumber || '',
          total: perLead,
          _fullTotal: entry.total,
          _leadCount: matches.length,
        });
      });
    } else {
      // Compute top candidate tracker leads for manual matching
      const candidates = suggestCandidates(entry.name, leads, { limit: 5, threshold: 0.55 });
      unmatched.push({
        ...entry,
        candidates: candidates.map(c => ({
          leadId: c.lead.id,
          leadName: c.lead.name,
          leadStage: c.lead.stage,
          leadPolicyNumber: c.lead.policyNumber || '',
          leadDealValue: c.lead.dealValue || 0,
          score: c.score,
        })),
      });
    }
  }

  const overridesByAgent = new Map();
  let overridesTotal = 0;
  for (const r of overrideAdvances) {
    overridesTotal += r.netAdvance;
    const k = nameKey(r.writingAgent);
    if (!overridesByAgent.has(k)) overridesByAgent.set(k, { writingAgent: r.writingAgent, total: 0, rows: [] });
    const e = overridesByAgent.get(k);
    e.total += r.netAdvance;
    e.rows.push(r);
  }

  // --- CHARGEBACKS ---
  // Actual money pulled back = the Reserve Withheld column (negative in the PDF).
  // The sum of |reserveWithheld| across all chargeback rows matches the
  // "Less Chargebacks" value in the Statement Summary header.
  const ownChargebacks = [];
  const overrideChargebacks = [];
  for (const r of chargebackRows) {
    if (nameKey(r.writingAgent) === ownerKey) ownChargebacks.push(r);
    else overrideChargebacks.push(r);
  }

  const cbByCustomer = new Map();
  for (const r of ownChargebacks) {
    const k = nameKey(r.customer);
    if (!k) continue;
    if (!cbByCustomer.has(k)) cbByCustomer.set(k, { key: k, name: r.customer, rows: [], amount: 0 });
    const entry = cbByCustomer.get(k);
    entry.rows.push(r);
    entry.amount += Math.abs(r.reserveWithheld);
  }
  const chargebacksMatched = [];
  const chargebacksUnmatched = [];
  for (const entry of cbByCustomer.values()) {
    const matches = findLeads(entry.name);
    if (matches.length > 0) {
      // Use the first matching lead as the canonical reference — chargeback
      // is a period-level event, not per-policy, and we already dedup by policyId.
      chargebacksMatched.push({ ...entry, leadId: matches[0].id });
    } else {
      chargebacksUnmatched.push(entry);
    }
  }

  const chargebacksOwnTotal = ownChargebacks.reduce((s, r) => s + Math.abs(r.reserveWithheld), 0);
  const chargebacksOverrideTotal = overrideChargebacks.reduce((s, r) => s + Math.abs(r.reserveWithheld), 0);

  const overrideChargebacksByAgent = new Map();
  for (const r of overrideChargebacks) {
    const k = nameKey(r.writingAgent);
    if (!overrideChargebacksByAgent.has(k)) overrideChargebacksByAgent.set(k, { writingAgent: r.writingAgent, amount: 0, rows: [] });
    const e = overrideChargebacksByAgent.get(k);
    e.amount += Math.abs(r.reserveWithheld);
    e.rows.push(r);
  }

  // Raw own-advance rows (writingAgent === owner). Stored to own_advances_v1
  // so KPI math can use what was actually paid in the statement period instead
  // of summing lead.dealValue (which gets overwritten on every re-import and
  // doesn't represent per-week payment).
  const ownAdvanceRows = ownSales;
  const ownAdvancesTotal = ownSales.reduce((s, r) => s + (r.netAdvance || 0), 0);

  return {
    header,
    ownSalesCount: ownSales.length,
    overridesCount: overrideAdvances.length,
    matched, unmatched,
    overridesTotal,
    overridesByAgent: Array.from(overridesByAgent.values()).sort((a, b) => b.total - a.total),
    ownAdvanceRows,
    ownAdvancesTotal,

    // Chargebacks
    chargebacksOwnCount: ownChargebacks.length,
    chargebacksOverrideCount: overrideChargebacks.length,
    chargebacksOwnTotal,
    chargebacksOverrideTotal,
    chargebacksMatched,
    chargebacksUnmatched,
    overrideChargebacksByAgent: Array.from(overrideChargebacksByAgent.values()).sort((a, b) => b.amount - a.amount),

    // Misc bonuses (PAR / FTA / Production / generic)
    bonusRows,
    bonusTotal: bonusRows.reduce((s, b) => s + (b.amount || 0), 0),
  };
}
