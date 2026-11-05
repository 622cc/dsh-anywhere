// The connection to the computer, on screen all the time: a row on the chats page, a dot in a chat's header, and under
// each header what is wrong: why, and whether it retries, with a way to try at once. A connection lost and found again
// within a few seconds of being on screen says nothing (back from the background, the connection of before has often
// died); a phone without a network says so at once. The bar and the dot open a sheet that goes through each part.
import { cleanup, effect, signal, Text, View } from 'nsh'
import { Sheet } from 'nsh/base'
import type { ConnectionState } from './dsh.ts'
import { causeOf, type Cause, type Check } from './reach.ts'
import { appActive, check as lastCheck, connection as reachState, network as phoneNetwork, reconnect, retryAt as nextTry, routeText as route, unlink } from './state.ts'
import { S } from './strings.ts'
import { Grabber, LiveDot, SCRIM, SHEET, sheetBottom } from './ui.tsx'

export interface Reach { connection: () => ConnectionState; network: () => boolean; active: () => boolean; check: () => Check | undefined; retryAt: () => number | undefined; routeText: () => string; open: { (): boolean; set(v: boolean): void }; retry: () => void; relink: () => void }
const open = signal(false)
const live: Reach = { connection: reachState, network: phoneNetwork, active: appActive, check: lastCheck, retryAt: nextTry, routeText: route, open, retry: reconnect, relink: unlink }

const dotClass: Record<Cause, string> = { connected: 'bg-emerald-500', slow: 'bg-amber-500', trying: 'bg-amber-500', 'no-network': 'bg-destructive', blocked: 'bg-destructive', computer: 'bg-destructive', companion: 'bg-destructive', refused: 'bg-destructive' }

/** The state to show: what was last shown holds for the few seconds a short drop gets. */
function shownCause(r: Reach) {
  const late = signal(false)
  const everOnline = signal(r.connection() === 'online')
  let timer: ReturnType<typeof setTimeout> | undefined
  // The few seconds count while the app is on screen: a connection that failed while it was away starts them again.
  effect(() => {
    if (r.connection() === 'online') everOnline.set(true)
    if (r.connection() === 'online' || !r.active()) { clearTimeout(timer); timer = undefined; late.set(false) }
    else if (!timer) timer = setTimeout(() => late.set(true), 3000)
  })
  cleanup(() => clearTimeout(timer))
  return (): Cause => {
    const cause = causeOf({ connection: r.connection(), network: r.network(), check: r.check() })
    return r.connection() !== 'online' && r.network() && !late() ? (everOnline() ? 'connected' : 'trying') : cause
  }
}

const titleOf = (cause: Cause, r: Reach) => (cause === 'trying' ? (r.connection() === 'offline' ? S.offline : S.slowConnect)
  : cause === 'no-network' ? S.noNetwork : S.reach[cause])

/** When it tries again, ticking; empty while it says nothing about trying. */
function retryText(r: Reach, cause: Cause, now: () => number) {
  if (cause === 'refused') return S.reach.noRetry
  if (cause === 'connected' || cause === 'slow' || cause === 'no-network' || r.connection() === 'online') return ''
  const at = r.retryAt()
  return at === undefined ? S.reach.retrying : S.reach.retryIn(String(Math.max(1, Math.ceil((at - now()) / 1000))))
}

function Dot(props: { cause: Cause }) {
  return props.cause === 'trying' ? <LiveDot /> : <View class={`w-[8px] h-[8px] rounded-full ${dotClass[props.cause]}`} />
}

/** Under a header. `always` (the chats page) also shows a connection without a problem. */
export function ConnectionBar(props: { reach?: Reach; always?: boolean }) {
  const r = props.reach ?? live
  const cause = shownCause(r)
  const now = signal(Date.now())
  const tick = setInterval(() => now.set(Date.now()), 1000)
  cleanup(() => clearInterval(tick))
  const quiet = () => cause() === 'connected'
  const line = () => [titleOf(cause(), r), cause() === 'connected' ? r.routeText() : ''].filter(Boolean).join(' · ')
  const sub = () => retryText(r, cause(), now)
  return (
    <If when={!quiet() || props.always}>
      <View role="button" testID="connection" accessibilityLabel={`${S.reach.title}: ${line()}`} onPress={() => r.open.set(true)}
        class={`mx-4 mt-1 mb-2 flex-row items-center gap-2 rounded-[10px] px-3 min-h-[36px] py-[5px] active:opacity-70 ${quiet() ? '' : 'bg-secondary'}`}>
        <Dot cause={cause()} />
        <View class="flex-1">
          <Text class="text-muted-foreground text-[13px] leading-[18px] line-clamp-2">{line()}</Text>
          <If when={sub()}><Text class="text-muted-foreground text-[12px] leading-[16px]">{sub()}</Text></If>
        </View>
        <If when={cause() === 'refused'}
          else={<If when={r.connection() === 'offline' && r.network()}>
            <View role="button" testID="reconnect" onPress={r.retry} hitSlop={8} class="active:opacity-60"><Text class="text-foreground text-[13px] font-medium">{S.retry}</Text></View>
          </If>}>
          <View role="button" testID="relink" onPress={r.relink} hitSlop={8} class="active:opacity-60"><Text class="text-foreground text-[13px] font-medium">{S.reach.relink}</Text></View>
        </If>
      </View>
    </If>
  )
}

/** In a chat's header, where a row would take the chat's room. */
export function ConnectionDot(props: { reach?: Reach }) {
  const r = props.reach ?? live
  const cause = shownCause(r)
  return (
    <View role="button" testID="connection-dot" accessibilityLabel={`${S.reach.title}: ${titleOf(cause(), r)}`} onPress={() => r.open.set(true)} hitSlop={6}
      class="w-[24px] h-[36px] items-center justify-center active:opacity-60">
      <Dot cause={cause()} />
    </View>
  )
}

/** Each part in turn, what is wrong, what to do. */
export function ReachSheet(props: { reach?: Reach }) {
  const r = props.reach ?? live
  const cause = () => causeOf({ connection: r.connection(), network: r.network(), check: r.check() })
  const online = () => r.connection() === 'online'
  const state = (ok: boolean | undefined) => (ok === undefined ? S.reach.partUnknown : ok ? S.reach.partOk : S.reach.partFailed)
  const part = (v: 'reachable' | 'unreachable' | undefined) => (online() ? true : v === undefined ? undefined : v === 'reachable')
  const access = () => { const a = r.check()?.access; return a === 'refused' ? false : a === 'ok' || online() ? true : undefined }
  const parts = (): [string, boolean | undefined][] => [
    [S.reach.partPhone, r.network()], [S.reach.partRelay, r.network() ? part(r.check()?.relay) : undefined],
    [S.reach.partComputer, r.network() ? part(r.check()?.computer) : undefined], [S.reach.partPairing, access()],
  ]
  const latency = () => { const ms = r.check()?.latencyMs; return ms === undefined ? '' : S.reach.latency(String(ms)) }
  const close = () => r.open.set(false)
  return (
    <Sheet open={r.open()} onOpenChange={(e) => { if (!e.open) close() }} closeOnSwipe popupClass={SHEET} backdropStyle={SCRIM}>
      <View class="pt-3 px-5" style={{ paddingBottom: sheetBottom() }}>
        <Grabber />
        <Text class="text-foreground text-[15px] font-semibold mb-2">{S.reach.title}</Text>
        <View class="flex-row items-center gap-2"><Dot cause={cause()} /><Text class="flex-1 text-foreground text-[15px]">{titleOf(cause(), r)}</Text></View>
        <If when={S.reach.why[cause()]}><Text testID="reach-why" class="mt-1 text-muted-foreground text-[13px] leading-[18px]">{S.reach.why[cause()]}</Text></If>
        <View class="mt-3 rounded-[12px] border border-border">
          {parts().map(([name, ok], i) => (
            <View class={`flex-row items-center justify-between px-3 py-[9px] ${i ? 'border-t border-border' : ''}`}>
              <Text class="text-foreground text-[14px]">{name}</Text>
              <Text class={`text-[13px] ${ok === false ? 'text-destructive' : 'text-muted-foreground'}`}>{state(ok)}</Text>
            </View>
          ))}
        </View>
        <If when={online() && (r.routeText() || latency())}><Text class="mt-2 text-muted-foreground text-[13px]">{r.routeText()}</Text><If when={latency()}><Text class="text-muted-foreground text-[13px]">{latency()}</Text></If></If>
        <If when={cause() === 'refused'} else={<If when={!online() && r.network()}>
          <View role="button" testID="reach-retry" onPress={() => { r.retry(); close() }} class="mt-3 rounded-[12px] h-[44px] justify-center items-center bg-primary active:opacity-80"><Text class="text-primary-foreground text-[15px] font-medium">{S.retry}</Text></View>
        </If>}>
          <View role="button" testID="reach-relink" onPress={() => { close(); r.relink() }} class="mt-3 rounded-[12px] h-[44px] justify-center items-center bg-primary active:opacity-80"><Text class="text-primary-foreground text-[15px] font-medium">{S.reach.relink}</Text></View>
        </If>
        <If when={cause() === 'computer'}>
          <View role="button" testID="reach-relink" onPress={() => { close(); r.relink() }} class="mt-1 h-[40px] justify-center items-center active:opacity-60"><Text class="text-muted-foreground text-[14px]">{S.reach.relink}</Text></View>
        </If>
      </View>
    </Sheet>
  )
}
