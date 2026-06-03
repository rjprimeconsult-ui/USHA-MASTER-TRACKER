import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS, OUTCOMES, DEFAULT_PLAYBOOK, FOLLOWUP_PLAYBOOK_KEY,
  FOLLOWUP_DEFAULTS, playbookForStage, ensureFollowupFields,
  armCadence, armIfNeeded, logTouch, dueStatus, snooze,
  consecutiveNoAnswer, suggestStageAfterTouch,
} from './followupEngine.mjs';

const PB = DEFAULT_PLAYBOOK;

test('enums and key are exported', () => {
  assert.deepEqual(CHANNELS, ['Call', 'Text', 'Email', 'Voicemail', 'Other']);
  assert.deepEqual(OUTCOMES, ['No answer', 'Left VM', 'Connected', 'Booked appt', 'Not interested', 'Other']);
  assert.equal(FOLLOWUP_PLAYBOOK_KEY, 'followup_playbook_v1');
});

test('FOLLOWUP_DEFAULTS shape is non-destructive defaults', () => {
  assert.deepEqual(FOLLOWUP_DEFAULTS.touchLog, []);
  assert.equal(FOLLOWUP_DEFAULTS.stageEnteredAt, null);
  assert.deepEqual(FOLLOWUP_DEFAULTS.cadence, { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null });
});

test('DEFAULT_PLAYBOOK has the four chase stages with steps', () => {
  for (const id of ['MISSED_APPT', 'PENDING_DECISION', 'FOLLOWUP_LATER', 'GHOSTED']) {
    const stage = DEFAULT_PLAYBOOK.stages[id];
    assert.ok(Array.isArray(stage.steps) && stage.steps.length > 0, `${id} has steps`);
    for (const s of stage.steps) {
      assert.equal(typeof s.afterDays, 'number');
      assert.ok(CHANNELS.includes(s.channel));
      assert.equal(typeof s.script, 'string');
    }
  }
});

test('playbookForStage returns steps for a chase stage and [] for terminal/unknown', () => {
  assert.ok(playbookForStage(DEFAULT_PLAYBOOK, 'GHOSTED').length >= 1);
  assert.deepEqual(playbookForStage(DEFAULT_PLAYBOOK, 'SOLD'), []);
  assert.deepEqual(playbookForStage(DEFAULT_PLAYBOOK, 'NOPE'), []);
});

test('ensureFollowupFields backfills missing fields without clobbering existing', () => {
  const bare = { id: 'p1', stage: 'GHOSTED', createdAt: '2026-05-01T00:00:00.000Z' };
  const out = ensureFollowupFields(bare, '2026-06-03T12:00:00.000Z');
  assert.deepEqual(out.touchLog, []);
  assert.deepEqual(out.cadence, { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null });
  assert.equal(out.stageEnteredAt, '2026-05-01T00:00:00.000Z');
});

test('ensureFollowupFields leaves an already-migrated prospect untouched', () => {
  const p = {
    id: 'p2', stage: 'GHOSTED', createdAt: '2026-05-01T00:00:00.000Z',
    stageEnteredAt: '2026-05-10T00:00:00.000Z',
    touchLog: [{ id: 't', at: '2026-05-11T00:00:00.000Z', channel: 'Call', outcome: 'No answer', note: '' }],
    cadence: { stepIndex: 2, nextDueAt: '2026-05-15T00:00:00.000Z', snoozedUntil: null, completedAt: null },
  };
  const out = ensureFollowupFields(p, '2026-06-03T12:00:00.000Z');
  assert.equal(out.stageEnteredAt, '2026-05-10T00:00:00.000Z');
  assert.equal(out.touchLog.length, 1);
  assert.equal(out.cadence.stepIndex, 2);
});

test('ensureFollowupFields uses now when no createdAt exists', () => {
  const out = ensureFollowupFields({ id: 'p3', stage: 'PENDING_DECISION' }, '2026-06-03T12:00:00.000Z');
  assert.equal(out.stageEnteredAt, '2026-06-03T12:00:00.000Z');
});

test('armCadence sets stageEnteredAt and nextDueAt from step 0 afterDays', () => {
  const p = { id: 'a', stage: 'PENDING_DECISION', touchLog: [], cadence: { ...FOLLOWUP_DEFAULTS.cadence } };
  const out = armCadence(p, PB, '2026-06-03T12:00:00.000Z');
  assert.equal(out.stageEnteredAt, '2026-06-03T12:00:00.000Z');
  assert.equal(out.cadence.stepIndex, 0);
  assert.equal(out.cadence.completedAt, null);
  assert.equal(out.cadence.nextDueAt, '2026-06-04T12:00:00.000Z');
});

test('armCadence on a terminal stage clears the cadence (no due date)', () => {
  const p = { id: 'b', stage: 'SOLD', touchLog: [], cadence: { stepIndex: 3, nextDueAt: '2026-01-01T00:00:00.000Z', snoozedUntil: null, completedAt: null } };
  const out = armCadence(p, PB, '2026-06-03T12:00:00.000Z');
  assert.equal(out.cadence.nextDueAt, null);
  assert.equal(out.cadence.stepIndex, 0);
});

test('logTouch appends a touch and advances to the next due date', () => {
  let p = armCadence({ id: 'c', stage: 'GHOSTED', touchLog: [], cadence: { ...FOLLOWUP_DEFAULTS.cadence } }, PB, '2026-06-03T12:00:00.000Z');
  const r = logTouch(p, { channel: 'Text', outcome: 'No answer', note: 'no reply' }, PB, '2026-06-04T15:00:00.000Z');
  assert.equal(r.prospect.touchLog.length, 1);
  assert.equal(r.prospect.touchLog[0].channel, 'Text');
  assert.equal(r.prospect.touchLog[0].outcome, 'No answer');
  assert.equal(r.prospect.touchLog[0].at, '2026-06-04T15:00:00.000Z');
  assert.ok(r.prospect.touchLog[0].id);
  assert.equal(r.prospect.cadence.stepIndex, 1);
  assert.equal(r.prospect.cadence.nextDueAt, '2026-06-06T15:00:00.000Z');
  assert.equal(r.suggestedStage, null);
});

test('logTouch on the final step completes the cadence and suggests onComplete stage', () => {
  let p = armCadence({ id: 'd', stage: 'GHOSTED', touchLog: [], cadence: { ...FOLLOWUP_DEFAULTS.cadence } }, PB, '2026-06-03T12:00:00.000Z');
  p.cadence.stepIndex = 3;
  const r = logTouch(p, { channel: 'Text', outcome: 'No answer', note: '' }, PB, '2026-06-10T12:00:00.000Z');
  assert.equal(r.prospect.touchLog.length, 1);
  assert.ok(r.prospect.cadence.completedAt);
  assert.equal(r.prospect.cadence.nextDueAt, null);
  assert.equal(r.suggestedStage, 'LOST');
});

test('logTouch on a no-cadence stage still records the touch, no due date', () => {
  const p = { id: 'e', stage: 'SOLD', touchLog: [], cadence: { ...FOLLOWUP_DEFAULTS.cadence }, stageEnteredAt: '2026-06-01T00:00:00.000Z' };
  const r = logTouch(p, { channel: 'Call', outcome: 'Connected', note: 'welcome call' }, PB, '2026-06-03T12:00:00.000Z');
  assert.equal(r.prospect.touchLog.length, 1);
  assert.equal(r.prospect.cadence.nextDueAt, null);
  assert.equal(r.suggestedStage, null);
});

test('logTouch FOLLOWUP_LATER final step does not suggest (loops on itself)', () => {
  let p = armCadence({ id: 'f', stage: 'FOLLOWUP_LATER', touchLog: [], cadence: { ...FOLLOWUP_DEFAULTS.cadence } }, PB, '2026-06-03T12:00:00.000Z');
  p.cadence.stepIndex = playbookForStage(PB, 'FOLLOWUP_LATER').length - 1;
  const r = logTouch(p, { channel: 'Call', outcome: 'No answer', note: '' }, PB, '2026-06-10T12:00:00.000Z');
  assert.equal(r.suggestedStage, null);
  assert.ok(r.prospect.cadence.completedAt);
});

const base = (over) => ({ id: 'x', stage: 'GHOSTED', touchLog: [], cadence: { stepIndex: 0, nextDueAt: '2026-06-04T12:00:00.000Z', snoozedUntil: null, completedAt: null }, ...over });

test('dueStatus: ontrack when due in the future', () => {
  const s = dueStatus(base(), '2026-06-03T12:00:00.000Z');
  assert.equal(s.state, 'ontrack');
  assert.equal(s.daysLate, 0);
});

test('dueStatus: due_today within the due calendar day', () => {
  const s = dueStatus(base(), '2026-06-04T08:00:00.000Z');
  assert.equal(s.state, 'due_today');
});

test('dueStatus: overdue with daysLate', () => {
  const s = dueStatus(base(), '2026-06-07T12:00:00.000Z');
  assert.equal(s.state, 'overdue');
  assert.equal(s.daysLate, 3);
});

test('dueStatus: snoozed suppresses until snoozedUntil passes', () => {
  const p = base({ cadence: { stepIndex: 0, nextDueAt: '2026-06-04T12:00:00.000Z', snoozedUntil: '2026-06-09T12:00:00.000Z', completedAt: null } });
  assert.equal(dueStatus(p, '2026-06-07T12:00:00.000Z').state, 'snoozed');
  assert.equal(dueStatus(p, '2026-06-10T12:00:00.000Z').state, 'overdue');
});

test('dueStatus: done when completedAt set; none when no cadence', () => {
  assert.equal(dueStatus(base({ cadence: { stepIndex: 4, nextDueAt: null, snoozedUntil: null, completedAt: '2026-06-10T00:00:00.000Z' } }), '2026-06-11T00:00:00.000Z').state, 'done');
  assert.equal(dueStatus({ id: 'y', stage: 'SOLD', cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null } }, '2026-06-11T00:00:00.000Z').state, 'none');
});

test('snooze sets snoozedUntil now + days', () => {
  const out = snooze(base(), 3, '2026-06-04T12:00:00.000Z');
  assert.equal(out.cadence.snoozedUntil, '2026-06-07T12:00:00.000Z');
});

test('armIfNeeded arms an un-started cadence anchored on stageEnteredAt', () => {
  const p = { id: 'q', stage: 'GHOSTED', stageEnteredAt: '2026-06-01T00:00:00.000Z', touchLog: [], cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null } };
  const out = armIfNeeded(p, DEFAULT_PLAYBOOK);
  // GHOSTED step 0 afterDays:1 -> entry + 1 day
  assert.equal(out.cadence.nextDueAt, '2026-06-02T00:00:00.000Z');
  assert.equal(out.cadence.stepIndex, 0);
});

test('armIfNeeded leaves already-armed prospect untouched', () => {
  const p = { id: 'r', stage: 'GHOSTED', stageEnteredAt: '2026-06-01T00:00:00.000Z', touchLog: [], cadence: { stepIndex: 0, nextDueAt: '2026-06-09T00:00:00.000Z', snoozedUntil: null, completedAt: null } };
  assert.equal(armIfNeeded(p, DEFAULT_PLAYBOOK).cadence.nextDueAt, '2026-06-09T00:00:00.000Z');
});

const withTouches = (stage, outcomes) => ({
  id: 'z', stage,
  touchLog: outcomes.map((o, i) => ({ id: 't' + i, at: `2026-06-0${i + 1}T12:00:00.000Z`, channel: 'Call', outcome: o, note: '' })),
  cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
});

test('consecutiveNoAnswer counts trailing No answer / Left VM touches', () => {
  assert.equal(consecutiveNoAnswer(withTouches('GHOSTED', ['Connected', 'No answer', 'No answer'])), 2);
  assert.equal(consecutiveNoAnswer(withTouches('GHOSTED', ['No answer', 'No answer', 'No answer'])), 3);
  assert.equal(consecutiveNoAnswer(withTouches('GHOSTED', ['No answer', 'Connected'])), 0);
  assert.equal(consecutiveNoAnswer({ touchLog: [] }), 0);
});

test('suggestStageAfterTouch: Booked appt -> APPOINTMENT_SET', () => {
  const p = withTouches('PENDING_DECISION', ['Booked appt']);
  const r = suggestStageAfterTouch(p, { outcome: 'Booked appt' }, DEFAULT_PLAYBOOK);
  assert.equal(r.stage, 'APPOINTMENT_SET');
  assert.ok(/appoint/i.test(r.reason));
});

test('suggestStageAfterTouch: Not interested -> LOST', () => {
  const p = withTouches('PENDING_DECISION', ['Not interested']);
  const r = suggestStageAfterTouch(p, { outcome: 'Not interested' }, DEFAULT_PLAYBOOK);
  assert.equal(r.stage, 'LOST');
});

test('suggestStageAfterTouch: 3rd consecutive No answer (not already Ghosted) -> GHOSTED', () => {
  const p = withTouches('PENDING_DECISION', ['No answer', 'No answer', 'No answer']);
  const r = suggestStageAfterTouch(p, { outcome: 'No answer' }, DEFAULT_PLAYBOOK);
  assert.equal(r.stage, 'GHOSTED');
});

test('suggestStageAfterTouch: already Ghosted with 3 no-answers does NOT re-suggest Ghosted', () => {
  const p = withTouches('GHOSTED', ['No answer', 'No answer', 'No answer']);
  const r = suggestStageAfterTouch(p, { outcome: 'No answer' }, DEFAULT_PLAYBOOK);
  assert.equal(r, null);
});

test('suggestStageAfterTouch: cadence just completed -> playbook onComplete (breakup)', () => {
  const p = { id: 'b', stage: 'MISSED_APPT', touchLog: [{ id: 't', at: '2026-06-09T00:00:00.000Z', channel: 'Text', outcome: 'No answer', note: '' }], cadence: { stepIndex: 4, nextDueAt: null, snoozedUntil: null, completedAt: '2026-06-09T00:00:00.000Z' } };
  const r = suggestStageAfterTouch(p, { outcome: 'No answer' }, DEFAULT_PLAYBOOK);
  assert.equal(r.stage, 'GHOSTED');
});

test('suggestStageAfterTouch: no rule matches -> null', () => {
  const p = withTouches('PENDING_DECISION', ['Connected']);
  const r = suggestStageAfterTouch(p, { outcome: 'Connected' }, DEFAULT_PLAYBOOK);
  assert.equal(r, null);
});

test('armIfNeeded leaves touched / advanced / completed / terminal untouched', () => {
  const touched = { id: 's', stage: 'GHOSTED', stageEnteredAt: '2026-06-01T00:00:00.000Z', touchLog: [{ id: 't', at: '2026-06-02T00:00:00.000Z', channel: 'Call', outcome: 'No answer', note: '' }], cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null } };
  assert.equal(armIfNeeded(touched, DEFAULT_PLAYBOOK).cadence.nextDueAt, null);
  const advanced = { id: 't2', stage: 'GHOSTED', stageEnteredAt: '2026-06-01T00:00:00.000Z', touchLog: [], cadence: { stepIndex: 2, nextDueAt: null, snoozedUntil: null, completedAt: null } };
  assert.equal(armIfNeeded(advanced, DEFAULT_PLAYBOOK).cadence.stepIndex, 2);
  const terminal = { id: 'u', stage: 'SOLD', stageEnteredAt: '2026-06-01T00:00:00.000Z', touchLog: [], cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null } };
  assert.equal(armIfNeeded(terminal, DEFAULT_PLAYBOOK).cadence.nextDueAt, null);
});
