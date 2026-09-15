// Nav-tab invariants for the Routine Builder (spec §9, §13.5). The tab strip is
// ordinary data, so a merge that drops or reorders an entry breaks navigation
// with no other signal — and the routine seeder reads its stage ids from a
// SECOND copy of the prospect stage list, which must never drift from the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_TABS, DEFAULT_PROSPECT_STAGES } from './constants.js';
import { DEFAULT_STAGE_IDS } from './routineModel.mjs';

test('Routine tab sits between Portal Clients and Prospects and uses the CalendarClock icon', () => {
  // Spec §9 put it directly after Overview; Juan moved it here on 2026-09-15 so it sits with
  // the two tabs it reads from. Recorded as a rev-11 deviation in the live-pass doc.
  const ids = NAV_TABS.map(t => t.id);
  assert.equal(ids[ids.indexOf('leads') + 1], 'routine');
  assert.equal(ids[ids.indexOf('routine') + 1], 'prospects');
  assert.deepEqual(NAV_TABS.find(t => t.id === 'routine'), { id: 'routine', label: 'Routine', icon: 'CalendarClock' });
  assert.equal(NAV_TABS.length, 15);
});

test('routineModel DEFAULT_STAGE_IDS mirrors constants.js DEFAULT_PROSPECT_STAGES (seeding must not desync)', () => {
  assert.deepEqual([...DEFAULT_STAGE_IDS].sort(), DEFAULT_PROSPECT_STAGES.map(s => s.id).sort());
});
