// A chat's activity in the top right corner of its header, as Claude's app keeps a chat's work there: a button with
// the to-dos' progress, whether anything runs and how full the context is, which drops a panel with the context on
// its own at the top, then the chat's work: the goal, the to-dos, the subagents and the background jobs. Active items lead; finished ones fold under a line of their own. Pinned,
// the whole panel sits above the composer instead and the header button steps aside (for every chat, kept on the phone);
// while the person types it is one line, unless they turn that off in its menu.
import { cleanup, effect, keyboardFrame, Overlay, Scroll, signal, Storage, Text, View, type Bounds, type Signal, type ViewRef } from 'nsh'
import { activeOf, shows, todoParts, type Activity } from './activity.ts'
import { detailsOf, tokens } from './details.ts'
import { isLive, sections, type Job } from './jobs.ts'
import type { Todo } from './fold.ts'
import type { Child } from './subagents.ts'
import { dsh } from './state.ts'
import { S } from './strings.ts'
import { chooseAction, haptic, Chevron, Icon, IconButton, LiveDot } from './ui.tsx'

export interface ChatActivity {
  todos: Signal<Todo[]>; jobs: Signal<Job[]>; children: Signal<Child[]>; context: Signal<Activity['context']>; goal: Signal<Activity['goal']>
  open: Signal<boolean>; closedAt: { at: number }
}

export function createActivity(): ChatActivity {
  return { todos: signal<Todo[]>([]), jobs: signal<Job[]>([]), children: signal<Child[]>([]), context: signal<Activity['context']>(undefined), goal: signal<Activity['goal']>(undefined), open: signal(false), closedAt: { at: 0 } }
}

const PINNED = 'activityPinned'
/** Whether the panel sits above the composer, for every chat. */
export const pinned = signal(false)
Storage.getItem(PINNED).then((v) => pinned.set(v === '1'), () => {})
export function setPinned(on: boolean) { pinned.set(on); (on ? Storage.setItem(PINNED, '1') : Storage.removeItem(PINNED)).catch(() => {}) }

const FOLD = 'activityFold'
/** Whether the pinned panel is one line while the person types; on unless turned off. */
const fold = signal(true)
Storage.getItem(FOLD).then((v) => fold.set(v !== '0'), () => {})
function setFold(on: boolean) { fold.set(on); (on ? Storage.removeItem(FOLD) : Storage.setItem(FOLD, '0')).catch(() => {}) }

const read = (a: ChatActivity): Activity => ({ todos: a.todos(), jobs: a.jobs(), children: a.children(), context: a.context(), goal: a.goal() })

/** The chat's context use (Desktop's meter) and goal, from session/projections, read again every 8 s while the chat is open. */
export function followDetails(sessionId: string, a: ChatActivity) {
  const load = () => dsh().rpc('session/projections', { request: { sessionId } }).then((v) => { const d = detailsOf(v); a.context.set(d.context); a.goal.set(d.goal) }, () => {})
  load()
  const timer = setInterval(load, 8000)
  cleanup(() => clearInterval(timer))
}

export function ActivityButton(props: { activity: ChatActivity }) {
  const a = props.activity
  const active = () => activeOf(read(a)).total
  const percent = () => a.context()?.percent
  const todos = () => ({ done: todoParts(a.todos()).done.length, total: a.todos().length })
  const label = () => [todos().total ? S.todosDone(todos().done, todos().total) : '', S.activityActive(active()), percent() !== undefined ? S.contextUsed(percent()!) : ''].filter(Boolean).join(S.factSep)
  return (
    <If when={shows(read(a)) && !pinned()}>
      <View role="button" testID="activity" accessibilityLabel={`${S.activity}: ${label()}`} accessibilityState={{ expanded: a.open() }} hitSlop={6}
        onPress={() => { if (Date.now() - a.closedAt.at > 300) { haptic('tick'); a.open.set(!a.open()) } }}
        class={`h-[32px] px-[10px] mr-[2px] flex-row items-center gap-[6px] rounded-full border border-border active:bg-secondary ${a.open() ? 'bg-secondary' : ''}`}>
        <If when={active()}><View testID="activity-live"><LiveDot /></View></If>
        <If when={todos().total} else={<If when={active()}><Text class="text-foreground text-[13px] font-medium" testID="activity-count">{String(active())}</Text></If>}>
          <Icon name="listChecks" size={14} />
          <Text class="text-foreground text-[13px] font-medium" testID="activity-todo-progress">{`${todos().done}/${todos().total}`}</Text>
        </If>
        <If when={percent() !== undefined}>
          <Text class="text-muted-foreground text-[13px]" testID="activity-context">{`${percent()}%`}</Text>
        </If>
        <If when={!active() && !todos().total && percent() === undefined}><Icon name="listChecks" size={16} /></If>
      </View>
    </If>
  )
}

type Opens = { openJobs: () => void; openChildren: () => void; onOpenChild: (c: Child) => void }

/** The panel hangs from the top right of the chat, under the header, as the ⋯ menu does (see HeaderMenu). */
export function ActivityPanel(props: { activity: ChatActivity } & Opens) {
  const a = props.activity
  let anchor: ViewRef | undefined
  const close = () => { a.closedAt.at = Date.now(); a.open.set(false) }
  return (
    <>
      <View ref={anchor} class="absolute top-0 right-[10px] w-[1px] h-[1px]" style={{ pointerEvents: 'none' }} />
      <If when={a.open()}>
        <Overlay anchor={anchor} placement="bottom" align="end" offset={0} margin={8} onPressOutside={close} onCancel={close}
          class="w-[340px] rounded-[16px] border border-border bg-popover shadow-lg overflow-hidden" testID="activity-panel">
          <Scroll style={{ maxHeight: 520 }} class="py-[6px]">
            <Contents {...props} done={close} percentAbove />
            <PinRow onPress={() => { haptic('tick'); close(); setPinned(true) }} />
          </Scroll>
        </Overlay>
      </If>
    </>
  )
}

/** Pinned, the same panel above the composer, kept short so the chat keeps the screen; its pin puts it back. */
export function ActivityDock(props: { activity: ChatActivity; typing?: () => boolean } & Opens) {
  const a = props.activity
  const typing = () => (props.typing ? props.typing() : keyboardFrame().height > 0)
  // Opened from its one line, it stays open until the typing stops.
  const opened = signal(false)
  effect(() => { if (!typing()) opened.set(false) })
  const line = () => fold() && typing() && !opened()
  const active = () => activeOf(read(a)).total
  const todos = () => ({ done: todoParts(a.todos()).done.length, total: a.todos().length })
  const percent = () => a.context()?.percent
  const menu = async () => {
    const id = await chooseAction({ title: S.activity, actions: [{ id: 'fold', label: S.oneLineWhileTyping, icon: 'listChecks', checked: fold() }, { id: 'unpin', label: S.unpinActivity, icon: 'pin' }] })
    if (id === 'fold') setFold(!fold())
    else if (id === 'unpin') setPinned(false)
  }
  return (
    <If when={pinned() && shows(read(a))}>
      <View testID="activity-dock" class="mb-2 rounded-[14px] border border-border bg-card overflow-hidden">
        <View class="flex-row items-center h-[36px] pr-[2px]">
          <View role="button" testID={line() ? 'activity-dock-line' : undefined} accessibilityState={{ expanded: !line() }} onPress={() => { if (line()) { haptic('tick'); opened.set(true) } }}
            class="flex-1 flex-row items-center self-stretch pl-[14px] gap-[8px]">
            <Text class="text-muted-foreground text-[13px]">{S.activity}</Text>
            <If when={line()}>
              <If when={active()}><LiveDot /></If>
              <If when={todos().total}>
                <Text class="text-foreground text-[13px]">{`${todos().done}/${todos().total}`}</Text>
              </If>
              <If when={percent() !== undefined}><Text class="text-muted-foreground text-[13px]">{`${percent()}%`}</Text></If>
            </If>
          </View>
          <IconButton name="more" label={S.activity} testID="activity-dock-menu" size={16} onPress={() => { haptic('tick'); menu() }} />
        </View>
        <If when={!line()}>
          <Scroll style={{ maxHeight: 148 }} class="pb-[4px]">
            <Contents {...props} done={() => {}} />
          </Scroll>
        </If>
      </View>
    </If>
  )
}

/** `percentAbove`: the header button that opened it shows the context percentage, so the panel leaves it out. */
function Contents(props: { activity: ChatActivity; done: () => void; percentAbove?: boolean } & Opens) {
  const a = props.activity
  const go = (f: () => void) => { haptic('tick'); props.done(); f() }
  const counts = () => activeOf(read(a))
  const todos = () => todoParts(a.todos())
  const jobs = () => sections(a.jobs())
  const kids = () => ({ live: a.children().filter((c) => c.running), settled: a.children().filter((c) => !c.running) })
  return (
    <>
      <If when={a.context()}>
        <View class="px-[14px] pt-[8px] pb-[8px] gap-[8px]" testID="activity-context-row" accessibilityLabel={S.contextUsed(a.context()?.percent ?? 0)}>
          <View class="flex-row items-center">
            <Text class="flex-1 text-foreground text-[15px] font-medium">{S.context}</Text>
            <Text class="text-muted-foreground text-[13px]">{`${tokens(a.context()?.used ?? 0)} / ${tokens(a.context()?.window ?? 0)}${props.percentAbove ? '' : ` (${a.context()?.percent}%)`}`}</Text>
          </View>
          <View class="h-[4px] rounded-full bg-secondary overflow-hidden">
            <View class={`h-[4px] rounded-full ${(a.context()?.percent ?? 0) >= 85 ? 'bg-destructive' : 'bg-foreground'}`} style={{ width: `${a.context()?.percent ?? 0}%` }} />
          </View>
        </View>
      </If>
      <If when={a.goal()}>
        <View class="px-[14px] pt-[6px] pb-[10px] gap-[4px]" testID="activity-goal">
          <View class="flex-row items-center">
            <Text class="flex-1 text-foreground text-[15px] font-medium">{S.goal}</Text>
            <Text class={`text-[13px] ${a.goal()?.phase === 'active' ? 'text-foreground' : 'text-muted-foreground'}`}>{S.goalPhase[a.goal()?.phase ?? 'active']}</Text>
          </View>
          <Text class="text-muted-foreground text-[13px] leading-[19px] line-clamp-3">{a.goal()?.objective}</Text>
        </View>
      </If>
      <If when={a.todos().length}>
        <Section icon="listChecks" title={S.todos} count={counts().todos} detail={S.todosDone(todos().done.length, a.todos().length)} testID="activity-todos" />
        <Each of={todos().active} key={(t) => t.content}>{(t) => (
          <Item dot={t().status === 'in_progress' ? 'live' : 'open'} text={t().content} />
        )}</Each>
        <Folded count={todos().done.length} label={S.completedCount} testID="activity-todos-done">
          {todos().done.map((t) => <Item dot="done" text={t.content} />)}
        </Folded>
      </If>
      <If when={a.children().length}>
        <Section icon="bot" title={S.subagentsTitle} count={counts().subagents} testID="activity-subagents" onPress={() => go(props.openChildren)} />
        <Each of={kids().live} key={(c) => c.id}>{(c) => <Item dot="live" text={c().name} onPress={() => go(() => props.onOpenChild(c()))} />}</Each>
        <Folded count={kids().settled.length} label={S.finishedCount} testID="activity-subagents-done">
          {kids().settled.map((c) => <Item dot="done" text={c.name} onPress={() => go(() => props.onOpenChild(c))} />)}
        </Folded>
      </If>
      <If when={a.jobs().length}>
        <Section icon="terminal" title={S.jobsTitle} count={counts().jobs} testID="activity-jobs" onPress={() => go(props.openJobs)} />
        <Each of={jobs().live} key={(j) => j.id}>{(j) => <Item dot="live" text={j().label} mono onPress={() => go(props.openJobs)} />}</Each>
        <Folded count={jobs().settled.length} label={S.finishedCount} testID="activity-jobs-done">
          {jobs().settled.map((j) => <Item dot={j.status === 'completed' ? 'done' : 'failed'} text={j.label} mono onPress={() => go(props.openJobs)} />)}
        </Folded>
      </If>
    </>
  )
}

/** The panel's last row: pins the activity above the composer. Its text starts where the section headings' does. */
export function PinRow(props: { onPress: () => void; onLabelLayout?: (e: { bounds: Bounds }) => void }) {
  return (
    <View role="button" testID="activity-pin" onPress={props.onPress}
      class="mt-[4px] flex-row items-center gap-2 px-[14px] h-[44px] active:bg-secondary">
      <Icon name="pin" size={16} />
      <Text onLayout={props.onLabelLayout} class="flex-1 text-foreground text-[15px]">{S.pinActivity}</Text>
    </View>
  )
}

export function Section(props: { icon: 'listChecks' | 'terminal' | 'bot'; title: string; count: number; detail?: string; testID: string; onPress?: () => void; onTitleLayout?: (e: { bounds: Bounds }) => void }) {
  return (
    <View role={props.onPress ? 'button' : undefined} onPress={props.onPress} testID={props.testID}
      class={`mt-[2px] flex-row items-center gap-2 px-[14px] h-[40px] ${props.onPress ? 'active:bg-secondary' : ''}`}>
      <Icon name={props.icon} size={16} />
      <Text onLayout={props.onTitleLayout} class="flex-1 text-foreground text-[15px] font-medium">{props.title}</Text>
      <Text class={`text-[13px] ${props.count ? 'text-foreground' : 'text-muted-foreground'}`}>{props.detail ?? (props.count ? S.activeCount(props.count) : S.noneActive)}</Text>
      <If when={props.onPress}><Chevron dir="right" font={14} /></If>
    </View>
  )
}

const DOT = { live: '', open: 'border border-muted-foreground', done: 'bg-muted-foreground', failed: 'bg-destructive' }
function Item(props: { dot: keyof typeof DOT; text: string; mono?: boolean; onPress?: () => void }) {
  const done = props.dot === 'done' || props.dot === 'failed'
  return (
    <View role={props.onPress ? 'button' : undefined} onPress={props.onPress} class={`flex-row items-start gap-[10px] pl-[38px] pr-[14px] py-[6px] ${props.onPress ? 'active:bg-secondary' : ''}`}>
      {props.dot === 'live' ? <LiveDot size={7} class="mt-[6px]" /> : <View class={`mt-[6px] w-[7px] h-[7px] rounded-full ${DOT[props.dot]}`} />}
      <Text class={`flex-1 text-[13px] leading-[19px] line-clamp-2 ${props.mono ? 'font-mono' : ''} ${done ? 'text-muted-foreground' : 'text-foreground'}`}>{props.text}</Text>
    </View>
  )
}

/** Frames for the layout test (src/folded.test.tsx). */
type Measured = { onRowLayout?: (e: { bounds: Bounds }) => void; onLabelLayout?: (e: { bounds: Bounds }) => void; onChevronLayout?: (e: { bounds: Bounds }) => void }
/** Finished items, folded until asked for. */
export function Folded(props: { count: number; label: (n: number) => string; testID: string; children?: unknown } & Measured) {
  const open = signal(false)
  return (
    <If when={props.count}>
      <View role="button" testID={props.testID} accessibilityState={{ expanded: open() }} onPress={() => { haptic('tick'); open.set(!open()) }} onLayout={props.onRowLayout}
        class="flex-row items-center gap-[5px] pl-[38px] pr-[14px] h-[34px] active:bg-secondary">
        <Text onLayout={props.onLabelLayout} class="shrink text-muted-foreground text-[13px] line-clamp-1">{props.label(props.count)}</Text>
        <View onLayout={props.onChevronLayout} class={`transition-transform duration-200 ${open() ? 'rotate-180' : 'rotate-0'}`}><Chevron dir="down" font={13} /></View>
      </View>
      <If when={open()}>{props.children as never}</If>
    </If>
  )
}

/** Keeps the activity's jobs in step with a list the chat already follows. */
export function mirror<T>(from: () => T, to: Signal<T>) { effect(() => to.set(from())) }
