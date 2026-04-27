import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
const file = process.argv[2];
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets['2026 PORTAL CLIENTS'], { header: 1, defval: '', raw: false });
const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' ');
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
  if (u === 'PREMIER ADVANTAGE' || u === 'PREMIER ADV' || u === 'PREM ADV' || u === 'PA') return 'PREMIER ADVANTAGE';
  if (u === 'SECURE ADVANTAGE'  || u === 'SECURE ADV'  || u === 'SEC ADV' || u === 'SA')  return 'SECURE ADVANTAGE';
  if (u === 'PREMIER CHOICE' || u === 'PC' || u === 'PREM CHOICE')                         return 'PREMIER CHOICE';
  if (u === 'HEALTH ACCESS' || u === 'HEALTH ACCESS III' || u === 'HA' || u === 'HA III')  return 'HEALTH ACCESS III';
  if (u === 'ACA WRAP' || u === 'ACA')                                                     return 'ACA WRAP';
  if (u === 'SUPPY')                                                                       return 'SUPPY';
  return `OTHER (${u || 'blank'})`;
}

const haLeads = [];
const allCounts = new Map();

for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  const name = clean(r[0]);
  if (!name || !(clean(r[3]) || clean(r[4]) || clean(r[9]))) continue;
  const p = mainProd(r[10]);
  allCounts.set(p, (allCounts.get(p) || 0) + 1);
  if (p === 'HEALTH ACCESS III') {
    const policyNo = clean(r[9]);
    const s = stage(r[16], r[15]);
    haLeads.push({ row: i, name, policyNo, stage: s, rawProduct: clean(r[10]) });
  }
}

console.log('All main-product counts in PORTAL CLIENTS:');
[...allCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(3)}  ${k}`));

console.log(`\nHEALTH ACCESS III leads in spreadsheet: ${haLeads.length}`);
console.log('Sorted by stage:');
['Issued','Pending','Declined','Not taken','Withdrawn'].forEach(st => {
  const inStage = haLeads.filter(h => h.stage === st);
  if (inStage.length === 0) return;
  console.log(`\n  ${st} (${inStage.length}):`);
  inStage.forEach(h => console.log(`    row ${h.row}  policy ${h.policyNo.padEnd(12)}  "${h.rawProduct}"  ${h.name}`));
});
