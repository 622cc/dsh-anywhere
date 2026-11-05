// The terminal pages: a chat's terminals on the computer, and one terminal (xterm.js in a web view, see
// terminal-page.ts) with a key bar for what a phone keyboard lacks. The shell is the computer user's own, outside the
// agent's sandbox and approvals, and the list says so.
import { cleanup, colorScheme, effect, fontScale, keyboardFrame, safeAreaInsets, signal, Text, untracked, View, WebView, type JSX, type WebViewRef } from 'nsh'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { ConnectionBar } from './status.tsx'
import type { TerminalInfo } from './terminal.ts'
import { PageChannel, readPageMessage, terminalPage, type BarKey } from './terminal-page.ts'
import { newTerminalId, TerminalSession, withCtrl, type TerminalPhase } from './terminals.ts'
import { chooseAction, haptic, LiveDot } from './ui.tsx'

export type TerminalTarget = { id: string; create: boolean }

export function TerminalsPage(props: { sessionId: string; onOpen: (target: TerminalTarget, title?: string) => void }) {
  const list = signal<TerminalInfo[] | undefined>(undefined)
  const error = signal('')
  const load = async () => {
    try { const v = await dsh().rpc('terminal/list', { sessionId: props.sessionId }); list.set(Array.isArray(v) ? v : []); error.set('') } catch (e) { error.set(readable(e)) }
  }
  load()
  const timer = setInterval(load, 5000)
  cleanup(() => clearInterval(timer))
  return (
    <View class="flex-1 bg-background">
      <ConnectionBar />
      <View class="px-4 pt-2 pb-8 gap-3 flex-1">
        <Text class="px-1 text-muted-foreground text-[13px] leading-[18px]" testID="terminal-note">{S.terminalNote}</Text>
        <If when={error()}>
          <View class="rounded-[10px] bg-secondary px-3 py-2 gap-2 flex-row items-center">
            <Text class="flex-1 text-muted-foreground text-[13px] leading-[18px]">{`${S.terminalsError} ${error()}`}</Text>
            <View role="button" testID="terminals-retry" onPress={() => { error.set(''); load() }} hitSlop={8} class="active:opacity-60"><Text class="text-foreground text-[13px] font-medium">{S.retry}</Text></View>
          </View>
        </If>
        <If when={list()} else={<If when={!error()}><Text class="px-1 text-muted-foreground text-[15px]">{S.terminalsLoading}</Text></If>}>
          <If when={list()!.length} else={<Text class="px-1 text-muted-foreground text-[15px]" testID="terminals-empty">{S.terminalsEmpty}</Text>}>
            <View class="rounded-[14px] bg-card border border-border overflow-hidden">
              <Each of={list()!} key={(t) => t.id}>{(t) => (
                <View role="button" testID={`terminal-${t().id}`} onPress={() => props.onOpen({ id: t().id, create: false }, t().title)}
                  accessibilityLabel={`${t().title}, ${S.terminalState[t().state] ?? t().state}`}
                  class={`flex-row items-center gap-3 px-[14px] min-h-[52px] py-[8px] active:bg-secondary ${list()![0]?.id === t().id ? '' : 'border-t border-border'}`}>
                  {t().state === 'running' ? <LiveDot size={8} /> : <View class={`w-[8px] h-[8px] rounded-full ${t().state === 'exited' ? 'bg-muted-foreground' : 'bg-destructive'}`} />}
                  <View class="flex-1 gap-[2px]">
                    <Text class="text-foreground text-[15px] leading-5 line-clamp-1">{t().title}</Text>
                    <Text class="text-muted-foreground text-[12px] font-mono line-clamp-1">{`${S.terminalState[t().state] ?? t().state}, ${t().cwd}`}</Text>
                  </View>
                </View>
              )}</Each>
            </View>
          </If>
        </If>
        <View role="button" testID="new-terminal" onPress={() => { haptic('press'); props.onOpen({ id: newTerminalId(), create: true }) }} accessibilityLabel={S.newTerminal}
          class="self-start rounded-full bg-primary px-4 h-[40px] items-center justify-center active:opacity-80">
          <Text class="text-primary-foreground text-[15px] font-medium">{S.newTerminal}</Text>
        </View>
      </View>
    </View>
  )
}

/** One terminal; `menu` opens the page's close action (the header's ⋯). */
export function TerminalPage(props: { sessionId: string; target: TerminalTarget; menu: () => boolean; onMenuClosed: () => void; onClosed: () => void }) {
  let web: WebViewRef | undefined
  const channel = new PageChannel((m) => web?.postMessage(m))
  const phase = signal<TerminalPhase>('loading')
  const info = signal<TerminalInfo | undefined>(undefined)
  const failure = signal('')
  const ctrl = signal(false)
  const notice = signal('')
  let size: { cols: number; rows: number } | undefined
  let session: TerminalSession | undefined
  const begin = () => {
    session?.stop()
    const s = new TerminalSession(dsh(), props.sessionId, props.target, {
      write: (d) => channel.write(d),
      reset: () => channel.reset(),
      // A frame out of order: a new attachment starts from a fresh snapshot.
      problem: (p) => { if (p === 'invalidOutput') s.takeControl(); else { notice.set(S.terminalInputFull); setTimeout(() => notice.set(''), 2500) } },
    })
    s.onChange = () => {
      phase.set(s.phase); info.set(s.info)
      failure.set(s.error === 'limit' ? S.terminalLimit : s.error === 'missing' ? S.terminalMissing : s.error ? `${S.terminalFailed} ${s.message}`.trim() : '')
    }
    session = s
    if (size) s.start(size.cols, size.rows)
  }
  cleanup(() => session?.stop())
  const onMessage = (data: string) => {
    const m = readPageMessage(data)
    if (!m) return
    if (m.t === 'ready') {
      size = { cols: m.cols, rows: m.rows }
      channel.ready()
      // A page that loaded again lost its screen: attach anew for a fresh snapshot.
      if (!session) begin(); else session.takeControl()
    } else if (m.t === 'size') { size = { cols: m.cols, rows: m.rows }; session?.resize(m.cols, m.rows) }
    else if (m.t === 'input') {
      const data = ctrl() ? withCtrl(m.data) : m.data
      ctrl.set(false)
      session?.input(data)
    }
  }
  const html = untracked(() => terminalPage({ dark: colorScheme() === 'dark', fontSize: Math.max(12, Math.round(12 * Math.min(fontScale(), 1.6))), scrollback: 1000 }))
  effect(() => { const dark = colorScheme() === 'dark'; channel.send({ t: 'theme', dark }) })
  effect(() => {
    if (!props.menu()) return
    untracked(async () => {
      props.onMenuClosed()
      const id = await chooseAction({ title: S.closeTerminalTitle, actions: [{ id: 'close', label: S.closeTerminal, destructive: true }] })
      if (id !== 'close') return
      await session?.close()
      props.onClosed()
    })
  })
  return (
    <TerminalView phase={phase} info={info} failure={failure} notice={notice} ctrl={ctrl}
      onKey={(k) => { haptic('tick'); if (k === 'ctrl') ctrl.update((v) => !v); else channel.key(k) }}
      onTakeControl={() => session?.takeControl()} onRetry={begin}
      screen={<WebView ref={(r) => { web = r }} html={html} testID="terminal-screen" class="flex-1" scrollable={false}
        onLoadStart={() => channel.lost()} onMessage={(e) => onMessage(e.data)} accessibilityLabel={S.terminal} />} />
  )
}

const KEYS: { key: BarKey | 'ctrl'; label: () => string; text: string }[] = [
  { key: 'esc', label: () => S.keyEsc, text: 'Esc' }, { key: 'tab', label: () => S.keyTab, text: 'Tab' }, { key: 'ctrl', label: () => S.keyCtrl, text: 'Ctrl' },
  { key: 'left', label: () => S.keyLeft, text: '←' }, { key: 'down', label: () => S.keyDown, text: '↓' }, { key: 'up', label: () => S.keyUp, text: '↑' }, { key: 'right', label: () => S.keyRight, text: '→' },
]

/** The page around the screen: what state the shell is in, and the key bar. */
export function TerminalView(props: {
  phase: () => TerminalPhase; info: () => TerminalInfo | undefined; failure: () => string; notice: () => string; ctrl: () => boolean
  onKey: (k: BarKey | 'ctrl') => void; onTakeControl: () => void; onRetry: () => void; screen: JSX.Element
}) {
  const status = () => {
    const p = props.phase()
    return p === 'loading' || p === 'connecting' ? S.terminalConnecting : p === 'readOnly' ? S.terminalReadOnly : p === 'exited' ? S.terminalExited(props.info()?.exitCode ?? null) : p === 'failed' ? props.failure() : ''
  }
  return (
    <View class="flex-1 bg-background pb-[env(keyboard-inset-height)]">
      <ConnectionBar />
      <If when={status()}>
        <View class="mx-3 mt-1 mb-1 rounded-[10px] bg-secondary px-3 py-2 gap-2 flex-row items-center" testID="terminal-status">
          <Text class={`flex-1 text-[13px] leading-[18px] ${props.phase() === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{status()}</Text>
          <If when={props.phase() === 'readOnly'}>
            <View role="button" testID="take-control" onPress={props.onTakeControl} hitSlop={8} class="active:opacity-60"><Text class="text-foreground text-[13px] font-medium">{S.takeControl}</Text></View>
          </If>
          <If when={props.phase() === 'failed'}>
            <View role="button" testID="terminal-retry" onPress={props.onRetry} hitSlop={8} class="active:opacity-60"><Text class="text-foreground text-[13px] font-medium">{S.retry}</Text></View>
          </If>
        </View>
      </If>
      {props.screen}
      <If when={props.notice()}><Text class="absolute top-2 left-4 right-4 rounded-[10px] bg-popover border border-border px-3 py-2 text-foreground text-[13px] shadow-md">{props.notice()}</Text></If>
      <View class="flex-row gap-[6px] px-2 pt-[6px] border-t border-border bg-background" style={{ paddingBottom: 6 + (keyboardFrame().height > 0 ? 0 : safeAreaInsets()().bottom) }}>
        {KEYS.map((k) => (
          <View role="button" testID={`key-${k.key}`} accessibilityLabel={k.label()} onPress={() => props.onKey(k.key)}
            class={`flex-1 h-[36px] rounded-[8px] items-center justify-center active:opacity-60 ${k.key === 'ctrl' && props.ctrl() ? 'bg-primary' : 'bg-secondary'}`}>
            <Text class={`text-[15px] font-mono ${k.key === 'ctrl' && props.ctrl() ? 'text-primary-foreground' : 'text-foreground'}`}>{k.text}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
