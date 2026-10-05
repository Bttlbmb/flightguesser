import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'public');
const output = join(root, 'dist');
const assets = [
  'index.html', 'config.json', 'app.js', 'styles.css', 'api.js', 'flights.js', 'selection.js', 'geo.js', 'game.js',
  'airports.js', 'destinations.js', 'data.js', 'browser-tools.js', 'globe.js', 'assets/crescent-favicon.svg',
  'data/airports.json', 'data/practice.json', 'data/city-links.js', 'data/world-land.js',
  'vendor/d3-geo.js', 'vendor/d3-geo-LICENSE.txt', 'vendor/atlas-LICENSE.txt',
];
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

// Explicit assets keep development files and accidental source-folder additions
// outside the deployable output. The build is offline and never modifies source.
await rm(output, { recursive: true, force: true });
const hostedAssets = {};
for (const asset of assets) {
  const target = join(output, asset);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(source, asset), target);
  if (process.argv.includes('--hosted')) {
    hostedAssets['/' + asset] = { type: types[extname(asset)], body: await readFile(target, 'utf8') };
  }
}
const page = await readFile(join(output, 'index.html'), 'utf8');
if (!page.includes('Flightguesser') || !page.includes('app.js')) throw new Error('Missing game entry point');
console.log('Built static game in dist/');
await writeFile(join(output, '.nojekyll'), '');

if (process.argv.includes('--hosted')) {
  // Embed text assets so this Worker needs no platform-specific asset binding.
  const worker = await readFile(join(root, 'server/worker.js'), 'utf8');
  await mkdir(join(output, 'server'), { recursive: true });
  await writeFile(join(output, 'server/index.js'), worker + '\nexport default createHostedHandler({ assets: ' + JSON.stringify(hostedAssets) + ' });\n');
  console.log('Built hosted Worker with live data relay');
}
