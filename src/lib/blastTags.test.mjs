import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blastTagOptions } from './blastTags.mjs';

test('distinct non-empty tags, first-seen order', () => {
  assert.deepEqual(
    blastTagOptions([{campaignOrTag:'A'},{campaignOrTag:''},{campaignOrTag:'B'},{campaignOrTag:'A'}]),
    ['A','B']
  );
});
test('case-insensitive dedupe, keeps first casing', () => {
  assert.deepEqual(blastTagOptions([{campaignOrTag:'Drip'},{campaignOrTag:'drip'}]), ['Drip']);
});
test('handles empty / non-array', () => {
  assert.deepEqual(blastTagOptions([]), []);
  assert.deepEqual(blastTagOptions(undefined), []);
});
