#!/usr/bin/env node
import { lstat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadConfiguration, pairingInvitation, prepareConfiguration, validOpaqueId, validateBaseUrl } from './config.ts';
import type { LocalHostConfiguration } from './config.ts';
import { HostError, publicError } from './errors.ts';
import { HostState, hashSecret, isRequestId, validateGrants } from './state.ts';
import type { DeviceGrants } from './types.ts';
import { setupDirect, declaredDshVersion } from './setup-direct.ts';
import { privateDirectory, privatePath, privateWrite, privateRead, protectNewFile, assertPrivate as privateReadDirectory } from './private-files.ts';
import { terminalInvitationQr, encodeInvitationQr } from './qr.ts';
import { setupTailcat } from './setup-tailcat.ts';
import { TAILCAT_NORMAL_PORT, TAILCAT_PAIRING_PORT } from './tailcat-connector.ts';
import { serveLocalPairing } from './local-pairing.ts';
import type { LocalPairingOptions } from './local-pairing.ts';
import { isEntryPoint } from './entry-point.ts';

export interface AdminIo { out: (text: string) => void; error: (text: string) => void }
export interface AdminOptions {
  /** Programmatic tests only; CLI release never permits WS. */ allowInsecureRelayLoopback?: boolean;
  /** Programmatic tests only: same-Wi-Fi pairing seams (advertiser, operator answer, bind). */
  localPairing?: Partial<Pick<LocalPairingOptions, 'advertise' | 'confirm' | 'host' | 'onListening'>>;
  /** Programmatic tests only: how long pair --tailcat waits for the running companion. */
  tailcatWaitMs?: number;
}
/** Operator answer on the terminal; anything but y/yes denies. */
async function terminalConfirm(code: string, device: string, io: AdminIo): Promise<boolean> {
  io.error(`"${device}" wants to pair. Check that the phone shows code ${code}. Allow? [y/N] `);
  const { createInterface } = await import('node:readline');
  const reader = createInterface({ input: process.stdin, terminal: false });
  try { const answer = await new Promise<string>(resolve => reader.once('line', resolve).once('close', () => resolve(''))); return /^\s*y(es)?\s*$/i.test(answer); }
  finally { reader.close(); }
}
/** The plugin process owns the helper; the CLI asks through the state database (docs/TAILCAT.md). */
async function waitTailcatPairing(state: HostState, id: string, deadlineMs: number) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const request = state.tailcatPairingRequest(id);
    if (!request || request.status === 'failed') break;
    if (request.status === 'open' && request.address && request.clientKey && request.proof && request.expiresAt && request.expiresAt > Date.now() + 90_000) return request as Required<typeof request>;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new HostError('tailcat_unavailable');
}
async function invitationOutput(invitation: unknown, flags: Map<string, string | true>, configPath: string, io: AdminIo): Promise<void> {
  const qr = flags.get('--qr') === true;
  if (qr) encodeInvitationQr(invitation); // Validate protocol size before creating any fallback file.
  const output = flags.has('--output') ? value(flags, '--output') : undefined;
  if (output) {
    if (!isAbsolute(output)) throw new HostError('invalid_request');
    const path = await privatePath(output), invitations = await privatePath(join(dirname(configPath), 'invitations'));
    if (dirname(path) !== invitations) throw new HostError('unsafe_private_path');
    await privateDirectory(invitations);
    try { await privateWrite(path, JSON.stringify(invitation) + '\n'); }
    catch (error) { throw (error as NodeJS.ErrnoException).code === 'EEXIST' ? new HostError('invitation_output_exists') : error; }
    io.out('Private one-use invitation JSON written. Do not share it.\n');
  }
  if (qr) {
    io.error('Do not share this one-use pairing QR. No transcription, screenshot or log. After scanning, run Clear-Host and clear terminal scrollback. TTL is at most 15 minutes.\n');
    try {
      const rendered = await terminalInvitationQr(invitation);
      io.out(rendered.text);
      io.error(`QR version ${rendered.version}, correction M, ${rendered.characters} ASCII characters.\n`);
    } catch (error) {
      if (!output || !(error instanceof HostError) || error.code !== 'qr_too_large') throw error;
      io.error('Invitation exceeds QR capacity; use the private JSON file instead. Nothing was truncated.\n');
    }
  }
}
async function waitPublication(state: HostState, routeId: string, accessId: string): Promise<void> {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const publication = state.relayPublication(accessId);
    if (!publication || publication.revoked || publication.expiresAt <= Date.now()) throw new HostError('unavailable');
    const status = state.relayStatus(routeId);
    if (publication.published && publication.generation && status.connected && status.ready && status.generation === publication.generation && Date.now() - status.updatedAt <= 1000) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new HostError('unavailable');
}
const HELP = `DSH Anywhere local administration (no remote admin listener)\n\nsetup-tailcat --config <new-private-dir/host.json> [--port 19445] [--host-name <name>] [--dsh-version auto|<verified-version>]\n     (Tailcat transport v3: loopback companion, native TLS identity, no OpenSSL; see docs/TAILCAT.md)\npair --config <private.json> --tailcat --read all [--execute all] (--qr and/or --output <file> | --local)\n     (--local: same-Wi-Fi Bonjour pairing with a 6-digit code, macOS)\ntailcat-status --config <private.json>\nsetup-direct --config <new-private-dir/host.json> --host <DNS-or-IP> [--host <SAN>...]\n     [--port 19445] [--bind 0.0.0.0] [--dsh-version auto|<verified-version>] [--openssl <absolute executable>]\ninit --config <private.json> --workspace <directory> [--dev-http]\n     [--host-name <name>] [--bind <IP>] [--port <port>]\n     [--cert <PEM> --key <PEM>] [--url <HTTPS URL>] [--include-certificate]\npair --config <private.json> --read all|<ids> [--execute all|<ids>] [--ttl <seconds>] [--url <URL>] (--qr and/or --output <private-invitations/file.json>)\nremote-pair --config <private.json> --read all|<ids> [--execute all|<ids>] --output <private-invitations/file.json> [--qr]\ngrant --config <private.json> --device <id> --read all|<ids> [--execute all|<ids>]\nremote-status --config <private.json>\ndevices --config <private.json>\nrevoke --config <private.json> --device <id>\n\nRegistry mode accepts all only; explicit IDs require explicit-list mode.\nOmitted --execute means read-only, including grant replacement.\nPair requires explicit --qr and/or --output; remote-pair requires --output. No offer is created without opt-in.\nInvitation JSON is never printed to stdout. QR/private files contain one-use secrets; keep them private.\nsetup-direct requires OpenSSL 3 for P-256 X.509; Node 24 alone cannot create certificates.\nQR uses dshm1 zlib/base64url, correction M. No OS trust or networking is changed.\n`;
function argumentsFor(argv: string[]) {
  const command = argv[0] ?? 'help';
  const flags = new Map<string, string | true>();
  const hosts: string[] = [];
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!;
    if (flag === '--host' && command === 'setup-direct') { const host = argv[++index]; if (!host || host.startsWith('--')) throw new HostError('invalid_request'); hosts.push(host); continue; }
    if (!flag.startsWith('--') || flags.has(flag)) throw new HostError('invalid_request');
    if (['--dev-http', '--include-certificate', '--qr', '--tailcat', '--local'].includes(flag)) flags.set(flag, true);
    else { const value = argv[++index]; if (!value || value.startsWith('--')) throw new HostError('invalid_request'); flags.set(flag, value); }
  }
  return { command, flags, hosts };
}
function value(flags: Map<string, string | true>, flag: string, fallback?: string): string {
  const raw = flags.get(flag) ?? fallback;
  if (typeof raw !== 'string') throw new HostError('invalid_request');
  return raw;
}
function csv(raw: string): string[] {
  if (raw === 'all') return ['*'];
  if (!raw) return [];
  const ids = raw.split(',');
  if (ids.some(id => !validOpaqueId(id))) throw new HostError('invalid_request');
  return ids;
}

function selectedGrants(config: LocalHostConfiguration, flags: Map<string, string | true>): DeviceGrants {
  const read = value(flags, '--read'), execute = flags.has('--execute') ? value(flags, '--execute') : undefined;
  // Standalone admin has no Cordis context. Never read/guess private DSH registry storage.
  if (config.workspaceSource === 'dsh-registry' && (read !== 'all' || (execute !== undefined && execute !== 'all'))) throw new HostError('explicit_grants_unavailable');
  const grants = validateGrants({ readWorkspaceIds: csv(read), executeWorkspaceIds: csv(execute ?? '') });
  if (config.workspaceSource !== 'dsh-registry' && [...grants.readWorkspaceIds, ...grants.executeWorkspaceIds].some(id => id !== '*' && !config.workspaces?.some(workspace => workspace.id === id))) throw new HostError('invalid_request');
  return grants;
}

/** Public CLI seam for isolated tests. Pairing secrets require an explicit QR/private file; never starts a server or recovers active commands. */
export async function runAdminCli(argv: string[], io: AdminIo = { out: text => process.stdout.write(text), error: text => process.stderr.write(text) }, options: AdminOptions = {}): Promise<number> {
  let state: HostState | undefined;
  try {
    const { command, flags, hosts } = argumentsFor(argv);
    if (command === 'help' || command === '--help') { io.out(HELP); return 0; }
    const known = command === 'verify-config' || command === 'tailcat-status' ? ['--config'] : command === 'setup-tailcat' ? ['--config', '--port', '--host-name', '--dsh-version'] : command === 'setup-direct' ? ['--config', '--port', '--bind', '--host-name', '--dsh-version', '--openssl'] : command === 'init' ? ['--config', '--workspace', '--dev-http', '--host-name', '--bind', '--port', '--cert', '--key', '--url', '--include-certificate'] : command === 'pair' ? ['--config', '--read', '--execute', '--ttl', '--url', '--qr', '--output', '--tailcat', '--local'] : command === 'remote-pair' ? ['--config', '--read', '--execute', '--ttl', '--output', '--qr'] : command === 'grant' ? ['--config', '--device', '--read', '--execute'] : command === 'remote-status' ? ['--config'] : command === 'devices' ? ['--config'] : command === 'revoke' ? ['--config', '--device'] : [];
    if (!known.length || [...flags.keys()].some(flag => !known.includes(flag))) throw new HostError('invalid_request');
    // Refuse implicit secret output before loading config or creating state/offers/grants.
    if ((command === 'pair' && flags.get('--qr') !== true && !flags.has('--output') && flags.get('--local') !== true) || (flags.has('--local') && flags.get('--tailcat') !== true) || (command === 'remote-pair' && !flags.has('--output'))) throw new HostError('invitation_output_required');
    const configArgument = value(flags, '--config');
    if ((command === 'setup-direct' || command === 'setup-tailcat' || command === 'verify-config') && !isAbsolute(configArgument)) throw new HostError('unsafe_private_path');
    const configPath = resolve(configArgument);
    if (command === 'setup-direct') {
      const rawPort = value(flags, '--port', '19445');
      if (!/^\d{1,5}$/.test(rawPort)) throw new HostError('invalid_request');
      const result = await setupDirect({ configPath, hosts, port: Number(rawPort), bind: value(flags, '--bind', '0.0.0.0'), hostName: value(flags, '--host-name', 'DSH Anywhere companion'), dshVersion: value(flags, '--dsh-version', 'auto'), ...(flags.has('--openssl') ? { openssl: value(flags, '--openssl') } : {}) });
      io.out(JSON.stringify({ ...result, workspaceSource: 'dsh-registry', message: 'Private configuration verified. No listener, firewall, OS trust or DSH profile changed.' }) + '\n'); return 0;
    }
    if (command === 'setup-tailcat') {
      const rawPort = value(flags, '--port', '19445');
      if (!/^\d{1,5}$/.test(rawPort)) throw new HostError('invalid_request');
      const result = await setupTailcat({ configPath, port: Number(rawPort), dshVersion: value(flags, '--dsh-version', 'auto'), ...(flags.has('--host-name') ? { hostName: value(flags, '--host-name') } : {}) });
      io.out(JSON.stringify({ ...result, transport: 'tailcat', workspaceSource: 'dsh-registry', message: 'Private configuration verified. No listener, firewall, OS trust or DSH profile changed.' }) + '\n'); return 0;
    }
    if (command === 'init') {
      const devHttp = flags.get('--dev-http') === true;
      const rawPort = value(flags, '--port', '9443');
      if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new HostError('invalid_request');
      const cert = flags.get('--cert'), key = flags.get('--key');
      if ((cert && !key) || (key && !cert) || (devHttp && (cert || key))) throw new HostError('invalid_request');
      const candidate: LocalHostConfiguration = {
        hostName: value(flags, '--host-name', 'DSH Anywhere'), bind: value(flags, '--bind', '127.0.0.1'), port: Number(rawPort),
        statePath: join(dirname(configPath), 'state', 'host.sqlite'),
        workspaces: [{ id: 'default', name: 'Default workspace', path: resolve(value(flags, '--workspace')) }],
        ...(devHttp ? { allowInsecureLoopback: true } : {}),
        ...(typeof cert === 'string' && typeof key === 'string' ? { tls: { certPath: resolve(cert), keyPath: resolve(key) } } : {}),
        ...(flags.get('--url') ? { publicUrl: value(flags, '--url') } : devHttp ? { publicUrl: `http://127.0.0.1:${rawPort}` } : {}),
        ...(flags.get('--include-certificate') === true ? { includeCertificatePem: true } : {}),
      };
      if (candidate.includeCertificatePem && !candidate.tls) throw new HostError('invalid_config');
      const prepared = await prepareConfiguration(candidate);
      // Owner-only ACLs on Windows too (POSIX modes alone are ignored there). A new directory is created
      // private; an existing one is left as configured, but the written config file itself is protected.
      try { await lstat(dirname(configPath)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await privateDirectory(dirname(configPath)); }
      await writeFile(configPath, JSON.stringify(prepared.config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await protectNewFile(configPath);
      state = new HostState(prepared.config.statePath);
      io.out('Private configuration and state initialized. No server or network was changed.\n'); return 0;
    }
    if (command === 'verify-config') {
      const raw = JSON.parse(await privateRead(configPath)) as LocalHostConfiguration;
      if (raw.dshVersion) declaredDshVersion(raw.dshVersion);
      if (!raw.tls) throw new HostError('invalid_config');
      await privateRead(raw.tls.keyPath); await privateRead(raw.tls.certPath);
      await privatePath(raw.statePath); await privateReadDirectory(dirname(raw.statePath));
      const checked = await prepareConfiguration(raw);
      io.out(JSON.stringify({ valid: true, baseUrl: checked.config.publicUrl, workspaceSource: checked.config.workspaceSource ?? 'explicit', port: checked.config.port }) + '\n'); return 0;
    }
    const config = await loadConfiguration(configPath, { administrationOnly: command === 'devices' || command === 'revoke' || command === 'remote-status' || command === 'tailcat-status' || command === 'grant', allowInsecureRelayLoopback: options.allowInsecureRelayLoopback === true });
    if (!isAbsolute(config.statePath)) throw new HostError('invalid_config');
    state = new HostState(config.statePath);
    if (command === 'tailcat-status') {
      if (!config.tailcat) throw new HostError('invalid_config');
      const snapshot = state.tailcatSnapshot(), counts = state.tailcatClientCounts();
      // Address and counts only: never the node state, keys or allowlist entries.
      io.out(JSON.stringify({ transport: 'tailcat', running: snapshot.running, address: snapshot.address, allowedClients: snapshot.allowedClients.length, pairedPhones: counts.linked, pendingPhones: counts.pending, updatedAt: snapshot.updatedAt, stale: Date.now() - snapshot.updatedAt > 10_000 }) + '\n'); return 0;
    }
    if (command === 'remote-status') {
      if (!config.relay) {
        io.out(JSON.stringify({ mode: 'direct', baseUrl: config.publicUrl, bind: config.bind, port: config.port, workspaceSource: config.workspaceSource ?? 'explicit', message: 'Configuration only; use Get-NetTCPConnection to verify listener readiness.' }) + '\n'); return 0;
      }
      const status = state.relayStatus(config.relay.routeId);
      io.out(JSON.stringify({ routeId: config.relay.routeId, ...status, stale: Date.now() - status.updatedAt > 3000 }) + '\n'); return 0;
    }
    if (command === 'remote-pair') {
      if (!config.relay) throw new HostError('invalid_config');
      const grants = selectedGrants(config, flags);
      const seconds = value(flags, '--ttl', '900');
      if (!/^\d+$/.test(seconds) || Number(seconds) < 1 || Number(seconds) > 900) throw new HostError('invalid_request');
      const output = value(flags, '--output');
      if (!isAbsolute(output)) throw new HostError('invalid_request');
      const prepared = await prepareConfiguration(config, { allowInsecureRelayLoopback: options.allowInsecureRelayLoopback === true });
      const offer = state.createRemotePairing(grants, config.relay.routeId, Number(seconds) * 1000);
      try {
        await waitPublication(state, config.relay.routeId, offer.relayAccess.accessId);
        const invitation = { ...pairingInvitation(prepared, offer.pairingToken), version: 2, expiresAt: offer.expiresAt, relay: { url: config.relay.url, routeId: config.relay.routeId, accessId: offer.relayAccess.accessId, accessToken: offer.relayAccess.accessToken } };
        await invitationOutput(invitation, flags, configPath, io);
      } catch { state.revokeRelayGrant(offer.relayAccess.accessId); throw new HostError('unavailable'); }
      io.out('Private remote invitation written after relay publication acknowledgement.\n'); return 0;
    }
    if (command === 'pair' && flags.get('--tailcat') === true) {
      if (!config.tailcat || flags.has('--url')) throw new HostError('invalid_config');
      const grants = selectedGrants(config, flags);
      const seconds = value(flags, '--ttl', '300');
      if (!/^\d+$/.test(seconds) || Number(seconds) < 1 || Number(seconds) > 900) throw new HostError('invalid_request');
      const prepared = await prepareConfiguration(config);
      pairingInvitation(prepared, ''); // Validate pin/trust before issuing an offer.
      // A one-use file is never overwritten; refuse before opening a window the phone could never use.
      if (flags.has('--output') && existsSync(value(flags, '--output'))) throw new HostError('invitation_output_exists');
      const offer = state.createPairing(grants, Number(seconds) * 1000);
      const template = { ...pairingInvitation(prepared, offer.pairingToken), version: 4, tailcat: { address: '$TAILCAT_ADDRESS', port: TAILCAT_NORMAL_PORT } };
      const requestId = state.requestTailcatPairing(hashSecret(offer.pairingToken), offer.expiresAt, JSON.stringify(template));
      try {
        const window = await waitTailcatPairing(state, requestId, options.tailcatWaitMs ?? 20_000);
        const expiresAt = Math.min(window.expiresAt, offer.expiresAt);
        const bootstrap = { version: 1, expiresAt,
          tailcat: { address: window.address, port: TAILCAT_PAIRING_PORT, key: window.clientKey, proof: window.proof } };
        state.forgetTailcatPairing(requestId);
        if (flags.get('--local') === true) {
          io.error(`Same-Wi-Fi pairing open until ${new Date(expiresAt).toLocaleTimeString()}. On the phone choose "Find computer on this Wi-Fi".\n`);
          await serveLocalPairing({ invitation: JSON.stringify(bootstrap), expiresAt, serviceName: config.hostName,
            confirm: options.localPairing?.confirm ?? ((code, device) => terminalConfirm(code, device, io)),
            ...(options.localPairing?.advertise ? { advertise: options.localPairing.advertise } : {}),
            ...(options.localPairing?.host ? { host: options.localPairing.host } : {}),
            ...(options.localPairing?.onListening ? { onListening: options.localPairing.onListening } : {}) });
          io.out('Invitation sent to the approved phone. It finishes pairing over Tailcat.\n');
        } else await invitationOutput(bootstrap, flags, configPath, io);
      } catch (error) {
        state.forgetTailcatPairing(requestId); state.cancelPairing(offer.pairingToken);
        throw error instanceof HostError ? error : new HostError('tailcat_unavailable');
      }
      return 0;
    }
    if (command === 'pair') {
      const grants = selectedGrants(config, flags);
      const seconds = value(flags, '--ttl', '300');
      if (!/^\d+$/.test(seconds) || Number(seconds) < 1 || Number(seconds) > 900) throw new HostError('invalid_request');
      const prepared = await prepareConfiguration(config);
      const url = flags.get('--url') ? value(flags, '--url') : config.publicUrl;
      if (url) validateBaseUrl(url, config.allowInsecureLoopback === true);
      // Validate URL/pin/trust before issuing an offer, avoiding orphan offers on bad configuration.
      pairingInvitation(prepared, '', url);
      const offer = state.createPairing(grants, Number(seconds) * 1000);
      await invitationOutput(pairingInvitation(prepared, offer.pairingToken, url), flags, configPath, io); return 0;
    }
    if (command === 'devices') { io.out(JSON.stringify({ items: state.listDevices() }) + '\n'); return 0; }
    const deviceId = value(flags, '--device');
    if (!isRequestId(deviceId)) throw new HostError('invalid_request');
    if (command === 'grant') {
      const device = state.replaceDeviceGrants(deviceId, selectedGrants(config, flags));
      io.out(JSON.stringify({ deviceId: device.deviceId, grants: device.grants }) + '\n'); return 0;
    }
    if (!state.revokeDevice(deviceId)) throw new HostError('not_found');
    io.out('Device revoked. Existing observation connections will close within one second.\n'); return 0;
  } catch (error) {
    const safe = publicError(error);
    io.error(`${safe.code}: ${safe.message}\n`); return 1;
  } finally { state?.close(); }
}
if (isEntryPoint(import.meta.url)) process.exitCode = await runAdminCli(process.argv.slice(2));
