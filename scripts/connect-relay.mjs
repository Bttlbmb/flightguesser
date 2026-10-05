import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeRelayUrl } from '../public/api.js';

const origin = 'https://bttlbmb.github.io';
export async function verifyRelay(value, fetcher = fetch) {
  const relayUrl = normalizeRelayUrl(value);
  const get = path => fetcher(relayUrl + path, {
    headers: { Origin: origin }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const response = await get('/api/config');
  if (!response.ok || response.headers.get('access-control-allow-origin') !== origin) {
    throw new Error('The relay did not allow the GitHub website. Deploy cloudflare/worker.js first.');
  }
  const settings = await response.json();
  if (settings.relay !== true || settings.telemetryProvider !== 'adsb.fi' || settings.routeProvider !== 'adsbdb') {
    throw new Error('Unexpected relay configuration. Deploy the prepared Flightguesser Worker.');
  }
  const nearby = await get('/api/nearby/37.57/126.98/50');
  if (!nearby.ok || nearby.headers.get('access-control-allow-origin') !== origin) {
    throw new Error('The Worker is installed, but live aircraft data failed (HTTP ' + nearby.status + '). Check its Cloudflare logs before connecting the website.');
  }
  const snapshot = await nearby.json();
  if (!Array.isArray(snapshot.ac)) throw new Error('The relay returned an unexpected aircraft response.');
  return { ...settings, relayUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = await verifyRelay(process.argv[2]);
  await writeFile(new URL('../public/config.json', import.meta.url), JSON.stringify(settings, null, 2) + '\n');
  console.log('Relay configuration and live aircraft data verified and saved. Commit the changes, then run npm run publish:pages.');
}
