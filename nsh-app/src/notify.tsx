// Telling the person about the chats they are not looking at: an answer that is ready, or an agent that waits on
// them. A chat on screen needs no word; another chat gets a banner at the top of the app; with the app away, the
// phone's own notification (the shell's notify.*), whose tap opens that chat. While the app is away and a chat still
// runs, the shell keeps watching (notify.watch; on Android a foreground service with an ongoing notification).
// The chats and their running state come from DSH's chat list (session/list), the waiting from $events (state.ts).
import { cleanup, effect, host, signal, Storage, Text, View, safeAreaInsets } from 'nsh'
import { alertsBetween, placeOf, type Alert, type Seen } from './attention.ts'
import type { Request } from './events.ts'
import { toolLabel } from './fold.ts'
import { S } from './strings.ts'
import { allowsNotice, notifyPrefs } from './prefs.ts'
import type { ChatSummary } from './workspaces.ts'

export interface Notice { kind: 'answer' | 'failed' | 'decision'; sessionId: string; title: string; body: string }
export interface AttentionIo {
  list: () => Promise<ChatSummary[]>
  requests: (sessionId: string) => Request[]
  waiting: () => string[]
  /** What DSH said went wrong in the chat's turn (api-session/error), until forgotten. */
  errors?: Map<string, string>
  call: (name: string, args?: unknown) => Promise<unknown>
  /** Chats DSH said started running since the last look (api-session/status), and whether it also said they stopped;
   * each look takes them. A short turn can start and end between two looks, with the list showing the chat stopped
   * both times, and DSH's "started" can come before the list shows the chat running. */
  ran?: Map<string, 'running' | 'finished'>
  everyMs?: number
  /** How long after a chat stops its answer's preview is read again (DSH writes it when the turn ends). */
  settleMs?: number
}

const ASKED = 'notifyAsked'
const words = (r: Request | undefined) => !r ? '' : r.kind === 'approval' ? S.allowTool(toolLabel(r.tool)) : r.questions[0]?.question ?? ''

/** Follows the chats; `visible` is the chat on screen (none on other pages), `active` whether the app is on screen. */
export function createAttention(io: AttentionIo, app: { active: () => boolean; visible: () => string | undefined }) {
  const banner = signal<Notice | undefined>(undefined)
  let chats: ChatSummary[] | undefined
  let before: Map<string, Seen> | undefined
  let watching = ''
  let bannerTimer: ReturnType<typeof setTimeout> | undefined
  let asked: boolean | undefined
  Storage.getItem(ASKED).then((v) => { asked = v === '1' }, () => { asked = false })

  const call = (name: string, args?: unknown) => { io.call(name, args).catch(() => {}) }
  const show = (n: Notice) => {
    clearTimeout(bannerTimer); banner.set(n)
    bannerTimer = setTimeout(() => { if (banner() === n) banner.set(undefined) }, 6000)
  }
  const tell = (a: Alert) => {
    if (a.kind === 'withdrawn') {
      call('notify.clear', { id: a.sessionId })
      if (banner()?.sessionId === a.sessionId && banner()?.kind === 'decision') banner.set(undefined)
      return
    }
    // The words: the question, what went wrong, or the answer's own first lines. DSH writes that preview when the
    // turn ends, just after the chat stops running, so an answer waits for a second look at the list.
    if (a.kind === 'answer') {
      setTimeout(async () => {
        let preview = ''
        try { preview = (await io.list()).find((c) => c.sessionId === a.sessionId)?.preview ?? '' } catch {}
        deliver('answer', a, preview)
      }, io.settleMs ?? 1500)
      return
    }
    const said = a.kind === 'decision' ? words(io.requests(a.sessionId)[0]) : (io.errors?.get(a.sessionId) ?? '').split('\n')[0]!.slice(0, 200)
    if (a.kind === 'failed') io.errors?.delete(a.sessionId)
    deliver(a.kind, a, said)
  }
  const deliver = (kind: Notice['kind'], a: Alert, body: string) => {
    const n: Notice = { kind, sessionId: a.sessionId, title: a.title, body }
    const place = placeOf(a, { active: app.active(), visible: app.visible() })
    if ((place === 'banner' || place === 'system') && !allowsNotice(notifyPrefs(), kind, place)) return
    if (place === 'banner') show(n)
    else if (place === 'system') call('notify.show', { id: n.sessionId, kind: n.kind, title: n.title, body: n.body })
  }
  /** The person's own chat started working: the one moment to ask whether the phone may tell them it is done. */
  const askOnce = (now: Map<string, Seen>, ran: Map<string, 'running' | 'finished'>) => {
    const v = app.visible()
    const started = !!v && (ran.has(v) || (now.get(v)?.running === true && before?.get(v)?.running === false))
    if (asked !== false || !app.active() || !started) return
    asked = true
    // Kept only once the person answered: iOS can return without showing its prompt ({decided: false}).
    io.call('notify.request').then((r) => {
      if ((r as { decided?: boolean } | null)?.decided === false) asked = false
      else Storage.setItem(ASKED, '1').catch(() => {})
    }, () => { asked = false })
  }
  const look = () => {
    if (!chats) return
    const waiting = new Set(io.waiting())
    // A turn that starts forgets what went wrong in the one before.
    for (const c of chats) if (c.running && before?.get(c.sessionId)?.running === false) io.errors?.delete(c.sessionId)
    const now = new Map(chats.map((c) => [c.sessionId, { running: c.running, waiting: waiting.has(c.sessionId), failed: io.errors?.has(c.sessionId) === true, title: c.title }]))
    const ran = new Map(io.ran); io.ran?.clear()
    askOnce(now, ran)
    // A whole turn between two looks: it ran, so it is news like one seen running.
    for (const [id, was] of ran) {
      const b = before?.get(id)
      if (was === 'finished' && b && !b.running && !now.get(id)?.running) before!.set(id, { ...b, running: true })
    }
    for (const a of alertsBetween(before, now)) tell(a)
    before = now
    // Away with chats running: the shell keeps watching and says what it watches.
    // An agent that waits on the person is not working: the ongoing notification says who waits.
    const running = chats.filter((c) => c.running), held = running.filter((c) => waiting.has(c.sessionId))
    let want = !running.length ? '' : JSON.stringify(held.length
      ? { title: S.needsDecision, body: held.map((c) => c.title).join(S.listSep) }
      : { title: S.watchingTitle(running.length), body: running.length === 1 ? running[0]!.title : S.watchingBody })
    if (!notifyPrefs().background) want = ''
    if (want !== watching) { watching = want; call('notify.watch', want ? JSON.parse(want) : null) }
  }
  const poll = async () => { try { chats = await io.list(); look() } catch {} }
  poll()
  const timer = setInterval(poll, io.everyMs ?? 4000)
  cleanup(() => { clearInterval(timer); clearTimeout(bannerTimer) })
  /** The chat came on screen: its notification and banner have done their job. */
  effect(() => {
    const v = app.visible(); if (!v) return
    call('notify.clear', { id: v })
    if (banner()?.sessionId === v) banner.set(undefined)
  })
  return { banner, look, poll, dismiss: () => banner.set(undefined), titleOf: (id: string) => chats?.find((c) => c.sessionId === id)?.title ?? '' }
}

const label = (kind: Notice['kind'] | undefined) => kind === 'decision' ? S.needsDecision : kind === 'failed' ? S.turnFailed : S.answerReady

/** The banner for another chat's news, under the header; a tap opens that chat. */
export function AttentionBanner(props: { notice: () => Notice | undefined; onOpen: (n: Notice) => void; onDismiss: () => void }) {
  const insets = safeAreaInsets()
  return (
    <If when={props.notice()}>
      <View role="button" testID="attention-banner" accessibilityLabel={`${props.notice()?.title}. ${props.notice()?.body}`}
        onPress={() => { const n = props.notice(); props.onDismiss(); if (n) props.onOpen(n) }}
        class="absolute left-3 right-3 rounded-[14px] bg-popover border border-border px-[14px] py-[10px] shadow-md gap-[2px] active:opacity-80"
        style={{ top: insets().top + 56 }}>
        <Text class="text-foreground text-[15px] leading-[21px] font-medium line-clamp-1">{props.notice()?.title}</Text>
        <Text class="text-muted-foreground text-[13px] leading-[18px] line-clamp-2">{props.notice()?.body || label(props.notice()?.kind)}</Text>
      </View>
    </If>
  )
}

/** Whether the app is on screen, from the shell (`app.state`); true where the shell does not say. */
export function followAppState() {
  const active = signal(true)
  host.call<{ active?: boolean }>('app.state').then((v) => active.set(v?.active !== false), () => {})
  try { cleanup(host.on('app.state', (v) => active.set((v as { active?: boolean } | undefined)?.active !== false))) } catch {}
  return active
}

/** The app's side of it, for a linked phone: follows the chats, shows the banner, and opens the chat a notification
 * or banner is about (`notify.open` from the shell, `open` in host.params when a notification started the app). */
export function Attention(props: { io: AttentionIo; asks: () => unknown; news: () => unknown; visible: () => string | undefined; open: (sessionId: string, title: string) => void }) {
  const active = followAppState()
  const a = createAttention(props.io, { active, visible: props.visible })
  effect(() => { props.asks(); a.look() }) // a question asked or answered: news without waiting for the next look
  effect(() => { if (props.news()) a.poll() }) // DSH says a chat started or stopped: look at the list now
  const opened = (host.params as { open?: unknown } | undefined)?.open
  if (typeof opened === 'string' && opened) props.open(opened, '')
  try { cleanup(host.on('notify.open', (v) => { const id = (v as { id?: unknown } | undefined)?.id; if (typeof id === 'string' && id) props.open(id, a.titleOf(id)) })) } catch {}
  return <AttentionBanner notice={a.banner} onOpen={(n) => props.open(n.sessionId, n.title)} onDismiss={a.dismiss} />
}
