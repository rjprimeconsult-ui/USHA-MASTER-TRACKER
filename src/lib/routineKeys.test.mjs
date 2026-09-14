import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTINE_KEYS, ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY, ROUTINE_FEATURE_KEY } from './routineKeys.mjs';

const storageSrc = readFileSync(new URL('./storage.js', import.meta.url), 'utf8');

test('every routine key is registered in APP_KEYS (purgeLocalMirror isolation — spec §4)', () => {
  for (const k of ROUTINE_KEYS) assert.ok(storageSrc.includes(`'${k}'`), `${k} missing from storage.js APP_KEYS`);
});

test('the two routine arrays are MERGEABLE_KEYS; settings is not', () => {
  const block = storageSrc.slice(storageSrc.indexOf('const MERGEABLE_KEYS'), storageSrc.indexOf(']);', storageSrc.indexOf('const MERGEABLE_KEYS')));
  assert.ok(block.includes(`'${ROUTINE_BLOCKS_KEY}'`));
  assert.ok(block.includes(`'${ROUTINE_DAY_KEY}'`));
  assert.ok(!block.includes(`'${ROUTINE_SETTINGS_KEY}'`));
});

test('migrateLocalToCloud never overwrites routine_day_v1 (tick-written records live there)', () => {
  const fn = storageSrc.slice(storageSrc.indexOf('const MIGRATE_SKIP'));
  assert.ok(fn.includes('MIGRATE_SKIP') && fn.includes(ROUTINE_DAY_KEY) && fn.includes('export async function migrateLocalToCloud'));
});

test('feature key literal', () => { assert.equal(ROUTINE_FEATURE_KEY, 'routine_builder'); });
