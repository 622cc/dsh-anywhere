// A chat's trajectory, as Desktop's Trajectory view lists it: every tool call, turn by turn, with its title, status,
// how long it took and when it started. The page follows the chat with its own Fold (session/follow, without the
// assistant's text stream), so it stays live while the chat runs. Tool arguments and output never reach it.
import { cleanup, computed, effect, List, signal, Text, View, type ListRef } from 'nsh'
import { Fold, keepUnchanged, toolLabel, type Call, type Turn } from './fold.ts'
import { duration } from './jobs.ts'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { ConnectionBar } from './status.tsx'
import { LiveDot } from './ui.tsx'

type Item = { kind: 'turn'; id: string; turn: number | undefined; count: number } | { kind: 'call'; id: string; call: Call; first: boolean; last: boolean }

export function TrajectoryPage(props: { sessionId: string }) {
  const fold = new Fold()
  const turns = signal<Turn[]>([])
  const loaded = signal(false)
  const error = signal('')
  let scheduled = false
  const flush = () => { scheduled = false; turns.set(fold.trajectory()); loaded.set(true) }
  let stop: (() => void) | undefined
  const follow = () => {
    stop?.(); error.set('')
    stop = dsh().stream('session/follow', { request: { address: { kind: 'session', sessionId: props.sessionId }, maxMessages: 100 } },
      (frame) => { fold.apply(frame); error.set(''); if (!scheduled) { scheduled = true; setTimeout(flush, 100) } },
      (e) => error.set(readable(e)))
  }
  follow()
  cleanup(() => stop?.())
  return <TrajectoryView turns={turns} loaded={loaded} error={error} retry={follow} />
}

const clock = (at: number) => new Date(at).toLocaleTimeString(S.ago.date, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
/** "Completed, 4s"; a running call has no length yet. */
const meta = (c: Call) => (c.endedAt === undefined ? S.callStatus[c.status] : S.jobLine(S.callStatus[c.status], duration(c.endedAt - c.at)))

export function TrajectoryView(props: { turns: () => Turn[]; loaded: () => boolean; error: () => string; retry: () => void }) {
  let list: ListRef | undefined
  let previous: Item[] = []
  const items = computed<Item[]>(() => {
    const next = props.turns().flatMap((t): Item[] => [{ kind: 'turn', id: t.id, turn: t.turn, count: t.calls.length },
      ...t.calls.map((call, i) => ({ kind: 'call' as const, id: `call:${call.callId}`, call, first: i === 0, last: i === t.calls.length - 1 }))])
    previous = keepUnchanged(previous, next)
    return previous
  })
  // Opened at the latest call, as the chat opens at its latest message.
  let first = true
  effect(() => { if (first && items().length) { first = false; setTimeout(() => list?.scrollToEnd({ animated: false }), 30) } })
  return (
    <View class="flex-1 bg-background">
      <ConnectionBar />
      <If when={props.error()}>
        <View class="mx-4 mt-2 rounded-[10px] bg-secondary px-3 py-2 gap-2 flex-row items-center">
          <Text class="flex-1 text-muted-foreground text-[13px] leading-[18px]">{props.error()}</Text>
          <View role="button" testID="trajectory-retry" onPress={props.retry} hitSlop={8} class="active:opacity-60"><Text class="text-foreground text-[13px] font-medium">{S.retry}</Text></View>
        </View>
      </If>
      <If when={!props.error() && (!props.loaded() || !items().length)}>
        <View class="flex-1 items-center justify-center px-6">
          <Text class="text-muted-foreground text-[15px] text-center">{props.loaded() ? S.noToolCalls : S.loadingTrajectory}</Text>
        </View>
      </If>
      <If when={items().length}>
        <List ref={list} each={items()} keyExtractor={(i) => i.id} estimatedItemSize={56} testID="trajectory" style={{ flex: 1 }} scrollbar={false}
          contentStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 }}>
          {(i) => <Cell item={i} />}
        </List>
      </If>
    </View>
  )
}

/** One cell; it reads `props.item()` where it is used because the List reuses cells for other items. */
function Cell(props: { item: () => Item }) {
  const turn = () => { const i = props.item(); return i.kind === 'turn' ? [i] : [] }
  const call = () => { const i = props.item(); return i.kind === 'call' ? [i] : [] }
  return (
    <View>
      <Each of={turn()} key={(t) => t.id}>{(t) => (
        <View class="flex-row items-baseline gap-2 pt-4 pb-[6px] px-1" accessibilityLabel={`${t().turn === undefined ? S.betweenTurns : S.turn(t().turn!)}, ${S.toolCalls(t().count)}`}>
          <Text class="flex-1 text-foreground text-[15px] font-semibold">{t().turn === undefined ? S.betweenTurns : S.turn(t().turn!)}</Text>
          <Text class="text-muted-foreground text-[13px]">{S.toolCalls(t().count)}</Text>
        </View>
      )}</Each>
      <Each of={call()} key={(c) => c.id}>{(c) => { const s = () => c().call; return (
        <View testID={`call-${s().callId}`} accessibilityLabel={`${toolLabel(s().tool)}, ${s().title}, ${meta(s())}`}
          class={`flex-row items-start gap-[10px] px-[14px] py-[10px] bg-card border-x border-b border-border ${c().first ? 'border-t rounded-t-[12px]' : ''} ${c().last ? 'rounded-b-[12px]' : ''}`}>
          {s().status === 'in_progress' ? <LiveDot size={8} class="mt-[6px]" /> : <View class={`mt-[6px] w-[8px] h-[8px] rounded-full ${s().status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground'}`} />}
          <View class="flex-1 gap-[2px]">
            <View class="flex-row flex-wrap gap-x-2">
              <Text class="text-foreground text-[15px] leading-[21px] font-medium">{toolLabel(s().tool)}</Text>
              <If when={s().title !== s().tool}><Text class="shrink text-muted-foreground text-[15px] leading-[21px] line-clamp-2">{s().title}</Text></If>
            </View>
            <Text class={`text-[12px] leading-4 ${s().status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{meta(s())}</Text>
          </View>
          <Text class="text-muted-foreground text-[12px] leading-5 tabular-nums">{clock(s().at)}</Text>
        </View>
      ) }}</Each>
    </View>
  )
}
