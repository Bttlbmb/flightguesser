import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './serve.mjs';
import { decodeAirportData } from '../public/airports.js';
import { bearingDegrees } from '../public/geo.js';

// Repeatable UI checks use actual assets and labelled fixtures. No provider
// requests escape the local browser; output belongs in ignored test-results/.
const root = fileURLToPath(new URL('..', import.meta.url));
const packagePath = process.env.FLIGHTGUESSER_PLAYWRIGHT_PACKAGE;
const require = createRequire(packagePath
  ? (packagePath.endsWith('package.json') ? packagePath : join(packagePath, 'package.json'))
  : join(root, 'package.json'));
let chromium;
try { ({ chromium } = require('playwright')); }
catch { throw new Error('Browser checks need Playwright. Set FLIGHTGUESSER_PLAYWRIGHT_PACKAGE to its package directory.'); }
const output = resolve(root, 'test-results/browser');
await mkdir(output, { recursive: true });
const packedAirports = JSON.parse(await readFile(resolve(root, 'public/data/airports.json'), 'utf8'));
const airports = decodeAirportData(packedAirports);
const recordings = JSON.parse(await readFile(resolve(root, 'public/data/practice.json'), 'utf8'));
const server = createGameServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const checks = [], views = [], errors = [];
let browser;
const tool = (page, name, args = {}) => page.evaluate(({ name, args }) => window.qaTools[name].execute(args), { name, args });
const read = page => tool(page, 'read_game_state');
const mark = name => checks.push(name);
const endpoint = id => {
  const airport = airports.find(value => value.id === id);
  assert.ok(airport, id);
  return { icao_code: airport.id, iata_code: airport.code, name: airport.name,
    municipality: airport.city, country_iso_name: airport.country,
    latitude: airport.lat, longitude: airport.lon };
};

async function boot(size, { tools = true, fixture = null, missingGlobe = false, brokenPractice = false, heldAirports = false, heldGlobe = false } = {}) {
  const phone = size.width <= 700 || size.width <= 1000 && size.height <= 500;
  const page = await browser.newPage({ viewport: size, isMobile: phone, hasTouch: phone });
  const mock = { mode: 'empty', sequence: 0, requests: [], external: [], held: [], routes: new Map() };
  page.on('pageerror', error => errors.push(error.message));
  if (tools) await page.addInitScript(() => {
    window.qaTools = {};
    Object.defineProperty(document, 'modelContext', { value: { registerTool(tool) { window.qaTools[tool.name] = tool; } } });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) { mock.external.push(url.hostname); return route.abort(); }
    mock.requests.push(url.pathname);
    if (missingGlobe && url.pathname === '/globe.js') return route.abort();
    if (heldGlobe && url.pathname === '/globe.js') { mock.held.push(route); return; }
    if (url.pathname === '/data/practice.json') {
      if (brokenPractice) return route.fulfill({ status: 503, body: 'Unavailable' });
      if (fixture) return route.fulfill({ json: [fixture] });
    }
    if (heldAirports && url.pathname === '/data/airports.json') { mock.held.push(route); return; }
    if (url.pathname === '/config.json') return route.fulfill({ json: { relay: true, telemetryProvider: 'adsb.fi', routeProvider: 'adsbdb' } });
    if (url.pathname.startsWith('/api/nearby/')) {
      if (mock.mode === 'rate-limit') return route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: {} });
      if (mock.mode === 'provider') return route.fulfill({ status: 503, json: {} });
      if (mock.mode === 'empty') return route.fulfill({ json: { now: Date.now(), ac: [] } });
      const [, , , lat, lon, radius] = url.pathname.split('/');
      if (radius === '50') mock.sequence++;
      const aircraft = { hex: (0xabc000 + mock.sequence).toString(16), flight: 'ABC' + (100 + mock.sequence), lat: Number(lat), lon: Number(lon),
        alt_baro: 34000, gs: 420, seen: 1, seen_pos: 1, baro_rate: 0 };
      const destination = endpoint('OMDB');
      aircraft.track = bearingDegrees(aircraft, { lat: destination.latitude, lon: destination.longitude });
      const origin = endpoint(aircraft.lon < 10 ? 'EGLL' : 'RKSI');
      mock.routes.set(aircraft.flight, { response: { flightroute: { callsign_icao: aircraft.flight, origin, destination } } });
      return route.fulfill({ json: { now: Date.now(), ac: [aircraft] } });
    }
    if (url.pathname.startsWith('/api/callsign/')) return route.fulfill({ json: mock.routes.get(url.pathname.split('/')[3]) });
    return route.continue();
  });
  await page.goto(base);
  if (tools) await page.waitForFunction(() => window.qaTools?.start_practice_round);
  return { page, mock };
}

async function inspect(page, label, screenshot = false) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const findings = await page.evaluate(() => {
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('horizontal overflow');
    for (const [a, b] of [['.wordmark', '#help-button'], ['.clue-book-header h2', '.clue-book-actions']]) {
      const left = document.querySelector(a), right = document.querySelector(b);
      if (!left?.getClientRects().length || !right?.getClientRects().length) continue;
      const x = left.getBoundingClientRect(), y = right.getBoundingClientRect();
      if (Math.min(x.right, y.right) > Math.max(x.left, y.left) + 1
        && Math.min(x.bottom, y.bottom) > Math.max(x.top, y.top) + 1) issues.push('overlapping controls');
    }
    const active = document.activeElement;
    if (active && active !== document.body && !active.getClientRects().length) issues.push('hidden focus');
    const popup = document.querySelector('#destination-results:not([hidden])');
    if (popup) {
      const rect = popup.getBoundingClientRect();
      const top = visualViewport?.offsetTop ?? 0;
      const bottom = top + (visualViewport?.height ?? innerHeight);
      if (rect.top < top - 1 || rect.bottom > bottom + 1) issues.push('popup outside viewport');
    }
    const dialog = document.querySelector('dialog[open]');
    if (dialog) {
      const rect = dialog.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) issues.push('dialog outside viewport');
    }
    return issues;
  });
  assert.deepEqual(findings, [], label);
  views.push(label);
  if (screenshot) {
    await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    // Viewport-only captures keep coarse-pointer emulation stable.
    await page.screenshot({ path: resolve(output, `${label}.png`), fullPage: false });
  }
}

async function guess(page, query) {
  const found = await tool(page, 'search_cities', { query });
  assert.ok(found.cities.length, query);
  return tool(page, 'submit_city_guess', { cityId: found.cities[0].id });
}

async function doubledText(page, label) {
  await page.evaluate(() => {
    const entries = [...document.querySelectorAll('body,h1,h2,h3,p,label,input,select,button,a,span,dt,dd,li')].map(element => {
      const style = getComputedStyle(element);
      return { element, original: element.getAttribute('style'), size: parseFloat(style.fontSize),
        height: parseFloat(style.lineHeight) / parseFloat(style.fontSize) };
    });
    window.qaTextStyles = entries;
    for (const { element, size, height } of entries) {
      element.style.setProperty('font-size', `${size * 2}px`, 'important');
      if (Number.isFinite(height)) element.style.setProperty('line-height', String(height), 'important');
    }
  });
  await inspect(page, label, true);
  await page.evaluate(() => {
    for (const { element, original } of window.qaTextStyles) {
      if (original === null) element.removeAttribute('style');
      else element.setAttribute('style', original);
    }
    delete window.qaTextStyles;
  });
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_BIN ? { executablePath: process.env.BROWSER_BIN } : {}) });
  for (const [width, height] of [[320, 568], [390, 844], [390, 450], [844, 390], [700, 900], [701, 900], [768, 1024], [1440, 1000]]) {
    const label = `${width}x${height}`;
    const { page, mock } = await boot({ width, height });
    try {
      await inspect(page, `${label}-entry`);
      if ([320, 701, 1440].includes(width)) await doubledText(page, `${label}-text200-entry`);
      await page.locator('#place-button').click();
      await inspect(page, `${label}-cities`);
      await page.locator('[data-action="home"]').click();
      await tool(page, 'start_practice_round');
      await inspect(page, `${label}-playing`, width === 390 && height === 844 || width === 1440);
      let game = await read(page);
      assert.equal(game.guessesLeft, 6);
      assert.equal('destinationCity' in game, false);
      assert.equal(await page.locator('.globe-route').count(), 0);
      const input = page.locator('#destination-input');
      await input.fill('London');
      await inspect(page, `${label}-search`);
      await input.press('ArrowDown'); await input.press('Enter');
      assert.equal(await input.inputValue(), 'London');
      await page.locator('[data-action="clue"]').click();
      assert.equal(await input.inputValue(), 'London');
      const collapsible = await page.locator('#clue-book-toggle').isVisible();
      if (collapsible) {
        await page.locator('#clue-book-toggle').click();
        assert.equal((await read(page)).guessesLeft, 5);
        assert.equal(await page.locator('#clue-book-content').isVisible(), false);
      }
      await page.locator('#guess-button').click();
      game = await read(page);
      const firstClue = game.clues.find(clue => clue.startsWith('Distance & direction:'));
      assert.ok(firstClue);
      assert.equal(game.guessesLeft, 4);
      if (collapsible) assert.equal(await page.locator('#clue-book-content').isVisible(), true);
      // A duplicate leaves attempts and the chosen phone-collapse state intact.
      if (collapsible) await page.locator('#clue-book-toggle').click();
      await input.fill('London'); await input.press('ArrowDown'); await input.press('Enter');
      await page.locator('#guess-button').click();
      assert.equal((await read(page)).guessesLeft, 4);
      if (collapsible) assert.equal(await page.locator('#clue-book-content').isVisible(), false);
      await tool(page, 'reveal_next_clue');
      await guess(page, 'HND'); await guess(page, 'ICN');
      assert.equal((await read(page)).clues.find(clue => clue.startsWith('Distance & direction:')), firstClue);
      game = await guess(page, 'KIJ');
      assert.equal(game.status, 'won');
      assert.equal(game.guessesLeft, 0);
      assert.equal(await page.locator('.guess-row.clue-used').count(), 2);
      assert.equal(await page.locator('.globe-route').count(), 1);
      await inspect(page, `${label}-sixth-win`, width === 320 || width === 1440);
      await page.locator('#help-button').click(); await inspect(page, `${label}-help`);
      if ([320, 701, 1440].includes(width)) await doubledText(page, `${label}-text200-help`);
      await page.locator('#info-done').click();
      await page.locator('#data-button').click(); await inspect(page, `${label}-data`);
      assert.match(await page.locator('#info-content').innerText(), /Aircraft source: adsb.lol/);
      await page.locator('#info-done').click();
      if ([320, 701, 1440].includes(width)) await doubledText(page, `${label}-text200-result`);
      const expected = [['CJU', 'ESR209'], ['ICN', 'APJ735'], ['KIJ', 'KAL2197'], ['ICN', 'ESR206']];
      for (const [query, callsign] of expected) {
        await tool(page, 'start_practice_round');
        await guess(page, query);
        assert.match(await page.locator('.route-note').innerText(), new RegExp(callsign));
      }
      assert.deepEqual(mock.external, []);
      mark(`${label}: keyboard, fixed clue, duplicates, paid clues, sixth win, dialogs, all recordings`);
      await page.reload(); await page.waitForFunction(() => window.qaTools?.start_practice_round);
      await tool(page, 'start_practice_round');
      for (const query of ['LHR', 'HND', 'ICN', 'CJU', 'JFK', 'CDG']) await guess(page, query);
      assert.equal((await read(page)).status, 'lost');
      await inspect(page, `${label}-loss`);
      await page.locator('[data-action="home"]').click();
      await tool(page, 'start_city_round', { city: 'Seoul' });
      await inspect(page, `${label}-empty`);
      assert.equal(await page.locator('[data-action="elsewhere"]').count(), 1);
      mock.mode = 'live';
      await page.locator('[data-action="elsewhere"]').click();
      await page.locator('#destination-input').waitFor();
      assert.match(await page.locator('.round-meta').innerText(), /London/);
      await guess(page, 'DXB');
      await page.locator('#data-button').click();
      assert.match(await page.locator('#info-content').innerText(), /Aircraft source: adsb.fi.*Route source: adsbdb/s);
      await page.locator('#info-done').click();
      await inspect(page, `${label}-live-fixture`);
      await tool(page, 'start_city_round', { city: 'London' });
      assert.match(await page.locator('.error h1').innerText(), /No different destination nearby/);
      assert.equal(await page.locator('[data-action="elsewhere"]').count(), 1);
      mock.mode = 'provider';
      await page.locator('[data-action="retry"]').click();
      assert.equal(await page.locator('[data-action="elsewhere"]').count(), 0);
      mock.mode = 'rate-limit';
      await page.locator('[data-action="retry"]').click();
      assert.equal(await page.locator('[data-action="retry"]').isDisabled(), true);
      await inspect(page, `${label}-provider-pause`);
      mark(`${label}: sixth loss, elsewhere, source labels, repeated answer, provider failure and pause`);
    } finally { await page.close(); }
  }

  // Cancel a pending file, then let it arrive: the next round must still be first.
  const held = await boot({ width: 390, height: 450 }, { heldAirports: true });
  await held.page.evaluate(() => { window.qaOpening = window.qaTools.start_practice_round.execute({}); });
  await held.page.locator('.loading').waitFor();
  await inspect(held.page, '390x450-loading');
  await held.page.locator('[data-action="cancel"]').click();
  for (const route of held.mock.held) await route.fulfill({ json: packedAirports });
  await held.page.evaluate(() => window.qaOpening);
  assert.equal((await read(held.page)).view, 'entry');
  await tool(held.page, 'start_practice_round'); await guess(held.page, 'KIJ');
  assert.match(await held.page.locator('.route-note').innerText(), /KAL2197/);
  await held.page.close(); mark('cancelled local-data load cannot reopen or advance practice');

  const broken = await boot({ width: 390, height: 844 }, { brokenPractice: true });
  await tool(broken.page, 'start_practice_round');
  assert.equal((await read(broken.page)).view, 'error');
  await inspect(broken.page, '390x844-broken-data');
  await broken.page.close(); mark('unavailable local recording shows recovery');

  const compass = await boot({ width: 390, height: 844 }, { missingGlobe: true });
  await tool(compass.page, 'start_practice_round');
  assert.equal(await compass.page.locator('.compass').count(), 1);
  await guess(compass.page, 'KIJ');
  assert.equal((await read(compass.page)).status, 'won');
  await compass.page.close(); mark('missing optional globe preserves compass and scoring');

  const stalled = await boot({ width: 390, height: 844 }, { heldGlobe: true });
  await tool(stalled.page, 'start_practice_round');
  assert.equal(await stalled.page.locator('.compass').count(), 1);
  await inspect(stalled.page, '390x844-stalled-globe');
  await stalled.page.close(); mark('stalled optional globe cannot block an otherwise playable round');

  const long = structuredClone(recordings[0]);
  long.route.destination.name = 'Airport' + 'LongName'.repeat(30);
  long.route.airline.name = 'Airline' + 'LongName'.repeat(17);
  const labels = await boot({ width: 320, height: 568 }, { fixture: long });
  await tool(labels.page, 'start_practice_round');
  for (let index = 0; index < 4; index++) await tool(labels.page, 'reveal_next_clue');
  await inspect(labels.page, '320x568-long-clues');
  await doubledText(labels.page, '320x568-text200-clues');
  await guess(labels.page, 'KIJ'); await inspect(labels.page, '320x568-long-result', true);
  await labels.page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await inspect(labels.page, '320x568-forced-colors');
  await labels.page.close(); mark('long text, doubled text, forced colors and reduced motion');

  const regular = await boot({ width: 1440, height: 1000 }, { tools: false });
  assert.equal(regular.mock.requests.includes('/browser-tools.js'), false);
  assert.equal(regular.mock.requests.includes('/data/airports.json'), false);
  assert.equal(regular.mock.requests.includes('/data/practice.json'), false);
  await regular.page.locator('#place-button').click();
  await regular.page.locator('#city-select').selectOption('0');
  await regular.page.getByRole('button', { name: 'Find a flight', exact: true }).click();
  await regular.page.locator('[data-action="practice"]').waitFor();
  await regular.page.locator('[data-action="practice"]').click();
  await regular.page.locator('#destination-input').waitFor();
  await inspect(regular.page, '1440x1000-no-browser-tools');
  await regular.page.close(); mark('ordinary browser has lazy data and complete practice controls');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ checks, views, errors, browser: browser.version() }, null, 2) + '\n');
  console.log(`Browser checks passed: ${checks.length} workflows, ${views.length} rendered states, ${browser.version()}`);
} finally {
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
