import { relayKey } from './relay.mjs';
import { settings, slugPattern, usableRelay } from './settings.mjs';
import { boundedJson, canPublish, matchesPublisherKey, publisherCookie, publisherRequest, sessionCookie, signedIn } from './publisher.mjs';

const response = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

function validSlug(slug) {
  return typeof slug === 'string' && slug.length <= 48 && slugPattern.test(slug);
}

export async function publisherSession(request, url, env) {
  if (request.method === 'GET') return response({ enabled: canPublish(env), signedIn: await signedIn(request, env) });
  if (request.method !== 'POST') return response({ error: 'Method unavailable.' }, 405, { Allow: 'GET, POST' });
  if (!canPublish(env)) return response({ error: 'Browser publishing is unavailable on this deployment.' }, 503);
  if (!publisherRequest(request, url)) return response({ error: 'Open setup on this site to sign in.' }, 403);
  let body;
  try {
    body = await boundedJson(request);
  } catch {
    return response({ error: 'Invalid sign-in request.' }, 400);
  }
  if (body?.signOut === true) return response({ signedIn: false }, 200, { 'Set-Cookie': sessionCookie() });
  if (!(await matchesPublisherKey(body?.key, env.PUBLISHER_KEY))) return response({ error: 'That publishing key was not accepted.' }, 401);
  const cookie = await publisherCookie(env.PUBLISHER_KEY);
  return response({ signedIn: true }, 200, { 'Set-Cookie': cookie });
}

export async function publishedRelays(request, url, env, lookupRelayId) {
  if (request.method === 'GET') {
    if (!env.RELAYS) return response({ relays: {} });
    const slug = url.searchParams.get('slug');
    if (slug !== null && !validSlug(slug)) return response({ relays: {} });
    const rows = slug === null
      ? await env.RELAYS.prepare('SELECT slug, config, revision FROM published_relays ORDER BY slug').all()
      : await env.RELAYS.prepare('SELECT slug, config, revision FROM published_relays WHERE slug = ?').bind(slug).all();
    const relays = Object.fromEntries(rows.results.map(row => [row.slug, { config: JSON.parse(row.config), revision: row.revision }]));
    return response({ relays });
  }

  if (request.method !== 'POST') return response({ error: 'Method unavailable.' }, 405, { Allow: 'GET, POST' });
  if (!canPublish(env)) return response({ error: 'Browser publishing is unavailable on this deployment.' }, 503);
  if (!publisherRequest(request, url) || !(await signedIn(request, env))) return response({ error: 'Sign in to publish this relay.' }, 401);

  let body;
  try {
    body = await boundedJson(request);
  } catch {
    return response({ error: 'Invalid relay settings.' }, 400);
  }
  const { slug, config: submitted, revision = null } = body ?? {};
  if (!validSlug(slug) || (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))) {
    return response({ error: 'Enter a valid short URL. Use lowercase letters, numbers, and hyphens.' }, 400);
  }
  const config = settings(submitted ?? {});
  if (config.demo || !relayKey.test(config.relay) || config.qr !== 'vanity' || config.invite.length > 240) {
    return response({ error: 'Choose a public Prayer.Global relay and a short URL for its overview.' }, 400);
  }
  const bundled = await env.ASSETS.fetch(new Request(new URL('/relays.json', url)));
  if (!bundled.ok) return response({ error: 'Could not check the deployment’s relay list. Try again.' }, 503);
  if (Object.hasOwn(await bundled.json(), slug) || slug === 'demo') {
    return response({ error: 'That short URL comes from the deployment file. Choose another short URL or edit it there.' }, 409);
  }

  try {
    config.id = await lookupRelayId(config.relay);
  } catch {
    return response({ error: 'Prayer.Global could not verify the relay. Try again before publishing.' }, 502);
  }
  if (!usableRelay(config)) return response({ error: 'Enter a valid public HTTPS prayer link.' }, 400);

  const record = JSON.stringify(config);
  const result = revision === null
    ? await env.RELAYS.prepare('INSERT INTO published_relays (slug, config) VALUES (?, ?) ON CONFLICT (slug) DO NOTHING RETURNING revision')
      .bind(slug, record).first()
    : await env.RELAYS.prepare('UPDATE published_relays SET config = ?, revision = revision + 1 WHERE slug = ? AND revision = ? RETURNING revision')
      .bind(record, slug, revision).first();
  if (!result) return response({ error: 'This short URL was published or updated elsewhere. Reload setup and open the published relay before editing.' }, 409);
  return response({ config, revision: result.revision });
}
