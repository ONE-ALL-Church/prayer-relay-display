import { strict as assert } from 'node:assert';
import test from 'node:test';
import { getGlobalLap, getRelay, parseRelayPage, progress, readRelayUrl, relayParts, snapshot } from '../src/relay.mjs';

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


test('global display requests the current lap grid and resets coverage across laps', async () => {
  const parts = relayParts('abcdef', '2128', 'global');
  for (const [lap, count, expected] of [[69, 2, 200], [70, 1, 100]]) {
    const stats = { key: 'abcdef', post_id: 2128, completed_int: count,
      remaining_int: 10 - count, lap_number: lap, timestamp: Date.now() / 1000 };
    const data = count === 2 ? { 100000001: 1, 100000002: 1 } : { 100000003: 1 };
    const calls = [];
    const state = await getGlobalLap(parts, async (url, options) => {
      assert.equal(url, 'https://prayer.global/wp-json/prayer_app/v1/global/map');
      assert.equal(options.credentials, 'omit');
      const body = JSON.parse(options.body);
      calls.push(body);
      return Response.json(body.action === 'get_stats' ? stats : { grid_data: { data } });
    });
    assert.deepEqual(calls, [
      { action: 'get_stats', parts },
      { action: 'get_grid', parts, data: { lap_number: lap } },
    ]);
    assert.equal(state.lap, lap);
    assert.deepEqual(state.grid, data);
    assert.equal(progress(state, false), expected);
  }
});

test('global display rejects a grid that is inconsistent with its lap totals', async () => {
  const parts = relayParts('abcdef', '2128', 'global');
  await assert.rejects(getGlobalLap(parts, async (_, options) => {
    const { action } = JSON.parse(options.body);
    return Response.json(action === 'get_stats'
      ? { key: 'abcdef', post_id: 2128, completed_int: 2, remaining_int: 8, lap_number: 69, timestamp: Date.now() / 1000 }
      : { grid_data: { data: { 100000001: 1 } } });
  }), /consistent prayer data/);
});
