// Automation tasks, as DSH Desktop's task manager shows them: every Host task (schedule/catalog), enabled first; a task
// opens in a sheet with its delivery records (schedule/history, 20 a page) and a delete that asks first
// (schedule/delete). DSH offers no pause and no create on this surface: tasks come from the agent's schedule tools.
import { cleanup, effect, List, signal, Scroll, Text, untracked, View } from 'nsh'
import { Sheet } from 'nsh/base'
import { dsh } from './state.ts'
import { ConnectionBar } from './status.tsx'
import { deleted, formatAt, frequency, HISTORY_PAGE, historyOf, lastSent, nextRun, tasksOf, type Delivery, type HistoryPage, type Task } from './schedules.ts'
import { readable, S } from './strings.ts'
import { Grabber, haptic, SCRIM, SHEET, sheetBottom } from './ui.tsx'

/** The phone's own zone, so a rule in it reads without its zone; undefined where the runtime cannot say. */
const phoneZone = (() => { try { return new Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined } })()

export function SchedulesScreen() {
  const tasks = signal<Task[]>([])
  const loading = signal(true)
  const refreshing = signal(false)
  const error = signal('')
  const open = signal<Task | undefined>(undefined)
  const now = signal(Date.now())
  const load = async () => {
    try { tasks.set(tasksOf(await dsh().rpc('schedule/catalog', {}))); error.set(''); now.set(Date.now()) } catch (e) { error.set(readable(e)) } finally { loading.set(false) }
  }
  const pull = async () => { refreshing.set(true); await load(); refreshing.set(false) }
  load()
  // A delivery moves a task's next run and last result on the computer; a light poll keeps the list current.
  const timer = setInterval(load, 10_000)
  cleanup(() => clearInterval(timer))
  return (
    <View class="flex-1 bg-background">
      <ConnectionBar />
      <If when={error()}>
        <View class="mx-4 my-2 rounded-[10px] bg-secondary px-3 py-2 flex-row items-center gap-3">
          <Text class="flex-1 text-destructive text-[13px] leading-[18px]">{error()}</Text>
          <View role="button" testID="schedules-retry" onPress={() => { loading.set(true); load() }} hitSlop={8} class="active:opacity-60"><Text class="text-foreground text-[13px] font-medium">{S.retry}</Text></View>
        </View>
      </If>
      <List each={tasks()} keyExtractor={(t) => t.id} estimatedItemSize={88} refreshing={refreshing()} onRefresh={pull} testID="schedules" style={{ flex: 1 }} contentStyle={{ paddingTop: 4, paddingBottom: 24 }}>
        {(t) => <TaskRow task={t} now={now} onOpen={() => { haptic('tick'); open.set(t()) }} />}
      </List>
      <If when={!tasks().length && !error()}>
        <View class="absolute inset-0 items-center justify-center px-8 pointer-events-none">
          <Text class="text-muted-foreground text-[15px] leading-[22px] text-center">{loading() ? S.schedulesLoading : S.schedulesEmpty}</Text>
        </View>
      </If>
      <TaskSheet task={open} onClose={() => open.set(undefined)} onChanged={load} />
    </View>
  )
}

function Status(props: { active: boolean }) {
  return (
    <View class="rounded-full bg-secondary px-[8px] py-[2px]">
      <Text class={`text-[12px] ${props.active ? 'text-foreground' : 'text-muted-foreground'}`}>{props.active ? S.scheduleActive : S.scheduleInactive}</Text>
    </View>
  )
}

function TaskRow(props: { task: () => Task; now: () => number; onOpen: () => void }) {
  const t = props.task
  const next = () => nextRun(t(), props.now())
  const label = () => [t().title, frequency(t(), S, phoneZone), t().active ? S.scheduleActive : S.scheduleInactive, next() ? S.scheduleNext(next()!) : '', lastSent(t(), props.now())].filter(Boolean).join(S.factSep)
  return (
    <View role="button" testID={`schedule-${t().id}`} accessibilityLabel={label()} onPress={props.onOpen}
      class="mx-2 px-3 py-[10px] rounded-[10px] gap-[3px] active:bg-secondary transition-colors duration-150">
      <View class="flex-row items-center gap-2">
        <Text class="flex-1 text-foreground text-[15px] leading-5 line-clamp-2">{t().title}</Text>
        <Status active={t().active} />
      </View>
      <Text class="text-muted-foreground text-[13px] leading-[18px]">{frequency(t(), S, phoneZone)}</Text>
      <If when={next()}><Text class="text-muted-foreground text-[13px] leading-[18px]">{S.scheduleNext(next() ?? '')}</Text></If>
      <Text class="text-muted-foreground text-[12px] leading-[16px]">{lastSent(t(), props.now())}</Text>
    </View>
  )
}

/** One task: its rule, its instruction, its delivery records and the delete. */
function TaskSheet(props: { task: () => Task | undefined; onClose: () => void; onChanged: () => void }) {
  const records = signal<Delivery[]>([])
  const page = signal<Omit<HistoryPage, 'records'> | undefined>(undefined)
  const loading = signal(false)
  const problem = signal('')
  const confirming = signal(false)
  const deleting = signal(false)
  let epoch = 0 // an answer for a task the sheet no longer shows is dropped
  const loadHistory = async (task: Task, before?: string) => {
    const mine = ++epoch
    loading.set(true); problem.set('')
    try {
      const h = historyOf(await dsh().rpc('schedule/history', { request: { sessionId: task.sessionId, id: task.id, limit: HISTORY_PAGE, ...(before ? { before } : {}) } }))
      if (mine !== epoch) return
      if ('code' in h) { problem.set(h.code === 'schedule_not_found' ? S.scheduleGone : S.scheduleRecordsError); return }
      records.update((r) => (before ? [...r, ...h.records] : h.records))
      page.set({ nextBefore: h.nextBefore, pruned: h.pruned, unavailable: h.unavailable })
    } catch (e) { if (mine === epoch) problem.set(`${S.scheduleRecordsError} ${readable(e)}`) } finally { if (mine === epoch) loading.set(false) }
  }
  effect(() => {
    const task = props.task()
    untracked(() => { records.set([]); page.set(undefined); confirming.set(false); deleting.set(false); if (task) loadHistory(task); else epoch++ })
  })
  const remove = async () => {
    const task = props.task(); if (!task || deleting()) return
    deleting.set(true); problem.set('')
    try {
      const gone = deleted(await dsh().rpc('schedule/delete', { request: { sessionId: task.sessionId, id: task.id } }))
      haptic(gone ? 'confirm' : 'reject')
      if (gone) props.onClose(); else problem.set(S.scheduleGone)
      props.onChanged()
    } catch (e) { haptic('reject'); problem.set(`${S.scheduleDeleteFailed} ${readable(e)}`) } finally { deleting.set(false); confirming.set(false) }
  }
  const t = () => props.task()
  return (
    <Sheet open={Boolean(t())} onOpenChange={(e) => { if (!e.open) props.onClose() }} closeOnSwipe popupClass={SHEET} backdropStyle={SCRIM}>
      <View class="pt-3" style={{ paddingBottom: sheetBottom(), maxHeight: 640 }} testID="schedule-sheet">
        <Grabber />
        <Scroll class="px-5" style={{ flexShrink: 1 }}>
          <View class="flex-row items-start gap-2">
            <Text class="flex-1 text-foreground text-[17px] leading-[22px] font-semibold">{t()?.title ?? ''}</Text>
            <Status active={t()?.active ?? false} />
          </View>
          <Text class="mt-1 text-muted-foreground text-[13px] leading-[18px]">{t() ? frequency(t()!, S, phoneZone) : ''}</Text>
          <If when={t() && nextRun(t()!)}><Text class="text-muted-foreground text-[13px] leading-[18px]">{S.scheduleNext(t() ? nextRun(t()!) ?? '' : '')}</Text></If>
          <If when={t()?.prompt}><Text class="mt-3 text-foreground text-[15px] leading-[21px]">{t()?.prompt ?? ''}</Text></If>

          <Text class="mt-5 pb-[6px] text-muted-foreground text-[13px] font-medium">{S.scheduleRecords}</Text>
          <View class="rounded-[14px] border border-border bg-card overflow-hidden">
            <If when={records().length} else={
              <Text class="px-[14px] py-3 text-muted-foreground text-[13px]">{loading() ? S.scheduleRecordsLoading : problem() ? '' : S.scheduleRecordsEmpty}</Text>
            }>
              <Each of={records()} key={(r) => r.messageId}>{(r) => (
                <View class={`px-[14px] py-[10px] gap-[2px] ${records()[0]?.messageId === r().messageId ? '' : 'border-t border-border'}`}>
                  <Text class="text-foreground text-[13px] tabular-nums">{formatAt(r().scheduledAt)}</Text>
                  <If when={r().prompt}><Text class="text-muted-foreground text-[13px] leading-[18px] line-clamp-3">{r().prompt ?? ''}</Text></If>
                </View>
              )}</Each>
            </If>
          </View>
          <If when={page()?.nextBefore && !problem()}>
            <View role="button" testID="schedule-more" onPress={() => { const task = t(), before = page()?.nextBefore; if (task && before && !loading()) loadHistory(task, before) }}
              class="mt-2 self-center rounded-full border border-border px-4 min-h-[36px] justify-center active:bg-secondary">
              <Text class="text-foreground text-[13px] font-medium">{loading() ? S.scheduleRecordsLoading : S.scheduleMore}</Text>
            </View>
          </If>
          <If when={!page()?.nextBefore && records().length && (page()?.pruned || page()?.unavailable)}>
            <Text class="mt-2 text-muted-foreground text-[12px] leading-[16px]">{page()?.pruned ? S.schedulePruned : S.scheduleUnavailable}</Text>
          </If>
          <If when={problem()}><Text class="mt-2 text-destructive text-[13px] leading-[18px]">{problem()}</Text></If>

          <If when={confirming()} else={
            <View role="button" testID="schedule-delete" onPress={() => { haptic('tick'); confirming.set(true) }}
              class="mt-5 mb-2 rounded-[12px] min-h-[44px] justify-center items-center bg-secondary active:opacity-80">
              <Text class="text-destructive text-[15px] font-medium">{S.scheduleDelete}</Text>
            </View>
          }>
            <View class="mt-5 mb-2 rounded-[14px] border border-border bg-card p-[14px] gap-2" testID="schedule-delete-ask">
              <Text class="text-foreground text-[15px] font-semibold">{S.scheduleDeleteTitle}</Text>
              <Text class="text-muted-foreground text-[13px] leading-[18px]">{S.scheduleDeleteBody}</Text>
              <View class="flex-row gap-2 mt-1">
                <View role="button" testID="schedule-delete-cancel" onPress={() => confirming.set(false)} class="flex-1 rounded-[10px] min-h-[44px] justify-center items-center bg-secondary active:opacity-80">
                  <Text class="text-foreground text-[15px]">{S.cancel}</Text>
                </View>
                <View role="button" testID="schedule-delete-confirm" onPress={remove} accessibilityState={{ busy: deleting() }} class="flex-1 rounded-[10px] min-h-[44px] justify-center items-center bg-destructive active:opacity-80">
                  <Text class="text-white text-[15px] font-medium">{deleting() ? S.scheduleDeleting : S.scheduleDeleteConfirm}</Text>
                </View>
              </View>
            </View>
          </If>
        </Scroll>
      </View>
    </Sheet>
  )
}
