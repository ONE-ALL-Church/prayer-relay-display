export const origin = 'https://prayer.global';
export const relayKey = /^[0-9a-f]{6}$/;
const postId = /^[1-9][0-9]{0,11}$/;

export function readRelayUrl(value) {
  const url = new URL(value.trim());
  const match = url.pathname.match(/^\/prayer_app\/custom\/([0-9a-f]{6})\/(?:map|display)\/?$/);
  if (url.origin !== origin || !match || url.username || url.password) {
    throw new Error('Enter the public Prayer.Global relay map or display link.');
  }
  return match[1];
}

export function relayParts(key, id, mode = 'custom') {
  if (!relayKey.test(key) || !postId.test(id)) throw new Error('Invalid relay.');
  return {
    root: 'prayer_app',
    type: mode,
    meta_key: `prayer_app_${mode}_magic_key`,
    public_key: key,
    action: mode === 'global' ? 'map' : 'display',
    post_id: String(id),
    post_type: 'pg_relays',
    instance_id: '',
  };
}

export function parseRelayPage(html, key, mode = 'custom') {
  const metadata = html.match(/\blet jsObject\s*=\s*\[(\{"parts"\s*:\s*\{[^{}]*\})\s*,/);
  if (!metadata) throw new Error('Prayer.Global did not provide relay details.');
  const { parts } = JSON.parse(metadata[1] + '}');
  const expected = relayParts(key, parts.post_id, mode);
  if (Object.keys(expected).some(field => String(parts[field]) !== expected[field])) {
    throw new Error('Prayer.Global returned details for a different relay.');
  }
  return expected.post_id;
}

const nonnegative = value => Number.isSafeInteger(value) && value >= 0;

export function snapshot(result, parts, now = Date.now()) {
  const stats = result?.stats;
  const grid = result?.grid_data?.data;
  if (stats?.key !== parts.public_key || String(stats.post_id) !== parts.post_id) {
    throw new Error('Prayer.Global returned a different relay.');
  }
  const { completed_int: covered, remaining_int: remaining, lap_number: lap, timestamp } = stats;
  const total = covered + remaining;
  if (!nonnegative(covered) || !nonnegative(remaining) || !Number.isSafeInteger(total) || total < 1 ||
      !Number.isSafeInteger(lap) || lap < 1 || !Number.isFinite(timestamp) ||
      Math.abs(now / 1000 - timestamp) > 90) throw new Error('Waiting for fresh prayer data.');
  const items = grid && typeof grid === 'object' && (!Array.isArray(grid) || grid.length === 0)
    ? Object.entries(grid) : null;
  if (!items || items.length > total ||
      items.some(([key, value]) => !/^\d{9}$/.test(key) || !nonnegative(value)) ||
      items.filter(([, value]) => value > 0).length !== covered) throw new Error('Waiting for consistent prayer data.');
  return {
    grid: Object.fromEntries(items.filter(([, value]) => value > 0)),
    lap, covered, total,
    participants: nonnegative(stats.participants_int) ? stats.participants_int : null,
    minutes: nonnegative(stats.minutes_prayed_int) ? stats.minutes_prayed_int : null,
  };
}

export function progress({ lap, covered, total }, cumulative = true) {
  const current = Math.round(covered / total * 1000);
  const completed = cumulative ? (lap - 1) * 1000 : 0;
  return completed + Math.min(current, covered < total ? 999 : 1000);
}

async function requestRelay(parts, action, data, fetcher) {
  const path = parts.type === 'global' ? 'global/map' : 'custom/display';
  const response = await fetcher(origin + '/wp-json/prayer_app/v1/' + path, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ action, parts, data }),
  });
  if (!response.ok) throw new Error('Prayer.Global could not load this relay.');
  return response.json();
}

export async function getRelay(parts, fetcher = fetch) {
  return snapshot(await requestRelay(parts, 'get_grid', undefined, fetcher), parts);
}

export async function getGlobalLap(parts, fetcher = fetch) {
  const stats = await requestRelay(parts, 'get_stats', undefined, fetcher);
  if (stats?.key !== parts.public_key || String(stats.post_id) !== parts.post_id ||
      !Number.isSafeInteger(stats.lap_number) || stats.lap_number < 1) {
    throw new Error('Prayer.Global returned a different relay or an invalid lap.');
  }
  const { grid_data } = await requestRelay(parts, 'get_grid', { lap_number: stats.lap_number }, fetcher);
  return snapshot({ stats, grid_data }, parts);
}
