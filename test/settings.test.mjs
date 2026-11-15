import assert from 'node:assert/strict';
import test from 'node:test';
import { appUrl, prayerUrl, screenInvitation, settings, suggestSlug, usableRelay } from '../src/settings.mjs';

const base = 'https://prayer.example.org';
const relay = { relay: 'abcd12', id: '123', org: 'Example Church', headline: 'Pray together', name: 'Operations' };

test('existing links keep their direct QR destination and custom prayer link', () => {
  const config = settings(relay);
  assert.equal(screenInvitation(base, config), 'https://prayer.global/prayer_app/custom/abcd12/map');
  assert.equal(screenInvitation(base, { ...config, invite: 'https://church.example/pray' }), 'https://church.example/pray');
});

test('overview links carry the selected relay and its public preferences', () => {
  const config = settings({ ...relay, qr: 'overview', intro: 'Take a minute to pray.' });
  const link = new URL(screenInvitation(base, config));
  assert.equal(link.searchParams.get('view'), 'join');
  assert.equal(link.searchParams.has('name'), false);
  const opened = settings(Object.fromEntries(link.searchParams));
  assert.equal(opened.intro, config.intro);
  assert.equal(opened.org, config.org);
  assert.equal(prayerUrl(opened), prayerUrl(config));
});

test('published screen links and vanity QR use the selected hostname and slug', () => {
  const config = settings({ ...relay, qr: 'vanity' });
  for (const host of [base, 'https://prayer-relay-display.example.workers.dev']) {
    assert.equal(appUrl(host, config, 'side', 'outreach').href, host + '/r/outreach?view=side');
    assert.equal(screenInvitation(host, config, 'outreach'), host + '/r/outreach');
  }
  assert.equal(new URL(screenInvitation(base, config)).searchParams.get('view'), 'join');
});

test('malformed relay IDs and unsafe prayer destinations cannot become valid links', () => {
  assert.equal(usableRelay(settings({ ...relay, relay: 'abcd12extra' })), false);
  assert.equal(usableRelay(settings({ ...relay, id: '1234567890123' })), false);
  assert.equal(usableRelay(settings({ ...relay, invite: 'javascript:alert(1)' })), false);
});

test('short URL suggestions avoid reserved and occupied paths', () => {
  assert.equal(suggestSlug('África & Asia', 'abcd12', { 'africa-asia': {} }), 'africa-asia-2');
  assert.equal(suggestSlug('Demo', 'abcd12', {}), 'demo-2');
  assert.equal(suggestSlug('祈り', 'abcd12', {}), 'relay-abcd12');
  const long = 'a'.repeat(48);
  assert.equal(suggestSlug(long, 'abcd12', { [long]: {} }), 'a'.repeat(46) + '-2');
});
