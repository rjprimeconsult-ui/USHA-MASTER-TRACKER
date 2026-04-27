import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
const file = process.argv[2];
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' ');

// Check PORTAL CLIENTS
const portal = XLSX.utils.sheet_to_json(wb.Sheets['2026 PORTAL CLIENTS'], { header: 1, defval: '', raw: false });
const targets = [
  'camilla campbell','william forish','valarie moreno','denise mcqueen',
  'donatello dolcimascolo','nicole jones','pablo perini','robert foreman',
  'adam davis','toni bethea-byrd','chris weston','lajuan kent',
];

console.log('PORTAL CLIENTS entries (DATE SUBMITTED for each matching lead):\n');
for (let i = 4; i < portal.length; i++) {
  const r = portal[i];
  const name = clean(r[0]).toLowerCase();
  if (!targets.some(t => name.includes(t))) continue;
  console.log(`  Row ${i}: "${clean(r[0])}"  DATE SUBMITTED = "${clean(r[5])}"  POLICY = "${clean(r[9])}"  PREMIUM = "${clean(r[18])}"`);
}

// Check BOUGHT LEAD TRACKER
const bought = XLSX.utils.sheet_to_json(wb.Sheets['BOUGHT LEAD TRACKER'], { header: 1, defval: '', raw: false });
console.log('\nBOUGHT LEAD TRACKER entries (DAY PURCHASED and DATE SOLD):\n');
for (let i = 5; i < bought.length; i++) {
  const r = bought[i];
  const name = clean(r[0]).toLowerCase();
  if (!targets.some(t => name.includes(t))) continue;
  console.log(`  Row ${i}: "${clean(r[0])}"  DAY PURCHASED = "${clean(r[3])}"  DATE SOLD = "${clean(r[4])}"`);
}
