import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
const file = process.argv[2];
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets['SalesReport'], { header: 1, defval: '', raw: false });
const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, ' ');

// Column indexes: 0=AppID 1=Name 2=Product 3=Status 4=PC 5=SubmitDate 6=EffectiveDate 7=IssueDate 8=PaidToDate 9=Agent 10=Premium 11=Fees 12=Assoc 13=Total

const statusCounts = new Map();
const productCounts = new Map();
const agentCounts = new Map();
const suffixCounts = new Map();
const customerDeals = new Map(); // customer → set of 10-char prefixes

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const appId = clean(r[0]);
  const name = clean(r[1]);
  const product = clean(r[2]);
  const status = clean(r[3]);
  const agent = clean(r[9]);
  if (!appId) continue;

  statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  productCounts.set(product, (productCounts.get(product) || 0) + 1);
  agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1);

  // AppID structure: 9-10 chars base + 1-letter suffix
  const suffix = appId.slice(-1);
  suffixCounts.set(suffix, (suffixCounts.get(suffix) || 0) + 1);

  const prefix = appId.slice(0, -1);
  const k = name + '|' + prefix;
  if (!customerDeals.has(name)) customerDeals.set(name, new Set());
  customerDeals.get(name).add(prefix);
}

console.log('Total rows:', rows.length - 1);
console.log('\nStatus values:');
[...statusCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  "${k}"`));
console.log('\nAgents:');
[...agentCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  "${k}"`));
console.log('\nAppID suffixes:');
[...suffixCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  "${k}"`));
console.log('\nDistinct products (top 25):');
[...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  "${k}"`));
console.log(`\nUnique customers: ${customerDeals.size}`);
let multiDealCustomers = 0;
for (const [name, prefixes] of customerDeals) {
  if (prefixes.size > 1) multiDealCustomers++;
}
console.log(`Customers with multiple deals (policies): ${multiDealCustomers}`);
