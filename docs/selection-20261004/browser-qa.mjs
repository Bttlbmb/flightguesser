import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGameServer } from '../../scripts/serve.mjs';
import { bearingDegrees } from '../../public/geo.js';

const require = createRequire('/Users/maxnurnus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json');
const { chromium } = require('playwright');
const airports = JSON.parse(await readFile(new URL('../../public/data/airports.json', import.meta.url), 'utf8'));
const endpoint = id => {
  const a = airports.find(a => a.id === id);
  return { icao: a.id, iata: a.code, name: a.name, location: a.city, countryiso2: a.country, lat: a.lat, lon: a.lon };
};
const destinations = ['RJTT', 'RCTP', 'VHHH', 'WSSS', 'RPLL', 'ZBAA'].map(endpoint);
const origin = endpoint('RKSI');
const rawAircraft = [];
const routes = new Map();
for (let index = 0; index < 12; index++) {
  const a = { hex: (0xabc000 + index).toString(16), flight: 'KAL' + (100 + index), lat: 37.56 + index * 0.001,
    lon: 126.97, alt_baro: 6000, gs: 210, track: bearingDegrees({lat:37.56 + index * 0.001,lon:126.97},origin),
    baro_rate: -1200, seen: 1, seen_pos: 1 };
  rawAircraft.push(a);
  routes.set(a.flight, { callsign: a.flight, plausible: true, _airports: [endpoint('RJTT'), origin] });
}
for (let index = 0; index < destinations.length; index++) {
  const a = { hex: (0xabc100 + index).toString(16), flight: 'ABC' + (200 + index),
    lat: 37.72 + index * 0.02, lon: 127.2 + index * 0.03,
    alt_baro: 34000, gs: 450, baro_rate: 0, seen: 1, seen_pos: 1 };
  a.track = bearingDegrees(a, destinations[index]);
  rawAircraft.push(a);
  routes.set(a.flight, { callsign: a.flight, plausible: true, _airports: [origin, destinations[index]] });
}
const server = createGameServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath:
  '/Users/maxnurnus/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const output = new URL('./browser/', import.meta.url);
await mkdir(output, { recursive: true });
const errors = [], cases = [];
const tool = (page, name, args = {}) => page.evaluate(({ name, args }) => window.qaTools[name].execute(args), { name, args });
try {
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700 });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.qaTools = {};
      Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool(tool) { window.qaTools[tool.name] = tool; } } });
    });
    let arrivalOnly = false, held = false, heldRoute;
    const requests = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { requests.push('external:' + url.hostname); return route.abort(); }
      if (url.pathname === '/api/config') return route.fulfill({ json: { relay: true } });
      if (url.pathname.startsWith('/api/nearby')) {
        requests.push(url.pathname);
        if (held) { heldRoute = route; return; }
        return route.fulfill({ json: { now: Date.now(), ac: arrivalOnly ? rawAircraft.slice(0, 12) : rawAircraft } });
      }
      if (url.pathname.startsWith('/api/route')) {
        requests.push(url.pathname);
        return route.fulfill({ json: routes.get(url.pathname.split('/')[3]) });
      }
      return route.continue();
    });
    await page.goto(base);
    await page.waitForFunction(() => window.qaTools.start_city_round);
    const answers = [];
    for (let index = 0; index < 3; index++) {
      const playing = await tool(page, 'start_city_round', { city: 'Seoul' });
      assert.equal(playing.status, 'playing');
      assert.equal(playing.clues.length, 1);
      assert.ok(!JSON.stringify(playing).includes('diagnostics'));
      assert.ok(!('destinationCity' in playing));
      assert.equal(await page.locator('.flight-globe .globe-route').count(), 0);
      const cities = ['London', 'Paris', 'New York', 'Sydney', 'Melbourne', 'Athens'];
      for (const name of cities) {
        const found = await tool(page, 'search_cities', { query: name });
        await tool(page, 'submit_city_guess', { cityId: found.cities[0].id });
      }
      const finished = await tool(page, 'read_game_state');
      assert.equal(finished.status, 'lost');
      assert.ok(!['Seoul', 'Incheon'].includes(finished.destinationCity));
      if (answers.length) assert.notEqual(finished.destinationCity, answers.at(-1));
      answers.push(finished.destinationCity);
    }
    cases.push({ width, height, test: 'three live-fixture rounds, hidden answer and session rotation', answers });
    arrivalOnly = true;
    const rejected = await tool(page, 'start_city_round', { city: 'Seoul' });
    assert.equal(rejected.view, 'error');
    assert.ok((await page.locator('#app').innerText()).includes('too close to landing'));
    assert.ok(await page.getByRole('button', { name: 'Play a recorded flight', exact: true }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Choose another city', exact: true }).isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: new URL(width + '-arrival-recovery.png', output).pathname, fullPage: width >= 700 });
    cases.push({ width, height, test: 'arrival-only recovery, readable actions and no horizontal overflow' });
    arrivalOnly = false; held = true;
    const pending = tool(page, 'start_city_round', { city: 'Seoul' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await heldRoute.abort();
    await pending;
    assert.notEqual((await tool(page, 'read_game_state')).view, 'game');
    held = false;
    assert.equal((await tool(page, 'start_city_round', { city: 'Seoul' })).status, 'playing');
    cases.push({ width, height, test: 'cancelled search stays closed and later fresh search opens' });
    assert.ok(!requests.some(url => url.startsWith('external:')));
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('results.json', output), JSON.stringify({
    qualification: 'Current source in Chromium desktop and emulated phone. Provider traffic intercepted; no live-provider/CORS or physical-phone claim.',
    cases, errors,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ cases: cases.length, errors, casesDetail: cases }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
