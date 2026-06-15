import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseSalesReport } from './salesreport.js';

const HEADER = ['AppID','Name','Product','Status','PC','Submit Date','Effective Date','Issue Date','Paid To Date','Agent Name','Premium','Fees','Assoc','Total'];
const ROWS = [
  ['02N230729F','ARIAS, MELANIE R','PREMIERADVANTAGE-24','Declined','','05/31/2026','','','','CONNERTON, BRIAN','1439.52','0.00','0.00','1439.52'],
  ['02N230729G','ARIAS, MELANIE R','CRITICAL ILLNESS','Declined','','05/31/2026','','','','CONNERTON, BRIAN','240.00','0.00','0.00','240.00'],
  ['72G238220S','ARIAS, MELANIE R','AIBCSAPPHIRE 2015','Declined','','05/31/2026','','','','CONNERTON, BRIAN','0.00','40.00','515.40','555.40'],
  ['52Y282004G','BRENNAN, DOUGLAS S','CRITICAL ILLNESS','Pending','','06/01/2026','','','','MORALES, GABRIEL','1200.00','0.00','0.00','1200.00'],
  ['52Y282004L','BRENNAN, DOUGLAS S','SECUREDENTAL HIGH','Pending','','06/01/2026','','','','MORALES, GABRIEL','434.88','0.00','0.00','434.88'],
  ['52Y281759B','CHIA, SUK','PREMIERCHOICE-15','Declined','','06/01/2026','','','','HIDALGO MICHELI, ILONKA','1496.28','0.00','0.00','1496.28'],
  ['52Y281759C','CHIA, SUK','PREMIERCHOICE-15','Declined','','06/01/2026','','','','HIDALGO MICHELI, ILONKA','179.16','0.00','0.00','179.16'],
  ['52Y281759D','CHIA, SUK','PREMCH HEALTH WELL','Declined','','06/01/2026','','','','HIDALGO MICHELI, ILONKA','224.52','0.00','0.00','224.52'],
  ['52Y281759G','CHIA, SUK','CRITICAL ILLNESS','Declined','','06/01/2026','','','','HIDALGO MICHELI, ILONKA','600.00','0.00','0.00','600.00'],
  ['52Y281759J','CHIA, SUK','PREMIERVISION','Declined','','06/01/2026','','','','HIDALGO MICHELI, ILONKA','139.08','0.00','0.00','139.08'],
  ['52Y281759L','CHIA, SUK','SECUREDENTAL HIGH','Declined','','06/01/2026','','','','HIDALGO MICHELI, ILONKA','415.20','0.00','0.00','415.20'],
  ['52Y282300F','CHIA, SUK','HEALTHACCESS III','In Force','','06/01/2026','06/01/2026','06/01/2026','06/01/2026','HIDALGO MICHELI, ILONKA','2950.44','0.00','0.00','2950.44'],
];

function wbFrom(dataRows) {
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SalesReport');
  return wb;
}

const dealsFor = (deals, namePart) => deals.filter(d => d.name.toLowerCase().includes(namePart));

test('12 product rows collapse into 4 applications (deals)', () => {
  const { deals } = parseSalesReport(wbFrom(ROWS));
  assert.equal(deals.length, 4);
});

test('CHIA SUK = 2 applications: PREMIER CHOICE and HEALTH ACCESS III', () => {
  const { deals } = parseSalesReport(wbFrom(ROWS));
  const chia = dealsFor(deals, 'chia');
  assert.equal(chia.length, 2);
  const mains = chia.map(d => d.mainProduct).sort();
  assert.deepEqual(mains, ['HEALTH ACCESS III', 'PREMIER CHOICE']);
});

test('ARIAS = 1 application: PREMIER ADVANTAGE main + SAPPHIRE association merged in', () => {
  const { deals } = parseSalesReport(wbFrom(ROWS));
  const arias = dealsFor(deals, 'arias');
  assert.equal(arias.length, 1);
  assert.equal(arias[0].mainProduct, 'PREMIER ADVANTAGE');
  assert.equal(arias[0].associationPlan, 'SAPPHIRE');
});

test('BRENNAN = 1 application (add-on-only group stays one lead)', () => {
  const { deals } = parseSalesReport(wbFrom(ROWS));
  const brennan = dealsFor(deals, 'brennan');
  assert.equal(brennan.length, 1);
});

test('each CHIA deal keeps its own AppID base (no cross-app merge)', () => {
  const { deals } = parseSalesReport(wbFrom(ROWS));
  const bases = dealsFor(deals, 'chia').map(d => d.appIdBase).sort();
  assert.deepEqual(bases, ['52Y281759', '52Y282300']);
});

test('Issued (In Force) deal is dated by ISSUE date, not submit date', () => {
  const rows = [
    // submit 03/15, effective 04/01, issue 04/10 — all different months
    ['99X999001A', 'TESTER, ISSUE D', 'PREMIERADVANTAGE-24', 'In Force', '', '03/15/2026', '04/01/2026', '04/10/2026', '04/10/2026', 'MORALES, GABRIEL', '1200.00', '0.00', '0.00', '1200.00'],
  ];
  const { deals } = parseSalesReport(wbFrom(rows));
  const d = deals.find(x => x.name.toLowerCase().includes('tester'));
  assert.ok(d, 'deal parsed');
  assert.equal(d.stage, 'Issued');
  assert.ok(d.issueDate, 'has an issue date');
  assert.equal(d.closedDate, d.issueDate);      // dated by issue date
  assert.notEqual(d.closedDate, d.submitDate);  // NOT the submit date
});

// --- Status normalization (Not Taken / Cancelled variants; no silent Pending)
import { normalizeStatus } from './salesreport.js';

test('normalizeStatus: maps real-world variants case/space-insensitively', () => {
  assert.equal(normalizeStatus('In Force'), 'Issued');
  assert.equal(normalizeStatus('  active '), 'Issued');
  assert.equal(normalizeStatus('Not Taken'), 'Not taken');
  assert.equal(normalizeStatus('NOTTAKEN'), 'Not taken');
  assert.equal(normalizeStatus('Declined'), 'Declined');
  assert.equal(normalizeStatus('Withdrawn'), 'Withdrawn');
  assert.equal(normalizeStatus('Canceled'), 'Withdrawn');
  assert.equal(normalizeStatus('Cancelled'), 'Withdrawn');
  assert.equal(normalizeStatus('Cancelled - NSF'), 'Withdrawn');
  assert.equal(normalizeStatus('Lapsed'), 'Withdrawn');
  assert.equal(normalizeStatus('Termed'), 'Withdrawn');
  assert.equal(normalizeStatus('Pending'), 'Pending');
  assert.equal(normalizeStatus('Submitted'), 'Pending');
});

test('normalizeStatus: unknown status returns null (NOT silently Pending)', () => {
  assert.equal(normalizeStatus('Frobnicated'), null);
  assert.equal(normalizeStatus(''), null);
});

// --- gapDetect: detect new policy numbers + premium corrections on re-upload
import { gapDetect } from './salesreport.js';

const _gdDeal = (over = {}) => ({
  nameKey: 'jane doe', name: 'Jane Doe', stage: 'Issued', mainProduct: 'HEALTH ACCESS III',
  mainMonthlyPremium: 100, addons: [], policyNumbers: ['52Y100000F'], ...over,
});

test('gapDetect: flags a new policy number not yet on the matched lead', () => {
  const deals = [_gdDeal({ policyNumbers: ['52Y100000F', '52Y100000G'] })];
  const leads = [{ id: 'L1', name: 'Jane Doe', stage: 'Issued', mainProduct: 'HEALTH ACCESS III', mainProductPremium: 100, policyNumber: '52Y100000F' }];
  const { mismatched } = gapDetect(deals, leads);
  const issue = mismatched[0].issues.find(i => i.kind === 'policyNumbers');
  assert.ok(issue, 'should flag new policy numbers');
  assert.deepEqual(issue.expected, ['52Y100000F', '52Y100000G']);
});

test('gapDetect: flags a premium difference', () => {
  const deals = [_gdDeal({ mainMonthlyPremium: 150 })];
  const leads = [{ id: 'L1', name: 'Jane Doe', stage: 'Issued', mainProduct: 'HEALTH ACCESS III', mainProductPremium: 100, policyNumber: '52Y100000F' }];
  const { mismatched } = gapDetect(deals, leads);
  const issue = mismatched[0].issues.find(i => i.kind === 'premium');
  assert.ok(issue);
  assert.equal(issue.expected, 150);
});

// --- buildSalesReportPatch: merge gapDetect issues into a lead patch
import { buildSalesReportPatch } from './salesreport.js';

test('buildSalesReportPatch: applies stage, product, merged policies, premium', () => {
  const lead = { id: 'L1', stage: 'Pending', mainProduct: '', mainProductPremium: 0, policyNumber: '52Y100000F' };
  const issues = [
    { kind: 'stage', expected: 'Not taken' },
    { kind: 'mainProduct', expected: 'HEALTH ACCESS III' },
    { kind: 'policyNumbers', expected: ['52Y100000F', '52Y100000G'] },
    { kind: 'premium', expected: 150 },
  ];
  const patch = buildSalesReportPatch(lead, issues);
  assert.equal(patch.stage, 'Not taken');
  assert.equal(patch.mainProduct, 'HEALTH ACCESS III');
  assert.equal(patch.policyNumber, '52Y100000F, 52Y100000G');
  assert.equal(patch.mainProductPremium, 150);
});

test('buildSalesReportPatch: empty issues → empty patch', () => {
  assert.deepEqual(buildSalesReportPatch({ id: 'L1' }, []), {});
});

// --- Parser hardening: GI/Health Access aliases, UW riders, never-drop premium
// (XLSX + parseSalesReport already imported at the top of this file)
import { dealToLead } from './salesreport.js';
import { leadPremium } from './reports.mjs';

// Build a SalesReport-shaped workbook. Columns mirror the real export:
// AppID | Name | Product | Status | PC | Submit | Eff | Issue | PaidTo | Agent
// | Premium | Fees | Assoc | Total  (parser reads r[0..3], r[5..7], r[10], r[12]).
function mkSalesWb(rows) {
  const header = ['AppID','Name','Product','Status','PC','Submit','Eff','Issue','PaidTo','Agent','Premium','Fees','Assoc','Total'];
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  return { SheetNames: ['SalesReport'], Sheets: { SalesReport: ws } };
}
const srow = (appId, name, product, status, prem, { assoc = 0, d = '06/15/2026' } = {}) =>
  [appId, name, product, status, '', d, d, d, d, 'AGENT, X', prem, 0, assoc, prem];
const avOf = (deal) => Math.round(leadPremium(dealToLead(deal, (o) => ({ ...o }))) * 12 * 100) / 100;
const findDeal = (deals, namePart) => deals.find(d => (d.name || '').toUpperCase().includes(namePart.toUpperCase()));

test('parser: Health Access recognized in all forms (HA, HA 3, HA III, HEALTH ACCESS III, HEALTHACCESS3)', () => {
  const forms = [['HA','52Y900001F'],['HA 3','52Y900002F'],['HA III','52Y900003F'],['HEALTH ACCESS III','52Y900004F'],['HEALTHACCESS3','52Y900005F']];
  for (const [form, appId] of forms) {
    const { deals } = parseSalesReport(mkSalesWb([ srow(appId, 'GICLIENT', form, 'In Force', 1200) ]));
    const d = findDeal(deals, 'GICLIENT');
    assert.equal(d.mainProduct, 'HEALTH ACCESS III', `"${form}" should map to Health Access`);
    assert.equal(avOf(d), 1200, `"${form}" AV should be 1200`);
  }
});

test('parser: HA-SECDENTPLUS stays a dental add-on, NOT Health Access — premium still counted', () => {
  const { deals } = parseSalesReport(mkSalesWb([ srow('52Y901000F', 'DENTALONLY', 'HA-SECDENTPLUS', 'In Force', 360) ]));
  const d = findDeal(deals, 'DENTALONLY');
  assert.notEqual(d.mainProduct, 'HEALTH ACCESS III');
  assert.equal(avOf(d), 360);
});

test('parser: unrecognized product premium is NEVER dropped (captured as OTHER)', () => {
  const { deals } = parseSalesReport(mkSalesWb([ srow('52Y902000F', 'WEIRDONE', 'SOME BRAND NEW PRODUCT', 'In Force', 600) ]));
  const d = findDeal(deals, 'WEIRDONE');
  assert.equal(avOf(d), 600);
});

test('parser: UW riders (Accident/Income/Life Protector) are captured', () => {
  const { deals } = parseSalesReport(mkSalesWb([
    srow('52Y903000B', 'RIDERGUY', 'PREMIERADVANTAGE', 'In Force', 1200),
    srow('52Y903000C', 'RIDERGUY', 'ACCIDENT PROTECTOR', 'In Force', 240),
    srow('52Y903000D', 'RIDERGUY', 'INCOME PROTECTOR', 'In Force', 120),
  ]));
  const d = findDeal(deals, 'RIDERGUY');
  assert.equal(avOf(d), 1560); // 1200 + 240 + 120 all counted
});

test('parser: add-on filed under a separate policy base merges WITHOUT dropping its premium', () => {
  const { deals } = parseSalesReport(mkSalesWb([
    srow('52Y904000B', 'MERGETEST', 'PREMIERADVANTAGE', 'In Force', 1200),
    srow('72G904999J', 'MERGETEST', 'PREMIERVISION',    'In Force', 240),
  ]));
  const merged = deals.filter(d => (d.name || '').toUpperCase().includes('MERGETEST'));
  assert.equal(merged.length, 1);
  assert.equal(avOf(merged[0]), 1440); // 1200 main + 240 vision
});
