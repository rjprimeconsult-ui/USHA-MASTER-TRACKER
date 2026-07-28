import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_PLAYBOOK } from './followupEngine.mjs';
import {
  WEBFORM_TOUCH_PREFIX,
  isAgentTouch,
  isOptedOut,
  isEligible,
  buildDraftSource,
  stepPurposeFor,
  STEP_PURPOSES,
} from './followupDraftGate.mjs';

// ---------- helpers ----------

// Monotonic timestamps so "oldest -> newest" assertions are meaningful.
let seq = 0;
const nextAt = () => new Date(Date.UTC(2026, 6, 1, 12, ++seq)).toISOString();

const agentTouch = (note, overrides = {}) => ({
  id: `t${seq + 1}`, at: nextAt(), channel: 'Call', outcome: 'Connected', note, ...overrides,
});
const inbound = (body, overrides = {}) => ({
  at: nextAt(), direction: 'in', body, deliveryStatus: 'delivered', isDrip: false, ...overrides,
});
const outbound = (body, overrides = {}) => ({
  at: nextAt(), direction: 'out', body, deliveryStatus: 'delivered', isDrip: false, ...overrides,
});
const prospect = (overrides = {}) => ({
  id: 'p1', name: 'Maria Lopez', stage: 'PENDING_DECISION', touchLog: [], ...overrides,
});
const line = (m) => `${m.direction === 'out' ? 'Agent' : 'Contact'}: ${m.body}`;

// ---------- touch provenance (§5.1) ----------

test('isAgentTouch: agent-logged touches pass; machine and malformed touches do not', () => {
  assert.equal(isAgentTouch(agentTouch('went over options')), true);
  // Provenance only — note emptiness is the eligibility gate's job, not this one's.
  assert.equal(isAgentTouch(agentTouch('')), true);
  // Agents CAN log Other/Other; only the webform note prefix reclassifies it.
  assert.equal(isAgentTouch(agentTouch('stopped by their office', { channel: 'Other', outcome: 'Other' })), true);
  assert.equal(isAgentTouch(null), false);
  assert.equal(isAgentTouch(undefined), false);
  assert.equal(isAgentTouch({}), false);
});

test('lowercase email/sent outreach touch -> machine, not eligible', () => {
  const t = agentTouch('Outreach email', { channel: 'email', outcome: 'sent' });
  assert.equal(isAgentTouch(t), false);
  assert.equal(isEligible(prospect({ touchLog: [t] })), false);
});

test('website-form re-submit touch -> machine, not eligible', () => {
  const plain = agentTouch(WEBFORM_TOUCH_PREFIX, { channel: 'Other', outcome: 'Other' });
  const withMsg = agentTouch(`${WEBFORM_TOUCH_PREFIX} — "call me ASAP about the quote"`, { channel: 'Other', outcome: 'Other' });
  assert.equal(isAgentTouch(plain), false);
  assert.equal(isAgentTouch(withMsg), false);
  assert.equal(isEligible(prospect({ touchLog: [plain, withMsg] })), false);
});

test('WEBFORM_TOUCH_PREFIX matches the literal in webforms.mjs', () => {
  const src = readFileSync(new URL('./webforms.mjs', import.meta.url), 'utf8');
  assert.ok(
    src.includes(`'${WEBFORM_TOUCH_PREFIX}'`),
    'webforms.mjs no longer contains the exact quoted literal — a rename would silently reclassify machine touches as agent touches'
  );
});

// ---------- the gate (§5.2) ----------

test('agent touch with a note -> eligible', () => {
  const p = prospect({ touchLog: [agentTouch('Went over silver plan, wants to talk to spouse')] });
  assert.equal(isEligible(p), true);
});

test('agent touch with empty or whitespace-only note -> not eligible', () => {
  assert.equal(isEligible(prospect({ touchLog: [agentTouch('')] })), false);
  assert.equal(isEligible(prospect({ touchLog: [agentTouch('   ')] })), false);
});

test('genuine inbound TextDrip reply -> eligible', () => {
  const p = prospect({ textdripChat: { messages: [inbound('Yes, still interested')] } });
  assert.equal(isEligible(p), true);
});

test('outbound-only TextDrip thread -> not eligible', () => {
  const p = prospect({ textdripChat: { messages: [outbound('Hi, following up!'), outbound('Checking in again')] } });
  assert.equal(isEligible(p), false);
});

test('inbound isDrip:true only -> not eligible (drip copy is not a conversation)', () => {
  const p = prospect({ textdripChat: { messages: [inbound('Automated campaign text', { isDrip: true })] } });
  assert.equal(isEligible(p), false);
});

test('inbound with empty/whitespace bodies only -> not eligible', () => {
  const p = prospect({ textdripChat: { messages: [inbound(''), inbound('   ')] } });
  assert.equal(isEligible(p), false);
});

test('missing textdripChat -> not eligible, no throw', () => {
  assert.equal(isEligible(prospect()), false);
  assert.equal(isEligible(prospect({ textdripChat: {} })), false);
  assert.equal(isEligible(prospect({ textdripChat: { messages: null } })), false);
});

test('situation alone never grants eligibility (D4)', () => {
  assert.equal(isEligible(prospect({ situation: 'BENEPATH LEAD' })), false);
  assert.equal(isEligible(prospect({ situation: 'Turning 62 soon, losing group coverage, urgent and detailed situation text' })), false);
});

// ---------- Phase 1 stage boundary (§1) ----------

test('out-of-scope stages with a valid agent touch -> not eligible', () => {
  for (const stage of ['WEBBY_SET', 'APPOINTMENT_SET', 'GHOSTED', 'SOLD', 'LOST']) {
    const p = prospect({ stage, touchLog: [agentTouch('Real conversation happened')] });
    assert.equal(isEligible(p), false, `${stage} must not be eligible in Phase 1`);
  }
});

test('all three in-scope stages qualify with a valid agent touch', () => {
  for (const stage of ['PENDING_DECISION', 'FOLLOWUP_LATER', 'MISSED_APPT']) {
    const p = prospect({ stage, touchLog: [agentTouch('Talked through the plan options')] });
    assert.equal(isEligible(p), true, stage);
  }
});

// ---------- opt-out gate (§5.4) ----------

const OPT_OUT_BODIES = [
  'STOP',
  'STOP.',
  'Stop please',
  'stop texting me',
  'Stop sending me texts',   // 21 chars — must clear the 25 bound
  'Stop calling me please',  // 22 chars — must clear the 25 bound
  'UNSUBSCRIBE',
  'opt out',
  'stop texting me!!!!!!!!!', // 24 raw / 15 normalised — bound measured AFTER stripping
];

test('opt-out keyword replies -> opted out, never eligible', () => {
  for (const body of OPT_OUT_BODIES) {
    const p = prospect({ textdripChat: { messages: [inbound(body)] } });
    assert.equal(isOptedOut(p), true, `should be opted out: ${JSON.stringify(body)}`);
    assert.equal(isEligible(p), false, `should not be eligible: ${JSON.stringify(body)}`);
  }
});

test('boundary lengths are what the spec says they are', () => {
  assert.equal('Stop sending me texts'.length, 21);
  assert.equal('Stop calling me please'.length, 22);
  assert.equal('stop texting me!!!!!!!!!'.length, 24);
  assert.equal('STOP TEXTING ME'.length, 15); // the normalised form of the 24-char raw body
  assert.equal('End of the month works for me'.length, 29);
});

const STILL_ELIGIBLE_BODIES = [
  'End of the month works for me',                  // 29 — over the 25 bound
  'Cancel my appointment Tuesday, can we move it?', // over the bound
  'Quit my job so I need my own plan now',          // over the bound
  'Stopped by your office today, call me',          // keyword followed by a letter (STOPPED)
];

test('sentence-initial keyword in an ordinary reply -> NOT opted out, still eligible', () => {
  for (const body of STILL_ELIGIBLE_BODIES) {
    const p = prospect({ textdripChat: { messages: [inbound(body)] } });
    assert.equal(isOptedOut(p), false, `must not be treated as opt-out: ${JSON.stringify(body)}`);
    assert.equal(isEligible(p), true, `must stay eligible: ${JSON.stringify(body)}`);
  }
});

test('Not interested outcome -> opted out, not eligible', () => {
  const p = prospect({ touchLog: [agentTouch('Said no thanks', { outcome: 'Not interested' })] });
  assert.equal(isOptedOut(p), true);
  assert.equal(isEligible(p), false);
});

test('isOptedOut is null-safe', () => {
  assert.equal(isOptedOut(prospect()), false);
  assert.equal(isOptedOut(null), false);
  assert.equal(isOptedOut(undefined), false);
});

// ---------- buildDraftSource (§5.5) ----------

test('meds never appears in buildDraftSource output, for any input shape', () => {
  const meds = 'Metformin 500mg daily';
  const withNotes = prospect({
    meds,
    situation: 'Turning 62, losing group coverage',
    touchLog: [agentTouch('Wants dental included')],
    textdripChat: { messages: [inbound('Sounds good')] },
  });
  assert.ok(!JSON.stringify(buildDraftSource(withNotes)).includes('Metformin'));

  const textdripOnly = prospect({ meds, textdripChat: { messages: [inbound('Sounds good')] } });
  assert.ok(!JSON.stringify(buildDraftSource(textdripOnly)).includes('Metformin'));

  const bare = prospect({ meds });
  assert.ok(!JSON.stringify(buildDraftSource(bare)).includes('Metformin'));
});

test('agentNotes: 3 most recent qualifying touches, oldest -> newest; machine and empty-note touches skipped', () => {
  const log = [
    agentTouch('n1'),
    agentTouch('n2'),
    agentTouch('Outreach email', { channel: 'email', outcome: 'sent' }),                // machine
    agentTouch('n3'),
    agentTouch('   '),                                                                  // whitespace note
    agentTouch(WEBFORM_TOUCH_PREFIX, { channel: 'Other', outcome: 'Other' }),           // machine
    agentTouch('n4'),
    agentTouch('n5'),
  ];
  const src = buildDraftSource(prospect({ touchLog: log }));
  assert.deepEqual(src.agentNotes.map((n) => n.note), ['n3', 'n4', 'n5']);
  for (const n of src.agentNotes) {
    assert.deepEqual(Object.keys(n).sort(), ['at', 'note', 'outcome']);
  }
  const times = src.agentNotes.map((n) => n.at);
  assert.deepEqual([...times].sort(), times, 'agentNotes must be oldest -> newest');
});

test('textdripSummary used only when there are no agent notes', () => {
  const messages = [inbound('Yes that works')];
  const withNotes = buildDraftSource(prospect({
    touchLog: [agentTouch('Spoke Tuesday')],
    textdripChat: { messages },
  }));
  assert.equal(withNotes.textdripSummary, undefined);

  const withoutNotes = buildDraftSource(prospect({ textdripChat: { messages } }));
  assert.equal(withoutNotes.textdripSummary, 'Contact: Yes that works');
});

test('textdripSummary renders BOTH sides Agent:/Contact:, oldest -> newest, drip excluded', () => {
  const chronological = [
    inbound('Hi, following up'),
    outbound('Drip campaign copy', { isDrip: true }), // excluded
    inbound('Yes that works'),
    outbound('Did the afternoon slot work?'),
  ];
  // normalizeConversation stores newest-first — build the stored array that way.
  const p = prospect({ textdripChat: { messages: [...chronological].reverse() } });
  assert.equal(
    buildDraftSource(p).textdripSummary,
    'Contact: Hi, following up\nContact: Yes that works\nAgent: Did the afternoon slot work?'
  );
});

test('textdripSummary caps at the 6 most recent messages', () => {
  const chronological = [];
  for (let i = 1; i <= 8; i++) {
    chronological.push(i % 2 ? inbound(`m${i}`) : outbound(`m${i}`));
  }
  const p = prospect({ textdripChat: { messages: [...chronological].reverse() } });
  const expected = chronological.slice(2).map(line).join('\n'); // m3..m8, oldest -> newest
  assert.equal(buildDraftSource(p).textdripSummary, expected);
});

test('textdripSummary truncation: drops WHOLE messages from the oldest end, never mid-message', () => {
  // 6 messages whose joined transcript is 983 chars (> 800). Dropping msg1
  // (164+newline) leaves 818 — still over — then msg2 (162+newline) leaves 655.
  const chronological = [];
  for (let i = 1; i <= 6; i++) {
    const body = `msg${i} ` + 'x'.repeat(150);
    chronological.push(i % 2 ? inbound(body) : outbound(body));
  }
  const p = prospect({ textdripChat: { messages: [...chronological].reverse() } });
  const summary = buildDraftSource(p).textdripSummary;
  assert.ok(summary.length <= 800, `summary must fit in 800 chars, got ${summary.length}`);
  assert.ok(!summary.includes('msg1'), 'oldest message dropped whole');
  assert.ok(!summary.includes('msg2'), 'second-oldest message dropped whole');
  const lines = summary.split('\n');
  assert.deepEqual(lines, chronological.slice(2).map(line), 'the 4 newest messages survive, oldest -> newest');
  for (const l of lines) {
    assert.match(l, /^(Agent|Contact): msg\d x{150}$/, 'every surviving line is a complete message');
  }
});

test('missedApptTime present only for MISSED_APPT with an appointmentTime, formatted like mergeScript {time}', () => {
  const appt = '2026-07-28T18:00:00.000Z';
  const expected = new Date(appt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

  const missed = buildDraftSource(prospect({ stage: 'MISSED_APPT', appointmentTime: appt, touchLog: [agentTouch('x')] }));
  assert.equal(missed.missedApptTime, expected);

  const otherStage = buildDraftSource(prospect({ stage: 'PENDING_DECISION', appointmentTime: appt, touchLog: [agentTouch('x')] }));
  assert.equal(otherStage.missedApptTime, undefined);

  // No appointmentTime -> field omitted entirely, never the "our scheduled time" placeholder.
  const noTime = buildDraftSource(prospect({ stage: 'MISSED_APPT', touchLog: [agentTouch('x')] }));
  assert.equal(noTime.missedApptTime, undefined);
  assert.ok(!JSON.stringify(noTime).includes('our scheduled time'));
});

test('buildDraftSource never throws on a bare prospect; ineligible -> firstName (+situation) only', () => {
  assert.deepEqual(buildDraftSource(prospect()), { firstName: 'Maria' });
  assert.deepEqual(
    buildDraftSource(prospect({ situation: 'Benepath lead, no contact yet' })),
    { firstName: 'Maria', situation: 'Benepath lead, no contact yet' }
  );
  assert.equal(buildDraftSource(prospect({ name: '' })).firstName, 'there');
  assert.equal(buildDraftSource(prospect({ name: '  Ana  Maria Ruiz ' })).firstName, 'Ana');
});

// ---------- stepPurposeFor (§8.1) ----------

test('stepPurpose table matches the live DEFAULT_PLAYBOOK step counts', () => {
  for (const stage of Object.keys(STEP_PURPOSES)) {
    assert.equal(
      STEP_PURPOSES[stage].length,
      DEFAULT_PLAYBOOK.stages[stage].steps.length,
      `${stage} purpose list must cover every playbook step`
    );
  }
});

test('stepPurposeFor: explicit mapping per the spec table', () => {
  assert.equal(stepPurposeFor('MISSED_APPT', 0), 'reschedule_urgent');
  assert.equal(stepPurposeFor('MISSED_APPT', 1), 'reschedule_urgent');
  assert.equal(stepPurposeFor('MISSED_APPT', 2), 'reschedule');
  assert.equal(stepPurposeFor('MISSED_APPT', 3), 'reschedule');
  assert.equal(stepPurposeFor('MISSED_APPT', 4), 'breakup');
  assert.equal(stepPurposeFor('PENDING_DECISION', 0), 'clarify');
  assert.equal(stepPurposeFor('PENDING_DECISION', 1), 'clarify');
  assert.equal(stepPurposeFor('PENDING_DECISION', 2), 'urgency');
  assert.equal(stepPurposeFor('PENDING_DECISION', 3), 'urgency');
  assert.equal(stepPurposeFor('PENDING_DECISION', 4), 'breakup');
  for (let i = 0; i < 4; i++) {
    assert.equal(stepPurposeFor('FOLLOWUP_LATER', i), 'check_in');
  }
});

test('FOLLOWUP_LATER has no breakup purpose (its last step is a self-looping check-in)', () => {
  assert.ok(!STEP_PURPOSES.FOLLOWUP_LATER.includes('breakup'));
});

test('out-of-range stepIndex maps to the last listed purpose', () => {
  assert.equal(stepPurposeFor('MISSED_APPT', 99), 'breakup');
  assert.equal(stepPurposeFor('PENDING_DECISION', 99), 'breakup');
  assert.equal(stepPurposeFor('FOLLOWUP_LATER', 99), 'check_in');
});

test('unknown or out-of-scope stage -> null', () => {
  assert.equal(stepPurposeFor('GHOSTED', 0), null);
  assert.equal(stepPurposeFor('SOLD', 0), null);
  assert.equal(stepPurposeFor(undefined, 0), null);
});
