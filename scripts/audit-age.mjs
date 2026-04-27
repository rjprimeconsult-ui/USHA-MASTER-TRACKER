import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
const file = process.argv[2];
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets['2026 PORTAL CLIENTS'], { header: 1, defval: '', raw: false });
const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
const norm = s => String(s || '').toUpperCase().trim();
function stage(ps, uw) {
  ps = norm(ps); uw = norm(uw);
  if (['PAID','APPROVED','P NOTE'].includes(ps)) return 'Issued';
  if (ps === 'WITHDRAWN') return 'Withdrawn';
  if (ps === 'DECLINED') return 'Declined';
  if (ps === 'NOT TAKEN') return 'Not taken';
  if (uw === 'APPROVED') return 'Issued';
  if (['DECLINE','DECLINED'].includes(uw)) return 'Declined';
  if (uw === 'WITHDRAWN') return 'Withdrawn';
  return 'Pending';
}
function mainProd(raw) {
  const u = norm(raw);
  if (u === 'PREMIER ADVANTAGE' || u === 'PREMIER ADV' || u === 'PREM ADV') return 'PREMIER ADVANTAGE';
  if (u === 'SECURE ADVANTAGE'  || u === 'SECURE ADV'  || u === 'SEC ADV')  return 'SECURE ADVANTAGE';
  if (u === 'PREMIER CHOICE')                                               return 'PREMIER CHOICE';
  if (u === 'HEALTH ACCESS' || u === 'HEALTH ACCESS III')                   return 'HEALTH ACCESS III';
  if (u === 'ACA WRAP')                                                     return 'ACA WRAP';
  return 'OTHER';
}

const UW = ['PREMIER ADVANTAGE','SECURE ADVANTAGE','PREMIER CHOICE'];
const GI = ['HEALTH ACCESS III'];
const tally = (bucket) => ({ issued:0, pending:0, notTaken:0, excludedOver50:0, total:0 });
const uw = tally(); const gi = tally();

for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  const name = clean(r[0]);
  if (!name || !(clean(r[3]) || clean(r[4]) || clean(r[9]))) continue;
  const age = parseInt(clean(r[1]), 10) || 0;
  const s = stage(r[16], r[15]);
  const p = mainProd(r[10]);
  const pool = UW.includes(p) ? uw : GI.includes(p) ? gi : null;
  if (!pool) continue;

  if (age > 50) { pool.excludedOver50 += 1; continue; }

  if (s === 'Issued')     pool.issued += 1;
  else if (s === 'Pending') pool.pending += 1;
  else if (['Declined','Not taken','Withdrawn'].includes(s)) pool.notTaken += 1;
}

const report = (label, x) => {
  const total = x.issued + x.pending + x.notTaken;
  const rate = total > 0 ? (x.issued / total) * 100 : 0;
  console.log(`${label}:`);
  console.log(`  Issued:   ${x.issued}`);
  console.log(`  Pending:  ${x.pending}`);
  console.log(`  Not taken/Declined/Withdrawn: ${x.notTaken}`);
  console.log(`  Excluded (over 50): ${x.excludedOver50}`);
  console.log(`  Counted total: ${total}`);
  console.log(`  Taken rate: ${rate.toFixed(1)}%`);
};
report('UW (Premier Adv/Choice, Secure Adv)', uw);
console.log();
report('GI (Health Access III)', gi);
