// A stand-in for DSH's web server: GET /?token= mints a host-bound session cookie, /api needs it, and
// /api/remote.mux echoes WebSocket messages. Synthetic values only.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { WebSocketServer } from 'ws';

export const TOKEN = 'synthetic-launch-token', KEY = 'synthetic-device-key-0123456789abcdef';

export async function fakeDsh(t: TestContext) {
  const seen: { path: string; host?: string; cookie?: string; origin?: string; authorization?: string }[] = [];
  let logins = 0, session = 'session-1';
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    seen.push({ path: url.pathname + url.search, host: req.headers.host, cookie: req.headers.cookie, origin: req.headers.origin, authorization: req.headers.authorization });
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.get('token') === TOKEN) {
      logins++;
      res.writeHead(302, { location: './', 'set-cookie': `dshs_${req.headers.host}=${session}; Path=/; HttpOnly; SameSite=Strict` });
      return res.end();
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    if (req.headers.cookie !== `dshs_${req.headers.host}=${session}`) { res.writeHead(401); return res.end('unauthorized'); }
    let body = ''; req.setEncoding('utf8'); req.on('data', c => { body += c; });
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ echoed: JSON.parse(body || 'null'), path: url.pathname })); });
  });
  server.on('upgrade', (req, socket, head) => {
    seen.push({ path: req.url ?? '', host: req.headers.host, cookie: req.headers.cookie });
    if (req.url !== '/api/remote.mux' || req.headers.cookie !== `dshs_${req.headers.host}=${session}`) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => ws.on('message', data => ws.send(`echo:${data}`)));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { for (const client of wss.clients) client.terminate(); wss.close(); server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://127.0.0.1:${port}`, seen, logins: () => logins, rotate: () => { session = 'session-2'; } };
}

