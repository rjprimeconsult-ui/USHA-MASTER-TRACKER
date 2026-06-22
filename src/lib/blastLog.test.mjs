import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlastPayload, normPlatform, blastKey, upsertBlast } from './blastLog.mjs';

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

test('blastKey is case/space-insensitive on the four parts', () => {
  const a = { runDate: '2026-06-16', platform: 'Ringy', sendTime: '10:30', campaignOrTag: 'AGED' };
  const b = { runDate: '2026-06-16', platform: 'ringy', sendTime: ' 10:30 ', campaignOrTag: 'aged' };
  assert.equal(blastKey(a), blastKey(b));
});
