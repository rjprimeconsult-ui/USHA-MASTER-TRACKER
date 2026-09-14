import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, paletteById, CATEGORIES } from './routinePalette.mjs';

test('10 entries, unique ids, every category whitelisted, one hex each', () => {
  assert.equal(PALETTE.length, 10);
  assert.equal(new Set(PALETTE.map(p => p.id)).size, 10);
  for (const p of PALETTE) {
    assert.ok(CATEGORIES.includes(p.category), p.id);
    assert.match(p.hex, /^#[0-9a-f]{6}$/);
    assert.ok(p.defaultMin >= 10 && p.defaultMin % 5 === 0);
    assert.equal(typeof p.defaultRemind, 'boolean');
    assert.ok(p.why.length > 10);
  }
});

test('no palette hue is amber #f59e0b (amber text is reserved for the loss marker — spec §7d)', () => {
  assert.ok(PALETTE.every(p => p.hex.toLowerCase() !== '#f59e0b'));
});

test('break is the only category that defaults reminders off; both appt entries share #8b5cf6', () => {
  assert.deepEqual(PALETTE.filter(p => !p.defaultRemind).map(p => p.id), ['break']);
  assert.equal(paletteById('webby').hex, '#8b5cf6');
  assert.equal(paletteById('inperson').hex, '#8b5cf6');
  assert.equal(paletteById('nope'), null);
});
