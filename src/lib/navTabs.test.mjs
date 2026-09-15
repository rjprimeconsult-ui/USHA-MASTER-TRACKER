// Nav-tab invariants for the Routine Builder (spec §9, §13.5). The tab strip is
// ordinary data, so a merge that drops or reorders an entry breaks navigation
// with no other signal — and the routine seeder reads its stage ids from a
// SECOND copy of the prospect stage list, which must never drift from the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_TABS, DEFAULT_PROSPECT_STAGES } from './constants.js';
import { DEFAULT_STAGE_IDS } from './routineModel.mjs';

test('Routine tab sits right after Overview and uses the CalendarClock icon (spec §9)', () => {
  const ids = NAV_TABS.map(t => t.id);
  assert.equal(ids[ids.indexOf('dashboard') + 1], 'routine');
  assert.deepEqual(NAV_TABS.find(t => t.id === 'routine'), { id: 'routine', label: 'Routine', icon: 'CalendarClock' });
  assert.equal(NAV_TABS.length, 15);
});

test('routineModel DEFAULT_STAGE_IDS mirrors constants.js DEFAULT_PROSPECT_STAGES (seeding must not desync)', () => {
  assert.deepEqual([...DEFAULT_STAGE_IDS].sort(), DEFAULT_PROSPECT_STAGES.map(s => s.id).sort());
});
