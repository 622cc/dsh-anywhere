// The link to the owner's computer lives in the native shell (Link.java: Tailcat, pinned TLS, the device token in the
// Android Keystore). The app only learns the bridge origin and the token to send.
import { computed, host, signal } from 'nsh'
import { Dsh, type ConnectionState, type DshError } from './dsh.ts'
import { Pending } from './events.ts'
import type { Check } from './reach.ts'
import { readable, S } from './strings.ts'
import { tryComputer, TRY_KEY, TRY_ORIGIN } from './tryit.ts'

export interface Settings { origin: string; key: string }
type LinkState = { paired: false } | { paired: true; origin: string; token: string }
export const settings = signal<Settings | null>(null)
export const loaded = signal(false)
export const linking = signal(false)
export const linkError = signal('')
/** On the sample of tryit.ts: no link, nothing leaves the phone, and nothing is kept for the next launch. */
export const trying = signal(false)
const socketState = signal<ConnectionState>('connecting')
/** Whether Android says the phone has a network (the shell's `network` event). The link runs inside a tunnel whose
 * connections outlive a network change, so the socket alone does not notice the phone going offline. */
export const network = signal(true)
export const reachState = (online: boolean, socket: ConnectionState): ConnectionState => (online ? socket : 'offline')
export const connection = computed(() => (trying() ? 'online' : reachState(network(), socketState())))
/** What each part last answered (reach.ts), when the next try is, and how the tunnel goes now, for the connection's state. */
export const check = signal<Check | undefined>(undefined)
export const retryAt = signal<number | undefined>(undefined)
export const routeText = signal('')
let client: Dsh | undefined
/** Approvals and questions the agent waits on, across chats; `asks` changes whenever they do. */
export const pending = new Pending()
export const asks = signal(0)
/** DSH's own news on $events (emit frames {event, args}): a chat started or stopped running (api-session/status
 * [sessionId, running]), a step or turn failed (api-session/error [sessionId, message]). `news` changes with each. */
export const news = signal(0)
export const turnErrors = new Map<string, string>()
/** Chats DSH said started running ('running'), and then stopped ('finished'), until the notifier's next look takes them. */
export const started = new Map<string, 'running' | 'finished'>()
export function heard(frame: unknown) {
  const f = frame as { type?: unknown; event?: unknown; args?: unknown } | undefined
  if (f?.type !== 'emit' || !Array.isArray(f.args)) return
  if (f.event === 'api-session/error' && typeof f.args[0] === 'string') turnErrors.set(f.args[0], typeof f.args[1] === 'string' ? f.args[1] : '')
  else if (f.event !== 'api-session/status') return
  else if (typeof f.args[0] === 'string') {
    if (f.args[1] === true) started.set(f.args[0], 'running')
    else if (started.get(f.args[0]) === 'running') started.set(f.args[0], 'finished')
  }
  news.update((n) => n + 1)
}
let stopEvents: (() => void) | undefined

export function dsh(): Dsh {
  const s = settings(); if (!s) throw new Error('not linked')
  if (!client || client.origin !== s.origin) {
    client?.close()
    const made: Dsh = client = new Dsh(s.origin, s.key, s.origin === TRY_ORIGIN ? tryComputer() : { onStuck: async () => {
      const next = await host.call<LinkState>('link.reset')
      if (next.paired && client === made) { made.origin = next.origin; settings.set({ origin: next.origin, key: next.token }) }
    } })
    client.onState = (c) => socketState.set(c)
    client.onRetryAt = (at) => retryAt.set(at)
    stopEvents = client.stream('$events', {}, (frame) => { heard(frame); pending.apply(frame); asks.update((n) => n + 1) })
  }
  return client
}
const adopt = (state: LinkState, sample = false) => { trying.set(sample); stopEvents?.(); client?.close(); client = undefined; pending.apply({ type: 'ready', clientId: '' }); asks.update((n) => n + 1); check.set(undefined); retryAt.set(undefined); routeText.set(''); lastLook = 0; settings.set(state.paired ? { origin: state.origin, key: state.token } : null) }

/** Whether the app is on screen (the shell's app.state); true where the shell does not say. */
export const appActive = signal(true)
/** The person asked to try the computer again now. */
export function reconnect() { client?.retryNow(); lastLook = 0 }

// While the connection fails: which part answers. While it works: how long an answer takes and how it goes. Only on screen.
const FAILING_MS = 15_000, WORKING_MS = 30_000, GRACE_MS = 3_000
let lastLook = 0, looking = false, failingSince = 0
async function look() {
  if (looking || !settings() || trying()) return
  looking = true; lastLook = Date.now()
  try {
    if (connection() === 'online') {
      const asked = Date.now()
      const access = await askComputer()
      check.set({ access, ...(access === 'ok' ? { latencyMs: Date.now() - asked } : {}) })
      const r = await host.call<{ route?: string; relay?: string }>('link.path').catch(() => undefined)
      routeText.set(r?.route === 'direct' ? S.pathDirect : r?.route === 'relay' ? S.pathRelay((r.relay ?? '').toUpperCase() || '—') : '')
    } else {
      const d = await host.call<Check & { error?: string }>('link.diagnose')
      if (d.error) return
      check.set({ relay: d.relay, computer: d.computer, ...(d.computer === 'reachable' ? { access: await askComputer() } : {}) })
    }
    if (check()?.access === 'refused') client?.hold()
  } catch { /* a shell without link.diagnose: the state stays as it is */ } finally { looking = false }
}
async function askComputer(): Promise<NonNullable<Check['access']>> {
  try { await dsh().computer(); return 'ok' } catch (e) { return (e as DshError).code === 'unauthorized' ? 'refused' : 'failed' }
}
function watchReach() {
  setInterval(() => {
    if (!appActive() || !network() || !settings()) return
    const now = Date.now()
    if (connection() === 'online') failingSince = 0; else if (!failingSince) failingSince = now
    if (failingSince && now - failingSince < GRACE_MS) return
    if (now - lastLook >= (failingSince ? FAILING_MS : WORKING_MS)) look()
  }, 1000)
}

export async function boot() {
  watchReach()
  try { adopt(await host.call<LinkState>('link.state')) } catch (e) { linkError.set(readable(e)) }
  loaded.set(true)
  // opened from a pairing QR or link (dshm1:…), now or while running
  const pending = (host.params as { pair?: string } | undefined)?.pair
  if (pending && !settings()) await pairWith(pending)
  // Back on a network: try the computer now instead of at the next retry.
  try { host.on('network', (data) => { const online = (data as { online?: boolean } | undefined)?.online !== false; network.set(online); if (online) reconnect() }) } catch {}
  host.call<{ online: boolean }>('network.state').then((v) => network.set(v.online !== false), () => {})
  // Back on screen: try the computer now. A connection that died while the app was away would otherwise wait for the
  // next retry, up to 15 seconds later.
  const onScreen = (v: unknown) => (v as { active?: boolean } | undefined)?.active !== false
  try { host.on('app.state', (data) => { appActive.set(onScreen(data)); if (appActive()) reconnect() }) } catch {}
  host.call('app.state').then((v) => appActive.set(onScreen(v)), () => {})
  try { host.on('pair', (data) => { const text = (data as { text?: string } | undefined)?.text; if (text) pairWith(text) }) } catch {}
}
export async function pairWith(text: string) {
  linking.set(true); linkError.set('')
  try { adopt(await host.call<LinkState>('link.pair', { text })) } catch (e) { linkError.set(readable(e)) } finally { linking.set(false) }
}
export async function scan() {
  let text: string
  try { text = await host.call<string>('link.scan') } catch (e) { if ((e as Error).message !== 'cancelled') linkError.set(readable(e)); return }
  await pairWith(text)
}
/** The link screen comes at once. Telling the computer goes on behind it, up to 30 seconds when the computer is silent;
 * a code linked meanwhile waits for that on the link's own thread. */
export function unlink() {
  const real = !trying()
  adopt({ paired: false })
  if (real) host.call('link.forget').catch(() => {})
}
/** The sample instead of a link. Only an unlinked phone offers it, so there is no link to lose. */
export function tryIt() {
  adopt({ paired: true, origin: TRY_ORIGIN, token: TRY_KEY }, true)
}
export const PRIVACY_URL = 'https://dsh-anywhere.jingtao.io/privacy/'

/** What the shell's `ui.open` needs for a module the agent built with show_interface (companion ui-modules.ts). */
export const interfaceRequest = (s: Settings, callId: string, title: string) => ({
  url: `${s.origin}/ui/package?call=${encodeURIComponent(callId)}`, rootUrl: `${s.origin}/ui/root.pub`, auth: s.key, title,
})
export const interfaceError = signal('')
export async function openInterface(callId: string, title: string) {
  const s = settings(); if (!s) return
  interfaceError.set('')
  try { await host.call('ui.open', interfaceRequest(s, callId, title)) } catch (e) { interfaceError.set(readable(e)) }
}

/** Answers an approval or question ($events/result) and forgets it here; the computer withdraws it everywhere else. */
export async function answer(eventId: string, args: unknown) {
  await dsh().rpc('$events/result', args as Record<string, unknown>)
  pending.drop(eventId); asks.update((n) => n + 1)
}
