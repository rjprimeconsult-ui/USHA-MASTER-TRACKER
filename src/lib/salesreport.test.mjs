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
