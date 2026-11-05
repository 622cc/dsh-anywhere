import { randomBytes } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { prepareConfiguration } from './config.ts';
import type { LocalHostConfiguration } from './config.ts';
import { HostError } from './errors.ts';
import { assertPrivate, privateDirectory, privatePath, privateRead, privateWrite } from './private-files.ts';
import { declaredDshVersion } from './setup-direct.ts';
import { generateServerIdentity } from './x509.ts';

export interface TailcatSetupOptions { configPath: string; port?: number; hostName?: string; dshVersion?: string }
/** Creates no listener, firewall rule, trust root, DSH session or profile change. Never rotates an identity. */
export async function setupTailcat(options: TailcatSetupOptions): Promise<{ baseUrl: string; port: number; dshVersion: string; existing: boolean }> {
  const version = declaredDshVersion(options.dshVersion), port = options.port ?? 19445;
  if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new HostError('invalid_request');
  const configPath = await privatePath(options.configPath), dir = dirname(configPath);
  let exists = false;
  try { await lstat(configPath); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (exists) {
    const raw = JSON.parse(await privateRead(configPath)) as LocalHostConfiguration;
    if (raw.dshVersion !== version || raw.workspaceSource !== 'dsh-registry' || !raw.tailcat || raw.relay || raw.port !== port || !raw.tls ||
        raw.statePath !== join(dir, 'state', 'host.sqlite') || (options.hostName !== undefined && raw.hostName !== options.hostName.trim())) throw new HostError('invalid_config');
    await assertPrivate(raw.tls.keyPath); await assertPrivate(raw.tls.certPath);
    const prepared = await prepareConfiguration(raw);
    return { baseUrl: prepared.config.publicUrl!, port, dshVersion: version, existing: true };
  }
  // Never generate over partial state; preserve failures for explicit owner recovery.
  for (const name of ['tls-key.pem', 'tls-cert.pem', 'state', 'invitations']) {
    try { await lstat(join(dir, name)); throw new HostError('invalid_config'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const hostId = randomBytes(16).toString('hex'), identity = generateServerIdentity(`h-${hostId}.dsh.invalid`);
  await privateDirectory(dir); await privateDirectory(join(dir, 'state')); await privateDirectory(join(dir, 'invitations'));
  const certPath = join(dir, 'tls-cert.pem'), keyPath = join(dir, 'tls-key.pem');
  await privateWrite(keyPath, identity.keyPem); await privateWrite(certPath, identity.certPem);
  const raw: LocalHostConfiguration = { dshVersion: version, hostName: (options.hostName ?? 'DSH Anywhere companion').trim(), workspaceSource: 'dsh-registry', bind: '127.0.0.1', port,
    statePath: join(dir, 'state', 'host.sqlite'), tls: { certPath, keyPath }, tailcat: { enabled: true, hostId }, includeCertificatePem: true };
  const prepared = await prepareConfiguration(raw);
  if (prepared.pinSha256 !== identity.pinSha256) throw new HostError('invalid_config');
  await privateWrite(configPath, JSON.stringify({ ...prepared.config, dshVersion: version, workspaces: undefined }, null, 2) + '\n');
  return { baseUrl: prepared.config.publicUrl!, port, dshVersion: version, existing: false };
}
