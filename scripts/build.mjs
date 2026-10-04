import { cp, mkdir, readFile, stat, rm, readdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
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

if (process.argv.includes('--hosted')) {
  // Bundle the small text-only asset collection so the Worker needs no asset binding.
  const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8' };
  const assets = {};
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix + '/' + entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path, relative);
      else assets[relative] = { type: types[extname(entry.name)] ?? 'text/plain; charset=utf-8', body: await readFile(path, 'utf8') };
    }
  }
  await collect(source);
  const worker = await readFile(join(root, 'server/worker.js'), 'utf8');
  await mkdir(join(output, 'server'), { recursive: true });
  await writeFile(join(output, 'server/index.js'), worker + '\nexport default createHostedHandler({ assets: ' + JSON.stringify(assets) + ' });\n');
  await mkdir(join(output, '.openai'), { recursive: true });
  await cp(join(root, '.openai/hosting.json'), join(output, '.openai/hosting.json'));
  console.log('Built hosted Worker with live data relay');
}
