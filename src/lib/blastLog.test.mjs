import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlastPayload, normPlatform, blastKey, upsertBlast, aggregateBlast } from './blastLog.mjs';

const NOW = '2026-06-22T12:00:00.000Z';

test('normPlatform maps to Ringy / Textdrip', () => {
  assert.equal(normPlatform('Ringy'), 'Ringy');
  assert.equal(normPlatform('ringy'), 'Ringy');
  assert.equal(normPlatform('Textdrip'), 'Textdrip');
  assert.equal(normPlatform('TEXTDRIP'), 'Textdrip');
  assert.equal(normPlatform('TextDrip'), 'Textdrip');
});

test('normalize: blast-log.csv field names', () => {
  const n = normalizeBlastPayload({
    run_date: '2026-06-16',
    platform: 'Ringy',
    range_start: '2025-01-01',
    range_end: '2026-05-31',
    campaign_or_tag: 'REPUROSED - AGED - POST O/E DRIP',
    contacts: '2000',
    send_time: '10:30',
    numbers_used: '',
    notes: 'blast 1 of 2',
  });
  assert.equal(n.runDate, '2026-06-16');
  assert.equal(n.platform, 'Ringy');
  assert.equal(n.rangeStart, '2025-01-01');
  assert.equal(n.rangeEnd, '2026-05-31');
  assert.equal(n.campaignOrTag, 'REPUROSED - AGED - POST O/E DRIP');
  assert.equal(n.contacts, 2000);
  assert.equal(n.sendTime, '10:30');
  assert.equal(n.notes, 'blast 1 of 2');
});

test('normalize: camelCase + messy contacts coerce to a number', () => {
  const n = normalizeBlastPayload({
    runDate: '2026-06-17', platform: 'textdrip',
    campaignOrTag: 'New Aged leads TEST', contacts: '4,587 contacts',
    sendTime: '12:30', numbersUsed: '+17722527748;+16305800482',
  });
  assert.equal(n.platform, 'Textdrip');
  assert.equal(n.contacts, 4587);
  assert.equal(n.numbersUsed, '+17722527748;+16305800482');
});

test('upsert: appends a new blast', () => {
  const { list, action } = upsertBlast([], normalizeBlastPayload({ run_date: '2026-06-16', platform: 'Ringy', send_time: '10:30', campaign_or_tag: 'AGED', contacts: 2000 }), NOW);
  assert.equal(action, 'create');
  assert.equal(list.length, 1);
  assert.equal(list[0].contacts, 2000);
  assert.ok(list[0].id);
  assert.equal(list[0].createdAt, NOW);
});

test('upsert: same date+platform+time+campaign updates in place (re-POST safe)', () => {
  const first = upsertBlast([], normalizeBlastPayload({ run_date: '2026-06-16', platform: 'Ringy', send_time: '10:30', campaign_or_tag: 'AGED', contacts: 2000 }), NOW);
  const second = upsertBlast(first.list, normalizeBlastPayload({ run_date: '2026-06-16', platform: 'Ringy', send_time: '10:30', campaign_or_tag: 'AGED', contacts: 2050, notes: 'corrected' }), NOW);
  assert.equal(second.action, 'update');
  assert.equal(second.list.length, 1);            // not duplicated
  assert.equal(second.list[0].contacts, 2050);    // refreshed
  assert.equal(second.list[0].notes, 'corrected');
  assert.equal(second.list[0].id, first.list[0].id); // same record
});

test('upsert: two blasts same day, different send time = two rows', () => {
  let list = [];
  ({ list } = upsertBlast(list, normalizeBlastPayload({ run_date: '2026-06-16', platform: 'Ringy', send_time: '10:30', campaign_or_tag: 'AGED', contacts: 2000 }), NOW));
  const r2 = upsertBlast(list, normalizeBlastPayload({ run_date: '2026-06-16', platform: 'Ringy', send_time: '12:30', campaign_or_tag: 'AGED', contacts: 2000 }), NOW);
  assert.equal(r2.action, 'create');
  assert.equal(r2.list.length, 2);
});

test('upsert: same date/time/campaign, different platform = two rows', () => {
  let list = [];
  ({ list } = upsertBlast(list, normalizeBlastPayload({ run_date: '2026-06-16', platform: 'Ringy', send_time: '10:30', campaign_or_tag: 'AGED' }), NOW));
  const r2 = upsertBlast(list, normalizeBlastPayload({ run_date: '2026-06-16', platform: 'Textdrip', send_time: '10:30', campaign_or_tag: 'AGED' }), NOW);
  assert.equal(r2.action, 'create');
  assert.equal(r2.list.length, 2);
});

test('upsert: same day/platform/time/campaign but different range = two rows', () => {
  let list = [];
  ({ list } = upsertBlast(list, normalizeBlastPayload({ run_date: '2026-06-17', platform: 'Textdrip', send_time: '12:30', campaign_or_tag: 'New Aged leads TEST', range_start: '2026-02-04', range_end: '2026-02-14', contacts: 4587 }), NOW));
  const r2 = upsertBlast(list, normalizeBlastPayload({ run_date: '2026-06-17', platform: 'Textdrip', send_time: '12:30', campaign_or_tag: 'New Aged leads TEST', range_start: '2026-02-15', range_end: '2026-02-22', contacts: 4679 }), NOW);
  assert.equal(r2.action, 'create');
  assert.equal(r2.list.length, 2);
});

test('upsert: re-POST preserves original id + createdAt, refreshes contacts', () => {
  const first = upsertBlast([], normalizeBlastPayload({ run_date: '2026-06-16', platform: 'Ringy', send_time: '10:30', campaign_or_tag: 'AGED', contacts: 2000 }), '2026-06-16T10:00:00.000Z');
  const second = upsertBlast(first.list, normalizeBlastPayload({ run_date: '2026-06-16', platform: 'Ringy', send_time: '10:30', campaign_or_tag: 'AGED', contacts: 2050 }), '2026-06-16T11:00:00.000Z');
  assert.equal(second.action, 'update');
  assert.equal(second.list[0].id, first.list[0].id);
  assert.equal(second.list[0].createdAt, first.list[0].createdAt); // not bumped
  assert.equal(second.list[0].contacts, 2050);
});

test('blastKey is case/space-insensitive on the parts', () => {
  const a = { runDate: '2026-06-16', platform: 'Ringy', sendTime: '10:30', campaignOrTag: 'AGED' };
  const b = { runDate: '2026-06-16', platform: 'ringy', sendTime: ' 10:30 ', campaignOrTag: 'aged' };
  assert.equal(blastKey(a), blastKey(b));
});

// ============================================================
// aggregateBlast — increment semantics (Ringy per-lead fan-out)
// ============================================================
function ringyRec() {
  return { runDate: '2026-06-22', platform: 'Ringy', rangeStart: '', rangeEnd: '', campaignOrTag: 'REPUROSED - AGED - POST O/E DRIP', sendTime: '', numbersUsed: '', notes: '' };
}

test('aggregateBlast: first hit creates a row with contacts = incBy', () => {
  const { list, action } = aggregateBlast([], ringyRec(), NOW, 1);
  assert.equal(action, 'create');
  assert.equal(list.length, 1);
  assert.equal(list[0].contacts, 1);
  assert.equal(list[0].source, 'auto');
  assert.ok(list[0].id);
  assert.equal(list[0].createdAt, NOW);
});

test('aggregateBlast: 2,000 per-lead hits accumulate to 2000 (not stuck at 1)', () => {
  let list = [];
  for (let i = 0; i < 2000; i++) {
    ({ list } = aggregateBlast(list, ringyRec(), NOW, 1));
  }
  assert.equal(list.length, 1);            // one daily entry, not 2000 rows
  assert.equal(list[0].contacts, 2000);    // the whole point
});

test('aggregateBlast: ignores record.contacts — tally is driven by incBy', () => {
  let list = [];
  ({ list } = aggregateBlast(list, { ...ringyRec(), contacts: 999 }, NOW, 1));
  ({ list } = aggregateBlast(list, { ...ringyRec(), contacts: 999 }, NOW, 1));
  assert.equal(list[0].contacts, 2);
});

test('aggregateBlast: respects an explicit incBy batch size', () => {
  let list = [];
  ({ list } = aggregateBlast(list, ringyRec(), NOW, 50));
  ({ list } = aggregateBlast(list, ringyRec(), NOW, 25));
  assert.equal(list[0].contacts, 75);
});

test('aggregateBlast: different day = a separate daily row', () => {
  let list = [];
  ({ list } = aggregateBlast(list, ringyRec(), NOW, 1));
  ({ list } = aggregateBlast(list, { ...ringyRec(), runDate: '2026-06-23' }, NOW, 1));
  assert.equal(list.length, 2);
});

test('aggregateBlast: different tag same day = a separate row', () => {
  let list = [];
  ({ list } = aggregateBlast(list, ringyRec(), NOW, 1));
  ({ list } = aggregateBlast(list, { ...ringyRec(), campaignOrTag: 'REPUROSED - YOUNG' }, NOW, 1));
  assert.equal(list.length, 2);
});

test('aggregateBlast: preserves id/createdAt across accumulation, stamps lastAt', () => {
  let list = [];
  ({ list } = aggregateBlast(list, ringyRec(), '2026-06-22T10:00:00.000Z', 1));
  const firstId = list[0].id;
  ({ list } = aggregateBlast(list, ringyRec(), '2026-06-22T10:05:00.000Z', 1));
  assert.equal(list[0].id, firstId);
  assert.equal(list[0].createdAt, '2026-06-22T10:00:00.000Z');
  assert.equal(list[0].lastAt, '2026-06-22T10:05:00.000Z');
});

test('aggregateBlast: does not mutate the input list', () => {
  const orig = [];
  aggregateBlast(orig, ringyRec(), NOW, 1);
  assert.equal(orig.length, 0);
});
