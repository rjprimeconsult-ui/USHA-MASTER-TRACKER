// Verify: sum(|Reserve Withheld|) should equal 'Less Chargebacks' header total
import { readFileSync } from 'node:fs';
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

const file = process.argv[2];
const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(readFileSync(file)), disableWorker: true }).promise;

let text = '';
for (let i = 1; i <= pdf.numPages; i++) {
  const p = await pdf.getPage(i);
  const c = await p.getTextContent();
  let prevY = null;
  for (const item of c.items) {
    const y = item.transform ? item.transform[5] : null;
    if (prevY !== null && y !== null && Math.abs(y - prevY) > 1) text += '\n';
    else if (text && !text.endsWith(' ') && !text.endsWith('\n')) text += ' ';
    text += item.str;
    prevY = y;
  }
  text += '\n\n';
}

let flat = text.replace(/\s+/g, ' ');
const headers = [...flat.matchAll(/(ADVANCE DETAIL|CHARGEBACK DETAIL|REINSTATEMENT DETAIL)/g)];

const MONEY_RE = /-?\$[\d,]+\.\d{2}/g;
const POLICY_RE = /\b\d{2}[A-Z]\d{6}[A-Z]?\b/g;
const money = s => { if (!s) return 0; const n = parseFloat(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };

let grandReserve = 0, grandAdvanced = 0, totalRows = 0;

for (let i = 0; i < headers.length; i++) {
  if (headers[i][1] !== 'CHARGEBACK DETAIL') continue;
  const start = headers[i].index + headers[i][0].length;
  const end = i + 1 < headers.length ? headers[i + 1].index : flat.length;
  const section = flat.slice(start, end);
  const policies = [...section.matchAll(POLICY_RE)];

  for (let j = 0; j < policies.length; j++) {
    const p = policies[j];
    const afterStart = p.index + p[0].length;
    const nextStart = j + 1 < policies.length ? policies[j + 1].index : section.length;
    let after = section.slice(afterStart, nextStart);
    const tot = after.search(/\bTotal:/i);
    if (tot >= 0) after = after.slice(0, tot);
    const dates = [...after.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g)];
    if (dates.length < 2) continue;
    let afterDates = after.slice(dates[1].index + dates[1][0].length);
    const tot2 = afterDates.search(/\bTotal:/i);
    if (tot2 >= 0) afterDates = afterDates.slice(0, tot2);
    const moneys = (afterDates.match(MONEY_RE) || []).map(money);
    if (moneys.length < 3) continue;
    if (moneys.length > 5) moneys.length = 5;
    grandReserve += Math.abs(moneys[moneys.length - 2]);
    grandAdvanced += Math.abs(moneys[moneys.length - 3]);
    totalRows++;
  }
}

console.log(`Rows: ${totalRows}`);
console.log(`Sum |Reserve Withheld|: $${grandReserve.toFixed(2)}   (expect $3,398.31)`);
console.log(`Sum |Total Advanced|:   $${grandAdvanced.toFixed(2)}`);

await pdf.destroy();
