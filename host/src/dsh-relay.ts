// DSH's own web-client protocol (POST /api/<method>, WebSocket /api/remote.mux) relayed for the owner's phone.
// The relay signs in exactly as DSH's Desktop host does (connection.authenticatedUrl → GET /?token= → host-bound
// session cookie) and forwards only /api, plus the generated modules (/ui) the phone downloads. Its front door is
// the companion's own server under /dsh (what Tailcat reaches; device-token auth, owner devices only: server.ts).
import { createReadStream } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { UiModules } from './ui-modules.ts';

export interface DshUpstream { origin: string; loginUrl: string }
export interface DshRelay {
  /** Answers a request whose URL is already stripped of any prefix and credential; false when it is not relayed. */
  serve(req: IncomingMessage, res: ServerResponse, url: URL): boolean;
  /** Takes over a WebSocket upgrade for /api/remote.mux; false when it is not one. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): boolean;
  close(): Promise<void>;
}
export interface DshRelayOptions {
  /** Read at sign-in time: DSH's port and launch token change on every launch. */
  upstream: () => DshUpstream;
  /** Generated modules the phone downloads: the companion's root key and each tool call's signed package. */
  ui?: Pick<UiModules, 'packagePath' | 'rootKey'>;
}

export const KEY_PARAM = 'dshm_key';
const MUX_PATH = '/api/remote.mux';

export function createDshRelay(options: DshRelayOptions): DshRelay {
  let cookie: string | undefined;
  let signingIn: Promise<string> | undefined;

  /** GET the launch URL without following its redirect and keep the session cookie it sets. */
  function signIn(): Promise<string> {
    signingIn ??= new Promise<string>((resolve, reject) => {
      const req = httpRequest(options.upstream().loginUrl, { method: 'GET' }, res => {
        res.resume();
        const set = res.headers['set-cookie']?.[0];
        if (!set) { reject(new Error(`dsh sign-in returned ${res.statusCode} without a session cookie`)); return; }
        resolve(set.split(';', 1)[0]!);
      });
      req.on('error', reject); req.end();
    }).then(value => { cookie = value; return value; }).finally(() => { signingIn = undefined; });
    return signingIn;
  }
  const session = (): Promise<string> => (cookie ? Promise.resolve(cookie) : signIn());

  function forward(req: IncomingMessage, res: ServerResponse, body: Buffer, path: string, retry: boolean, value: string) {
    const target = new URL(options.upstream().origin);
    const headers: Record<string, string> = { host: target.host, cookie: value };
    for (const name of ['content-type', 'accept', 'accept-encoding', 'x-file-name']) {
      const header = req.headers[name]; if (typeof header === 'string') headers[name] = header;
    }
    if (body.length) headers['content-length'] = String(body.length);
    const upstream = httpRequest({ host: target.hostname, port: target.port, path, method: req.method, headers }, up => {
      if (up.statusCode === 401 && retry) {
        up.resume(); cookie = undefined;
        signIn().then(next => forward(req, res, body, path, false, next), () => { res.writeHead(502); res.end(); });
        return;
      }
      const out: Record<string, string | string[]> = {};
      for (const [name, header] of Object.entries(up.headers)) if (header !== undefined && name !== 'set-cookie') out[name] = header;
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    upstream.end(body);
  }

  function serveUi(url: URL, res: ServerResponse) {
    if (url.pathname === '/ui/root.pub') {
      options.ui!.rootKey().then(key => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(key); }, () => { res.writeHead(503); res.end(); });
      return;
    }
    const path = options.ui!.packagePath(url.searchParams.get('call') ?? '');
    if (!path) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  }

  const wss = new WebSocketServer({ noServer: true });
  const upstreams = new Set<WebSocket>();
  return {
    serve(req, res, url) {
      if (req.method === 'GET' && options.ui && (url.pathname === '/ui/root.pub' || url.pathname === '/ui/package')) { serveUi(url, res); return true; }
      if (!url.pathname.startsWith('/api/') || url.pathname === MUX_PATH) return false;
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const path = url.pathname + (url.search === '?' ? '' : url.search);
        session().then(value => forward(req, res, Buffer.concat(chunks), path, true, value), () => { res.writeHead(502); res.end(); });
      });
      return true;
    },
    upgrade(req, socket, head, url) {
      if (url.pathname !== MUX_PATH) return false;
      const refuse = (status: number) => { socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Bad Gateway'}\r\nConnection: close\r\n\r\n`); };
      const connect = (value: string, retry: boolean) => {
        const target = new URL(options.upstream().origin);
        const upstream = new WebSocket(`ws://${target.host}${MUX_PATH}`, { headers: { cookie: value } });
        upstreams.add(upstream); upstream.once('close', () => upstreams.delete(upstream));
        upstream.once('unexpected-response', (_request, response) => {
          response.resume();
          if (response.statusCode === 401 && retry) { cookie = undefined; signIn().then(next => connect(next, false), () => refuse(502)); }
          else refuse(response.statusCode === 401 ? 401 : 502);
        });
        upstream.once('error', () => { if (!socket.destroyed) refuse(502); });
        upstream.once('open', () => {
          wss.handleUpgrade(req, socket, head, client => {
            client.on('message', (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); });
            upstream.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
            const closeCode = (code: number) => (code >= 1000 && code < 1005) || (code >= 3000 && code < 5000) ? code : 1011;
            client.on('close', (code, reason) => upstream.close(closeCode(code), reason));
            upstream.on('close', (code, reason) => client.close(closeCode(code), reason));
            client.on('error', () => upstream.terminate());
            upstream.on('error', () => client.terminate());
          });
        });
      };
      session().then(value => connect(value, true), () => refuse(502));
      return true;
    },
    async close() {
      for (const client of wss.clients) client.terminate();
      for (const upstream of upstreams) upstream.terminate();
      wss.close();
    },
  };
}

/** The credential a request carries, removed from the URL so it never reaches DSH. */
export function takeCredential(req: IncomingMessage, url: URL, allowQuery: boolean): string | undefined {
  const query = url.searchParams.get(KEY_PARAM); url.searchParams.delete(KEY_PARAM);
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return allowQuery ? query ?? undefined : undefined;
}
