// Find all rows that look like junk (section headers, labels, etc.)
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const file = process.argv[2];
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const portal = wb.Sheets['2026 PORTAL CLIENTS'];
const rows = XLSX.utils.sheet_to_json(portal, { header: 1, defval: '', raw: false });

const clean = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' ');

// Rows with NO phone AND NO email AND NO policy number — likely section headers
console.log('Rows with no phone / email / policy — these are likely junk:');
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const name = clean(r[0]);
  const phone = clean(r[3]);
  const email = clean(r[4]);
  const policyNo = clean(r[9]);
  if (!name) continue;
  if (!phone && !email && !policyNo) {
    console.log(`  row ${i}: name="${name}"  state="${clean(r[2])}"  mainProduct="${clean(r[10])}"  uw="${clean(r[15])}"  policy="${clean(r[16])}"`);
  }
}
