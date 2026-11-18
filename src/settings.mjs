import { origin, relayParts } from './relay.mjs';

export const defaultAccent = '#f3cc59';
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const accentPattern = /^#[0-9a-f]{6}$/i;

function shortText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function suggestSlug(name, relay, published) {
  const fromName = name.normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '');
  const base = fromName || (relay ? 'relay-' + relay : 'relay');
  let candidate = base;
  let number = 2;
  while (candidate === 'demo' || Object.hasOwn(published, candidate)) {
    const suffix = '-' + number++;
    candidate = base.slice(0, 48 - suffix.length).replace(/-$/, '') + suffix;
  }
  return candidate;
}

export function inviteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use a public HTTPS prayer link.');
  return url.href;
}

export function settings(source) {
  const value = {
    relay: typeof source.relay === 'string' ? source.relay : '',
    id: typeof source.id === 'string' ? source.id : '',
    name: shortText(source.name, 60),
    org: shortText(source.org, 42),
    headline: shortText(source.headline, 42),
    intro: shortText(source.intro, 160),
    invite: typeof source.invite === 'string' ? source.invite.trim() : '',
    accent: accentPattern.test(source.accent ?? '') ? source.accent : defaultAccent,
    screenUrl: typeof source.screenUrl === 'string' ? source.screenUrl.trim() : '',
    qr: ['overview', 'vanity'].includes(source.qr) ? source.qr : 'direct',
  };
  if (source.demo === '1' || source.demo === 'live') value.demo = source.demo;
  return value;
}

export function prayerUrl(config) {
  if (config.demo) return origin;
  const parts = relayParts(config.relay, config.id);
  return config.invite ? inviteUrl(config.invite) : `${origin}/prayer_app/custom/${parts.public_key}/map`;
}

export function appUrl(base, options, view, slug) {
  const url = new URL(slug ? '/r/' + slug : '/', base);
  if (!slug) {
    for (const [key, value] of Object.entries(settings(options))) {
      if (value) url.searchParams.set(key, value);
    }
  }
  if (view) url.searchParams.set('view', view);
  return url;
}

export function screenInvitation(base, config, slug) {
  if (config.screenUrl) return inviteUrl(config.screenUrl);
  if (config.qr === 'vanity' && slug) return appUrl(base, config, undefined, slug).href;
  if (config.qr === 'overview' || config.qr === 'vanity') {
    return appUrl(base, { ...config, qr: 'direct' }, 'join', slug).href;
  }
  return prayerUrl(config);
}

export function usableRelay(config) {
  try {
    prayerUrl(config);
    if (config.screenUrl) inviteUrl(config.screenUrl);
    return true;
  } catch {
    return false;
  }
}
