import { writeFile } from 'node:fs/promises';
import { normalizeRelayUrl } from '../public/api.js';

const relayUrl = normalizeRelayUrl(process.argv[2]);
const origin = 'https://bttlbmb.github.io';
const response = await fetch(relayUrl + '/api/config', {
  headers: { Origin: origin }, redirect: 'error', signal: AbortSignal.timeout(10000),
});
if (!response.ok || response.headers.get('access-control-allow-origin') !== origin) {
  throw new Error('The relay did not allow the GitHub website. Deploy cloudflare/worker.js first.');
}
const settings = await response.json();
if (settings.relay !== true || settings.telemetryProvider !== 'adsb.fi' || settings.routeProvider !== 'adsbdb') {
  throw new Error('Unexpected relay configuration. Deploy the prepared Flightguesser Worker.');
}
await writeFile(new URL('../public/config.json', import.meta.url), JSON.stringify({ ...settings, relayUrl }, null, 2) + '\n');
console.log('Relay configuration verified and saved. Commit the changes, then run npm run publish:pages.');
