import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  makeStepKey, sourceHash, shouldRegenerate, rotatePrevious, pruneDrafts,
} from './followupDraftCache.mjs';

const NUL = String.fromCharCode(0);

// A full §5.5-shaped source payload with every field present. The structural
// hash test iterates these keys, so a field added here is covered automatically.
function fullSource() {
  return {
    firstName: 'Maria',
    situation: 'Lost group coverage, comparing options',
    missedApptTime: 'Tue, 6:00 PM',
    agentNotes: [
      { at: '2026-07-20T15:00:00.000Z', outcome: 'Spoke', note: 'Wants to compare with spouse plan' },
      { at: '2026-07-22T18:30:00.000Z', outcome: 'Left VM', note: 'Asked for a Thursday callback' },
    ],
    textdripSummary: 'Agent: Any questions?\nContact: Send me the numbers again',
  };
}

const K = 'PENDING_DECISION:1';
const H = 'aaaaaaaa';
// A §7.2-shaped cache entry; override fields per case.
const entry = (over = {}) => ({
  status: 'ok',
  text: 'Quick draft about the spouse-plan comparison',
  edited: false,
  stepKey: K,
  sourceHash: H,
  at: '2026-07-27T00:00:00.000Z',
  attempts: 0,
  previous: [],
  rejected: [],
  ...over,
});

// ---------- makeStepKey ----------
test('makeStepKey: stage + colon + step index', () => {
  assert.equal(makeStepKey('PENDING_DECISION', 1, 5), 'PENDING_DECISION:1');
  assert.equal(makeStepKey('MISSED_APPT', 0, 5), 'MISSED_APPT:0');
});

test('makeStepKey clamps the index to steps.length - 1', () => {
  assert.equal(makeStepKey('FOLLOWUP_LATER', 9, 4), 'FOLLOWUP_LATER:3');
  assert.equal(makeStepKey('FOLLOWUP_LATER', 4, 4), 'FOLLOWUP_LATER:3');
});

test('makeStepKey floors at 0 (missing index, negative index, empty playbook)', () => {
  assert.equal(makeStepKey('PENDING_DECISION', undefined, 5), 'PENDING_DECISION:0');
  assert.equal(makeStepKey('PENDING_DECISION', null, 5), 'PENDING_DECISION:0');
  assert.equal(makeStepKey('PENDING_DECISION', -3, 5), 'PENDING_DECISION:0');
  assert.equal(makeStepKey('PENDING_DECISION', 0, 0), 'PENDING_DECISION:0');
  assert.equal(makeStepKey('PENDING_DECISION', 2, 0), 'PENDING_DECISION:0');
});

test('makeStepKey changes with stage or index', () => {
  assert.notEqual(makeStepKey('PENDING_DECISION', 1, 5), makeStepKey('MISSED_APPT', 1, 5));
  assert.notEqual(makeStepKey('PENDING_DECISION', 1, 5), makeStepKey('PENDING_DECISION', 2, 5));
});

// ---------- sourceHash ----------
test('sourceHash is deterministic and renders 8 lowercase hex chars', () => {
  const a = sourceHash(K, fullSource());
  const b = sourceHash(K, fullSource());
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{8}$/);
});

test('sourceHash: ["a","b c"] and ["a b","c"] must NOT collide (NUL join, not space)', () => {
  const h1 = sourceHash('k', { firstName: '', situation: 'a', missedApptTime: 'b c', agentNotes: [], textdripSummary: '' });
  const h2 = sourceHash('k', { firstName: '', situation: 'a b', missedApptTime: 'c', agentNotes: [], textdripSummary: '' });
  assert.notEqual(h1, h2);
});

test('sourceHash fixed slots: absent situation/missedApptTime hash as empty strings, never dropped', () => {
  // Absent field === empty-string field (the slot always exists)...
  assert.equal(
    sourceHash(K, { firstName: 'J', agentNotes: [] }),
    sourceHash(K, { firstName: 'J', situation: '', missedApptTime: '', agentNotes: [], textdripSummary: '' }),
  );
  // ...so "situation set, no appointment" can never collide with
  // "situation cleared, appointment set" (§7.3's shifted-positions failure).
  const hA = sourceHash(K, { firstName: 'J', situation: 'retiring', agentNotes: [] });
  const hB = sourceHash(K, { firstName: 'J', missedApptTime: 'retiring', agentNotes: [] });
  assert.notEqual(hA, hB);
});

test('sourceHash changes when a note is added, edited, its outcome or timestamp changes, situation changes, or stepKey changes', () => {
  const base = sourceHash(K, fullSource());

  const added = fullSource();
  added.agentNotes = [...added.agentNotes, { at: '2026-07-23T10:00:00.000Z', outcome: 'Texted', note: 'New note' }];
  assert.notEqual(sourceHash(K, added), base, 'note added');

  const edited = fullSource();
  edited.agentNotes[1] = { ...edited.agentNotes[1], note: 'Asked for a Friday callback' };
  assert.notEqual(sourceHash(K, edited), base, 'note edited');

  const outcome = fullSource();
  outcome.agentNotes[1] = { ...outcome.agentNotes[1], outcome: 'Spoke' };
  assert.notEqual(sourceHash(K, outcome), base, 'note outcome changed');

  const at = fullSource();
  at.agentNotes[1] = { ...at.agentNotes[1], at: '2026-07-22T19:00:00.000Z' };
  assert.notEqual(sourceHash(K, at), base, 'note timestamp changed');

  const situation = fullSource();
  situation.situation = 'Now comparing with a COBRA quote';
  assert.notEqual(sourceHash(K, situation), base, 'situation changed');

  assert.notEqual(sourceHash('PENDING_DECISION:2', fullSource()), base, 'stepKey changed');
});

test('sourceHash covers everything buildDraftSource sends (structural — mutate each field in turn)', () => {
  const baseline = sourceHash('MISSED_APPT:0', fullSource());
  const fields = Object.keys(fullSource());
  assert.ok(fields.length >= 5, 'source object must carry every payload field');
  const mutateValue = (v) => (Array.isArray(v)
    ? [...v, { at: '2026-07-23T00:00:00.000Z', outcome: 'Texted', note: 'mutation marker' }]
    : `${v}~mutated`);
  for (const field of fields) {
    const mutated = fullSource();
    mutated[field] = mutateValue(mutated[field]);
    assert.notEqual(
      sourceHash('MISSED_APPT:0', mutated), baseline,
      `mutating "${field}" must change the hash — a sent-but-unhashed field leaves a stale draft in place`,
    );
  }
});

test('sourceHash is FNV-1a 32-bit over the UTF-8 bytes of the NUL-joined parts (§7.3 order)', () => {
  const src = {
    firstName: 'José',
    situation: 'a',
    agentNotes: [{ at: 't1', outcome: 'Spoke', note: 'señal' }],
    textdripSummary: '',
  };
  const joined = ['K:0', 'José', 'a', '', 't1|Spoke|señal', ''].join(NUL);
  const bytes = new TextEncoder().encode(joined);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  assert.equal(sourceHash('K:0', src), h.toString(16).padStart(8, '0'));
});

test('sourceHash pads short digests to 8 chars', () => {
  let found = null;
  for (let i = 0; i < 5000 && !found; i++) {
    const h = sourceHash('K:0', { firstName: `pad-probe-${i}` });
    if (h[0] === '0') found = h;
  }
  assert.ok(found, 'expected at least one digest below 0x10000000 within 5000 probes');
  assert.match(found, /^[0-9a-f]{8}$/);
});

test('module source contains no literal NUL byte and no BOM', () => {
  const bytes = fs.readFileSync(new URL('./followupDraftCache.mjs', import.meta.url));
  assert.equal(bytes.indexOf(0), -1, 'U+0000 must be built via String.fromCharCode(0), never typed as a byte');
  assert.notEqual(bytes[0], 0xef, 'file must not start with a UTF-8 BOM');
});

// ---------- shouldRegenerate (§7.4, precedence order) ----------
test('rule 0: no cache entry -> generate, push nothing onto previous', () => {
  assert.deepEqual(shouldRegenerate(null, K, H), { generate: true, rotatePrevious: false, resetCounters: true });
  assert.deepEqual(shouldRegenerate(undefined, K, H), { generate: true, rotatePrevious: false, resetCounters: true });
});

test('rule 1: insufficient + same hash NEVER regenerates (D9 — no re-billing on reopen)', () => {
  const cached = entry({ status: 'insufficient', text: '' });
  assert.deepEqual(shouldRegenerate(cached, K, H), { generate: false, rotatePrevious: false, resetCounters: false });
  // edited/attempts values cannot re-open the gate
  assert.equal(shouldRegenerate(entry({ status: 'insufficient', text: '', edited: true, attempts: 0 }), K, H).generate, false);
});

test('rule 1 releases when inputs change: insufficient + NEW hash regenerates', () => {
  const cached = entry({ status: 'insufficient', text: '' });
  const d = shouldRegenerate(cached, K, 'bbbbbbbb');
  assert.equal(d.generate, true);
  assert.equal(d.rotatePrevious, false);
  assert.equal(d.resetCounters, true);
});

test('rule 2: failed + same hash regenerates iff attempts < 2, counters persist', () => {
  assert.deepEqual(
    shouldRegenerate(entry({ status: 'failed', text: '', attempts: 0 }), K, H),
    { generate: true, rotatePrevious: false, resetCounters: false },
  );
  assert.deepEqual(
    shouldRegenerate(entry({ status: 'failed', text: '', attempts: 1 }), K, H),
    { generate: true, rotatePrevious: false, resetCounters: false },
  );
});

test('rule 2: failed + same hash + attempts === 2 -> no call', () => {
  assert.deepEqual(
    shouldRegenerate(entry({ status: 'failed', text: '', attempts: 2 }), K, H),
    { generate: false, rotatePrevious: false, resetCounters: false },
  );
  assert.equal(shouldRegenerate(entry({ status: 'failed', text: '', attempts: 3 }), K, H).generate, false);
});

test('rule 3: stepKey changed -> regenerate even when edited, rotate previous, reset counters', () => {
  const d = shouldRegenerate(entry({ edited: true }), 'PENDING_DECISION:2', 'bbbbbbbb');
  assert.deepEqual(d, { generate: true, rotatePrevious: true, resetCounters: true });
  // same result when not edited
  assert.deepEqual(
    shouldRegenerate(entry(), 'PENDING_DECISION:2', 'bbbbbbbb'),
    { generate: true, rotatePrevious: true, resetCounters: true },
  );
});

test('rule 3 outranks rules 1-2: exhausted failed / declined entries regenerate on a step change', () => {
  // attempts cap and the insufficient latch are per sourceHash; a stepKey
  // change always changes the hash, so both reset and generation fires.
  assert.equal(shouldRegenerate(entry({ status: 'failed', text: '', attempts: 2 }), 'PENDING_DECISION:2', 'bbbbbbbb').generate, true);
  assert.equal(shouldRegenerate(entry({ status: 'insufficient', text: '' }), 'PENDING_DECISION:2', 'bbbbbbbb').generate, true);
});

test('rule 4: sourceHash changed + edited -> does NOT regenerate (never overwrite the agent in place)', () => {
  const d = shouldRegenerate(entry({ edited: true }), K, 'bbbbbbbb');
  assert.equal(d.generate, false);
  assert.equal(d.rotatePrevious, false);
  assert.equal(d.resetCounters, true, 'attempts and rejected still reset on a hash change');
});

test('rule 4: sourceHash changed + not edited -> regenerates WITHOUT rotating previous', () => {
  assert.deepEqual(
    shouldRegenerate(entry(), K, 'bbbbbbbb'),
    { generate: true, rotatePrevious: false, resetCounters: true },
  );
});

test('rule 5: nothing changed -> serve the cache', () => {
  assert.deepEqual(shouldRegenerate(entry(), K, H), { generate: false, rotatePrevious: false, resetCounters: false });
  assert.deepEqual(shouldRegenerate(entry({ edited: true }), K, H), { generate: false, rotatePrevious: false, resetCounters: false });
});

// ---------- rotatePrevious ----------
test('rotatePrevious pushes newest-first and caps at 2', () => {
  assert.deepEqual(rotatePrevious(entry({ text: 'c', previous: ['b', 'a'] })), ['c', 'b']);
  assert.deepEqual(rotatePrevious(entry({ text: 'c', previous: ['b'] })), ['c', 'b']);
  assert.deepEqual(rotatePrevious(entry({ text: 'c', previous: [] })), ['c']);
  // over-long stored arrays are re-capped, newest kept
  assert.deepEqual(rotatePrevious(entry({ text: 'c', previous: ['b', 'a', 'z'] })), ['c', 'b']);
});

test('rotatePrevious is pure: returns a new array and never mutates the entry', () => {
  const e = entry({ text: 'c', previous: ['b', 'a'] });
  const out = rotatePrevious(e);
  assert.notEqual(out, e.previous);
  assert.deepEqual(e.previous, ['b', 'a']);
});

test('rotatePrevious pushes NOTHING for empty text or failed/insufficient status — previous never contains null', () => {
  assert.deepEqual(rotatePrevious(entry({ text: '', previous: ['b', 'a'] })), ['b', 'a']);
  assert.deepEqual(rotatePrevious(entry({ text: '   ', previous: ['b'] })), ['b']);
  assert.deepEqual(rotatePrevious(entry({ status: 'failed', text: 'stale', previous: ['b'] })), ['b']);
  assert.deepEqual(rotatePrevious(entry({ status: 'insufficient', text: 'stale', previous: ['b'] })), ['b']);
  assert.deepEqual(rotatePrevious(entry({ text: undefined, previous: [] })), []);
  assert.deepEqual(rotatePrevious(null), []);
  assert.deepEqual(rotatePrevious(undefined), []);
  for (const e of [entry({ text: undefined, previous: ['b'] }), entry({ status: 'failed', text: '' })]) {
    assert.ok(!rotatePrevious(e).includes(null), 'previous must never contain null');
    assert.ok(!rotatePrevious(e).includes(''), 'previous must never contain an empty draft');
  }
});

test('previous only ever GAINS entries: a rule-3 rotation of an unusable entry loses nothing', () => {
  // Failed entry hits a step change: rule 3 says rotate, the push-nothing
  // guard keeps the old drafts intact — previous is never reset by any rule.
  const failed = entry({ status: 'failed', text: '', attempts: 1, previous: ['old draft'] });
  const d = shouldRegenerate(failed, 'PENDING_DECISION:2', 'bbbbbbbb');
  assert.equal(d.generate, true);
  assert.equal(d.rotatePrevious, true);
  assert.deepEqual(rotatePrevious(failed), ['old draft']);
  // and a usable entry gains its text on top of what was already there
  const ok = entry({ text: 'step 2 draft', previous: ['step 1 draft'] });
  assert.deepEqual(rotatePrevious(ok), ['step 2 draft', 'step 1 draft']);
});

// ---------- pruneDrafts (§7.5) ----------
test('pruneDrafts drops absent, archived, SOLD and LOST prospects; keeps the rest (GHOSTED included)', () => {
  const map = {
    keep1: { status: 'ok', text: 'a' },
    ghosted: { status: 'ok', text: 'b' },
    archived: { status: 'ok', text: 'c' },
    sold: { status: 'ok', text: 'd' },
    lost: { status: 'ok', text: 'e' },
    gone: { status: 'ok', text: 'f' },
  };
  const prospects = [
    { id: 'keep1', stage: 'PENDING_DECISION', archivedAt: null },
    { id: 'ghosted', stage: 'GHOSTED', archivedAt: null },
    { id: 'archived', stage: 'FOLLOWUP_LATER', archivedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'sold', stage: 'SOLD', archivedAt: null },
    { id: 'lost', stage: 'LOST', archivedAt: null },
    // 'gone' is not in the loaded list at all
  ];
  const { map: out, changed } = pruneDrafts(map, prospects);
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(out).sort(), ['ghosted', 'keep1']);
  assert.equal(out.keep1, map.keep1, 'kept entries carry over by reference');
  assert.equal(Object.keys(map).length, 6, 'input map is not mutated');
});

test('pruneDrafts reports changed: false and returns the original map when nothing drops', () => {
  const map = { keep1: { status: 'ok', text: 'a' } };
  const res = pruneDrafts(map, [{ id: 'keep1', stage: 'MISSED_APPT', archivedAt: null }]);
  assert.equal(res.changed, false);
  assert.equal(res.map, map, 'same reference, so the caller can skip the write entirely');
});

test('pruneDrafts: missing archivedAt counts as not archived; numeric ids match string keys', () => {
  const map = { 7: { status: 'ok', text: 'a' } };
  const res = pruneDrafts(map, [{ id: 7, stage: 'FOLLOWUP_LATER' }]);
  assert.equal(res.changed, false);
  assert.deepEqual(Object.keys(res.map), ['7']);
});

test('pruneDrafts defensive shapes: null map, empty prospect list', () => {
  assert.deepEqual(pruneDrafts(null, []), { map: {}, changed: false });
  assert.deepEqual(pruneDrafts(undefined, []), { map: {}, changed: false });
  const res = pruneDrafts({ a: { status: 'ok' } }, []);
  assert.equal(res.changed, true);
  assert.deepEqual(res.map, {});
});
