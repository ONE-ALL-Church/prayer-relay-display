import QRCode from 'qrcode';
import { origin, readRelayUrl, relayParts, getRelay, progress } from './relay.mjs';
import { drawMap, loadMap } from './map.mjs';

const $ = id => document.getElementById(id);
const currentUrl = new URL(location.href);
const query = currentUrl.searchParams;
const demo = query.get('demo') === '1';
const view = query.get('view');
const motion = matchMedia('(prefers-reduced-motion: reduce)');

function screenUrl(options, layout) {
  const url = new URL('/', location.origin);
  for (const [key, value] of Object.entries(options)) if (value) url.searchParams.set(key, value);
  if (layout) url.searchParams.set('view', layout);
  return url;
}

function inviteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use a public HTTPS prayer link.');
  return url.href;
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
      $('form-status').textContent = name + ' copied.';
    } catch {
      $('form-status').textContent = 'Open ' + name.toLowerCase() + ' and copy its address.';
    }
  });
  row.append(anchor, copy);
  $('generated').append(row);
}

function showSetup() {
  $('display').hidden = true;
  $('setup').hidden = false;
  const key = query.get('relay');
  if (key && /^[0-9a-f]{6}$/.test(key)) $('relay').value = origin + '/prayer_app/custom/' + key + '/display';
  for (const field of ['org', 'headline', 'invite']) $(field).value = query.get(field) || '';
  if (/^#[0-9a-f]{6}$/i.test(query.get('accent'))) $('accent').value = query.get('accent');

  $('relay-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = $('form-status');
    const button = event.submitter;
    button.disabled = true;
    $('results').hidden = true;
    status.textContent = 'Checking the relay…';
    try {
      const key = readRelayUrl($('relay').value);
      const invite = $('invite').value.trim() ? inviteUrl($('invite').value) : '';
      const response = await fetch('/api/relay?' + new URLSearchParams({ key }), { signal: AbortSignal.timeout(14000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The relay could not be verified.');
      await getRelay(relayParts(key, result.id));
      const options = { relay: key, id: result.id, org: $('org').value.trim(), headline: $('headline').value.trim(), invite, accent: $('accent').value };
      $('generated').replaceChildren();
      addResult('Side screen', screenUrl(options, 'side'));
      addResult('Rear LED', screenUrl(options, 'led'));
      addResult('Setup link', screenUrl(options));
      $('results').hidden = false;
      status.textContent = 'Both screen links are ready.';
      $('generated').querySelector('a').focus();
    } catch (error) {
      status.textContent = error instanceof TypeError || error.name === 'TimeoutError'
        ? 'Could not connect. Check the links and try again.' : error.message;
    } finally {
      button.disabled = false;
    }
  });
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

async function showScreen() {
  let parts, publicJoin;
  try {
    if (!demo) parts = relayParts(query.get('relay') ?? '', query.get('id') ?? '');
    publicJoin = demo ? origin : inviteUrl(query.get('invite') || `${origin}/prayer_app/custom/${parts.public_key}/map`);
  } catch {
    showSetup();
    $('form-status').textContent = 'This screen link is incomplete. Connect your relay to create a new one.';
    return;
  }

  $('setup').hidden = true;
  document.body.classList.add(view);
  $('display').hidden = false;
  const config = Object.fromEntries(query);
  delete config.view;
  $('edit-link').href = screenUrl(config);
  $('switch-view').href = screenUrl(config, view === 'side' ? 'led' : 'side');
  $('switch-view').textContent = view === 'side' ? 'Rear LED' : 'Side screen';
  $('screen-org').textContent = query.get('org')?.slice(0, 42) || 'Prayer Relay';
  $('screen-headline').textContent = query.get('headline')?.slice(0, 42) || 'Pray for the world';
  const accent = query.get('accent');
  if (/^#[0-9a-f]{6}$/i.test(accent)) document.documentElement.style.setProperty('--accent', accent);
  const status = $('connection');
  status.textContent = demo ? 'Demo data' : 'Connecting';
  if (view === 'side') {
    $('join-link').href = $('qr-link').href = publicJoin;
    $('join-link').textContent = demo ? 'Explore Prayer.Global' : publicJoin.replace(/^https:\/\//, '').replace(/\/$/, '');
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

if (view === 'side' || view === 'led') showScreen();
else showSetup();
