import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDownlineIds, isDescendant, directReports, uplineChain, wouldCreateCycle,
  MAX_TEAM_DEPTH,
} from './teamTree.mjs';

// Edge helper
const E = (uplineId, downlineId, status = 'active') => ({ uplineId, downlineId, status });

// The canonical 3-level org from the spec:
//   SAT → FSL1 → FTA1 → A1, A2
//                FTA2 → A3
//         FSL2 → FTA3 → A4
const ORG = [
  E('SAT', 'FSL1'), E('SAT', 'FSL2'),
  E('FSL1', 'FTA1'), E('FSL1', 'FTA2'),
  E('FSL2', 'FTA3'),
  E('FTA1', 'A1'), E('FTA1', 'A2'),
  E('FTA2', 'A3'),
  E('FTA3', 'A4'),
];

// ---------- getDownlineIds: transitive visibility ----------

test('SAT sees the entire downline subtree (all 9)', () => {
  const ids = getDownlineIds('SAT', ORG);
  assert.deepEqual([...ids].sort(), ['A1', 'A2', 'A3', 'A4', 'FSL1', 'FSL2', 'FTA1', 'FTA2', 'FTA3']);
});

test('FSL1 sees only their subtree — never sideways (FSL2 branch) or upward (SAT)', () => {
  const ids = getDownlineIds('FSL1', ORG);
  assert.deepEqual([...ids].sort(), ['A1', 'A2', 'A3', 'FTA1', 'FTA2']);
  assert.equal(ids.has('SAT'), false);
  assert.equal(ids.has('FSL2'), false);
  assert.equal(ids.has('A4'), false);
});

test('FTA1 sees only their own agents', () => {
  const ids = getDownlineIds('FTA1', ORG);
  assert.deepEqual([...ids].sort(), ['A1', 'A2']);
});

test('a leaf agent has an empty downline', () => {
  assert.equal(getDownlineIds('A1', ORG).size, 0);
});

test('root is never included in its own downline', () => {
  assert.equal(getDownlineIds('SAT', ORG).has('SAT'), false);
});

// ---------- non-active edges grant nothing ----------

test('pending / removed / declined edges do not grant visibility', () => {
  const edges = [
    E('L', 'X', 'pending'),
    E('L', 'Y', 'removed'),
    E('L', 'Z', 'declined'),
    E('L', 'W', 'active'),
  ];
  assert.deepEqual([...getDownlineIds('L', edges)], ['W']);
});

test('edge with null downline_id (unresolved invite) is ignored', () => {
  const edges = [{ uplineId: 'L', downlineId: null, status: 'active' }, E('L', 'W')];
  assert.deepEqual([...getDownlineIds('L', edges)], ['W']);
});

// ---------- THE cycle tests (must terminate, must stay correct) ----------

test('deliberately planted 2-cycle terminates and yields the right set', () => {
  // Malformed data: A→B and B→A both active (DB constraints would normally block)
  const edges = [E('A', 'B'), E('B', 'A')];
  const ids = getDownlineIds('A', edges);
  assert.deepEqual([...ids], ['B']); // B is below A; A never re-enters its own set
});

test('deeper planted cycle (B→C→B) below the root terminates', () => {
  const edges = [E('A', 'B'), E('B', 'C'), E('C', 'B'), E('C', 'D')];
  const ids = getDownlineIds('A', edges);
  assert.deepEqual([...ids].sort(), ['B', 'C', 'D']);
});

test('self-edge is ignored, not followed', () => {
  const edges = [E('A', 'A'), E('A', 'B')];
  assert.deepEqual([...getDownlineIds('A', edges)], ['B']);
});

test('depth cap: a chain longer than MAX_TEAM_DEPTH is truncated, never loops', () => {
  const edges = [];
  for (let i = 0; i < 30; i++) edges.push(E(`N${i}`, `N${i + 1}`));
  const ids = getDownlineIds('N0', edges);
  assert.equal(ids.size, MAX_TEAM_DEPTH); // capped
  assert.equal(ids.has(`N${MAX_TEAM_DEPTH}`), true);
  assert.equal(ids.has(`N${MAX_TEAM_DEPTH + 1}`), false);
});

// ---------- isDescendant: the authorization predicate ----------

test('isDescendant matches the subtree exactly', () => {
  assert.equal(isDescendant('SAT', 'A4', ORG), true);
  assert.equal(isDescendant('FSL1', 'A4', ORG), false); // sideways
  assert.equal(isDescendant('FTA1', 'SAT', ORG), false); // upward
  assert.equal(isDescendant('A1', 'A2', ORG), false);    // peer
  assert.equal(isDescendant('SAT', 'SAT', ORG), false);  // self
});

// ---------- directReports ----------

test('directReports returns one level only', () => {
  assert.deepEqual(directReports('SAT', ORG).sort(), ['FSL1', 'FSL2']);
  assert.deepEqual(directReports('FTA1', ORG).sort(), ['A1', 'A2']);
  assert.deepEqual(directReports('A1', ORG), []);
});

// ---------- uplineChain ----------

test('uplineChain walks to the top, nearest first', () => {
  assert.deepEqual(uplineChain('A1', ORG), ['FTA1', 'FSL1', 'SAT']);
  assert.deepEqual(uplineChain('SAT', ORG), []);
});

test('uplineChain is cycle-safe on malformed data', () => {
  const edges = [E('A', 'B'), E('B', 'A')];
  assert.deepEqual(uplineChain('B', edges), ['A']); // stops, no loop
});

// ---------- wouldCreateCycle: invite guard ----------

test('inviting your own ancestor is a cycle', () => {
  assert.equal(wouldCreateCycle('FTA1', 'SAT', ORG), true);
  assert.equal(wouldCreateCycle('FTA1', 'FSL1', ORG), true);
});

test('inviting yourself is a cycle', () => {
  assert.equal(wouldCreateCycle('FTA1', 'FTA1', ORG), true);
});

test('inviting a stranger or a peer is NOT a cycle', () => {
  assert.equal(wouldCreateCycle('FTA1', 'NEW_USER', ORG), false);
  assert.equal(wouldCreateCycle('FTA1', 'FTA2', ORG), false); // peer (would move teams — allowed, not a cycle)
});

// ---------- malformed multi-upline tolerance ----------

test('walk tolerates duplicate active uplines in bad data (no crash, superset-safe)', () => {
  // DB partial unique index prevents this; the walk must still terminate.
  const edges = [E('L1', 'X'), E('L2', 'X'), E('X', 'Y')];
  assert.deepEqual([...getDownlineIds('L1', edges)].sort(), ['X', 'Y']);
  assert.deepEqual([...getDownlineIds('L2', edges)].sort(), ['X', 'Y']);
});
