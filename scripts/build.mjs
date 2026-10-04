import { cp, mkdir, readFile, stat, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'public');
const output = join(root, 'dist');

// Only public game assets go into the deployable output. No dev relay or evidence.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, filter: path => !basename(path).startsWith('.') });
for (const asset of [
  'index.html', 'app.js', 'styles.css', 'api.js', 'flights.js', 'selection.js', 'geo.js', 'game.js',
  'airports.js', 'destinations.js', 'globe.js', 'assets/crescent-mark.svg', 'assets/crescent-favicon.svg',
  'data/airports.json', 'data/practice.json', 'data/city-links.js', 'data/world-land.js',
  'vendor/d3-geo.js', 'vendor/d3-geo-LICENSE.txt', 'vendor/atlas-LICENSE.txt',
]) {
  if (!(await stat(join(output, asset))).isFile()) throw new Error(`Missing public asset: ${asset}`);
}
const page = await readFile(join(output, 'index.html'), 'utf8');
if (!page.includes('Flightguesser') || !page.includes('app.js')) throw new Error('Missing game entry point');
console.log('Built static game in dist/');
