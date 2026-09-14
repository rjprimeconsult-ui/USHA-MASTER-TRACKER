import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTINE_KEYS, ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY, ROUTINE_FEATURE_KEY } from './routineKeys.mjs';
import { BETA_FEATURES } from './featureFlags.js';

const storageSrc = readFileSync(new URL('./storage.js', import.meta.url), 'utf8');

test('every routine key is registered in APP_KEYS (purgeLocalMirror isolation — spec §4)', () => {
  const start = storageSrc.indexOf('const APP_KEYS');
  const appKeys = storageSrc.slice(start, storageSrc.indexOf('];', start));
  for (const k of ROUTINE_KEYS) assert.ok(appKeys.includes(`'${k}'`), `${k} missing from storage.js APP_KEYS`);
});

test('the two routine arrays are MERGEABLE_KEYS; settings is not', () => {
  const block = storageSrc.slice(storageSrc.indexOf('const MERGEABLE_KEYS'), storageSrc.indexOf(']);', storageSrc.indexOf('const MERGEABLE_KEYS')));
  assert.ok(block.includes(`'${ROUTINE_BLOCKS_KEY}'`));
  assert.ok(block.includes(`'${ROUTINE_DAY_KEY}'`));
  assert.ok(!block.includes(`'${ROUTINE_SETTINGS_KEY}'`));
});

test('migrateLocalToCloud never overwrites routine_day_v1 (tick-written records live there)', () => {
  const decl = storageSrc.slice(storageSrc.indexOf('const MIGRATE_SKIP'), storageSrc.indexOf(')', storageSrc.indexOf('const MIGRATE_SKIP')) + 1);
  assert.ok(decl.includes(`'${ROUTINE_DAY_KEY}'`), 'MIGRATE_SKIP must list routine_day_v1');
  const fnStart = storageSrc.indexOf('export async function migrateLocalToCloud');
  const fn = storageSrc.slice(fnStart, storageSrc.indexOf('\n}', fnStart));
  assert.ok(fn.includes('MIGRATE_SKIP.has(key)'), 'the loop must skip MIGRATE_SKIP keys');
});

test('ROUTINE_FEATURE_KEY names a registered feature', () => { assert.ok(BETA_FEATURES[ROUTINE_FEATURE_KEY], 'routine_builder must exist in BETA_FEATURES'); });
