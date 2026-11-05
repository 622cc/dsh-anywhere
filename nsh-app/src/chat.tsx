// One chat, as DSH Desktop draws it: the person's messages in bubbles, the agent's answers as markdown, and
// between them the turn process ("Running commands" while it works, "Completed, 3 tool calls" after), which
// opens to the Think text and one row per tool call. Everything comes from DSH's own session/follow stream.
import { BlankChat } from './blankchat.tsx'
import { cleanup, computed, createMotion, effect, Image, untracked, keyboardFrame, LayoutAnimation, List, safeAreaInsets, signal, Text, View, type InputRef, type ListRef } from 'nsh'
import { Input, TextView } from 'nsh/base'
import { doneTitle, Fold, headline, keepUnchanged, liveText, toolLabel, turnEnds, type Attached, type Entry, type LiveLine, type Row, type Step, type Todo } from './fold.ts'
import { connection, dsh, interfaceError, openInterface } from './state.ts'
import { readable, S } from './strings.ts'
import { ModelPicker } from './picker.tsx'
import { Asks } from './asks.tsx'
import { ConnectionBar } from './status.tsx'
import { haptic, Chevron, Icon, IconButton, LiveDot } from './ui.tsx'
import { appear, FRESH_MS, rise, STANDARD } from './motion.ts'
import { copyText, messageMenu } from './copy.tsx'
import { addAttachment, DraftChips, forget, SentAttachments } from './attachments.tsx'
import { promptContent, type Draft } from './attach.ts'
import { awaitingFirstStep, outgoing, retext, settle, type Outgoing } from './outbox.ts'
import { Bubble, OutgoingView, WorkingRow } from './sent.tsx'
import { steady } from './live.ts'
import { inboxOf, waiting, type Waiting } from './queue.ts'
import { QueueBar } from './queuebar.tsx'
import { TodoDock } from './todos.tsx'
import { FailureView } from './failure.tsx'
import { followJobs, JobsDock, JobsSheet } from './jobs.tsx'
import type { Job } from './jobs.ts'
import { commandsOf, insertMention, isSuggestion, mentionAt, referencesOf, referenceText, route, skillsOf, slashQuery, suggest, type Command, type Reference, type Skill, type Suggestion } from './commands.ts'
import { ControlsSheet, followReferences, Suggestions, type Run } from './commandbar.tsx'
import type { Selection } from './models.ts'
import { addressOf, composerOf, followUp, type Child, type Subagent } from './subagents.ts'
import { followChildren, SubagentsDock, SubagentsSheet } from './subagents.tsx'
import { ActivityDock, ActivityPanel, followDetails, type ChatActivity } from './activity.tsx'
import { mentionsInto } from './files.ts'
import { followsEnd, PADDING } from './scroll.ts'

type Process = Extract<Row, { kind: 'process' }>
type CommandRow = Extract<Row, { kind: 'command' }>
/** A cell: a row, or, while its turn is open, one entry of that turn. Small cells keep the list's measuring cheap and its scroll position steady. */
type Item = Row | { kind: 'entry'; id: string; entry: Entry } | { kind: 'outgoing'; id: string; message: Outgoing } | { kind: 'working'; id: string }
const LINE = 22
let requestCounter = 0

/** A child chat: a subagent of `parentSessionId`, read and continued through its parent, as Desktop opens it. */
export interface ChildOf { parentSessionId: string; subagent: Subagent }

export function ChatScreen(props: { sessionId: string; onTitle: (t: string) => void; child?: ChildOf; onOpenChild?: (child: Child) => void; activity?: ChatActivity; where?: { title: string; path: string } }) {
  const child = props.child
  const composer = child ? composerOf(child.subagent.mode) : 'compose'
  const fold = new Fold()
  const rows = signal<Row[]>([])
  const running = signal(false)
  const model = signal<Selection | undefined>(undefined)
  const loaded = signal(false)
  const error = signal('')
  const draft = signal('')
  const attached = signal<Draft[]>([])
  const uploading = signal(false)
  const outbox = signal<Outgoing[]>([])
  const inbox = signal(inboxOf(undefined))
  const todos = signal<Todo[]>([])
  const todosOpen = signal(false) // the to-do list folds when the chat is touched
  const subagents = signal<Subagent[]>([])
  const jobs = signal<Job[]>([])
  followJobs(props.sessionId, (j) => jobs.set(j))
  const { kids, load: loadKids } = followChildren(subagents)
  const jobsOpen = signal(false)
  const kidsOpen = signal(false)
  const openKids = () => { loadKids(); kidsOpen.set(true) }
  // The header's activity button reads what this chat follows; a chat without one (a child) docks its items instead.
  const activity = props.activity
  if (activity) {
    effect(() => activity.todos.set(todos()))
    effect(() => activity.jobs.set(jobs()))
    effect(() => activity.children.set(kids()))
    followDetails(props.sessionId, activity)
  }
  const commands = signal<Command[]>([])
  const skills = signal<Skill[]>([])
  const controlsOpen = signal(false)
  const caret = signal(0)
  const references = signal<Reference[]>([])
  const composerHeight = signal(LINE)
  const open = signal<Set<string>>(new Set())
  const atBottom = signal(true)
  const insets = safeAreaInsets()
  let list: ListRef | undefined
  let input: InputRef | undefined
  let scheduled = false
  const arrivedAs = new Map<string, string>() // a sent message's row → the outgoing id its cell keeps
  const bornAt = new Map<string, number>() // when a row first showed; the rows of the opening snapshot count as old
  const fresh = (id: string) => Date.now() - (bornAt.get(id) ?? 0) < FRESH_MS
  const line = signal<LiveLine>({ detail: '' })
  const showLine = steady<LiveLine>((l) => line.set(l))
  // Frames arrive token by token; the screen redraws at most every 60 ms.
  const flush = () => {
    scheduled = false
    const now = loaded() ? Date.now() : 0
    for (const r of fold.rows()) if (!bornAt.has(r.id)) bornAt.set(r.id, now)
    showLine(fold.live())
    rows.set(keepUnchanged(rows(), fold.rows())); running.set(fold.running); model.set(fold.model); inbox.set(fold.inbox); todos.set(fold.todos); if (fold.subagents !== subagents()) subagents.set(fold.subagents); if (fold.title) props.onTitle(fold.title); loaded.set(true)
    const s = settle(outbox(), rows())
    for (const [row, id] of s.arrived) { arrivedAs.set(row, id); outbox().find((o) => o.id === id)?.drafts.forEach(forget) }
    if (s.outbox !== outbox()) outbox.set(s.outbox)
    // A queued message that starts its turn goes to the top of the screen, as one just sent does.
    for (const id of s.started) pin(id)
  }
  const stop = dsh().stream('session/follow', { request: { address: child ? addressOf(child.parentSessionId, child.subagent) : { kind: 'session', sessionId: props.sessionId }, assistantStream: true, maxMessages: 100 } },
    (frame) => { fold.apply(frame); error.set(''); if (!scheduled) { scheduled = true; setTimeout(flush, 60) } },
    (e) => error.set(readable(e)))
  cleanup(stop)

  // Opened at the end. A sent message and its reply stay at the end, right above the composer, while they fit on
  // screen (followsEnd); a reply longer than the screen goes on below the sent message, which stays at the top, and
  // the person scrolls, with a way down to the latest.
  let first = true
  // It shows once it is there, as v0's app does, instead of flashing the top of the chat first.
  const placed = signal(false)
  effect(() => { if (first && rows().length) { first = false; setTimeout(() => { list?.scrollToEnd({ animated: false }); setTimeout(() => placed.set(true), 32) }, 30) } })
  effect(() => { if (loaded() && !rows().length) placed.set(true) })
  effect(() => { if (keyboardFrame().height > 0 && atBottom()) setTimeout(() => list?.scrollToEnd({ animated: true }), 80) })
  const toEnd = () => { list?.scrollToEnd({ animated: true }); atBottom.set(true) }
  let previous: Item[] = []
  const items = computed<Item[]>(() => {
    const next = rows().flatMap((r): Item[] => {
      if (r.kind === 'user' && arrivedAs.has(r.id)) return [{ ...r, id: arrivedAs.get(r.id)! }]
      return r.kind === 'process' && open().has(r.id) ? [r, ...r.entries.map((entry) => ({ kind: 'entry' as const, id: `${r.id}/${entry.id}`, entry }))] : [r]
    })
    if (awaitingFirstStep(rows(), running())) next.push({ kind: 'working', id: 'working' })
    for (const o of outbox()) if (!o.held) next.push({ kind: 'outgoing', id: o.id, message: o })
    previous = keepUnchanged(previous, next)
    return previous
  })
  const viewport = signal(0)
  const heights = new Map<string, number>()
  const measured = signal(0)
  const measure = (id: string, h: number) => { if (heights.get(id) !== h) { heights.set(id, h); measured.update((n) => n + 1) } }
  const anchor = signal<string | undefined>(undefined)
  const below = computed(() => {
    measured(); const a = anchor(), all = items(); const i = a ? all.findIndex((x) => x.id === a) : -1
    if (i < 0) return -1
    let h = 0
    for (let j = i; j < all.length; j++) h += heights.get(all[j]!.id) ?? 48
    return h
  })
  // While the turn fits, each growth keeps the end in sight; a reply that outgrew the screen goes on out of sight: offer
  // the way down (scrolling there takes it away).
  effect(() => {
    const h = below(), v = viewport()
    if (followsEnd(h, v)) { if (atBottom()) setTimeout(() => list?.scrollToEnd({ animated: true }), 30) }
    else if (h > v - PADDING + 24) atBottom.set(false)
  })
  // The list getting shorter (the activity pinned above the composer, the keyboard) keeps the end in sight when it was there.
  effect(() => { viewport(); if (untracked(atBottom)) setTimeout(() => list?.scrollToEnd({ animated: true }), 30) })
  const pin = (id: string) => { anchor.set(id); atBottom.set(true); setTimeout(() => list?.scrollToEnd({ animated: true }), 50) }

  // The last answer of each finished turn carries its Copy button, as in ChatGPT's and Claude's apps.
  const ends = computed(() => turnEnds(rows(), running()))
  const lastProcess = computed(() => { const r = rows(); for (let i = r.length - 1; i >= 0; i--) if (r[i]!.kind === 'process') return i === r.length - 1 || r.slice(i + 1).every((x) => x.kind !== 'user') ? r[i]!.id : ''; return '' })
  const toggle = (id: string) => { LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity')); open.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  const canSend = computed(() => (Boolean(draft().trim()) || attached().length > 0) && !uploading())
  const mark = (id: string, change: Partial<Outgoing>) => outbox.update((l) => l.map((o) => (o.id === id ? { ...o, ...change } : o)))
  // The outgoing id is the prompt's requestId, so sending it again after an unclear failure is the same request.
  const deliver = async (o: Outgoing) => {
    mark(o.id, { state: 'sending', error: undefined, sentAt: Date.now(), acceptedAt: undefined })
    try {
      const content = promptContent(o.text, o.drafts)
      // A child's follow-up joins its inbox through the parent, as Desktop's composer routes it.
      if (child) await dsh().rpc('subagents/prompt', followUp(child.parentSessionId, props.sessionId, o.id, content))
      else await dsh().rpc('session/prompt', { request: { requestId: o.id, sessionId: props.sessionId, mode: 'queue', content } })
      haptic('confirm')
      if (outbox().some((x) => x.id === o.id)) mark(o.id, { state: 'queued', acceptedAt: Date.now() })
    } catch (e) { haptic('reject'); mark(o.id, { state: 'failed', error: readable(e) }) }
  }
  const submit = () => {
    if (!canSend()) return
    // A line naming one of DSH's commands runs it, as the Desktop composer does; a skill is sent as a message.
    if (!attached().length && route(draft(), commands()) === 'command') return void runTyped(draft().trim())
    // Sent while the agent works, it waits in the queue above the composer; the chat stays where it is.
    const o = outgoing(`phone-${Date.now().toString(36)}-${requestCounter++}`, draft(), attached(), rows(), outbox(), running())
    draft.set(''); attached.set([]); composerHeight.set(LINE)
    outbox.update((l) => [...l, o]); if (!o.held) pin(o.id)
    deliver(o)
  }
  const queue = computed(() => waiting(inbox(), outbox()))
  const drop = (id: string) => outbox.update((l) => l.filter((o) => o.id !== id))
  // An item the agent took meanwhile is no longer DSH's to change: nothing to report.
  const updateQueue = async (w: Waiting, action: Record<string, unknown>) => {
    if (!w.item) return true
    try { await dsh().rpc('session/updateQueue', { request: { sessionId: props.sessionId, itemId: w.item.id, action } }); return true }
    catch (e) { if ((e as { code?: string }).code !== 'session/queue-item-not-found') { haptic('reject'); error.set(readable(e)) } return false }
  }
  const steer = async (w: Waiting) => { if (await updateQueue(w, { kind: 'steer' })) haptic('confirm') }
  const unqueue = async (w: Waiting) => { if (await updateQueue(w, { kind: 'remove' })) { haptic('tick'); drop(w.id) } }
  const edit = async (w: Waiting, text: string) => {
    if (!(await updateQueue(w, { kind: 'edit', content: [{ type: 'text', text }] }))) return
    outbox.update((l) => l.map((o) => (o.id === w.id ? retext(o, text, rows(), l) : o)))
  }
  // Commands and skills for "/", reloaded when the controls open (a skill or plugin may have come since).
  const loadCommands = async () => {
    const [c, k] = await Promise.all([dsh().rpc('commands/list', { agentId: props.sessionId }).catch(() => undefined), dsh().rpc('skills/list', { request: { sessionId: props.sessionId } }).catch(() => undefined)])
    if (c !== undefined) commands.set(commandsOf(c)); if (k !== undefined) skills.set(skillsOf(k))
  }
  if (!child) loadCommands() // a child's composer sends messages only
  const execute: Run = async (line) => {
    try {
      const v = await dsh().rpc<{ result?: { kind?: string; text?: string } } | undefined>('commands/execute', { agentId: props.sessionId, line, submittedAttachments: [] })
      if (!v) return S.unknownCommand(line)
      return v.result?.kind === 'error' ? v.result.text || S.unknownCommand(line) : undefined
    } catch (e) { return readable(e) }
  }
  const runTyped = async (line: string) => {
    draft.set(''); composerHeight.set(LINE)
    const failed = await execute(line)
    if (failed) { haptic('reject'); error.set(failed) } else haptic('confirm')
  }
  const mention = computed(() => mentionAt(draft(), Math.min(caret(), draft().length)))
  followReferences(props.sessionId, () => (slashQuery(draft()) === undefined ? mention()?.query : undefined), (r) => references.set(r), referencesOf)
  const suggestions = computed<(Suggestion | Reference)[]>(() => {
    const q = slashQuery(draft())
    if (q !== undefined) return suggest(q, commands(), skills())
    return mention() ? references() : []
  })
  const setDraft = (text: string, at = text.length) => { draft.set(text); caret.set(at); setTimeout(() => { input?.focus(); input?.setSelection(at) }, 30) }
  if (composer === 'compose') cleanup(mentionsInto(props.sessionId, draft, setDraft)) // "Mention in chat" from the workspace browser
  const pick = (i: Suggestion | Reference) => {
    if (isSuggestion(i)) return setDraft(`/${i.name} `)
    const at = mention(); if (!at) return
    const next = insertMention(draft(), at, referenceText(i)); setDraft(next.text, next.caret)
  }
  const cancel = async () => {
    try {
      if (child) await dsh().rpc('subagents/interruptByParent', { childSessionId: props.sessionId, parentSessionId: child.parentSessionId, mode: 'continuable' })
      else await dsh().rpc('session/cancel', { request: { sessionId: props.sessionId } })
    } catch (e) { error.set(readable(e)) }
  }

  return (
    <View class="flex-1 bg-background pb-[env(keyboard-inset-height)]">
      <ConnectionBar />
      <View class="flex-1" onTouchStart={() => { if (todosOpen()) todosOpen.set(false) }}>
      <List ref={list} each={items()} keyExtractor={(r) => r.id} estimatedItemSize={48} testID="thread" style={{ flex: 1, opacity: placed() ? 1 : 0 }} class="transition-opacity duration-150" scrollbar={false}
        onLayout={(e) => viewport.set(e.bounds.size.height)}
        maintainVisibleContentPosition={{}} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
        contentStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }} scrollEventThrottle={50}
        onScroll={(e) => atBottom.set(e.offset.y + e.size.height >= e.contentSize.height - 80)}>
        {(r) => <RowView sessionId={props.sessionId} item={r} line={line} live={() => running() && r().id === lastProcess()} open={() => open().has(r().id)} toggle={() => toggle(r().id)}
          onHeight={(h) => measure(r().id, h)} busy={running} retry={(o) => deliver(o)} ends={() => ends().has(r().id)} fresh={fresh} />}
      </List>
      </View>
      <View role="button" accessibilityLabel={S.latest} testID={loaded() && !atBottom() ? 'latest' : undefined} onPress={toEnd}
        class={`absolute self-center w-[34px] h-[34px] rounded-full border border-border bg-card shadow-sm items-center justify-center active:opacity-70 transition-all ${loaded() && !atBottom() ? 'opacity-100 scale-100 duration-[180ms]' : 'opacity-0 scale-90 duration-[120ms]'}`}
        style={{ bottom: 116 + (keyboardFrame().height > 0 ? 0 : insets().bottom), transitionTimingFunction: STANDARD, pointerEvents: loaded() && !atBottom() ? 'auto' : 'none' }}>
        <Icon name="chevronDown" size={18} class="tint-foreground" />
      </View>
      <If when={props.where && loaded() && !items().length}><BlankChat title={props.where!.title} path={props.where!.path} /></If>
      <If when={!loaded() && !error() && connection() !== 'offline'}><View class="absolute inset-0 items-center justify-center pointer-events-none"><Text class="text-muted-foreground text-[15px]">{S.connecting}</Text></View></If>
      <If when={(error() || interfaceError()) && connection() !== 'offline'}>
        <View class="mx-4 mb-1 rounded-[10px] bg-secondary px-3 py-2"><Text class="text-muted-foreground text-[13px] leading-[18px] line-clamp-2">{error() || interfaceError()}</Text></View>
      </If>
      <JobsSheet open={jobsOpen} onClose={() => jobsOpen.set(false)} sessionId={props.sessionId} jobs={jobs} />
      <SubagentsSheet open={kidsOpen} onClose={() => kidsOpen.set(false)} kids={kids} onOpen={(c) => props.onOpenChild?.(c)} />
      <If when={activity}><ActivityPanel activity={activity!} openJobs={() => jobsOpen.set(true)} openChildren={openKids} onOpenChild={(c) => props.onOpenChild?.(c)} /></If>
      <ControlsSheet open={controlsOpen} onClose={() => controlsOpen.set(false)} sessionId={props.sessionId} commands={commands} skills={skills} run={execute} insert={(t) => setDraft(t)} reload={loadCommands} />
      <View class="px-3 pt-1" style={{ paddingBottom: 8 + (keyboardFrame().height > 0 ? 0 : insets().bottom) }}>
        <Asks sessionId={props.sessionId} onError={(m) => error.set(m)} />
        {/* Typing "/" or "@" shows only what can be picked: the docks step aside until the pick or the text is gone. */}
        {/* A chat with the header's activity button pins its whole panel here; a subagent's chat has its own docks. */}
        <If when={!suggestions().length && activity}>
          <ActivityDock activity={activity!} openJobs={() => jobsOpen.set(true)} openChildren={openKids} onOpenChild={(c) => props.onOpenChild?.(c)} />
        </If>
        <If when={!suggestions().length && !activity}>
          <JobsDock jobs={jobs} onOpen={() => jobsOpen.set(true)} />
          <TodoDock todos={todos} open={todosOpen} />
          <SubagentsDock kids={kids} onOpen={openKids} />
        </If>
        <Suggestions items={suggestions} onPick={pick} />
        <If when={!suggestions().length}><QueueBar items={queue} running={running} steer={steer} remove={unqueue} edit={edit} retry={(w) => { const o = outbox().find((x) => x.id === w.id); if (o) deliver(o) }} /></If>
        <If when={composer !== 'compose'}>
          <View class="rounded-[16px] border border-border bg-card px-[14px] py-[12px] gap-1" testID="read-only">
            <Text class="text-foreground text-[15px] font-medium">{composer === 'one-shot' ? S.oneShotTitle : S.readOnlyTitle}</Text>
            <If when={composer === 'one-shot'}><Text class="text-muted-foreground text-[13px] leading-[18px]">{S.oneShotBody}</Text></If>
          </View>
        </If>
        <If when={composer === 'compose'}>
        <View class="rounded-[16px] border border-border bg-card">
          <DraftChips items={attached} uploading={uploading} remove={(d) => { forget(d); attached.update((l) => l.filter((x) => x.id !== d.id)) }} />
          <Input ref={input} placeholder={S.message} accessibilityLabel={S.message} value={draft()} onChange={(e) => draft.set(e.value)} multiline submitBehavior="newline" testID="composer"
            onSelectionChange={(e) => caret.set(e.end)}
            onContentSizeChange={(e) => composerHeight.set(Math.min(Math.max(e.size.height, LINE), LINE * 6))}
            style={{ height: composerHeight() + 16 }} class="bg-transparent px-[14px] pt-[10px] pb-[6px] text-foreground placeholder:text-muted-foreground text-[15px] leading-[22px]" />
          <View class="flex-row items-center px-[6px] pb-[6px] gap-[2px]">
            {/* A child takes text: no uploads, commands or model of its own from the phone. */}
            <If when={!child}>
              <IconButton name="plus" label={S.attach} testID="attach" iconClass="tint-muted-foreground"
                onPress={() => addAttachment(props.sessionId, (d) => attached.update((l) => [...l, d]), (m) => error.set(m), (on) => uploading.set(on))} />
              <IconButton name="sliders" label={S.controls} testID="controls-open" iconClass="tint-muted-foreground" onPress={() => controlsOpen.set(true)} />
              <ModelPicker sessionId={props.sessionId} selection={model} onSelected={(s) => { fold.model = s; model.set(s) }} onError={(m) => error.set(m)} />
            </If>
            <View class="flex-1" />
            {/* While the agent works, Stop stays and a typed message queues beside it (t3code's Queue + Stop). */}
            <If when={running()}>
              <View role="button" accessibilityLabel={S.stop} testID="stop" onPress={cancel} hitSlop={6} class={`w-[32px] h-[32px] rounded-full items-center justify-center active:opacity-80 ${canSend() ? 'bg-secondary' : 'bg-primary'}`}>
                <View class={`w-[10px] h-[10px] rounded-[2.5px] ${canSend() ? 'bg-foreground' : 'bg-primary-foreground'}`} />
              </View>
            </If>
            <If when={!running() || canSend()}>
              <View role="button" accessibilityLabel={running() ? S.queue : S.send} testID="send" onPress={submit} hitSlop={6} class={`ml-[6px] w-[32px] h-[32px] rounded-full items-center justify-center ${canSend() ? 'bg-primary active:opacity-80' : 'bg-secondary'}`}>
                <Icon name="arrowUp" size={18} class={canSend() ? 'tint-primary-foreground' : 'tint-muted-foreground'} />
              </View>
            </If>
          </View>
        </View>
        </If>
      </View>
    </View>
  )
}

/** One cell; it reads `props.item()` where it is used because the List reuses cells for other rows. */
function RowView(props: { sessionId: string; item: () => Item; line: () => LiveLine; live: () => boolean; open: () => boolean; toggle: () => void; onHeight: (h: number) => void; busy: () => boolean; retry: (o: Outgoing) => void; ends: () => boolean; fresh: (id: string) => boolean }) {
  const kind = () => props.item().kind
  const sent = () => { const i = props.item(); return i.kind === 'outgoing' ? [i.message] : [] }
  const text = () => (props.item() as { text?: string }).text ?? ''
  const process = () => (kind() === 'process' ? [props.item() as Process] : [])
  const entry = () => { const i = props.item(); return i.kind === 'entry' ? [i] : [] }
  return (
    <View class={kind() === 'entry' ? 'pb-[6px]' : kind() === 'process' && props.open() ? 'pb-[6px]' : 'pb-4'} onLayout={(e) => props.onHeight(e.bounds.size.height)}>
      <Each of={entry()} key={(e) => e.id}>{(e) => <EntryView entry={() => e().entry} />}</Each>
      <If when={kind() === 'user'}>
        <View class="items-end">
          <SentAttachments sessionId={props.sessionId} items={() => (props.item() as { attachments?: Attached[] }).attachments ?? []} />
          <If when={text()}><Bubble text={text()} /></If>
        </View>
      </If>
      <If when={kind() === 'working'}><WorkingRow title={() => liveText(props.line(), 'analyzing')} /></If>
      <Each of={sent()} key={(o) => o.id}>{(o) => <OutgoingView message={o} busy={props.busy} retry={() => props.retry(o())} />}</Each>
      <Each of={kind() === 'command' ? [props.item() as CommandRow] : []} key={(c) => c.id}>{(c) => <CommandView command={c} />}</Each>
      <Each of={kind() === 'failure' ? [props.item() as Extract<Row, { kind: 'failure' }>] : []} key={(f) => f.id}>{(f) => <FailureView failure={f} />}</Each>
      <If when={kind() === 'notice'}>
        <Text class="text-muted-foreground text-[13px] leading-[18px] line-clamp-3">{text()}</Text>
      </If>
      <Each of={kind() === 'assistant' ? [props.item().id] : []} key={(id) => id}>{(id) => { const m = createMotion(props.fresh(id()) ? { enter: appear } : {}); return (
        <View class="self-stretch" onLongPress={() => messageMenu(text(), true)} testID="reply" style={m.style}>
          <TextView markdown={text()} codeBlockActions={[{ id: 'copy', label: S.copy }]} options={{ streaming: Boolean((props.item() as { streaming?: boolean }).streaming) }} links="open"
            classes={{ root: 'text-foreground text-[15px] leading-[23px]', code: 'font-mono text-[13px] bg-secondary rounded-[4px]', codeBlock: 'font-mono text-[12px] leading-[18px] bg-card border border-border rounded-[10px]' }} />
          <If when={props.ends()}><CopyButton text={text} /></If>
        </View>
      ) }}</Each>
      <Each of={process()} key={(p) => p.id}>{(p) => <ProcessView process={p} line={props.line} live={props.live} open={props.open} toggle={props.toggle} />}</Each>
    </View>
  )
}

/** A command as DSH logged it: the line, then what it did. */
function CommandView(props: { command: () => CommandRow }) {
  const c = props.command
  return (
    <View class="flex-row items-start gap-2" testID={`command-${c().state}`}>
      <Text class="text-foreground text-[13px] leading-5 font-mono">{c().line}</Text>
      <Text class={`flex-1 text-[13px] leading-5 line-clamp-3 ${c().state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{c().state === 'running' ? S.sending : c().text}</Text>
    </View>
  )
}

/** Copies a whole answer; the icon turns to a check for a moment. */
function CopyButton(props: { text: () => string }) {
  const done = signal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  cleanup(() => clearTimeout(timer))
  const press = async () => { if (await copyText(props.text())) { done.set(true); clearTimeout(timer); timer = setTimeout(() => done.set(false), 1500) } }
  return (
    <View class="flex-row -ml-2 mt-1">
      <IconButton name={done() ? 'check' : 'copy'} label={done() ? S.copied : S.copy} testID="copy-reply" onPress={press} size={16} class="w-[32px] h-[32px]" iconClass="tint-muted-foreground" />
    </View>
  )
}

/** Built interfaces of a turn, one card per title: a rebuilt interface replaces the card of the version before it. */
function latestInterfaces(steps: Step[]): Step[] {
  const byTitle = new Map<string, Step>()
  for (const s of steps) if (s.tool === 'show_interface' && s.status === 'completed') { byTitle.delete(s.title); byTitle.set(s.title, s) }
  return [...byTitle.values()]
}

function ProcessView(props: { process: () => Process; line: () => LiveLine; live: () => boolean; open: () => boolean; toggle: () => void }) {
  const h = () => headline(props.process(), props.live())
  const title = () => h().label === 'done' ? doneTitle(props.process().steps) : liveText(props.line(), h().label)
  return (
    <View class="self-stretch">
      <View role="button" testID="process" onPress={props.toggle} hitSlop={{ top: 8, bottom: 8 }} class="self-stretch flex-row items-center gap-[6px] py-[4px] active:opacity-60">
        <If when={props.live()}><LiveDot /></If>
        <Text class={`shrink text-[13px] leading-5 line-clamp-1 ${props.live() ? 'text-foreground' : 'text-muted-foreground'}`}>{title()}</Text>
        <View class={`transition-transform duration-200 ${props.open() ? 'rotate-90' : 'rotate-0'}`}><Chevron dir="right" font={13} class={props.live() ? 'tint-foreground' : 'tint-muted-foreground'} /></View>
      </View>
      {latestInterfaces(props.process().steps).map((s) => (
        <View role="button" testID={`interface-${s.callId}`} onPress={() => openInterface(s.callId, s.title)} class="mt-2 self-stretch flex-row items-center gap-3 rounded-[12px] border border-border bg-card px-[14px] py-[12px] active:bg-secondary">
          <Text class="flex-1 text-foreground text-[15px] leading-[21px] font-medium line-clamp-1">{s.title}</Text>
          <Chevron dir="right" font={14} />
        </View>
      ))}
    </View>
  )
}

/** One entry of an open turn, indented under it: Think with its formatted text, or a tool call. */
function EntryView(props: { entry: () => Entry }) {
  const think = () => { const e = props.entry(); return e.kind === 'think' ? [e] : [] }
  const step = () => { const e = props.entry(); return e.kind === 'step' ? [e.step] : [] }
  return (
    <View class="ml-[2px] pl-[14px] border-l border-border">
      <Each of={think()} key={(e) => e.id}>{(e) => (
        <View class="self-stretch gap-[2px]">
          <Text class="text-muted-foreground text-[12px] leading-[18px] font-medium">{S.think}</Text>
          {/* formatted, as DSH Desktop shows expanded thinking */}
          <TextView markdown={e().text} classes={{ root: 'text-muted-foreground text-[13px] leading-5', code: 'font-mono text-[12px]', codeBlock: 'font-mono text-[12px] bg-card border border-border rounded-[8px]' }} />
        </View>
      )}</Each>
      <Each of={step()} key={(st) => st.callId}>{(st) => <StepView step={st()} />}</Each>
    </View>
  )
}

function StepView(props: { step: Step }) {
  const s = props.step
  return (
    <View class="flex-row items-start gap-2" testID={`step-${s.callId}`}>
      <Text class="text-foreground text-[13px] leading-[18px] font-medium">{toolLabel(s.tool)}</Text>
      <Text class={`flex-1 text-[13px] leading-[18px] line-clamp-2 ${s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{s.title === s.tool ? '' : s.title}</Text>
      <If when={s.status !== 'completed' && s.status !== 'failed'}><LiveDot class="mt-[6px]" /></If>
    </View>
  )
}
