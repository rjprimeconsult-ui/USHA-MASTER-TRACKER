// Trace a specific lead through both the PORTAL and BOUGHT sheets
// to verify the stage it would come out with.
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const file = process.argv[2];
const targetName = (process.argv[3] || '').toLowerCase();

const wb = XLSX.read(readFileSync(file), { type: 'buffer' });

function cleanMulti(v) { return String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' '); }

// PORTAL CLIENTS sheet
const portal = wb.Sheets['2026 PORTAL CLIENTS'];
const portalRows = XLSX.utils.sheet_to_json(portal, { header: 1, defval: '', raw: false });
console.log(`PORTAL CLIENTS rows: ${portalRows.length}`);
for (let i = 4; i < portalRows.length; i++) {
  const r = portalRows[i];
  const name = cleanMulti(r[0]);
  if (!name.toLowerCase().includes(targetName)) continue;
  console.log(`\nPORTAL row ${i}: "${name}"`);
  console.log(`  State: "${r[2]}"`);
  console.log(`  Phone: "${r[3]}"`);
  console.log(`  Date submitted: "${r[5]}"`);
  console.log(`  Association: "${r[8]}"`);
  console.log(`  Main product: "${r[10]}"`);
  console.log(`  UW STATUS (r[15]): "${r[15]}"`);
  console.log(`  POLICY STATUS (r[16]): "${r[16]}"`);
  console.log(`  PREMIUM (r[18]): "${r[18]}"`);
}

// BOUGHT LEAD TRACKER sheet
const bought = wb.Sheets['BOUGHT LEAD TRACKER'];
const boughtRows = XLSX.utils.sheet_to_json(bought, { header: 1, defval: '', raw: false });
console.log(`\n\nBOUGHT LEAD TRACKER rows: ${boughtRows.length}`);
for (let i = 5; i < boughtRows.length; i++) {
  const r = boughtRows[i];
  const name = cleanMulti(r[0]);
  if (!name.toLowerCase().includes(targetName)) continue;
  console.log(`\nBOUGHT row ${i}: "${name}"`);
  console.log(`  Month Sold (r[2]): "${r[2]}"`);
  console.log(`  Day Purchased (r[3]): "${r[3]}"`);
  console.log(`  Date Sold (r[4]): "${r[4]}"`);
  console.log(`  CRM (r[5]): "${r[5]}"`);
  console.log(`  Campaign (r[6]): "${r[6]}"`);
  console.log(`  Price (r[7]): "${r[7]}"`);
  console.log(`  Commission (r[8]): "${r[8]}"`);
}
