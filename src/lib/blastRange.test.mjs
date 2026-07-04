import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLeadRange, joinLeadRange } from './blastRange.mjs';

test('splits on a space-surrounded arrow', () => {
  assert.deepEqual(splitLeadRange('01/01/2025 → 05/31/2026'), { start: '01/01/2025', end: '05/31/2026' });
});
test('splits on a space-surrounded hyphen', () => {
  assert.deepEqual(splitLeadRange('01/01/2025 - 05/31/2026'), { start: '01/01/2025', end: '05/31/2026' });
});
test('splits on the word "to"', () => {
  assert.deepEqual(splitLeadRange('Jan 1 2025 to May 31 2026'), { start: 'Jan 1 2025', end: 'May 31 2026' });
});
test('does NOT split a hyphenated single date', () => {
  assert.deepEqual(splitLeadRange('03-26-2026'), { start: '03-26-2026', end: '' });
});
test('single date → start only', () => {
  assert.deepEqual(splitLeadRange('01/01/2025'), { start: '01/01/2025', end: '' });
});
test('blank → both empty', () => {
  assert.deepEqual(splitLeadRange('   '), { start: '', end: '' });
});
test('join renders canonical arrow, or a lone start, or empty', () => {
  assert.equal(joinLeadRange('01/01/2025', '05/31/2026'), '01/01/2025 → 05/31/2026');
  assert.equal(joinLeadRange('01/01/2025', ''), '01/01/2025');
  assert.equal(joinLeadRange('', ''), '');
});
