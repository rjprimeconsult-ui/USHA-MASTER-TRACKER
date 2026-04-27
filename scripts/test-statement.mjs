// End-to-end test of the fixed parser against the real PDF.
import { readFileSync } from 'node:fs';
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

const file = process.argv[2];
const buffer = readFileSync(file);
const pdf = await (pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise);

let text = '';
for (let i = 1; i <= pdf.numPages; i++) {
  const p = await pdf.getPage(i);
  const content = await p.getTextContent();
  let prevY = null;
  for (const item of content.items) {
    const y = item.transform ? item.transform[5] : null;
    if (prevY !== null && y !== null && Math.abs(y - prevY) > 1) text += '\n';
    else if (text && !text.endsWith(' ') && !text.endsWith('\n')) text += ' ';
    text += item.str;
    prevY = y;
  }
  text += '\n\n';
}

// Inline copy of parsing logic
const money = s => { if (!s) return 0; const n = parseFloat(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };

const ownerMatch = text.slice(0, 2000).match(/^\s*([A-Z][A-Z' .-]+[A-Z])\s*\n.*?Title:\s*(\w+)/s);
const owner = ownerMatch?.[1]?.trim() || '';
const tier = ownerMatch?.[2]?.trim() || '';
console.log(`Owner: "${owner}"  Tier: ${tier}`);

let flat = text.replace(/\s+/g, ' ');
const adIdx = flat.indexOf('ADVANCE DETAIL');
const reIdx = flat.indexOf('REINSTATEMENT DETAIL');
if (adIdx >= 0) flat = flat.slice(adIdx);
if (reIdx > adIdx) flat = flat.slice(0, reIdx - adIdx);

const ownerUpper = owner.toUpperCase().trim();
const policyMatches = [...flat.matchAll(/\b(\d{2}[A-Z]\d{6}[A-Z]?)\b/g)];
console.log(`Policy IDs found: ${policyMatches.length}`);

let ownSales = 0, overrides = 0;
const ownCustomers = new Map();
const overrideAgents = new Map();

for (let i = 0; i < policyMatches.length; i++) {
  const m = policyMatches[i];
  const prevEnd = i === 0 ? 0 : policyMatches[i - 1].index + policyMatches[i - 1][0].length;
  const beforeSegment = flat.slice(prevEnd, m.index).trim();

  let writingAgent = '';
  if (ownerUpper && beforeSegment.toUpperCase().includes(ownerUpper)) {
    writingAgent = owner;
    ownSales += 1;
  } else {
    const words = beforeSegment.split(' ').filter(Boolean);
    const isNameCaps = w => /^[A-Z][A-Z'.]*$/.test(w) && w.length <= 20;
    let end = words.length;
    while (end > 0 && !isNameCaps(words[end - 1])) end--;
    let start = end;
    while (start > 0 && isNameCaps(words[start - 1])) start--;
    if (end - start > 3) start = end - 3;
    writingAgent = (end - start >= 2) ? words.slice(start, end).join(' ') : 'UNKNOWN';
    overrides += 1;
  }

  // Customer + money
  const afterStart = m.index + m[0].length;
  const nextStart = i + 1 < policyMatches.length ? policyMatches[i + 1].index : flat.length;
  const afterSegment = flat.slice(afterStart, nextStart);
  const dateIter = [...afterSegment.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)];
  if (dateIter.length < 2) continue;
  const customer = afterSegment.slice(0, dateIter[0].index).replace(/\s+/g, ' ').trim();
  const afterDates = afterSegment.slice(dateIter[1].index + dateIter[1][0].length);
  const moneys = (afterDates.match(/-?\$[\d,]+\.\d{2}/g) || []).map(money);
  const netAdvance = moneys[moneys.length - 1] || 0;

  if (writingAgent === owner) {
    const prev = ownCustomers.get(customer.toLowerCase()) || { name: customer, total: 0, rows: 0 };
    prev.total += netAdvance;
    prev.rows += 1;
    ownCustomers.set(customer.toLowerCase(), prev);
  } else {
    const k = writingAgent.toLowerCase();
    const e = overrideAgents.get(k) || { agent: writingAgent, total: 0, rows: 0 };
    e.total += netAdvance; e.rows += 1;
    overrideAgents.set(k, e);
  }
}

console.log(`\nOwn-sales rows:  ${ownSales}`);
console.log(`Override rows:   ${overrides}`);
console.log(`\nOwn-sales customers (summed Net Advance):`);
[...ownCustomers.values()].sort((a, b) => b.total - a.total).forEach(c => {
  console.log(`  ${c.name.padEnd(30)}  ${c.rows} rows  $${c.total.toFixed(2)}`);
});
console.log(`\nOverride writing agents (top 10):`);
[...overrideAgents.values()].sort((a, b) => b.total - a.total).slice(0, 10).forEach(a => {
  console.log(`  ${a.agent.padEnd(30)}  ${a.rows} rows  $${a.total.toFixed(2)}`);
});

await pdf.destroy();
