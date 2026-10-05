import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import worker from '../dist/server/index.js';

// Preview the generated Worker locally, including its real relay behavior.
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 5187);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a valid localhost port');
const server = createServer(async (req, res) => {
  if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(req.headers.host)) {
    res.writeHead(403);
    res.end('Localhost only');
    return;
  }
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', cancel);
  try {
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method, headers: req.headers, signal: controller.signal,
    });
    const response = await worker.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) res.end();
    else await pipeline(Readable.fromWeb(response.body), res);
  } catch {
    if (res.headersSent) res.destroy();
    else { res.writeHead(500); res.end('Preview failed'); }
  } finally {
    res.off('close', cancel);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Hosted preview: http://localhost:${port}`));
