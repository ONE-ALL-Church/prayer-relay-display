import { origin, parseRelayPage, relayKey } from './relay.mjs';
import { publishedRelays, publisherSession } from './published-relays.mjs';

function fetchPrayerPage(url) {
  return fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    cf: { cacheEverything: true, cacheTtlByStatus: { '200': 300, '300-399': 60, '400-599': 0 } },
  });
}

async function lookupRelayId(key, mode = 'custom') {
  const view = mode === 'global' ? 'map' : 'display';
  const upstream = await fetchPrayerPage(`${origin}/prayer_app/${mode}/${key}/${view}`);
  if (!upstream.ok) throw new Error('Prayer.Global could not open that relay.');

  // Limit the HTML response before decoding.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error('Relay page is too large.');
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } finally {
    await reader.cancel();
  }
  return parseRelayPage(html, key, mode);
}

async function lookupGlobalRelay() {
  const latestMap = new URL('/newest/map', origin);
  const response = await fetchPrayerPage(latestMap);
  const location = response.headers.get('Location');
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error('Prayer.Global did not return a global map.');
  }
  const map = new URL(location, latestMap);
  const key = map.pathname.match(/^\/prayer_app\/global\/([0-9a-f]{6})\/map\/?$/)?.[1];
  if (map.origin !== origin || !key) throw new Error('Prayer.Global returned an unexpected global map.');
  return { key, id: await lookupRelayId(key, 'global') };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/publisher' || url.pathname === '/api/published-relays') {
      try {
        return url.pathname === '/api/publisher'
          ? await publisherSession(request, url, env)
          : await publishedRelays(request, url, env, lookupRelayId);
      } catch (error) {
        console.error('Relay publishing request failed', error.name);
        return Response.json({ error: 'Relay publishing is temporarily unavailable.' }, {
          status: 503, headers: { 'Cache-Control': 'no-store' },
        });
      }
    }
    if (url.pathname !== '/api/relay') return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    const global = url.searchParams.get('source') === 'global';
    const key = url.searchParams.get('key') ?? '';
    if (!global && !relayKey.test(key)) return Response.json({ error: 'Invalid relay link.' }, { status: 400 });
    try {
      const relay = global ? await lookupGlobalRelay() : { id: await lookupRelayId(key) };
      return Response.json(relay, {
        headers: { 'cache-control': 'public, max-age=300' },
      });
    } catch (error) {
      console.warn('Relay lookup failed', error.name);
      return Response.json({ error: 'Could not verify that public relay. Check the link and try again.' }, { status: 502 });
    }
  },
};
