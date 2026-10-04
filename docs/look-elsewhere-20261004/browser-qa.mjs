import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGameServer } from '../../scripts/serve.mjs';
import { bearingDegrees } from '../../public/geo.js';

const require = createRequire('/Users/maxnurnus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json');
const { chromium } = require('playwright');
const airports = JSON.parse(await readFile(new URL('../../public/data/airports.json', import.meta.url), 'utf8'));
const cities = [
  { name: 'Seoul', lat: 37.57, lon: 126.98, origin: 'RKSI' },
  { name: 'London', lat: 51.51, lon: -0.13, origin: 'EGLL' },
  { name: 'New York', lat: 40.71, lon: -74.01, origin: 'KJFK' },
  { name: 'Singapore', lat: 1.35, lon: 103.82, origin: 'WSSS' },
  { name: 'Sydney', lat: -33.87, lon: 151.21, origin: 'YSSY' },
  { name: 'Tokyo', lat: 35.68, lon: 139.65, origin: 'RJTT' },
  { name: 'Paris', lat: 48.86, lon: 2.35, origin: 'LFPG' },
  { name: 'San Francisco', lat: 37.77, lon: -122.42, origin: 'KSFO' },
];
const endpoint = id => {
  const a = airports.find(a => a.id === id);
  assert.ok(a, id);
  return { icao: a.id, iata: a.code, name: a.name, location: a.city, countryiso2: a.country, lat: a.lat, lon: a.lon };
};
const server = createGameServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath:
  '/Users/maxnurnus/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const output = new URL('./browser/', import.meta.url);
await mkdir(output, { recursive: true });
const errors = [], cases = [];
let sequence = 0;
const tool = (page, name, args = {}) => page.evaluate(({ name, args }) => window.qaTools[name].execute(args), { name, args });
const read = page => tool(page, 'read_game_state');
const waitView = (page, view) => page.waitForFunction(view => window.qaTools.read_game_state.execute().view === view, view);
const mark = (label, size, detail = {}) => cases.push({ test: label, ...size, ...detail });
const checkWidth = async page => {
  const sizes = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(sizes.content <= sizes.viewport + 1, JSON.stringify(sizes));
};
const save = (page, size, label) => page.screenshot({ path: new URL(`${size.width}x${size.height}-${label}.png`, output).pathname, fullPage: size.width >= 700 && size.height >= 500 });

async function setup(size) {
  const phone = size.width < 700 || size.height < 500;
  const page = await browser.newPage({ viewport: size, isMobile: phone, hasTouch: phone });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.qaTools = {};
    window.locationCalls = 0;
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool(tool) { window.qaTools[tool.name] = tool; } } });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success) {
      window.locationCalls++;
      success({ coords: { latitude: 37.5665, longitude: 126.978 } });
    } } });
  });
  const mock = { mode: 'empty', held: [], requests: [], external: [], routes: new Map(), longLabels: false };
  const payload = (place, mode) => {
    const destinations = mode === 'variety' ? ['OMDB', 'OTHH'] : mode === 'arrival' ? ['RKSI'] : ['OMDB'];
    const ac = destinations.map(id => {
      const destination = endpoint(id), origin = endpoint(mode === 'arrival' ? 'RJTT' : place.origin);
      if (mock.longLabels) destination.name = 'Destination' + 'LongAirportName'.repeat(16);
      const n = ++sequence;
      const a = { hex: (0xabc000 + n).toString(16), flight: 'ABC' + (200 + n), lat: place.lat, lon: place.lon,
        alt_baro: mode === 'arrival' ? 6000 : 34000, gs: mode === 'arrival' ? 210 : 450,
        baro_rate: mode === 'arrival' ? -1200 : 0, seen: 1, seen_pos: 1 };
      a.track = bearingDegrees(a, destination);
      mock.routes.set(a.flight, { callsign: a.flight, plausible: true, _airports: [origin, destination] });
      return a;
    });
    return { now: Date.now(), ac };
  };
  mock.release = async mode => {
    const held = mock.held.splice(0);
    assert.ok(held.length);
    for (const { route, place } of held) {
      try { await route.fulfill({ json: payload(place, mode) }); }
      catch (error) { if (!/Target.*closed|already handled|Invalid InterceptionId/.test(error.message)) throw error; }
    }
  };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) { mock.external.push(url.hostname); return route.abort(); }
    if (url.pathname === '/api/config') return route.fulfill({ json: { relay: true } });
    if (url.pathname.startsWith('/api/nearby/')) {
      const [, , , lat, lon, radius] = url.pathname.split('/');
      const place = cities.find(c => Math.abs(c.lat - Number(lat)) < 0.02 && Math.abs(c.lon - Number(lon)) < 0.02);
      assert.ok(place, url.pathname);
      mock.requests.push({ city: place.name, radius: Number(radius), mode: mock.mode });
      if (mock.mode === 'hold') { mock.held.push({ route, place }); return; }
      if (mock.mode === 'rate-limit') return route.fulfill({ status: 429, headers: { 'retry-after': '60' }, json: {} });
      if (mock.mode === 'provider') return route.fulfill({ status: 503, json: {} });
      if (mock.mode === 'network') return route.abort('failed');
      return route.fulfill({ json: mock.mode === 'empty' ? { now: Date.now(), ac: [] } : payload(place, mock.mode) });
    }
    if (url.pathname.startsWith('/api/route/')) return route.fulfill({ json: mock.routes.get(url.pathname.split('/')[3]) });
    return route.continue();
  });
  await page.goto(base);
  await page.waitForFunction(() => window.qaTools.start_city_round);
  return { page, mock, close: async () => { assert.deepEqual(mock.external, []); await page.close(); } };
}

async function guess(page, name, query = name) {
  const matches = await tool(page, 'search_cities', { query });
  const city = matches.cities.find(c => c.name === name);
  assert.ok(city, JSON.stringify(matches));
  return tool(page, 'submit_city_guess', { cityId: city.id });
}

try {
  for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844], [375, 667], [320, 568], [390, 450], [844, 390]]) {
    const size = { width, height };
    const { page, mock, close } = await setup(size);
    await page.locator('#place-button').click();
    await page.locator('#city-select').selectOption('0');
    await page.locator('#difficulty-select').selectOption('hard');
    await page.getByRole('button', { name: 'Find a flight', exact: true }).click();
    await waitView(page, 'error');
    assert.equal(mock.requests.length, 3);
    assert.equal(await page.locator('[data-action="elsewhere"]').count(), 1);
    await checkWidth(page);
    if (width === 390 && height === 450) {
      const box = await page.locator('[data-action="elsewhere"]').boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= height, 'Recovery button should fit on a short phone before scrolling.');
    }
    await save(page, size, 'empty');
    mark('empty search offers one-click recovery', size);

    await page.getByRole('button', { name: 'Search again', exact: true }).click();
    await waitView(page, 'error');
    assert.equal(mock.requests.length, 6);
    assert.ok(mock.requests.every(r => r.city === 'Seoul'));
    mark('retry retains the original search point', size);

    mock.mode = 'hold';
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'elsewhere');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Finding a flight near London.');
    while (!mock.held.length) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(mock.requests.length, 7);
    assert.equal(mock.requests.at(-1).city, 'London');
    await checkWidth(page);
    await save(page, size, 'loading');
    mark('keyboard action searches another named city once', size);
    mock.mode = 'valid';
    mock.longLabels = width === 320;
    await mock.release('valid');
    await waitView(page, 'game');
    const playing = await read(page);
    assert.equal(playing.status, 'playing');
    assert.equal(playing.difficulty, 'hard');
    assert.match(playing.observation, /London/);
    assert.ok(!('destinationCity' in playing));
    assert.equal(await page.locator('.flight-globe .globe-route').count(), 0);
    assert.match(await page.locator('.round-meta').innerText(), /Near London/);
    await checkWidth(page);
    await save(page, size, 'round');
    mark('new live round shows starting area and retains difficulty', size);
    assert.equal((await guess(page, 'Dubai')).status, 'won');
    await checkWidth(page);
    await save(page, size, 'finished');
    mark('finished result and long airport label fit', size);
    await close();
  }

  for (const size of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    let run = await setup(size);
    run.mock.mode = 'arrival';
    await tool(run.page, 'start_city_round', { city: 'Seoul' });
    assert.match(await run.page.locator('.error').innerText(), /too close to landing/);
    run.mock.mode = 'valid';
    await run.page.getByRole('button', { name: 'Look elsewhere', exact: true }).click();
    await waitView(run.page, 'game');
    assert.match((await read(run.page)).observation, /London/);
    mark('arrival-only sky offers recovery', size);
    await run.close();

    run = await setup(size);
    await tool(run.page, 'start_city_round', { city: 'Seoul' });
    run.mock.mode = 'hold';
    await run.page.getByRole('button', { name: 'Look elsewhere', exact: true }).click();
    while (!run.mock.held.length) await new Promise(resolve => setTimeout(resolve, 10));
    await run.page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await read(run.page)).view, 'entry');
    run.mock.mode = 'valid';
    await run.mock.release('valid');
    await run.page.waitForLoadState('networkidle');
    assert.equal((await read(run.page)).view, 'entry');
    assert.equal((await tool(run.page, 'start_city_round', { city: 'New York' })).status, 'playing');
    mark('cancelled alternate search stays closed; later search works', size);
    await run.close();

    run = await setup(size);
    await run.page.locator('#location-button').click();
    await waitView(run.page, 'error');
    run.mock.mode = 'valid';
    await run.page.getByRole('button', { name: 'Look elsewhere', exact: true }).click();
    await waitView(run.page, 'game');
    assert.match((await read(run.page)).observation, /London/);
    assert.equal(await run.page.evaluate(() => window.locationCalls), 1);
    mark('device-location recovery skips nearby listed city without relocalising', size);
    await run.close();

    run = await setup(size);
    run.mock.mode = 'valid';
    assert.equal((await tool(run.page, 'start_city_round', { city: 'Seoul' })).status, 'playing');
    assert.equal((await guess(run.page, 'Dubai')).status, 'won');
    run.mock.mode = 'repeated';
    await run.page.locator('[data-action="next"]').click();
    await waitView(run.page, 'error');
    assert.match(await run.page.locator('h1').innerText(), /No different destination/);
    run.mock.mode = 'variety';
    await run.page.getByRole('button', { name: 'Look elsewhere', exact: true }).click();
    await waitView(run.page, 'game');
    assert.equal((await guess(run.page, 'Doha', 'DOH')).status, 'won');
    mark('alternate city preserves last-destination exclusion', size);
    await run.close();

    run = await setup(size);
    await tool(run.page, 'start_city_round', { city: 'Seoul' });
    await run.page.getByRole('button', { name: 'Play a recorded flight', exact: true }).click();
    await waitView(run.page, 'game');
    assert.equal((await read(run.page)).mode, 'practice');
    assert.match(await run.page.locator('.round-meta').innerText(), /Practice/i);
    mark('recorded fallback remains explicit and available', size);
    await run.close();
  }

  const size = { width: 390, height: 450 };
  for (const mode of ['rate-limit', 'provider', 'network']) {
    const run = await setup(size);
    run.mock.mode = mode;
    await tool(run.page, 'start_city_round', { city: 'Seoul' });
    assert.equal((await read(run.page)).view, 'error');
    assert.equal(await run.page.locator('[data-action="elsewhere"]').count(), 0);
    if (mode === 'rate-limit') assert.equal(await run.page.locator('[data-action="retry"]').isDisabled(), true);
    await checkWidth(run.page);
    mark('service failure or pause does not offer a location workaround', size, { mode });
    await run.close();
  }

  const run = await setup({ width: 1440, height: 1000 });
  await tool(run.page, 'start_city_round', { city: 'Seoul' });
  const names = ['London', 'New York', 'Singapore', 'Sydney', 'Tokyo', 'Paris', 'San Francisco', 'Seoul'];
  for (const [index, name] of names.entries()) {
    const count = run.mock.requests.length;
    await run.page.getByRole('button', { name: 'Look elsewhere', exact: true }).click();
    await waitView(run.page, 'error');
    assert.equal(run.mock.requests.length - count, 3);
    assert.ok(run.mock.requests.slice(count).every(request => request.city === name));
    assert.equal(run.mock.requests.length, 3 * (index + 2));
  }
  mark('successive clicks rotate all cities without automatic chaining', { width: 1440, height: 1000 }, { cities: names });
  await run.page.getByRole('button', { name: 'Choose another city', exact: true }).click();
  await waitView(run.page, 'city');
  assert.equal(await run.page.locator('#city-select option').count(), 9);
  mark('manual city choice remains available', { width: 1440, height: 1000 });
  await run.close();

  assert.deepEqual(errors, []);
  await writeFile(new URL('results.json', output), JSON.stringify({ qualification:
    'Current source in Chromium desktop/tablet and emulated phone. Provider responses are local fixtures; no live-provider, hosted CORS, physical-phone or screen-reader claim.',
    cases, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ cases: cases.length, errors, tests: [...new Set(cases.map(c => c.test))] }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
