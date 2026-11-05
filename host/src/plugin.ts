import { HOST_VERSION } from './phone.ts';
import { createQuestionBridge } from './question-bridge.ts';
import type { QuestionServices } from './question-bridge.ts';
import type { DshAdapterOptions } from './dsh-adapter.ts';
import { createDshAdapter } from './dsh-adapter.ts';
import type { DshAgentPresets, DshEvents, DshSessionController } from './dsh-adapter.ts';
import { HostError } from './errors.ts';
import { loadConfiguration } from './config.ts';
import { dirname, isAbsolute, join } from 'node:path';
import { startHostServer } from './server.ts';
import { createMobileAdminRoutes } from './admin.ts';
import type { MobileAdminRoute } from './admin.ts';
import type { HostConfiguration } from './types.ts';
import { createWorkspaceSource } from './workspace-source.ts';
import type { DshWorkspaceRegistry } from './workspace-source.ts';
import { runningSubagentCounts } from './running-subagents.ts';
import type { LiveAgent, LiveSession } from './running-subagents.ts';
import { createDshRelay } from './dsh-relay.ts';
import type { DshRelay } from './dsh-relay.ts';
import { createUiModules, uiTool } from './ui-modules.ts';
import { lifecycleLog } from './lifecycle-log.ts';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isCompatibleDshVersion } from './compatibility.ts';
import { setupTailcat } from './setup-tailcat.ts';
import { defaultConfigPath, legacyCompanionActive, runningDshVersion } from './zero-config.ts';
import type { ProfileFacts } from './zero-config.ts';

/** Configuration is deliberately explicit and owner-local, never supplied by a mobile client. */
/** `generativeUi`: give every DSH agent the show_interface tool (ui-modules.ts); off unless the profile block sets it.
 * `nsh`: the NSH that builds those interfaces, the one the phone app runs (their APIs differ between versions). */
export type Config = ((HostConfiguration & { dshVersion: string; configPath?: never }) | { dshVersion: string; configPath: string }) & { generativeUi?: boolean; nsh?: string };
/** The bundle row (tools/pack-bundle.mjs): no configPath and no dshVersion. The companion uses the private path
 * install-host uses, creates the Tailcat configuration there on first start, and runs as the running DSH's version. */
export type BundleConfig = { generativeUi?: boolean; nsh?: string };
function isBundleRow(config: unknown): config is BundleConfig | undefined | null {
  return config === undefined || config === null || (typeof config === 'object' && !Array.isArray(config) && Object.keys(config).every(key => key === 'generativeUi' || key === 'nsh'));
}
/** Structural Cordis context avoids importing or vendoring DSH's service graph. */
export interface HostConnection {
  readonly fetch?: { register(route: MobileAdminRoute): () => Promise<void> };
  /** DSH's own sign-in URL for a local client, as the Desktop host builds it (dsh-desktop-host). */
  authenticatedUrl?(baseUrl: string): string;
}
/** DSH's web server: protocol and the OS-assigned port, read at use time (they change per launch). */
export interface HostWebServer { readonly protocol: string; readonly port: number | undefined }
export interface CompanionContext {
  sessionController: DshSessionController;
  agentPresets?: DshAgentPresets;
  fileUploads?: DshAdapterOptions['fileUploads'];
  attachments?: DshAdapterOptions['attachments'];
  userQuestions?: QuestionServices;
  llm?: { resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{ inputModalities?: readonly string[] }> };
  /** Inspected live state only, never used to authorize cwd or promote a Session. */
  sessions?: { get(id: string): LiveSession | undefined; list(): LiveSession[] };
  agents?: { get(id: string): LiveAgent | undefined; list(): LiveAgent[] };
  /** Public rc.2 header-only persistence observation; no event-log decoding. */
  sessionPersistence?: { stat(id: string, options?: { signal?: AbortSignal }): Promise<{ readonly header: unknown } | undefined> };
  /** Cordis 4.0.4 active lookup bypasses inject and returns fresh tracing proxies. */
  get?<K extends 'workspaceRegistry' | 'sessions' | 'agents' | 'sessionPersistence' | 'fileUploads' | 'attachments' | 'userQuestions' | 'llm' | 'profileContext'>(name: K): ({ workspaceRegistry: DshWorkspaceRegistry; sessions: NonNullable<CompanionContext['sessions']>; agents: NonNullable<CompanionContext['agents']>; sessionPersistence: NonNullable<CompanionContext['sessionPersistence']>; fileUploads: NonNullable<CompanionContext['fileUploads']>; attachments: NonNullable<CompanionContext['attachments']>; userQuestions: QuestionServices; llm: NonNullable<CompanionContext['llm']>; profileContext: ProfileFacts })[K] | undefined;
  on(name: string, listener: (...args: any[]) => any, options?: { global: boolean; prepend?: boolean }): () => unknown;
  /** Optional dynamic injection: the admin UI exists only when a Host Connection provides /api. */
  inject?(names: string[], callback: (ctx: CompanionContext & { connection?: HostConnection; webServer?: HostWebServer; tools?: { register(tool: unknown): () => unknown } }) => (() => unknown) | undefined): unknown;
}
export const name = 'dsh-mobile-companion';
export const version = HOST_VERSION;
// Inspected rc.2 Cordis has required-only injection; production Web composition
// supplies both services. The adapter itself permits a preset-free composition.
// workspaceRegistry is conditional: ctx.get() checks availability on every use;
// adding it to required inject would break legacy compositions without the service.
export const inject = ['sessionController', 'agentPresets'];

function eventBridge(ctx: CompanionContext): DshEvents {
  return {
    subscribeDisposed(listener) {
      return ctx.on('session/disposed', (session: { id?: string }) => { if (typeof session.id === 'string') listener(session.id); }, { global: true });
    },
    subscribeNotifications(listener) {
      return ctx.on('session/event', (session: { id?: string }, value: unknown) => {
        if (typeof session.id !== 'string' || !value || typeof value !== 'object') return;
        const e = value as Record<string, unknown>, d = e.data as Record<string, unknown> | undefined;
        listener(session.id, { type: e.type as string, seq: e.seq as number, time: e.time as number,
          ...(Number.isSafeInteger(d?.turn) ? { turn: d!.turn as number } : {}),
          ...(e.type === 'turn/end' ? { completed: !!d?.reason && (d.reason as { kind?: string }).kind === 'completed' } : {}) });
      }, { global: true });
    },
    subscribe(sessionId, listener) {
      const disposers: (() => unknown)[] = [];
      try {
        disposers.push(ctx.on('session/event', (session: { id?: string }, event: unknown) => {
          if (session.id === sessionId) listener({ type: 'event', event });
        }, { global: true }));
        disposers.push(ctx.on('agent/assistant-stream', (payload: { agent?: { session?: { id?: string; seq?: number } }; frame?: unknown }) => {
          if (payload.agent?.session?.id === sessionId) listener({ type: 'assistant-stream', frame: payload.frame });
        }, { global: true }));
        disposers.push(ctx.on('api-session/status', (id: string, running: boolean) => {
          if (id === sessionId) listener({ type: 'status', running });
        }, { global: true }));
      } catch { for (const dispose of disposers) dispose(); throw new HostError('unavailable'); }
      return () => { for (const dispose of disposers) dispose(); };
    },
  };
}

/** Promise<disposer> is the inspected Cordis startup effect shape: load awaits
 * startup; unload awaits the eventual disposer even if removal races startup. */
export async function apply(ctx: CompanionContext, input: Config | BundleConfig | undefined): Promise<() => Promise<void>> {
  const bundled = isBundleRow(input);
  // dshVersion is filled in below, once the running DSH's version is known.
  const config: Config = bundled ? { ...(input ?? {}), configPath: defaultConfigPath(), dshVersion: '' } : input as Config;
  let adapter: Awaited<ReturnType<typeof createDshAdapter>> | undefined;
  let questions: ReturnType<typeof createQuestionBridge> | undefined;
  const logDir = 'configPath' in config && typeof config.configPath === 'string' && isAbsolute(config.configPath) ? dirname(config.configPath) : undefined;
  const log = logDir ? lifecycleLog(logDir) : () => {};
  log('starting', HOST_VERSION);
  try {
    if (bundled) {
      const profile = ctx.get?.('profileContext');
      if (legacyCompanionActive(profile)) throw new HostError('companion_conflict');
      const version = runningDshVersion(profile);
      if (version === undefined || !isCompatibleDshVersion(version)) throw new HostError('unsupported_dsh_version');
      config.dshVersion = version;
      // Created once, like install-host's first run; an existing configuration is only loaded, never regenerated.
      if (!existsSync(config.configPath!)) await setupTailcat({ configPath: config.configPath!, dshVersion: version });
    }
    let hostConfig: HostConfiguration;
    if ('configPath' in config && config.configPath !== undefined) {
      if (!isAbsolute(config.configPath) || Object.keys(config).some(key => key !== 'configPath' && key !== 'dshVersion' && key !== 'generativeUi' && key !== 'nsh') || ('generativeUi' in config && typeof config.generativeUi !== 'boolean') || ('nsh' in config && (typeof config.nsh !== 'string' || !isAbsolute(config.nsh)))) throw new HostError('invalid_config');
      hostConfig = await loadConfiguration(config.configPath);
    } else hostConfig = config as HostConfiguration;
    const workspaceSource = await createWorkspaceSource(hostConfig, () => ctx.get?.('workspaceRegistry'));
    // Optional Cordis services must use get(): absent direct getters throw.
    const sessions = () => ctx.get ? ctx.get('sessions') : ctx.sessions;
    const agents = () => ctx.get ? ctx.get('agents') : ctx.agents;
    const persistence = () => ctx.get ? ctx.get('sessionPersistence') : ctx.sessionPersistence;
    const sessionHeader = persistence() ? async (id: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      const store = sessions(), backend = persistence();
      if (!backend) throw new HostError('unavailable');
      const live = store?.get(id);
      if (live) return live.header;
      const result = await backend.stat(id, { signal });
      signal.throwIfAborted();
      // Fresh proxies are normal; the backend's public identity survives them.
      const current = persistence();
      const identity = (service: NonNullable<typeof backend>) => Reflect.get(service, Symbol.for('cordis.original')) ?? service;
      if (!current || identity(current) !== identity(backend)) throw new HostError('unavailable');
      return sessions()?.get(id)?.header ?? result?.header;
    } : undefined;
    const sessionStatus = sessions() && agents() ? (id: string) => {
      const store = sessions(), registry = agents();
      if (!store || !registry) throw new HostError('unavailable');
      return { running: registry.get(id)?.status === 'running', updatedAt: store.get(id)?.header.createdAt ?? 0 };
    } : undefined;
    const fileUploads = ctx.get ? ctx.get('fileUploads') : ctx.fileUploads;
    const attachments = ctx.get ? ctx.get('attachments') : ctx.attachments;
    const userQuestions = ctx.get ? ctx.get('userQuestions') : ctx.userQuestions;
    const llm = ctx.get ? ctx.get('llm') : ctx.llm;
    if (userQuestions && ctx.sessionController.resolveAgent) questions = createQuestionBridge(listener => ctx.on('user-questions/request', listener, { global: true, prepend: true }));
    adapter = await createDshAdapter({ dshVersion: config.dshVersion, sessionController: ctx.sessionController,
      ...(fileUploads ? { fileUploads } : {}), ...(attachments ? { attachments } : {}),
      ...(llm ? { modelInfo: (provider, model, signal) => llm.resolveModelInfo(provider, model, signal) } : {}),
      ...(questions ? { questionBridge: questions, answerContinued: async (sessionId, callId, answer) => {
        const resolved = await ctx.sessionController.resolveAgent!(sessionId);
        if ('error' in resolved) throw resolved.error;
        return userQuestions!.answer(resolved.agent, callId, answer);
      } } : {}),
      ...(ctx.agentPresets ? { agentPresets: ctx.agentPresets } : {}), workspaceSource, events: eventBridge(ctx), ...(sessionHeader ? { sessionHeader } : {}),
      ...(sessionStatus ? { sessionStatus, runningSubagentCounts: () => {
        const store = sessions(), registry = agents();
        if (!store || !registry) throw new HostError('unavailable');
        return runningSubagentCounts(registry.list(), store.list());
      } } : {}) });
    const configPath = 'configPath' in config && typeof config.configPath === 'string' ? config.configPath : undefined;
    // A configured NSH is required, not preferred: building with another version gives the phone modules it cannot run.
    const nsh = config.nsh !== undefined ? (existsSync(config.nsh) ? config.nsh : undefined)
      : [process.env.NSH_BIN, join(homedir(), '.local/bin/nsh'), join(homedir(), '.nsh/bin/nsh'), '/opt/homebrew/bin/nsh', '/usr/local/bin/nsh'].find(path => path && existsSync(path));
    const ui = config.generativeUi && configPath && nsh ? createUiModules({ dir: join(dirname(configPath), 'ui'), nsh }) : undefined;
    // DSH's own protocol for the owner's phone, under /dsh on this server once DSH's web server is known (below).
    let dshRelay: DshRelay | undefined;
    const host = await startHostServer({ config: hostConfig, adapter, workspaceSource, dsh: () => dshRelay });
    if (configPath) ctx.inject?.(['connection'], connCtx => {
      const connection = connCtx.connection;
      if (!connection?.fetch?.register) return undefined;
      const record = hostConfig as unknown as Record<string, unknown>;
      const transport = record.tailcat ? 'tailcat' as const : 'direct' as const;
      const publicUrl = typeof record.publicUrl === 'string' ? record.publicUrl : undefined;
      const disposers = createMobileAdminRoutes({ configPath, dshVersion: config.dshVersion, transport, ...(publicUrl === undefined ? {} : { publicUrl }) }).map(route => connection.fetch!.register(route));
      return () => Promise.all(disposers.map(dispose => dispose()));
    });
    if (ui) ctx.inject?.(['tools'], toolsCtx => toolsCtx.tools?.register(uiTool(ui)));
    // DSH's own protocol for the owner's phone: the relay signs in exactly as the Desktop host does.
    ctx.inject?.(['connection', 'webServer'], webCtx => {
      const connection = webCtx.connection, web = webCtx.webServer;
      if (!connection?.authenticatedUrl || !web) return undefined;
      const origin = () => `${web.protocol}//127.0.0.1:${String(web.port)}`;
      const relay = createDshRelay({ upstream: () => ({ origin: origin(), loginUrl: connection.authenticatedUrl!(origin()) }), ...(ui ? { ui } : {}) });
      dshRelay = relay;
      return async () => { dshRelay = undefined; await relay.close(); };
    });
    let closed = false;
    log('running', HOST_VERSION);
    return async () => {
      if (closed) return; closed = true;
      log('stopping', HOST_VERSION);
      questions?.close(); adapter!.dispose();
      try { await host.close(); } catch { log('failed', HOST_VERSION, 'close'); throw new HostError('unavailable'); }
      log('stopped', HOST_VERSION);
    };
  } catch (error) {
    questions?.close(); adapter?.dispose();
    const failure = error instanceof HostError ? error : new HostError('invalid_config');
    log('failed', HOST_VERSION, failure.code);
    throw failure;
  }
}

export default { name, inject, apply };
