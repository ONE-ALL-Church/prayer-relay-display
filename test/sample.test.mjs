import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sampleGrid, sampleSnapshot } from '../src/sample.mjs';

test('sample totals and map highlights match at rest and during a preview', async () => {
  const features = JSON.parse(await readFile(new URL('../public/demo-map.json', import.meta.url), 'utf8'));
  const initial = sampleSnapshot();
  const preview = sampleSnapshot(initial.covered + 8);
  assert.equal(initial.total, features.length);
  const first = sampleGrid(features, initial.covered);
  const second = sampleGrid(features, preview.covered);
  assert.equal(Object.keys(first).length, initial.covered);
  assert.equal(Object.keys(second).length, preview.covered);
  assert.ok(Object.keys(first).every(id => second[id] === 1));
});
