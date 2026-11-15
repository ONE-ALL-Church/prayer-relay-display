const cookieName = '__Host-relay-publisher';
const lifetime = 8 * 60 * 60;
const encoder = new TextEncoder();

async function keyFor(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function canPublish(env) {
  return Boolean(env.RELAYS && typeof env.PUBLISHER_KEY === 'string' && env.PUBLISHER_KEY.length >= 32);
}

export async function matchesPublisherKey(candidate, secret) {
  if (typeof candidate !== 'string' || candidate.length < 32 || candidate.length > 256) return false;
  const challenge = encoder.encode('prayer-relay:login');
  const signature = await crypto.subtle.sign('HMAC', await keyFor(candidate), challenge);
  return crypto.subtle.verify('HMAC', await keyFor(secret), signature, challenge);
}

export async function publisherCookie(secret) {
  const expires = Math.floor(Date.now() / 1000) + lifetime;
  const value = expires + '.' + crypto.randomUUID();
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(value));
  return sessionCookie(value + '.' + btoa(String.fromCharCode(...new Uint8Array(signature))), lifetime);
}

export function sessionCookie(value = '', age = 0) {
  return `${cookieName}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Strict`;
}

export async function signedIn(request, env) {
  if (!canPublish(env)) return false;
  const cookie = request.headers.get('Cookie')?.split(/;\s*/).find(part => part.startsWith(cookieName + '='));
  const value = cookie?.slice(cookieName.length + 1) ?? '';
  const match = /^(\d{10})\.([0-9a-f-]{36})\.([A-Za-z0-9+/]{43}=)$/.exec(value);
  if (!match || Number(match[1]) <= Date.now() / 1000) return false;
  const signature = Uint8Array.from(atob(match[3]), character => character.charCodeAt(0));
  return crypto.subtle.verify('HMAC', await keyFor(env.PUBLISHER_KEY), signature, encoder.encode(match[1] + '.' + match[2]));
}

export function publisherRequest(request, url) {
  return request.headers.get('Origin') === url.origin &&
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'application/json';
}

export async function boundedJson(request) {
  if (!request.body || Number(request.headers.get('Content-Length')) > 4096) throw new Error('Invalid request body.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(body + decoder.decode());
      size += value.byteLength;
      if (size > 4096) throw new Error('Invalid request body.');
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}
