import { findNearbyRound } from '../public/api.js';
const input = await new Promise((resolve, reject) => {
  let value = '';
  const terminal = process.stdin.isTTY;
  const finish = () => {
    process.stdin.removeAllListeners('data');
    if (terminal) process.stdin.setRawMode(false);
    process.stdin.pause();
    try { resolve(JSON.parse(value)); } catch { reject(new Error('Expected JSON input')); }
  };
  if (terminal) process.stdin.setRawMode(true);
  process.stderr.write('Ready for verification JSON on stdin (input is hidden).\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    value += chunk;
    if (value.includes('\u0003')) process.exit(130);
    if (value.length > 65536) process.exit(1);
    if (/[\r\n]/.test(value)) finish();
  });
  process.stdin.resume();
});
const { url, token } = input;
const headers = token ? { 'OAI-Sites-Authorization': 'Bearer ' + token } : {};
const fetcher = async (path, options = {}) => fetch(new URL(path, url), { ...options, headers: { ...headers, ...options.headers }, redirect: 'error' });
try {
  const page = await fetcher('/');
  if (!page.ok) throw new Error('Site page returned HTTP ' + page.status);
  const html = await page.text();
  if (html.includes('difficulty-select')) throw new Error('Difficulty selector is still present');
  const config = await fetcher('/api/config');
  if (!config.ok || (await config.json()).relay !== true) throw new Error('Hosted relay not enabled');
  const round = await findNearbyRound({ lat: 37.5665, lon: 126.978, name: 'Seoul', kind: 'city' }, { relay: true, fetcher });
  console.log(JSON.stringify({ page: 'passed', difficultySelector: 'absent', relay: 'enabled', mode: round.mode, routeSource: round.route.provider, candidatesCompared: round.diagnostics.candidatesCompared }));
} catch (error) {
  console.log(JSON.stringify({ verification: 'failed', code: error.code ?? 'hosted-check', message: error.message }));
  process.exitCode = 1;
}
