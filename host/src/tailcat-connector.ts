import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostError } from './errors.ts';
import { TAILCAT_CLIENT } from './state.ts';
import type { HostState, TailcatPairingRequest } from './state.ts';
import type { TailcatConfiguration } from './types.ts';

/** Helper IPC v3, docs/TAILCAT.md. stdout is private typed IPC; nothing from it is logged. */
export const TAILCAT_IPC_VERSION = 3;
export const TAILCAT_PAIRING_PORT = 48932;
export const TAILCAT_NORMAL_PORT = 48931;
const MAX_LINE = 64 * 1024;
const ADDRESS = /^tc[\x21-\x7e]{1,2046}$/, PRIVATE_KEY = /^privkey:[0-9a-f]{64}$/, PROOF = /^[A-Za-z0-9_-]{43}$/;
const EVENT_FIELDS: Record<string, string[]> = {
  ready: ['address'], persist: ['id', 'state', 'allowedClients'], pairing: ['address', 'port', 'key', 'proof', 'expiresAt'],
  paired: ['address', 'client'], pairingClosed: [], error: ['code'],
};

export interface TailcatHelperCommand { command: string; args: string[] }
export interface TailcatConnectorOptions {
  tailcat: TailcatConfiguration; state: HostState; targetPort: number; hostName: string;
  /** Programmatic tests only: run a fake helper instead of the bundled binary. */
  helper?: TailcatHelperCommand;
  pollMs?: number; sweepMs?: number;
}
export interface TailcatConnectorStatus { running: boolean; ready: boolean; address: string; allowedClients: number; restarts: number }
export interface TailcatConnector { start(): void; close(): Promise<void>; sweep(): void; status(): TailcatConnectorStatus }

/** Bundled helper next to the built plugin: dist/tailcat/dsh-tailcat-host-<goos>-<goarch>[.exe]. */
export function bundledTailcatHelper(base = dirname(fileURLToPath(import.meta.url))): string {
  const goos = process.platform === 'win32' ? 'windows' : process.platform;
  const goarch = process.arch === 'x64' ? 'amd64' : process.arch;
  return join(base, 'tailcat', `dsh-tailcat-host-${goos}-${goarch}${process.platform === 'win32' ? '.exe' : ''}`);
}
export function tailcatHelperCommand(tailcat: TailcatConfiguration): TailcatHelperCommand {
  const command = tailcat.helperPath ?? bundledTailcatHelper();
  if (!existsSync(command)) throw new HostError('tailcat_helper_missing');
  return { command, args: [] };
}

/** Owns one helper process; the helper's only TCP destination is 127.0.0.1:targetPort. */
export function createTailcatConnector(options: TailcatConnectorOptions): TailcatConnector {
  const { state, targetPort } = options;
  if (!Number.isInteger(targetPort) || targetPort < 1024 || targetPort > 65534) throw new HostError('invalid_config');
  const helper = options.helper ?? tailcatHelperCommand(options.tailcat);
  const name = [...options.hostName.trim()].slice(0, 64).join('') || 'DSH Anywhere';
  let child: ChildProcess | undefined, buffer = '', closed = false, started = false, ready = false, address = '', restarts = 0, backoff = 1000;
  let poll: ReturnType<typeof setInterval> | undefined, sweeper: ReturnType<typeof setInterval> | undefined, restartTimer: ReturnType<typeof setTimeout> | undefined;
  // Helper-side allowlist as last persisted; the database is authoritative for what it should be.
  let helperAllowed: string[] = [], allowedInFlight: string | undefined;
  let active: (TailcatPairingRequest & { windowExpiresAt?: number }) | undefined;

  function write(value: unknown) {
    if (!child?.stdin?.writable) return;
    child.stdin.write(JSON.stringify(value) + '\n');
  }
  function activePairing() {
    return active && (active.windowExpiresAt === undefined || active.windowExpiresAt > Date.now()) ? { pairingHash: active.pairingHash, offerExpiresAt: active.offerExpiresAt } : undefined;
  }
  function handle(event: Record<string, unknown>) {
    const kind = event.event;
    if (typeof kind !== 'string' || !EVENT_FIELDS[kind]) return;
    const fields = EVENT_FIELDS[kind]!;
    if (Object.keys(event).length !== fields.length + 1 || fields.some(field => !(field in event))) return;
    if (kind === 'ready' && typeof event.address === 'string' && (event.address === '' || ADDRESS.test(event.address))) {
      ready = true; address = event.address; state.updateTailcatStatus(address, true); sweep();
    } else if (kind === 'persist' && typeof event.id === 'string' && event.id.length <= 32) {
      let ok = false;
      try {
        const allowed = event.allowedClients as string[];
        // Commit before acknowledging: the helper treats ack as durable.
        state.persistTailcat(event.state as string | null, allowed, activePairing());
        helperAllowed = [...allowed].sort(); allowedInFlight = undefined; ok = true;
      } catch { ok = false; }
      write({ command: 'ack', id: event.id, ok });
    } else if (kind === 'pairing' && active && typeof event.address === 'string' && ADDRESS.test(event.address) && event.port === TAILCAT_PAIRING_PORT &&
        typeof event.key === 'string' && PRIVATE_KEY.test(event.key) && typeof event.proof === 'string' && PROOF.test(event.proof) &&
        Number.isSafeInteger(event.expiresAt) && (event.expiresAt as number) * 1000 > Date.now()) {
      const expiresAt = (event.expiresAt as number) * 1000;
      if (state.openTailcatPairing(active.id, event.address, event.key, event.proof, expiresAt)) active.windowExpiresAt = expiresAt;
      else active = undefined;
    } else if (kind === 'paired' && typeof event.client === 'string' && TAILCAT_CLIENT.test(event.client) && typeof event.address === 'string' && ADDRESS.test(event.address)) {
      try { state.recordTailcatPaired(event.client, activePairing()); } catch { /* invalid key: sweep removes it */ }
      address = event.address; state.updateTailcatStatus(address, true);
    } else if (kind === 'pairingClosed') {
      if (active?.windowExpiresAt === undefined && active) state.failTailcatPairing(active.id);
      active = undefined;
    } else if (kind === 'error') {
      // Fixed vocabulary only; a failed pair request releases the CLI waiter now.
      if (active && active.windowExpiresAt === undefined) { state.failTailcatPairing(active.id); active = undefined; }
      allowedInFlight = undefined;
    }
  }
  function launch() {
    if (closed) return;
    let proc: ChildProcess;
    const env = process.platform === 'darwin' ? { ...process.env, SSL_CERT_FILE: process.env.SSL_CERT_FILE || '/etc/ssl/cert.pem' } : process.env;
    try { proc = spawn(helper.command, helper.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env }); }
    catch { scheduleRestart(); return; }
    child = proc; buffer = ''; ready = false; allowedInFlight = undefined; active = undefined;
    proc.on('error', () => {});
    proc.stdin?.on('error', () => {});
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      if (child !== proc) return;
      buffer += chunk;
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try { const value = JSON.parse(line) as unknown; if (value && typeof value === 'object' && !Array.isArray(value)) handle(value as Record<string, unknown>); }
        catch { /* malformed IPC is dropped, never echoed */ }
      }
      if (buffer.length > MAX_LINE) proc.kill();
    });
    proc.on('exit', () => {
      if (child !== proc) return;
      child = undefined; ready = false;
      if (active) { state.failTailcatPairing(active.id); active = undefined; }
      if (!closed) { state.updateTailcatStatus(null, false); scheduleRestart(); }
    });
    const snapshot = state.tailcatSnapshot(), allowed = state.tailcatAllowedClients();
    helperAllowed = [...allowed];
    write({ version: TAILCAT_IPC_VERSION, localPort: targetPort, state: snapshot.state, allowedClients: allowed, name });
  }
  function scheduleRestart() {
    if (closed || restartTimer) return;
    restarts++;
    restartTimer = setTimeout(() => { restartTimer = undefined; launch(); }, backoff); restartTimer.unref();
    backoff = Math.min(backoff * 2, 30_000);
  }
  function servicePairing() {
    if (!ready || closed) return;
    if (active?.windowExpiresAt !== undefined && active.windowExpiresAt <= Date.now()) active = undefined;
    const next = state.nextTailcatPairingRequest();
    if (!next || next.id === active?.id) return;
    // One window at a time; a newer request replaces an older open window, as `pair` does in the helper.
    if (active && active.windowExpiresAt === undefined) return;
    active = next; write({ command: 'pair', invitation: next.template ?? '' });
  }
  function sweep() {
    if (closed) return;
    let desired: string[];
    try { desired = state.tailcatAllowedClients(); } catch { return; }
    if (ready) { backoff = 1000; state.updateTailcatStatus(address, true); }
    const serialized = JSON.stringify(desired);
    if (!ready || allowedInFlight === serialized || serialized === JSON.stringify(helperAllowed)) return;
    allowedInFlight = serialized; write({ command: 'setAllowed', allowedClients: desired });
  }
  return {
    start() {
      if (started || closed) return; started = true;
      launch();
      poll = setInterval(servicePairing, options.pollMs ?? 250); poll.unref();
      sweeper = setInterval(sweep, options.sweepMs ?? 2000); sweeper.unref();
    },
    sweep,
    status: () => ({ running: child !== undefined, ready, address, allowedClients: helperAllowed.length, restarts }),
    async close() {
      if (closed) return; closed = true;
      if (poll) clearInterval(poll); if (sweeper) clearInterval(sweeper); if (restartTimer) clearTimeout(restartTimer);
      const proc = child; child = undefined;
      if (active) { try { state.failTailcatPairing(active.id); } catch { /* closed state */ } active = undefined; }
      try { state.updateTailcatStatus(null, false); } catch { /* closed state */ }
      if (!proc || proc.exitCode !== null) return;
      // Closing stdin is the helper's stop signal; kill only a helper that ignores it.
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { proc.kill(); resolve(); }, 3000); timer.unref();
        proc.once('exit', () => { clearTimeout(timer); resolve(); });
        proc.stdin?.end();
      });
    },
  };
}
