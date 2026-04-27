// Final verify: unique agents with 2-consecutive-caps requirement
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

const POLICY_RE = /\b\d{2}[A-Z]\d{6}[A-Z]?\b/g;
const MONEY_RE = /-?\$[\d,]+\.\d{2}/g;
const money = s => { if (!s) return 0; const n = parseFloat(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const PRODUCT_FIRST_WORDS = new Set(['MEDGUARD','PREMIER','PREM','PREMIERVISION','SECURE','SECUREADVANTAGE','SECUREDENTAL','ACCIDENT','INCOME','LIFE','HEALTHACCESS','DENTAL','VISION']);
const isPureCaps = w => /^[A-Z][A-Z']+$/.test(w) && w.length >= 2 && w.length <= 20;
const qualifies = w => isPureCaps(w) && !PRODUCT_FIRST_WORDS.has(w);
const OWNER = 'JULIO FERNANDEZ';

const headers = [...flat.matchAll(/(ADVANCE DETAIL|CHARGEBACK DETAIL|REINSTATEMENT DETAIL)/g)];
const byAgent = new Map();

for (let i = 0; i < headers.length; i++) {
  if (headers[i][1] !== 'CHARGEBACK DETAIL') continue;
  const start = headers[i].index + headers[i][0].length;
  const end = i + 1 < headers.length ? headers[i + 1].index : flat.length;
  const section = flat.slice(start, end);
  const policies = [...section.matchAll(POLICY_RE)];
  for (let j = 0; j < policies.length; j++) {
    const p = policies[j];
    const prevEnd = j === 0 ? 0 : policies[j - 1].index + policies[j - 1][0].length;
    const beforeSegment = section.slice(prevEnd, p.index).trim();
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
    const rw = Math.abs(moneys[moneys.length - 2]);

    let agent;
    if (beforeSegment.toUpperCase().includes(OWNER)) {
      agent = OWNER;
    } else {
      const words = beforeSegment.split(' ').filter(Boolean);
      let s = -1;
      for (let k = 0; k < words.length - 1; k++) {
        if (qualifies(words[k]) && qualifies(words[k + 1])) { s = k; break; }
      }
      if (s >= 0) {
        let e = s;
        while (e < words.length && e - s < 3 && qualifies(words[e])) e++;
        agent = words.slice(s, e).join(' ');
      } else {
        agent = 'UNKNOWN';
      }
    }
    const e = byAgent.get(agent) || { agent, total: 0, rows: 0 };
    e.total += rw; e.rows += 1;
    byAgent.set(agent, e);
  }
}

console.log('Chargeback writing agents (clean):');
[...byAgent.values()].sort((a, b) => b.total - a.total).forEach(a => {
  console.log(`  ${a.agent.padEnd(30)}  ${a.rows} rows  -$${a.total.toFixed(2)}`);
});

await pdf.destroy();
