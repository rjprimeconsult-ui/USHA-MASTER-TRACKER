// Audit: how many leads land in each stage × product bucket after my normalization?
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const file = process.argv[2];
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const portal = wb.Sheets['2026 PORTAL CLIENTS'];
const rows = XLSX.utils.sheet_to_json(portal, { header: 1, defval: '', raw: false });

const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' ');

function normalizeStage(ps, uw) {
  ps = String(ps || '').toUpperCase().trim();
  uw = String(uw || '').toUpperCase().trim();
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

function normalizeMain(raw) {
  const u = String(raw || '').toUpperCase().trim();
  if (u === 'PREMIER ADVANTAGE') return 'PREMIER ADVANTAGE';
  if (u === 'PREMIER CHOICE')    return 'PREMIER CHOICE';
  if (u === 'SECURE ADVANTAGE')  return 'SECURE ADVANTAGE';
  if (u === 'HEALTH ACCESS' || u === 'HEALTH ACCESS III') return 'HEALTH ACCESS III';
  if (u === 'ACA WRAP')          return 'ACA WRAP';
  if (u === 'SUPPY')             return 'SUPPY';
  return `OTHER (${u || 'blank'})`;
}

const buckets = new Map(); // "stage|product" → count
const declinedByProduct = new Map();

for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  const name = clean(r[0]);
  const phone = clean(r[3]);
  const email = clean(r[4]);
  const policy = clean(r[9]);
  if (!name || !(phone || email || policy)) continue;
  const stage = normalizeStage(r[16], r[15]);
  const product = normalizeMain(r[10]);
  const key = `${stage}|${product}`;
  buckets.set(key, (buckets.get(key) || 0) + 1);
  if (stage === 'Declined') {
    declinedByProduct.set(product, (declinedByProduct.get(product) || 0) + 1);
  }
}

console.log('All stage × product buckets:');
[...buckets.entries()].sort().forEach(([k, v]) => console.log(`  ${v.toString().padStart(3)}  ${k}`));

console.log('\nDeclined breakdown by product:');
[...declinedByProduct.entries()].sort((a, b) => b[1] - a[1]).forEach(([p, n]) => {
  console.log(`  ${n.toString().padStart(3)}  ${p}`);
});
const UW = ['PREMIER ADVANTAGE', 'PREMIER CHOICE', 'SECURE ADVANTAGE'];
const uwDeclined = UW.reduce((s, p) => s + (declinedByProduct.get(p) || 0), 0);
const giDeclined = declinedByProduct.get('HEALTH ACCESS III') || 0;
const otherDeclined = [...declinedByProduct.entries()].filter(([p]) => !UW.includes(p) && p !== 'HEALTH ACCESS III').reduce((s, [,n]) => s + n, 0);
console.log(`\n  UW Declined total: ${uwDeclined}`);
console.log(`  GI Declined total: ${giDeclined}`);
console.log(`  Other/blank Declined: ${otherDeclined}`);
