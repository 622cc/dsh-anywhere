// Live end-to-end check (tools/tailcat-e2e.sh): the real Go helper, the real companion server and the
// reference phone (tailcat/e2e/phone) pair and read over real Tailcat/DERP. Needs network access.
// Not a *.test.ts file: npm test never runs it. Prints statuses only, never keys or tokens.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdminCli } from '../src/cli.ts';
import { startHostServer } from '../src/server.ts';
import { createWorkspaceSource } from '../src/workspace-source.ts';
import type { HostAdapter, HostConfiguration } from '../src/types.ts';
const [helperPath, phonePath] = process.argv.slice(2);
const adapter: HostAdapter = { upstreamVersion: 'e2e', async listPresets() { return []; }, async listSessions() { return []; },
  async snapshot() { throw new Error('none'); }, async *watch() {}, async createSession() { return { sessionId: 'x' }; }, async prompt() {}, async cancel() {} };
const registryService: any = { list: () => [], archivedSessionIds: [] };
const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-e2e-'))), configPath = join(dir, 'companion', 'host.json');
const io = { out: (s: string) => process.stdout.write('[cli] ' + s.replace(/"(key|proof|pairingToken)":"[^"]+"/g, '"$1":"…"')), error: (s: string) => process.stderr.write('[cli!] ' + s) };
if (await runAdminCli(['setup-tailcat', '--config', configPath, '--dsh-version', '0.2.1-alpha.1', '--port', '19555'], io) !== 0) throw new Error('setup failed');
const raw = JSON.parse(readFileSync(configPath, 'utf8'));
raw.tailcat.helperPath = helperPath; writeFileSync(configPath, JSON.stringify(raw, null, 2));
const host = await startHostServer({ config: raw as HostConfiguration, adapter, workspaceSource: await createWorkspaceSource({ workspaceSource: 'dsh-registry' }, () => registryService) });
const started = Date.now();
while (!host.tailcat?.status().ready) { if (Date.now() - started > 60_000) throw new Error('helper never ready: ' + JSON.stringify(host.tailcat?.status())); await new Promise(r => setTimeout(r, 250)); }
console.log('[host] helper ready', JSON.stringify({ ...host.tailcat.status(), address: host.tailcat.status().address ? 'tc…' : '' }));
const output = join(dir, 'companion', 'invitations', 'phone.json');
const paired = await runAdminCli(['pair', '--config', configPath, '--tailcat', '--read', 'all', '--execute', 'all', '--output', output], io);
console.log('[host] pair exit', paired);
if (paired !== 0) { await host.close(); process.exit(1); }
const code = await new Promise<number>(resolve => { const child = spawn(phonePath!, ['--invitation', output], { stdio: 'inherit' }); child.on('exit', c => resolve(c ?? 1)); });
console.log('[host] phone exit', code, 'clients', JSON.stringify(host.state.tailcatClientCounts()), 'status', JSON.stringify({ ...host.tailcat.status(), address: 'tc…' }));
await host.close(); process.exit(code);
