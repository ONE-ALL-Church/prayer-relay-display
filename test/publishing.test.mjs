import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { publisherSession, publishedRelays } from '../src/published-relays.mjs';

const host = 'https://relay.example.org';
const createRequest = (endpoint, options) => new Request(host + endpoint, options);
const post = (endpoint, body, headers = {}) => createRequest(endpoint, {
  method: 'POST', body: JSON.stringify(body),
  headers: { Origin: host, 'Content-Type': 'application/json', ...headers },
});

test('publishing is optional and anonymous visitors cannot write relay settings', async () => {
  const key = randomBytes(32).toString('hex');
  const session = createRequest('/api/publisher');
  assert.deepEqual(await (await publisherSession(session, new URL(session.url), {})).json(), {
    enabled: false, signedIn: false,
  });

  const write = post('/api/published-relays', { slug: 'outreach' });
  const failIfUsed = () => assert.fail('Unauthorized writes must stop before storage or relay lookup.');
  const result = await publishedRelays(write, new URL(write.url), {
    RELAYS: { prepare: failIfUsed }, PUBLISHER_KEY: key,
  }, failIfUsed);
  assert.equal(result.status, 401);
});

test('publisher sign-in issues a protected cookie and rotating the key rejects that session', async () => {
  const env = { RELAYS: {}, PUBLISHER_KEY: randomBytes(32).toString('hex') };
  const crossSite = post('/api/publisher', { key: env.PUBLISHER_KEY }, { Origin: 'https://other.example' });
  assert.equal((await publisherSession(crossSite, new URL(crossSite.url), env)).status, 403);
  const login = post('/api/publisher', { key: env.PUBLISHER_KEY });
  const authenticated = await publisherSession(login, new URL(login.url), env);
  assert.equal(authenticated.status, 200);
  const cookie = authenticated.headers.get('Set-Cookie');
  assert.match(cookie, /Path=\/; Max-Age=28800; Secure; HttpOnly; SameSite=Strict$/);

  const read = createRequest('/api/publisher', { headers: { Cookie: cookie.split(';')[0] } });
  const status = async runtime => (await (await publisherSession(read, new URL(read.url), runtime)).json()).signedIn;
  assert.equal(await status(env), true);
  assert.equal(await status({ ...env, PUBLISHER_KEY: randomBytes(32).toString('hex') }), false);
});
