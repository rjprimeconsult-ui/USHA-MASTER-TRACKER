import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const ws = wb.Sheets['2026 PORTAL CLIENTS'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

const uwCounts = {};
const psCounts = {};
const pairs = {};
for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  const name = String(r[0] || '').trim();
  if (!name) continue;
  const uw = String(r[15] || '').trim().toUpperCase();
  const ps = String(r[16] || '').trim().toUpperCase();
  if (uw) uwCounts[uw] = (uwCounts[uw] || 0) + 1;
  if (ps) psCounts[ps] = (psCounts[ps] || 0) + 1;
  const key = `${uw} → ${ps}`;
  pairs[key] = (pairs[key] || 0) + 1;
}

console.log('UW STATUS values:');
Object.entries(uwCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));
console.log('\nPOLICY STATUS values:');
Object.entries(psCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));
console.log('\nUW → POLICY pairs:');
Object.entries(pairs).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));
