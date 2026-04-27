import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const targets = process.argv.slice(3);

const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
console.log('=== All sheets ===');
console.log(wb.SheetNames.map((n, i) => `  ${i}: "${n}"`).join('\n'));

for (const target of targets) {
  const sheet = wb.Sheets[target];
  if (!sheet) {
    console.log(`\n!! Sheet "${target}" NOT FOUND`);
    continue;
  }
  console.log(`\n=== "${target}" ===`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  console.log(`Row count: ${rows.length}`);
  if (rows.length === 0) continue;
  // Print first 15 rows so we see headers + samples
  const cap = Math.min(15, rows.length);
  for (let i = 0; i < cap; i++) {
    const r = rows[i].map(c => {
      const s = String(c ?? '');
      return s.length > 30 ? s.slice(0, 27) + '...' : s;
    });
    console.log(`  [${i}] ${r.join(' | ')}`);
  }
  if (rows.length > cap) console.log(`  ... (${rows.length - cap} more rows)`);
}
