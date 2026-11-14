import { strict as assert } from 'node:assert';
import test from 'node:test';
import { getRelay, parseRelayPage, progress, readRelayUrl, relayParts, snapshot } from '../src/relay.mjs';

const key = 'abcd12';
const parts = relayParts(key, '123');
const time = Date.now();

function result(grid, completed, lap = 1, timestamp = time / 1000) {
  return { grid_data: { data: grid }, stats: {
    key, post_id: 123, lap_number: lap, completed_int: completed, remaining_int: 10 - completed,
    timestamp, participants_int: 3, minutes_prayed_int: 8,
  }};
}

test('only accepts public custom relay links on Prayer.Global', () => {
  assert.equal(readRelayUrl('https://prayer.global/prayer_app/custom/abcd12/map'), key);
  for (const url of [
    'https://prayer.global.example/prayer_app/custom/abcd12/map',
    'https://prayer.global/prayer_app/custom/abcd12/edit',
    'https://prayer.global/prayer_app/global/abcd12/map',
  ]) assert.throws(() => readRelayUrl(url));
});

test('reads only the matching parts metadata from public relay HTML', () => {
  const html = `<script>let jsObject = [${JSON.stringify({ parts, stats: { key } })}][0]</script>`;
  assert.equal(parseRelayPage(html, key), '123');
  assert.throws(() => parseRelayPage(html, 'ffffee'), /different relay/);
  assert.throws(() => parseRelayPage('<h1>Unavailable</h1>', key));
});

test('accepts an empty relay or a sparse grid and strips participant records', () => {
  assert.deepEqual(snapshot(result([], 0), parts, time).grid, {});
  const payload = { ...result({ 100000001: 1 }, 1), participants: [{ name: 'Private' }] };
  assert.deepEqual(snapshot(payload, parts, time), {
    grid: { 100000001: 1 }, lap: 1, covered: 1, total: 10, participants: 3, minutes: 8,
  });
});

test('rejects stale, inconsistent, and wrong-relay feeds', () => {
  assert.throws(() => snapshot(result([], 2), parts, time), /consistent/);
  assert.throws(() => snapshot(result([], 0, 1, time / 1000 - 120), parts, time), /fresh/);
  assert.throws(() => snapshot(result([], 0), relayParts('123abc', '123'), time), /different relay/);
});

test('completes a lap exactly once and keeps cumulative coverage', () => {
  assert.equal(progress({ lap: 1, covered: 4769, total: 4770 }), 999);
  assert.equal(progress({ lap: 1, covered: 4770, total: 4770 }), 1000);
  assert.equal(progress({ lap: 2, covered: 0, total: 4770 }), 1000);
  assert.equal(progress({ lap: 2, covered: 477, total: 4770 }), 1100);
});

test('the display requests only get_grid from the fixed relay endpoint', async () => {
  await getRelay(parts, async (url, options) => {
    assert.equal(url, 'https://prayer.global/wp-json/prayer_app/v1/custom/display');
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(JSON.parse(options.body), { action: 'get_grid', parts });
    return Response.json(result([], 0));
  });
});
