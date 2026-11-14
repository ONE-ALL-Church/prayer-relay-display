import { origin, parseRelayPage, relayKey } from './relay.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/relay') return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    const key = url.searchParams.get('key') ?? '';
    if (!relayKey.test(key)) return Response.json({ error: 'Invalid relay link.' }, { status: 400 });
    try {
      const upstream = await fetch(`${origin}/prayer_app/custom/${key}/display`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        cf: { cacheEverything: true, cacheTtlByStatus: { '200': 300, '400-599': 0 } },
      });
      if (!upstream.ok) return Response.json({ error: 'Prayer.Global could not open that relay.' }, { status: 502 });

      // Limit the HTML response before decoding. Only the public relay ID leaves this route.
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

      return Response.json({ id: parseRelayPage(html, key) }, {
        headers: { 'cache-control': 'public, max-age=300' },
      });
    } catch (error) {
      console.warn('Relay lookup failed', error.name);
      return Response.json({ error: 'Could not verify that public relay. Check the link and try again.' }, { status: 502 });
    }
  },
};
