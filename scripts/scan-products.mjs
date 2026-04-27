import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
const file = process.argv[2];
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const portal = wb.Sheets['2026 PORTAL CLIENTS'];
const rows = XLSX.utils.sheet_to_json(portal, { header: 1, defval: '', raw: false });
const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' ').toUpperCase();
const counts = new Map();
for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  const name = clean(r[0]);
  if (!name || !(clean(r[3]) || clean(r[4]) || clean(r[9]))) continue;
  const p = clean(r[10]);
  counts.set(p, (counts.get(p) || 0) + 1);
}
console.log('All distinct Main Product (POLICY TYPE) values:');
[...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(3)}  "${k}"`));
