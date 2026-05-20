// Tests for the record-merge logic that prevents last-write-wins data
// loss when PRIM is open in two tabs/devices.
//
//   Run:  node --test src/lib/mergeStore.test.mjs
//
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeArrayStores } from './mergeStore.mjs';

test('THE BUG: a record another session added is never erased', () => {
  // This session loaded [a, b] then saves. Meanwhile another tab added
  // "tim". The merged write must still contain tim.
  const local    = [{ id: 'a' }, { id: 'b' }];
  const remote   = [{ id: 'a' }, { id: 'b' }, { id: 'tim', name: 'Tim Vince' }];
  const baseline = new Set(['a', 'b']);
  const merged = mergeArrayStores(local, remote, baseline);
  assert.ok(merged.some(r => r.id === 'tim'), 'tim must survive the merge');
  assert.equal(merged.length, 3);
});

test('a record this session deleted stays deleted', () => {
  // Loaded [a, b] (both in baseline), user deleted b → local is [a].
  // b is still in remote, but baseline proves we deleted it on purpose.
  const local    = [{ id: 'a' }];
  const remote   = [{ id: 'a' }, { id: 'b' }];
  const baseline = new Set(['a', 'b']);
  const merged = mergeArrayStores(local, remote, baseline);
  assert.deepEqual(merged.map(r => r.id), ['a']);
});

test('a record this session added is kept', () => {
  const local    = [{ id: 'a' }, { id: 'bob' }];
  const remote   = [{ id: 'a' }];
  const baseline = new Set(['a', 'bob']);
  const merged = mergeArrayStores(local, remote, baseline);
  assert.ok(merged.some(r => r.id === 'bob'));
  assert.equal(merged.length, 2);
});

test('edit conflict — the active tab (local) wins', () => {
  const local    = [{ id: 'a', v: 'local-edit' }];
  const remote   = [{ id: 'a', v: 'remote-edit' }];
  const baseline = new Set(['a']);
  const merged = mergeArrayStores(local, remote, baseline);
  assert.equal(merged[0].v, 'local-edit');
});

test('empty remote — local is returned as-is', () => {
  const local = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(mergeArrayStores(local, [], new Set()), local);
});

test('null / non-array remote — local is returned as-is', () => {
  const local = [{ id: 'a' }];
  assert.deepEqual(mergeArrayStores(local, null, new Set()), local);
  assert.deepEqual(mergeArrayStores(local, undefined, new Set()), local);
});

test('a record with no id — returns null so caller falls back to plain write', () => {
  const local  = [{ id: 'a' }, { name: 'no id here' }];
  const remote = [{ id: 'a' }];
  assert.equal(mergeArrayStores(local, remote, new Set()), null);

  const local2  = [{ id: 'a' }];
  const remote2 = [{ id: 'a' }, { name: 'remote no id' }];
  assert.equal(mergeArrayStores(local2, remote2, new Set()), null);
});

test('missing baseline is treated as empty — remote-only records are kept', () => {
  // Safe direction: without a baseline we cannot prove a delete, so we
  // keep the remote record rather than risk erasing it.
  const local  = [{ id: 'a' }];
  const remote = [{ id: 'a' }, { id: 'x' }];
  const merged = mergeArrayStores(local, remote, undefined);
  assert.ok(merged.some(r => r.id === 'x'));
});

test('two sessions both added records — both survive', () => {
  // This session added "bob" (in baseline); another added "tim" (not).
  const local    = [{ id: 'a' }, { id: 'bob' }];
  const remote   = [{ id: 'a' }, { id: 'tim' }];
  const baseline = new Set(['a', 'bob']);
  const merged = mergeArrayStores(local, remote, baseline);
  const ids = merged.map(r => r.id).sort();
  assert.deepEqual(ids, ['a', 'bob', 'tim']);
});
