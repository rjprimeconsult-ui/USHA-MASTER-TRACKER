import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_TEMPLATE, BLANK_TEMPLATE, TEMPLATES } from './routineTemplates.mjs';
import { paletteById } from './routinePalette.mjs';

const dur = (e) => e.durationMin ?? paletteById(e.paletteId).defaultMin;

test('starter is collision-free, sorted, never crosses midnight, 11 entries', () => {
  const es = STARTER_TEMPLATE.entries;
  assert.equal(es.length, 11);
  for (let i = 1; i < es.length; i++) assert.ok(es[i].startMin >= es[i - 1].startMin + dur(es[i - 1]), `overlap at ${i}`);
  for (const e of es) {
    assert.ok(paletteById(e.paletteId), e.paletteId);
    assert.ok(e.startMin + dur(e) <= 1440);
    assert.equal(e.startMin % 5, 0);
  }
});

test('starter shape pins (spec §7e)', () => {
  const es = STARTER_TEMPLATE.entries;
  assert.deepEqual(es.map(e => e.startMin), [480, 510, 630, 645, 675, 750, 795, 915, 930, 990, 1035]);
  assert.equal(es[5].name, 'Lunch');
  assert.equal(es[5].paletteId, 'break');
  assert.equal(es[10].name, 'Day wrap-up');
  assert.equal(es[10].paletteId, 'review');
  assert.equal(es[1].note, 'Fresh leads first. Aim for 40 dials.');
});

test('blank has no entries; TEMPLATES lists both', () => {
  assert.deepEqual(BLANK_TEMPLATE.entries, []);
  assert.deepEqual(TEMPLATES.map(t => t.id), ['agent-day', 'blank']);
});
