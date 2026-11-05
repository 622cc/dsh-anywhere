import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runAdminCli } from './cli.ts';
import { invitationQrSvg } from './qr.ts';

/** One authenticated browser Fetch route registered on the DSH shared /api channel. */
export interface MobileAdminRoute {
  readonly path: string;
  readonly methods: readonly ('GET' | 'HEAD' | 'POST')[];
  readonly requestBody: 'buffered' | 'streaming';
  readonly fetch: (request: Request) => Promise<Response>;
}

interface AdminOptions {
  readonly configPath: string;
  readonly dshVersion: string;
  readonly transport: 'tailcat' | 'direct';
  readonly publicUrl?: string;
  readonly tailcatWaitMs?: number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function failure(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function codeOf(error: string): string {
  return /^([a-z_]+):/.exec(error.trim())?.[1] ?? 'unavailable';
}

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Local admin surface for the Settings page. Every route runs behind DSH browser auth. */
export function createMobileAdminRoutes(options: AdminOptions): MobileAdminRoute[] {
  const invitations = join(dirname(options.configPath), 'invitations');
  const run = async (argv: string[]): Promise<{ code: number; out: string; error: string }> => {
    let out = '', error = '';
    const code = await runAdminCli(argv, { out: text => { out += text; }, error: text => { error += text; } }, options.tailcatWaitMs === undefined ? {} : { tailcatWaitMs: options.tailcatWaitMs });
    return { code, out, error };
  };

  const status = async (): Promise<Response> => {
    if (options.transport === 'direct') {
      const result = await run(['devices', '--config', options.configPath]);
      if (result.code !== 0) return failure(503, 'unavailable', 'The companion is not running.');
      try {
        const value = JSON.parse(result.out) as { items?: { revokedAt?: unknown }[] };
        const active = Array.isArray(value.items) ? value.items.filter(item => item.revokedAt === null).length : 0;
        return json(200, { transport: 'direct', running: true, address: options.publicUrl ?? null, allowedClients: 0, pairedPhones: active, pendingPhones: 0, updatedAt: Date.now(), stale: false, dshVersion: options.dshVersion });
      } catch {
        return failure(503, 'unavailable', 'The companion status is unavailable.');
      }
    }
    const result = await run(['tailcat-status', '--config', options.configPath]);
    if (result.code !== 0) return failure(503, 'unavailable', 'The companion is not running.');
    try {
      const value = JSON.parse(result.out) as Record<string, unknown>;
      return json(200, { ...value, dshVersion: options.dshVersion });
    } catch {
      return failure(503, 'unavailable', 'The companion status is unavailable.');
    }
  };

  const devices = async (): Promise<Response> => {
    const result = await run(['devices', '--config', options.configPath]);
    if (result.code !== 0) return failure(503, 'unavailable', 'The paired-device list is unavailable.');
    try {
      const value = JSON.parse(result.out) as { items?: unknown };
      return json(200, { items: Array.isArray(value.items) ? value.items : [] });
    } catch {
      return failure(503, 'unavailable', 'The paired-device list is unavailable.');
    }
  };

  const pair = async (request: Request): Promise<Response> => {
    let body: unknown;
    try { body = await request.json(); } catch { return failure(400, 'invalid_request', 'The pairing request is not valid JSON.'); }
    if (typeof body !== 'object' || body === null || (body as { execute?: unknown }).execute !== undefined && typeof (body as { execute?: unknown }).execute !== 'boolean') {
      return failure(400, 'invalid_request', 'The pairing request is invalid.');
    }
    const execute = (body as { execute?: boolean }).execute === true;
    await mkdir(invitations, { recursive: true, mode: 0o700 });
    const file = join(invitations, `ui-${randomUUID()}.json`);
    try {
      const result = await run(options.transport === 'tailcat'
        ? ['pair', '--config', options.configPath, '--tailcat', '--read', 'all', ...(execute ? ['--execute', 'all'] : []), '--output', file]
        : ['pair', '--config', options.configPath, '--read', 'all', ...(execute ? ['--execute', 'all'] : []), '--url', options.publicUrl ?? '', '--output', file]);
      if (result.code !== 0) return failure(503, 'unavailable', 'Pairing could not start. Check that this Mac can reach Tailcat, then try again.');
      const invitation = JSON.parse(await readFile(file, 'utf8')) as { expiresAt?: unknown };
      const rendered = await invitationQrSvg(invitation);
      return json(200, { svg: rendered.svg, version: rendered.version, expiresAt: typeof invitation.expiresAt === 'number' ? invitation.expiresAt : Date.now() + 120_000 });
    } catch {
      return failure(503, 'unavailable', 'Pairing could not start. Check that this Mac can reach Tailcat, then try again.');
    } finally {
      await rm(file, { force: true });
    }
  };

  const revoke = async (request: Request): Promise<Response> => {
    let body: unknown;
    try { body = await request.json(); } catch { return failure(400, 'invalid_request', 'The revoke request is not valid JSON.'); }
    const deviceId = (body as { deviceId?: unknown })?.deviceId;
    if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) return failure(400, 'invalid_request', 'A device id is required.');
    const result = await run(['revoke', '--config', options.configPath, '--device', deviceId]);
    if (result.code !== 0) {
      return codeOf(result.error) === 'not_found' ? failure(404, 'not_found', 'That phone is not active.') : failure(503, 'unavailable', 'The phone could not be revoked.');
    }
    return json(200, { revoked: true });
  };

  return [
    { path: '/api/dsh-mobile/status', methods: ['GET'], requestBody: 'buffered', fetch: status },
    { path: '/api/dsh-mobile/devices', methods: ['GET'], requestBody: 'buffered', fetch: devices },
    { path: '/api/dsh-mobile/pair', methods: ['POST'], requestBody: 'buffered', fetch: pair },
    { path: '/api/dsh-mobile/revoke', methods: ['POST'], requestBody: 'buffered', fetch: revoke },
  ];
}
