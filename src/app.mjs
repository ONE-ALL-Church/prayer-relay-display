import QRCode from 'qrcode';
import { origin, readRelayUrl, relayParts, getRelay, progress } from './relay.mjs';
import { drawMap, loadMap } from './map.mjs';
import { appUrl, inviteUrl, prayerUrl, screenInvitation, settings, slugPattern, usableRelay } from './settings.mjs';

const $ = id => document.getElementById(id);
const currentUrl = new URL(location.href);
const query = currentUrl.searchParams;
const base = currentUrl.origin;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const savedKey = 'prayer-relay-display:saved-relays';
const vanityPath = currentUrl.pathname.match(/^\/r\/([^/]+)\/?$/);
const allowedViews = ['side', 'led', 'join'];

async function publishedRelays() {
  try {
    const response = await fetch('/relays.json');
    if (!response.ok) return {};
    const records = await response.json();
    return Object.fromEntries(Object.entries(records).flatMap(([slug, record]) => {
      if (!slugPattern.test(slug) || slug.length > 48 || !record || typeof record !== 'object') return [];
      const config = settings(record);
      return usableRelay(config) ? [[slug, config]] : [];
    }));
  } catch {
    return {};
  }
}

function savedRelays() {
  try {
    const records = JSON.parse(localStorage.getItem(savedKey) || '{}');
    return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
  } catch {
    return {};
  }
}

function storeRelays(records) {
  try {
    localStorage.setItem(savedKey, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

function applyAccent(color) {
  const channels = color.slice(1).match(/../g).map(hex => {
    const channel = Number.parseInt(hex, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-text', luminance > .179 ? '#000' : '#fff');
}

function addResult(name, url) {
  const row = document.createElement('div');
  row.className = 'generated-link';
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  anchor.textContent = name;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.setAttribute('aria-label', 'Copy ' + name.toLowerCase());
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url.href);
      $('copy-status').textContent = name + ' copied.';
    } catch {
      $('copy-status').textContent = 'Open ' + name.toLowerCase() + ' and copy its address.';
    }
  });
  row.append(anchor, copy);
  $('generated').append(row);
}

function showSetup(prefill, published, initialMessage = '') {
  const form = $('relay-form');
  const status = $('form-status');
  let editing;
  let records = savedRelays();
  status.textContent = initialMessage;
  $('setup').hidden = false;

  function showDestination() {
    const choice = $('qr-destination').value;
    $('overview-settings').hidden = choice === 'direct';
    $('vanity-settings').hidden = choice !== 'vanity';
    $('vanity-slug').required = choice === 'vanity';
    $('vanity-slug').disabled = choice !== 'vanity';
    const slug = $('vanity-slug').value;
    $('short-preview').textContent = slugPattern.test(slug) ? appUrl(base, {}, undefined, slug).href : '';
  }

  function fill(config, slug = '') {
    $('relay').value = relayKeyUrl(config.relay);
    const fields = { 'relay-name': config.name, org: config.org, headline: config.headline, invite: config.invite,
      'intro-copy': config.intro, accent: config.accent, 'qr-destination': config.qr, 'vanity-slug': slug };
    for (const [field, value] of Object.entries(fields)) $(field).value = value;
    showDestination();
  }

  function showLinks(config, slug = '') {
    const isPublished = Object.hasOwn(published, slug) && JSON.stringify(published[slug]) === JSON.stringify(config);
    const publishedSlug = isPublished ? slug : '';
    const linkedConfig = !isPublished && config.qr === 'vanity' ? { ...config, qr: 'overview' } : config;
    $('generated').replaceChildren();
    $('copy-status').textContent = '';
    addResult('Side screen', appUrl(base, linkedConfig, 'side', publishedSlug));
    addResult('Rear LED', appUrl(base, linkedConfig, 'led', publishedSlug));
    addResult('Participant overview', appUrl(base, linkedConfig, 'join', publishedSlug));
    const setup = appUrl(base, config);
    if (slug) setup.searchParams.set('slug', slug);
    addResult('Setup link', setup);

    $('vanity-help').hidden = isPublished || config.qr !== 'vanity';
    $('vanity-help').open = !isPublished && config.qr === 'vanity';
    $('profile-json').value = JSON.stringify({ ...published, [slug]: config }, null, 2);
    $('publish-status').textContent = !isPublished && config.qr === 'vanity'
      ? 'These links preview the branded overview. Publish the short URL to use it in the QR code.' : '';
    $('results').hidden = false;
  }

  function renderSaved() {
    const list = $('relay-list');
    list.replaceChildren();
    for (const [key, record] of Object.entries(records)) {
      const config = settings(record?.config || {});
      if (!usableRelay(config) || config.demo) continue;
      const item = document.createElement('li');
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'secondary';
      select.textContent = config.name || config.headline || config.org || config.relay;
      select.addEventListener('click', () => {
        editing = key;
        fill(config, record.slug);
        showLinks(config, record.slug);
        status.textContent = 'Relay loaded. Save to update its settings.';
        $('relay-name').focus();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + select.textContent);
      remove.addEventListener('click', () => {
        const remaining = { ...records };
        delete remaining[key];
        if (!storeRelays(remaining)) {
          status.textContent = 'This browser could not remove the saved relay.';
          return;
        }
        records = remaining;
        if (editing === key) editing = undefined;
        renderSaved();
        status.textContent = 'Removed from this browser.';
        if (list.childElementCount) $('new-relay').focus();
        else $('relay').focus();
      });
      item.append(select, remove);
      list.append(item);
    }
    $('saved-relays').hidden = !list.childElementCount;
  }

  const publishedList = $('published-list');
  for (const [slug, config] of Object.entries(published)) {
    if (config.demo) continue;
    const item = document.createElement('li');
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'secondary';
    select.textContent = config.name || config.headline || slug;
    select.addEventListener('click', () => {
      editing = undefined;
      fill(config, slug);
      showLinks(config, slug);
      $('generated').querySelector('a').focus();
    });
    item.append(select);
    publishedList.append(item);
  }
  $('published-relays').hidden = !publishedList.childElementCount;

  fill(prefill, query.get('slug') ?? '');
  renderSaved();
  $('qr-destination').addEventListener('change', showDestination);
  $('vanity-slug').addEventListener('input', showDestination);
  $('new-relay').addEventListener('click', () => {
    editing = undefined;
    fill(settings({}));
    status.textContent = '';
    $('results').hidden = true;
    $('relay').focus();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    status.textContent = 'Checking the relay…';
    try {
      const key = readRelayUrl($('relay').value);
      const invite = $('invite').value.trim() ? inviteUrl($('invite').value) : '';
      const response = await fetch('/api/relay?' + new URLSearchParams({ key }), { signal: AbortSignal.timeout(14000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The relay could not be verified.');
      await getRelay(relayParts(key, result.id));
      const qr = $('qr-destination').value;
      const slug = qr === 'vanity' ? $('vanity-slug').value : '';
      const config = settings({ relay: key, id: result.id, name: $('relay-name').value,
        org: $('org').value, headline: $('headline').value, invite, intro: $('intro-copy').value, accent: $('accent').value, qr });
      const recordKey = editing ?? crypto.randomUUID();
      const updated = { ...savedRelays(), [recordKey]: { config, slug } };
      const stored = storeRelays(updated);
      if (stored) {
        records = updated;
        editing = recordKey;
        renderSaved();
      }
      showLinks(config, slug);
      status.textContent = stored ? 'Screen links are ready. Relay saved in this browser.' : 'Screen links are ready. Copy the setup link to save your settings.';
      $('generated').querySelector('a').focus();
    } catch (error) {
      status.textContent = error instanceof TypeError || error.name === 'TimeoutError'
        ? 'Could not connect. Check the links and try again.' : error.message;
    } finally {
      button.disabled = false;
    }
  });
}

function relayKeyUrl(key) {
  return /^[0-9a-f]{6}$/.test(key) ? `${origin}/prayer_app/custom/${key}/display` : '';
}

function showOverview(config) {
  const demo = config.demo === '1';
  $('overview').hidden = false;
  applyAccent(config.accent);
  $('overview-org').textContent = config.org || 'Prayer Relay';
  $('overview-headline').textContent = config.headline || 'Pray for the world';
  $('overview-intro').textContent = config.intro || 'Take a minute to pray for a place in the world.';
  $('start-praying').href = prayerUrl(config);
  if (demo) {
    $('start-praying').firstChild.textContent = 'Explore Prayer.Global ';
    $('overview-status').textContent = 'Demo data';
    $('overview-coverage').textContent = '42.1%';
    $('overview-participants').textContent = '312';
    return;
  }

  const parts = relayParts(config.relay, config.id);
  const status = $('overview-status');
  let hasData = false;
  status.textContent = 'Connecting';
  async function refresh() {
    try {
      const state = await getRelay(parts);
      $('overview-coverage').textContent = (progress(state) / 10).toFixed(1) + '%';
      $('overview-participants').textContent = state.participants?.toLocaleString() ?? '—';
      hasData = true;
      status.textContent = 'Live relay';
    } catch {
      status.textContent = hasData ? 'Updates delayed' : 'Progress unavailable';
    }
    setTimeout(refresh, 30000);
  }
  refresh();
}

function counter(element, format) {
  let current, frame;
  return (next, animate) => {
    if (next === current && !frame) return;
    cancelAnimationFrame(frame);
    frame = undefined;
    if (next == null || current == null || current === next || !animate || motion.matches || next < current) {
      current = next;
      element.textContent = next == null ? '—' : format(next);
      return;
    }
    const start = current;
    const begin = performance.now();
    const duration = Math.min(1100, 300 + 50 * (next - start));
    function tick(now) {
      const time = Math.min(1, (now - begin) / duration);
      current = Math.floor(start + (next - start) * time);
      element.textContent = format(current);
      frame = time < 1 ? requestAnimationFrame(tick) : undefined;
    }
    frame = requestAnimationFrame(tick);
  };
}

async function showScreen(config, view, slug) {
  const demo = config.demo === '1';
  const parts = demo ? null : relayParts(config.relay, config.id);
  const publicJoin = screenInvitation(base, config, slug);
  document.body.classList.add(view);
  $('display').hidden = false;
  const setup = appUrl(base, config);
  if (slug) setup.searchParams.set('slug', slug);
  $('edit-link').href = setup;
  $('switch-view').href = appUrl(base, config, view === 'side' ? 'led' : 'side', slug);
  $('switch-view').textContent = view === 'side' ? 'Rear LED' : 'Side screen';
  $('screen-org').textContent = config.org || 'Prayer Relay';
  $('screen-headline').textContent = config.headline || 'Pray for the world';
  applyAccent(config.accent);
  const status = $('connection');
  status.textContent = demo ? 'Demo data' : 'Connecting';
  if (view === 'side') {
    $('join-link').href = $('qr-link').href = publicJoin;
    const link = new URL(publicJoin);
    const longOverview = link.origin === base && link.searchParams.get('view') === 'join';
    $('join-link').textContent = longOverview ? 'Relay overview' : demo && !slug ? 'Explore Prayer.Global'
      : publicJoin.replace(/^https:\/\//, '').replace(/\/$/, '');
    $('qr').src = await QRCode.toDataURL(publicJoin, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
  }

  let paths = new Map();
  let features;
  let state;
  let live = false;
  let celebration;
  let highlight;
  let highlighted = [];
  const percent = counter($('percent'), value => (value / 10).toFixed(1));
  const participants = counter($('participants'), value => value.toLocaleString());
  const minutes = counter($('minutes'), value => value.toLocaleString());

  function paint(snapshot, previous) {
    for (const [id, elements] of paths) {
      const covered = snapshot.lap > 1 || snapshot.grid[id] > 0;
      const recent = previous && snapshot.grid[id] > (previous.lap === snapshot.lap ? (previous.grid[id] ?? 0) : 0);
      for (const element of elements) {
        element.classList.toggle('covered', covered);
        if (recent && !motion.matches) {
          element.classList.add('recent');
          highlighted.push(element);
        }
      }
    }
    if (highlighted.length) {
      clearTimeout(highlight);
      highlight = setTimeout(() => {
        for (const element of highlighted) element.classList.remove('recent');
        highlighted = [];
      }, 1200);
    }
  }

  function celebrate(preview) {
    clearTimeout(celebration);
    const panel = $('milestone');
    panel.hidden = true;
    // Restart the overlay if the operator triggers it twice.
    void panel.offsetWidth;
    panel.querySelector('span').textContent = preview ? '100% celebration preview' : 'The world, covered in prayer.';
    panel.hidden = false;
    if (!motion.matches && typeof $('world').animate === 'function') {
      $('world').animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.6)', offset: .3 }, { filter: 'brightness(1)' }], { duration: 1800 });
    }
    celebration = setTimeout(() => { panel.hidden = true; }, 3000);
  }

  function show(snapshot, animate) {
    const next = progress(snapshot);
    percent(next, animate);
    participants(snapshot.participants, animate);
    minutes(snapshot.minutes, animate);
    if (animate && progress(state) < 1000 && next >= 1000) celebrate(false);
    paint(snapshot, animate ? state : null);
    state = snapshot;
  }

  async function renderMap() {
    try {
      features = await loadMap(demo);
      paths = drawMap($('world'), features);
      if (state) paint(state, null);
      $('map-status').hidden = true;
    } catch {
      $('map-status').textContent = 'Map temporarily unavailable';
      $('map-status').hidden = false;
      setTimeout(renderMap, 30000);
    }
  }

  function sample() {
    if (features?.length) {
      const count = Math.min(features.length - 1, (state?.covered ?? 45) + 4);
      show({
        grid: Object.fromEntries(features.filter((_, i) => i * 53 % features.length < count).map(feature => [feature.id, 1])),
        total: features.length, covered: count, lap: 1,
        participants: 180 + count * 2, minutes: 420 + count * 5,
      }, Boolean(state));
    }
    setTimeout(sample, 6000);
  }

  async function poll() {
    try {
      const next = await getRelay(parts);
      const sameOrHigher = !state || progress(next) >= progress(state);
      show(next, live && sameOrHigher);
      status.textContent = 'Live relay';
      live = true;
    } catch {
      status.textContent = state ? 'Updates delayed' : 'Waiting for relay data';
      live = false;
    }
    setTimeout(poll, live ? 10000 : 20000);
  }

  let controlTimer;
  function controls() {
    document.body.classList.add('show-controls');
    clearTimeout(controlTimer);
    controlTimer = setTimeout(() => document.body.classList.remove('show-controls'), 3000);
  }
  window.addEventListener('pointermove', controls, { passive: true });
  window.addEventListener('pointerdown', controls, { passive: true });
  window.addEventListener('keydown', controls);
  $('preview').addEventListener('click', () => celebrate(true));
  if (!document.fullscreenEnabled) $('fullscreen').hidden = true;
  $('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* The operator can still use browser full screen. */ }
  });
  renderMap();
  if (demo) sample();
  else poll();
}

const view = query.get('view') || (vanityPath ? 'join' : '');
const slug = vanityPath?.[1];
const published = vanityPath || !allowedViews.includes(view) ? await publishedRelays() : {};
const config = slug ? published[slug] : settings(Object.fromEntries(query));

$('setup').hidden = true;
if (slug && (!Object.hasOwn(published, slug) || !allowedViews.includes(view))) {
  $('overview').classList.add('overview-error');
  const heading = document.createElement('h1');
  heading.textContent = 'Relay link unavailable';
  $('overview').replaceChildren(heading);
  $('overview').hidden = false;
} else if (allowedViews.includes(view) && usableRelay(config)) {
  if (view === 'join') showOverview(config);
  else showScreen(config, view, slug);
} else {
  showSetup(config, published, view ? 'This relay link is incomplete. Connect your relay to create a new one.' : '');
}
