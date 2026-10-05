import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, realpath, mkdir } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve the actual build under the Pages prefix, with no relay or API mocks.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await realpath(join(root, 'dist'));
const packagePath = process.env.FLIGHTGUESSER_PLAYWRIGHT_PACKAGE;
const require = createRequire(packagePath
  ? (packagePath.endsWith('package.json') ? packagePath : join(packagePath, 'package.json'))
  : join(root, 'package.json'));
let chromium;
try { ({ chromium } = require('playwright')); }
catch { throw new Error('Pages checks need Playwright. Set FLIGHTGUESSER_PLAYWRIGHT_PACKAGE to its package directory.'); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const prefix = '/flightguesser/';
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith(prefix)) throw new Error('Outside Pages site');
    const relative = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
    const file = await realpath(resolve(directory, relative));
    if (!file.startsWith(directory + sep)) throw new Error('Outside static build');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'text/plain' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const output = join(root, 'test-results/pages');
await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_BIN ? { executablePath: process.env.BROWSER_BIN } : {}) });
  for (const [width, height] of [[390, 844], [1440, 1000]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const failures = [], requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      assert.equal(url.origin, origin, 'Practice must not contact external services');
      assert.ok(url.pathname.startsWith(prefix), 'All requests must preserve the Pages prefix');
      return route.continue();
    });
    await page.goto(origin + prefix);
    await page.locator('[data-action="practice"]').click();
    await page.locator('#destination-input').waitFor();
    assert.equal(await page.locator('.globe-route').count(), 0);
    assert.ok(requests.includes(prefix + 'data/airports.json'));
    assert.ok(requests.includes(prefix + 'data/practice.json'));
    const input = page.locator('#destination-input');
    await input.fill('KIJ');
    await input.press('ArrowDown');
    await input.press('Enter');
    await page.locator('#guess-button').click();
    await page.locator('[data-action="next"]').waitFor();
    assert.match(await page.locator('#app').innerText(), /Niigata/);
    await page.screenshot({ path: join(output, `${width}-result.png`), fullPage: true });
    await page.locator('[data-action="next"]').click();
    await page.locator('#destination-input').waitFor();
    // A live search must load the static config at the project path, then show
    // a useful recovery if direct provider access fails. Keep this check offline.
    await page.unroute('**/*');
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      requests.push(url.pathname);
      assert.ok(url.pathname.startsWith(prefix));
      return route.continue();
    });
    await page.goto(origin + prefix);
    await page.locator('#place-button').click();
    await page.locator('#city-select').selectOption('0');
    await page.locator('#city-form button').click();
    await page.locator('[data-action="practice"]').waitFor();
    assert.ok(requests.includes(prefix + 'config.json'));
    assert.deepEqual(failures, []);
    assert.deepEqual(errors, []);
    await page.locator('[data-action="practice"]').click();
    await page.locator('#destination-input').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.close();
  }
  console.log('Pages checks passed: desktop and phone, relative assets/configuration, recorded win, next round, live failure recovery.');
} finally {
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
