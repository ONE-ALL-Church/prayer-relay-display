import QRCode from 'qrcode';
import { origin, readRelayUrl, relayParts, getRelay, getGlobalLap, progress } from './relay.mjs';
import { drawMap, loadMap } from './map.mjs';
import { sampleGrid, sampleSnapshot } from './sample.mjs';
import { appUrl, defaultAccent, inviteUrl, prayerUrl, screenInvitation, settings, slugPattern, suggestSlug, usableRelay } from './settings.mjs';

const $ = id => document.getElementById(id);
const currentUrl = new URL(location.href);
const query = currentUrl.searchParams;
const base = currentUrl.origin;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const savedKey = 'prayer-relay-display:saved-relays';
const vanityPath = currentUrl.pathname.match(/^\/r\/([^/]+)\/?$/);
const allowedViews = ['side', 'led', 'join'];

async function fetchJson(path, options) {
  const response = await fetch(path, { signal: AbortSignal.timeout(14000), ...options });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Could not reach the relay service.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function postJson(path, body) {
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function publishedRelays(slug) {
  const search = slug ? '?' + new URLSearchParams({ slug }) : '';
  const [bundled, hosted] = await Promise.all([
    fetchJson('/relays.json').catch(() => ({})),
    fetchJson('/api/published-relays' + search).catch(() => ({})),
  ]);
  const published = Object.create(null);
  for (const [key, record] of Object.entries(bundled)) {
    const config = settings(record ?? {});
    if (slugPattern.test(key) && key.length <= 48 && usableRelay(config)) published[key] = { config };
  }
  for (const [key, record] of Object.entries(hosted.relays ?? {})) {
    if (!Object.hasOwn(published, key)) published[key] = record;
  }
  return published;
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

function luminance(color) {
  const channels = color.slice(1).match(/../g).map(hex => {
    const channel = Number.parseInt(hex, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

function applyAccent(color) {
  const light = luminance(color);
  const style = document.documentElement.style;
  style.setProperty('--accent', color);
  style.setProperty('--accent-text', light > .179 ? '#000' : '#fff');
  // Keep text and focus indicators legible even on the lighter cards.
  const contrast = (light + .05) / (luminance('#1b2621') + .05);
  style.setProperty('--accent-readable', contrast >= 4.5 ? color : defaultAccent);
  style.setProperty('--accent-border', contrast >= 3 ? 'transparent' : '#a9b4b0');
}

function displayAddress(url) {
  const address = new URL(url);
  return address.pathname === '/' && !address.search && !address.hash
    ? address.host
    : address.href.slice('https://'.length);
}

function showScreenAddress(url) {
  const link = $('join-link');
  const address = new URL(url);
  const overview = address.origin === base && address.searchParams.get('view') === 'join';
  const label = overview ? 'Open relay overview' : displayAddress(url);
  const fit = () => {
    link.textContent = label;
    const wraps = link.scrollWidth > link.clientWidth;
    if (wraps) link.textContent = 'Scan to join';
    $('display-url-warning').hidden = !wraps;
  };
  fit();
  new ResizeObserver(fit).observe(link.parentElement);
}

function addressWarning(config, slug) {
  if (!config.screenUrl && config.qr !== 'direct' && !slug) {
    return 'The preview QR opens the overview. Publish a short URL or enter a side-screen short URL to show an address people can type.';
  }
  const url = screenInvitation(base, config, slug);
  const text = document.createElement('canvas').getContext('2d');
  if (!text) return '';
  // Match the side-screen address at the reference 1920 × 1080 layout.
  text.font = '650 22px ' + getComputedStyle(document.documentElement).fontFamily;
  return text.measureText(displayAddress(url)).width > 416
    ? 'This address may not fit on one line. Enter a shorter side-screen URL in Customize.'
    : '';
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

function showSetup(prefill, published, session, initialMessage = '') {
  const form = $('relay-form');
  const status = $('form-status');
  let editing;
  let records = savedRelays();
  let openedSlug;
  let draft;
  let busy = false;
  let customSlug = false;
  let previewRequest = 0;
  const relayInput = $('relay');
  const nameInput = $('relay-name');
  const slugInput = $('vanity-slug');
  const customize = $('customize-relay');
  const archiveButton = $('archive-relay');
  const publisherStatus = $('publisher-status');
  const publisherForm = $('publisher-form');

  function showPublisher() {
    const available = session.enabled && draft?.config.qr === 'vanity';
    $('browser-publishing').hidden = !available;
    publisherForm.hidden = session.signedIn || !available;
    $('publisher-actions').hidden = !session.signedIn || !available;
    const button = $('publish-relay');
    button.hidden = Boolean(draft?.archived);
    button.disabled = busy || !draft || draft.isPublished || draft.conflict;
    archiveButton.hidden = !draft?.isPublished || !draft.revision;
    archiveButton.disabled = busy;
    archiveButton.textContent = draft?.archived ? 'Restore relay' : 'Archive relay';
    button.textContent = draft?.revision ? 'Update published relay' : 'Publish relay';
  }
  status.textContent = initialMessage;
  $('setup').hidden = false;

  function showDestination() {
    const choice = $('qr-destination').value;
    $('overview-settings').hidden = choice === 'direct';
    $('vanity-settings').hidden = choice !== 'vanity';
    let key = '';
    try { key = readRelayUrl(relayInput.value); } catch { /* Validate the relay field on submit. */ }
    slugInput.required = choice === 'vanity' && Boolean(key);
    slugInput.disabled = choice !== 'vanity' || !key;
    if (choice === 'vanity' && !customSlug) {
      slugInput.value = nameInput.value.trim() || key ? suggestSlug(nameInput.value, key, published) : '';
    }
    const slug = slugInput.value;
    $('short-preview').textContent = choice === 'vanity' && slugPattern.test(slug)
      ? 'Short URL ' + appUrl(base, {}, undefined, slug).host + '/r/' + slug : '';
    $('preview-relay').textContent = session.enabled ? 'Preview relay' : 'Save relay and create links';
  }

  function fill(config, slug = '') {
    customSlug = Boolean(slug);
    $('relay').value = relayKeyUrl(config.relay);
    const fields = { 'relay-name': config.name, org: config.org, headline: config.headline, invite: config.invite,
      'intro-copy': config.intro, 'screen-url': config.screenUrl, accent: config.accent, 'qr-destination': config.qr, 'vanity-slug': slug };
    for (const [field, value] of Object.entries(fields)) $(field).value = value;
    showDestination();
  }

  async function showSharePanel(slug, archived) {
    const publicUrl = appUrl(base, {}, undefined, slug);
    const link = $('shared-relay-url');
    const qr = $('share-qr');
    const download = $('download-relay-qr');
    link.href = publicUrl.href;
    link.textContent = publicUrl.host + publicUrl.pathname;
    qr.hidden = true;
    download.hidden = true;
    $('copy-production-links').hidden = archived;
    $('share-relay').hidden = false;
    try {
      const svg = await QRCode.toString(publicUrl.href, { type: 'svg', margin: 4, errorCorrectionLevel: 'M' });
      if (link.href !== publicUrl.href || $('share-relay').hidden) return;
      const source = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      qr.src = source;
      qr.hidden = false;
      download.href = source;
      download.download = slug + '-qr.svg';
      download.hidden = false;
    } catch {
      $('copy-status').textContent = 'Could not generate the QR code. You can copy the relay link.';
    }
  }

  async function copyShare(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      $('copy-status').textContent = message;
    } catch {
      $('copy-status').textContent = 'Could not copy. Open a link to copy its address.';
    }
  }

  $('copy-relay-link').addEventListener('click', () => copyShare($('shared-relay-url').href, 'Relay link copied.'));
  $('copy-production-links').addEventListener('click', () => {
    const publicUrl = new URL($('shared-relay-url').href);
    const side = new URL(publicUrl);
    const led = new URL(publicUrl);
    side.searchParams.set('view', 'side');
    led.searchParams.set('view', 'led');
    copyShare(['Side screen ' + side.href, 'Rear LED ' + led.href, 'Participant overview ' + publicUrl.href].join('\n'), 'Production links copied.');
  });

  function showLinks(config, slug = '') {
    const entry = published[slug];
    const isPublished = entry && JSON.stringify(settings(entry.config)) === JSON.stringify(config);
    const revision = slug === openedSlug ? entry?.revision : undefined;
    const archived = Boolean(entry?.archivedAt && isPublished);
    draft = { config, slug, revision, isPublished, archived,
      conflict: Boolean(entry && !isPublished && (!revision || entry.archivedAt)) };
    const publishedSlug = isPublished ? slug : '';
    const linkedConfig = !isPublished && config.qr === 'vanity' ? { ...config, qr: 'overview' } : config;
    $('generated').replaceChildren();
    $('copy-status').textContent = '';
    $('results-title').textContent = archived ? 'Share the recap' : isPublished ? 'Share this relay'
      : session.enabled && config.qr === 'vanity' ? 'Preview your relay' : 'Your relay links';
    $('results-guide').textContent = archived ? 'Share the recap with the same link or QR code.'
      : isPublished ? 'Share the public link with participants and the production links with the booth.'
      : session.enabled && config.qr === 'vanity' ? 'Open a preview to check your map, branding, and QR code before you publish.'
      : 'Open the screen links on your production computers. Keep the setup link to edit this relay.';
    $('screen-links-title').textContent = archived ? 'Recap and setup links' : isPublished ? 'Production and setup links' : 'Preview links';
    const warning = archived ? '' : addressWarning(config, slug);
    $('side-url-warning').textContent = warning;
    $('side-url-warning').hidden = !warning;
    $('share-relay').hidden = true;
    if (isPublished) showSharePanel(slug, archived);
    if (!archived) {
      addResult('Side screen', appUrl(base, linkedConfig, 'side', publishedSlug));
      addResult('Rear LED', appUrl(base, linkedConfig, 'led', publishedSlug));
    }
    addResult(archived ? 'Relay recap' : 'Participant overview', appUrl(base, linkedConfig, 'join', publishedSlug));
    const setup = appUrl(base, isPublished ? {} : config);
    if (isPublished) setup.searchParams.set('edit', slug);
    else if (slug) setup.searchParams.set('slug', slug);
    addResult('Setup link', setup);

    $('vanity-help').hidden = session.enabled || isPublished || config.qr !== 'vanity';
    const bundled = Object.fromEntries(Object.entries(published)
      .filter(([, record]) => !record.revision)
      .map(([key, record]) => [key, record.config]));
    $('profile-json').value = JSON.stringify({ ...bundled, [slug]: config }, null, 2);
    if (archived) $('publish-status').textContent = 'Archived. The same short URL opens the recap.';
    else if (isPublished && config.qr === 'vanity') $('publish-status').textContent = 'Short URL is published.';
    else if (entry?.archivedAt && draft.conflict) {
      $('publish-status').textContent = 'Restore this relay before changing its published settings, or choose a different short URL.';
    } else if (session.enabled && draft.conflict) {
      $('publish-status').textContent = entry.revision
        ? 'This short URL is in use. Open it from Published relays to edit it, or choose another short URL.'
        : 'This short URL is managed in the deployment file. Choose another short URL to publish here.';
    } else $('publish-status').textContent = config.qr === 'vanity'
      ? 'These links preview the branded overview. Publish the short URL to use it in the QR code.' : '';
    showPublisher();
    $('results').hidden = false;
  }

  function renderSaved() {
    const list = $('relay-list');
    list.replaceChildren();
    for (const [key, record] of Object.entries(records)) {
      const config = settings(record?.config || {});
      if (!usableRelay(config) || config.demo) continue;
      const publishedConfig = published[record.slug]?.config;
      if (publishedConfig && JSON.stringify(settings(publishedConfig)) === JSON.stringify(config)) continue;
      const item = document.createElement('li');
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'secondary';
      select.textContent = config.name || config.headline || config.org || config.relay;
      select.addEventListener('click', () => {
        previewRequest++;
        editing = key;
        openedSlug = undefined;
        publisherStatus.textContent = '';
        fill(config, record.slug);
        showLinks(config, record.slug);
        status.textContent = 'Relay loaded. Preview any changes before sharing.';
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

  function openPublished(slug) {
    previewRequest++;
    const config = settings(published[slug].config);
    editing = undefined;
    openedSlug = slug;
    publisherStatus.textContent = '';
    fill(config, slug);
    showLinks(config, slug);
    status.textContent = published[slug].archivedAt
      ? 'Restore this relay before editing its published settings.'
      : 'Preview your changes before publishing an update.';
  }

  function startRelay(template) {
    previewRequest++;
    editing = undefined;
    openedSlug = undefined;
    draft = undefined;
    customize.open = false;
    $('results').hidden = true;
    const config = template ? {
      org: template.org, headline: template.headline, intro: template.intro, accent: template.accent,
      qr: session.enabled ? 'vanity' : template.qr,
    } : { qr: session.enabled ? 'vanity' : 'direct' };
    fill(settings(config));
    status.textContent = template ? 'Branding copied. Paste the new Prayer.Global relay link.' : '';
    relayInput.focus();
  }

  function renderPublished() {
    const active = $('published-list');
    const archived = $('archived-list');
    active.replaceChildren();
    archived.replaceChildren();
    for (const [slug, { config, archivedAt }] of Object.entries(published)) {
      if (config.demo) continue;
      const item = document.createElement('li');
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'secondary';
      select.textContent = config.name || config.headline || slug;
      select.addEventListener('click', () => {
        openPublished(slug);
        nameInput.focus();
      });
      const duplicate = document.createElement('button');
      duplicate.type = 'button';
      duplicate.className = 'secondary';
      duplicate.textContent = 'Duplicate';
      duplicate.setAttribute('aria-label', 'Duplicate ' + select.textContent);
      duplicate.addEventListener('click', () => startRelay(config));
      item.append(select, duplicate);
      (archivedAt ? archived : active).append(item);
    }
    $('published-relays').hidden = !active.childElementCount;
    $('archived-relays').hidden = !archived.childElementCount;
  }

  const editSlug = query.get('edit');
  const hasPrefill = Boolean(prefill.relay || query.has('qr'));
  if (editSlug && Object.hasOwn(published, editSlug) && !published[editSlug].config.demo) openPublished(editSlug);
  else fill(hasPrefill ? prefill : settings({ qr: session.enabled ? 'vanity' : 'direct' }), query.get('slug') ?? '');
  renderSaved();
  renderPublished();
  $('qr-destination').addEventListener('change', showDestination);
  for (const field of [relayInput, nameInput]) field.addEventListener('input', showDestination);
  relayInput.addEventListener('input', () => {
    if (relayInput.hasAttribute('aria-invalid')) status.textContent = '';
    relayInput.removeAttribute('aria-invalid');
  });
  slugInput.addEventListener('input', () => {
    customSlug = Boolean(slugInput.value);
    showDestination();
  });
  form.addEventListener('invalid', event => {
    if (customize.contains(event.target)) customize.open = true;
  }, true);
  $('new-relay').addEventListener('click', () => startRelay());

  form.addEventListener('input', () => {
    previewRequest++;
    if (!draft) {
      if ($('preview-relay').disabled) status.textContent = 'Preview your changes to create updated links.';
      return;
    }
    draft = undefined;
    showPublisher();
    $('results').hidden = true;
    status.textContent = 'Preview your changes to create updated links.';
  });

  publisherForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    const key = $('publisher-key').value;
    $('publisher-key').value = '';
    try {
      session = { enabled: true, ...await postJson('/api/publisher', { key }) };
      publisherStatus.textContent = 'Signed in. Review your changes before publishing.';
      showPublisher();
      if (!$('publish-relay').disabled) $('publish-relay').focus();
      else if (!archiveButton.hidden) archiveButton.focus();
      else $('publisher-sign-out').focus();
    } catch (error) {
      publisherStatus.textContent = error.message;
      $('publisher-key').focus();
    } finally {
      button.disabled = false;
    }
  });

  $('publisher-sign-out').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      session = { enabled: true, ...await postJson('/api/publisher', { signOut: true }) };
      publisherStatus.textContent = 'Signed out.';
      showPublisher();
      $('publisher-key').focus();
    } catch (error) {
      publisherStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $('publish-relay').addEventListener('click', async () => {
    if (!draft || busy || draft.conflict || draft.isPublished) return;
    const pending = draft;
    const { slug, config, revision } = pending;
    busy = true;
    showPublisher();
    publisherStatus.textContent = 'Publishing…';
    try {
      const record = await postJson('/api/published-relays', { slug, config, revision });
      published[slug] = record;
      renderPublished();
      renderSaved();
      if (draft === pending) {
        openedSlug = slug;
        fill(record.config, slug);
        showLinks(record.config, slug);
        publisherStatus.textContent = 'Published. Phones and screens can open this short URL.';
        $('results-title').focus();
      }
    } catch (error) {
      if (error.status === 401) session.signedIn = false;
      publisherStatus.textContent = error.message;
    } finally {
      busy = false;
      showPublisher();
    }
  });

  archiveButton.addEventListener('click', async () => {
    if (!draft?.isPublished || !draft.revision || busy) return;
    const pending = draft;
    const { slug, revision, archived } = pending;
    if (!archived && !window.confirm('Archive this relay? Its short URL and QR code will open a recap.')) return;
    busy = true;
    showPublisher();
    publisherStatus.textContent = archived ? 'Restoring…' : 'Archiving…';
    try {
      published[slug] = await postJson('/api/published-relays', { slug, revision, action: archived ? 'restore' : 'archive' });
      renderPublished();
      if (draft === pending) {
        openPublished(slug);
        publisherStatus.textContent = archived ? 'Relay restored.' : 'Relay archived.';
        archiveButton.focus();
      }
    } catch (error) {
      if (error.status === 401) session.signedIn = false;
      publisherStatus.textContent = error.message;
    } finally {
      busy = false;
      showPublisher();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    let key;
    try {
      key = readRelayUrl(relayInput.value);
    } catch {
      relayInput.setAttribute('aria-invalid', 'true');
      status.textContent = 'Paste the public map or display link from your custom Prayer.Global relay.';
      relayInput.focus();
      return;
    }
    const button = event.submitter;
    button.disabled = true;
    const request = ++previewRequest;
    status.textContent = 'Checking the relay…';
    try {
      const invite = $('invite').value.trim() ? inviteUrl($('invite').value) : '';
      let screenUrl = '';
      if ($('screen-url').value.trim()) {
        try {
          screenUrl = inviteUrl($('screen-url').value);
        } catch {
          customize.open = true;
          $('screen-url').focus();
          status.textContent = 'Enter a public HTTPS address for the side screen.';
          return;
        }
      }
      const qr = $('qr-destination').value;
      const slug = qr === 'vanity' ? slugInput.value : '';
      const values = { relay: key, name: nameInput.value, org: $('org').value,
        headline: $('headline').value, invite, screenUrl, intro: $('intro-copy').value, accent: $('accent').value, qr };
      const result = await fetchJson('/api/relay?' + new URLSearchParams({ key }));
      await getRelay(relayParts(key, result.id));
      if (request !== previewRequest) return;
      const config = settings({ ...values, id: result.id });
      const recordKey = editing ?? crypto.randomUUID();
      const updated = { ...savedRelays(), [recordKey]: { config, slug } };
      const stored = storeRelays(updated);
      if (stored) {
        records = updated;
        editing = recordKey;
        renderSaved();
      }
      publisherStatus.textContent = '';
      showLinks(config, slug);
      status.textContent = stored ? 'Screen links are ready. Relay saved in this browser.' : 'Screen links are ready. Copy the setup link to save your settings.';
      $('results-title').focus();
    } catch (error) {
      if (request !== previewRequest) return;
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

function relayReader(config) {
  if (config.demo === 'live') {
    return async () => {
      const { key, id } = await fetchJson('/api/relay?source=global');
      return getGlobalLap(relayParts(key, id, 'global'));
    };
  }
  const parts = relayParts(config.relay, config.id);
  return () => getRelay(parts);
}

function liveStatus(message) {
  return 'Prayer.Global · ' + message;
}

function showOverview(config, record) {
  const demo = config.demo === '1';
  const global = config.demo === 'live';
  $('overview').hidden = false;
  applyAccent(config.accent);
  $('overview-org').textContent = global ? 'Global prayer relay' : config.org || 'Prayer Relay';
  $('overview-event').textContent = config.name;
  $('overview-event').hidden = !config.name || config.name === config.org;
  $('overview-headline').textContent = config.headline || 'Pray for the world';
  $('overview-intro').textContent = config.intro || 'Take a minute to pray for a place in the world.';
  if (record?.archivedAt) {
    const summary = record.summary;
    $('overview-intro').textContent = 'Thank you for praying with us.';
    $('start-praying').hidden = true;
    $('overview-progress-title').textContent = 'Relay recap';
    $('overview-status').textContent = 'Event ended';
    if (summary) {
      $('overview-coverage').textContent = (summary.coverage / 10).toFixed(1) + '%';
      $('overview-participants').textContent = summary.participants?.toLocaleString() ?? '—';
      $('overview-minutes').textContent = summary.minutes?.toLocaleString() ?? '—';
      $('overview-minutes-stat').hidden = summary.minutes == null;
    } else {
      $('overview-status').textContent = 'Final totals unavailable';
      $('overview').querySelector('dl').hidden = true;
      $('overview-credit').hidden = true;
    }
    return;
  }
  $('start-praying').href = prayerUrl(config);
  if (demo) {
    $('start-praying').firstChild.textContent = 'Explore Prayer.Global ';
    const sample = sampleSnapshot();
    $('overview-status').textContent = 'Demo data';
    $('overview-coverage').textContent = (progress(sample) / 10).toFixed(1) + '%';
    $('overview-participants').textContent = sample.participants.toLocaleString();
    $('overview-minutes').textContent = sample.minutes.toLocaleString();
    $('overview-minutes-stat').hidden = false;
    return;
  }

  const read = relayReader(config);
  const status = $('overview-status');
  let state;
  status.textContent = global ? liveStatus('Connecting') : 'Connecting';
  if (global) {
    $('overview-progress-title').textContent = 'Current lap progress';
    $('start-praying').firstChild.textContent = 'Start praying at Prayer.Global ';
  }
  async function refresh() {
    try {
      state = await read();
      $('overview-coverage').textContent = (progress(state, !global) / 10).toFixed(1) + '%';
      $('overview-participants').textContent = state.participants?.toLocaleString() ?? '—';
      $('overview-minutes').textContent = state.minutes?.toLocaleString() ?? '—';
      $('overview-minutes-stat').hidden = state.minutes == null;
      if (global) $('overview-progress-title').textContent = 'Lap ' + state.lap + ' progress';
      status.textContent = global ? liveStatus('Live') : 'Live relay';
    } catch {
      const message = state ? 'Updates delayed' : 'Progress unavailable';
      status.textContent = global ? liveStatus(message) : message;
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
  const global = config.demo === 'live';
  const read = demo ? null : relayReader(config);
  const publicJoin = screenInvitation(base, config, slug);
  document.body.classList.add(view);
  if (global) document.body.classList.add('global-demo');
  $('display').hidden = false;
  const setup = appUrl(base, slug || global ? {} : config);
  if (slug && !demo) setup.searchParams.set('edit', slug);
  $('edit-link').href = setup;
  $('switch-view').href = appUrl(base, config, view === 'side' ? 'led' : 'side', slug);
  $('switch-view').textContent = view === 'side' ? 'Rear LED' : 'Side screen';
  $('screen-org').textContent = global ? 'Global prayer relay' : config.org || 'Prayer Relay';
  $('screen-headline').textContent = config.headline || 'Pray for the world';
  applyAccent(config.accent);
  const status = $('connection');
  status.textContent = global ? liveStatus('Connecting') : demo ? 'Demo data' : 'Connecting';
  if (global) $('coverage-label').textContent = 'Current lap coverage';
  if (view === 'side') {
    $('join-link').href = $('qr-link').href = publicJoin;
    showScreenAddress(publicJoin);
    $('qr').src = await QRCode.toDataURL(publicJoin, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
  }

  let paths = new Map();
  let features;
  let state;
  let live = false;
  let celebration;
  let highlight;
  let highlighted = [];
  let sampleReset;
  const sampleUpdate = $('sample-update');
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  const formatTotal = value => value >= 10000000 ? compact.format(value) : value.toLocaleString();
  const percent = counter($('percent'), value => (value / 10).toFixed(1));
  const participants = counter($('participants'), formatTotal);
  const minutes = counter($('minutes'), formatTotal);

  function paint(snapshot, previous) {
    for (const [id, elements] of paths) {
      const covered = (!global && snapshot.lap > 1) || snapshot.grid[id] > 0;
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
    const next = progress(snapshot, !global);
    percent(next, animate);
    participants(snapshot.participants, animate);
    minutes(snapshot.minutes, animate);
    if (animate && progress(state, !global) < 1000 && next >= 1000) celebrate(false);
    paint(snapshot, animate ? state : null);
    if (global) $('coverage-label').textContent = 'Lap ' + snapshot.lap + ' coverage';
    state = snapshot;
  }

  async function renderMap() {
    try {
      features = await loadMap(demo);
      paths = drawMap($('world'), features);
      if (demo) sample(state.covered);
      else if (state) paint(state, null);
      $('map-status').hidden = true;
    } catch {
      $('map-status').textContent = 'Map temporarily unavailable';
      $('map-status').hidden = false;
      setTimeout(renderMap, 30000);
    }
  }

  function sample(covered, animate = false) {
    const snapshot = sampleSnapshot(covered);
    show({ ...snapshot, grid: features ? sampleGrid(features, snapshot.covered) : {} }, animate);
  }

  async function poll() {
    try {
      const next = await read();
      const sameOrHigher = !state || progress(next, !global) >= progress(state, !global);
      const sameLap = !state || state.lap === next.lap;
      show(next, live && sameOrHigher && (!global || sameLap));
      status.textContent = global ? liveStatus('Live') : 'Live relay';
      live = true;
    } catch {
      const message = state ? 'Updates delayed' : 'Waiting for relay data';
      status.textContent = global ? liveStatus(message) : message;
      live = false;
    }
    setTimeout(poll, live ? 10000 : 20000);
  }

  let controlTimer;
  const operator = document.querySelector('.operator-controls');
  const toggle = $('controls-toggle');
  const toolbar = $('display-controls');
  function expandControls(expanded) {
    toolbar.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  function showControls() {
    operator.classList.add('visible');
    clearTimeout(controlTimer);
    controlTimer = setTimeout(() => {
      if (operator.matches(':hover, :focus-within')) return;
      operator.classList.remove('visible');
      expandControls(false);
    }, 5000);
  }
  window.addEventListener('pointermove', showControls, { passive: true });
  window.addEventListener('pointerdown', showControls, { passive: true });
  window.addEventListener('keydown', showControls);
  operator.addEventListener('pointerleave', showControls);
  operator.addEventListener('focusout', showControls);
  toggle.addEventListener('click', () => expandControls(toolbar.hidden));
  $('preview').addEventListener('click', () => celebrate(true));
  if (!document.fullscreenEnabled) $('fullscreen').hidden = true;
  $('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* The operator can still use browser full screen. */ }
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  });

  if (demo) {
    sample();
    sampleUpdate.hidden = false;
    sampleUpdate.addEventListener('click', () => {
      clearTimeout(sampleReset);
      if (state.covered > sampleSnapshot().covered) sample();
      sample(sampleSnapshot().covered + 8, true);
      sampleReset = setTimeout(() => sample(), 5000);
    });
    expandControls(true);
  } else {
    poll();
  }
  showControls();
  renderMap();
}

const view = query.get('view') || (vanityPath ? 'join' : '');
const slug = vanityPath?.[1];
const setupView = !vanityPath && !allowedViews.includes(view);
const [published, session] = await Promise.all([
  vanityPath || setupView ? publishedRelays(slug) : {},
  setupView ? fetchJson('/api/publisher').catch(() => ({})) : {},
]);
const config = slug && Object.hasOwn(published, slug) ? settings(published[slug].config) : settings(Object.fromEntries(query));

if (slug && (!Object.hasOwn(published, slug) || !allowedViews.includes(view))) {
  $('overview').classList.add('overview-error');
  const heading = document.createElement('h1');
  heading.textContent = 'Relay link unavailable';
  $('overview').replaceChildren(heading);
  $('overview').hidden = false;
} else if (allowedViews.includes(view) && usableRelay(config)) {
  if (view === 'join' || published[slug]?.archivedAt) showOverview(config, published[slug]);
  else showScreen(config, view, slug);
} else {
  showSetup(config, published, session, view ? 'This relay link is incomplete. Connect your relay to create a new one.' : '');
}
