// Inline copy of the parser for node testing
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z\s']/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ').replace(/\b[a-z]\b/g, ' ').replace(/\s+/g, ' ').trim();
}
const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' ');
const money = v => { const n = parseFloat(String(v || '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const parseDate = v => {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) { let [, mm, dd, yy] = m; if (yy.length === 2) yy = (parseInt(yy) > 50 ? '19' : '20') + yy; return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; }
  return null;
};
function flipName(s) {
  s = clean(s); const m = s.match(/^([^,]+),\s*(.+)$/); if (!m) return s;
  return (m[2].trim() + ' ' + m[1].trim()).toLowerCase().replace(/\b(\w)/g, c => c.toUpperCase());
}

const MAIN = [{ re: /^PREMIERADVANTAGE/i, id: 'PREMIER ADVANTAGE' },{ re: /^PREMIERCHOICE/i, id: 'PREMIER CHOICE' },{ re: /^HEALTHACCESS/i, id: 'HEALTH ACCESS III' },{ re: /^SECURE ADV SICKNESS/i, id: 'SECURE ADVANTAGE' }];
const SA = [/^SECURE ADV SICKNESS/i, /^SECURE ADV ACCIDENT/i, /^SECADV HLTH WELL PLS/i, /^SECADV HLTH PLUS/i];
const PC = [/^PREMIERCHOICE/i, /^PREMCH HEALTH WELL/i];
const ADDONS = [{ re: /^CRITICAL ILLNESS/i, id: 'MEDGUARD III' }, { re: /^PREMIERVISION/i, id: 'PREMIERVISION' }, { re: /^SECUREDENTAL/i, id: 'DENTAL / SECUREDENTAL' }, { re: /^HA-SECDENTPLUS/i, id: 'DENTAL / SECUREDENTAL' }];
const ASSOC = [{ re: /EXECDIAMOND/i, id: 'EXECUTIVE DIAMOND' }, { re: /^AIBCDIAMOND/i, id: 'DIAMOND' }, { re: /EMERALD/i, id: 'EMERALD' }, { re: /SAPPHIRE/i, id: 'SAPPHIRE' }, { re: /RUBY/i, id: 'RUBY' }, { re: /ABCELITE/i, id: 'ABC ELITE' }, { re: /ABCEXECUTIVE/i, id: 'ABC EXECUTIVE' }, { re: /ABCENTREPRENEUR/i, id: 'ABC ENTREPRENEUR' }, { re: /^AIBC PRO/i, id: 'PRO WRAP' }];
const STATUS = { 'In Force':'Issued','Not Taken':'Not taken','Declined':'Declined','Withdrawn':'Withdrawn','Pending':'Pending','Canceled':'Withdrawn' };

const file = process.argv[2];
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets['SalesReport'], { header: 1, defval: '', raw: false });

const byDeal = new Map();
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const appId = clean(r[0]), name = clean(r[1]), product = clean(r[2]), status = clean(r[3]);
  if (!appId || !name) continue;
  const base = appId.slice(0, -1);
  const k = `${nameKey(name)}|${base}`;
  if (!byDeal.has(k)) byDeal.set(k, { nameKey: nameKey(name), name: flipName(name), appIdBase: base, policyNumbers: [], mainProduct:'', mainMonthlyPremium:0, associationPlan:'', addons:[], mainRowStatus:null, stageVotes:{}, submitDate:null });
  const d = byDeal.get(k);
  d.policyNumbers.push(appId);
  const sd = parseDate(r[5]); if (sd && (!d.submitDate || sd < d.submitDate)) d.submitDate = sd;
  d.stageVotes[status] = (d.stageVotes[status] || 0) + 1;
  const av = money(r[10]);
  const isSA = SA.some(re => re.test(product));
  const isPC = PC.some(re => re.test(product));
  const mainHit = MAIN.find(p => p.re.test(product));
  const addonHit = ADDONS.find(p => p.re.test(product));
  const assocHit = ASSOC.find(p => p.re.test(product));
  if (isSA) { if (!d.mainProduct) d.mainProduct = 'SECURE ADVANTAGE'; if (/SICKNESS/i.test(product)) d.mainRowStatus = status; d.mainMonthlyPremium += av / 12; }
  else if (isPC) { if (!d.mainProduct) d.mainProduct = 'PREMIER CHOICE'; if (/^PREMIERCHOICE/i.test(product)) d.mainRowStatus = status; d.mainMonthlyPremium += av / 12; }
  else if (mainHit) { if (!d.mainProduct) { d.mainProduct = mainHit.id; d.mainRowStatus = status; } d.mainMonthlyPremium += av / 12; }
  else if (addonHit) d.addons.push({ id: addonHit.id, monthlyPremium: av / 12 });
  else if (assocHit) d.associationPlan = assocHit.id;
}

const deals = [...byDeal.values()];
const orphanAssociations = [];
const finalDeals = [];
for (const d of deals) {
  if (d.mainProduct) finalDeals.push(d);
  else if (d.associationPlan) orphanAssociations.push(d);
  else finalDeals.push(d);
}
for (const orphan of orphanAssociations) {
  const candidates = finalDeals.filter(d => d.nameKey === orphan.nameKey && d.mainProduct);
  if (candidates.length === 0) { finalDeals.push(orphan); continue; }
  candidates.sort((a, b) => Math.abs(new Date(a.submitDate || '1970-01-01') - new Date(orphan.submitDate || '1970-01-01')) - Math.abs(new Date(b.submitDate || '1970-01-01') - new Date(orphan.submitDate || '1970-01-01')));
  const t = candidates[0];
  if (!t.associationPlan) t.associationPlan = orphan.associationPlan;
  t.policyNumbers.push(...orphan.policyNumbers);
}
for (const d of finalDeals) {
  d.stage = STATUS[d.mainRowStatus] || STATUS[Object.entries(d.stageVotes).sort((a,b)=>b[1]-a[1])[0]?.[0]] || 'Pending';
}

const withMain = finalDeals.filter(d => d.mainProduct);
const withoutMain = finalDeals.filter(d => !d.mainProduct);

console.log(`${rows.length - 1} product rows → ${finalDeals.length} deals`);
console.log(`  ${withMain.length} with main product`);
console.log(`  ${withoutMain.length} with no main product`);

const byStage = {}; const byProd = {};
for (const d of finalDeals) { byStage[d.stage] = (byStage[d.stage]||0)+1; byProd[d.mainProduct||'(none)']=(byProd[d.mainProduct||'(none)']||0)+1; }
console.log('\nDeals by stage:'); Object.entries(byStage).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${v.toString().padStart(3)}  ${k}`));
console.log('\nDeals by main product:'); Object.entries(byProd).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${v.toString().padStart(3)}  ${k}`));

console.log('\n5 sample deals:');
withMain.slice(0, 5).forEach((d, i) => {
  console.log(`  ${i+1}. ${d.name} · ${d.mainProduct} @ $${d.mainMonthlyPremium.toFixed(2)}/mo · stage=${d.stage}${d.associationPlan ? ' · assoc=' + d.associationPlan : ''}${d.addons.length ? ' · addons=[' + d.addons.map(a => a.id).join(', ') + ']' : ''}`);
});
