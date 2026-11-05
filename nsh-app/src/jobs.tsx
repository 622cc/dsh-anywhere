// A chat's background jobs, as DSH Desktop lists them from its header: running ones, then finished ones; a job opens
// to its live output (job/follow while open) and stops with a second press to confirm (job/kill). The phone shows
// the running count docked above the composer in a subagent's chat (one with no activity panel); a press opens the list in a sheet.
import { cleanup, Keyboard, effect, signal, Scroll, Text, untracked, View } from 'nsh'
import { Sheet } from 'nsh/base'
import { dsh } from './state.ts'
import { duration, followJob, isLive, jobsOf, sections, type Job, type JobOutput } from './jobs.ts'
import { readable, S } from './strings.ts'
import { Grabber, haptic, Chevron, Icon, SCRIM, SHEET, sheetBottom, LiveDot } from './ui.tsx'

/** The chat's jobs, followed for as long as the chat is open. */
export function followJobs(sessionId: string, set: (jobs: Job[]) => void) {
  const stop = dsh().stream('job/list', { request: { sessionId } }, (frame) => { const jobs = jobsOf(frame); if (jobs) set(jobs) }, () => {})
  cleanup(stop)
}

export function JobsDock(props: { jobs: () => Job[]; onOpen: () => void }) {
  const live = () => props.jobs().filter(isLive).length
  return (
    <If when={live()}>
      <View role="button" testID="jobs" accessibilityLabel={S.jobsTitle} onPress={() => { haptic('tick'); Keyboard.dismiss(); props.onOpen() }}
        class="mb-2 flex-row items-center gap-2 rounded-[14px] border border-border bg-card px-[14px] min-h-[44px] active:bg-secondary">
        <Icon name="terminal" size={16} />
        <LiveDot />
        <Text class="flex-1 text-foreground text-[15px] line-clamp-1">{S.jobs(live(), props.jobs().length)}</Text>
        <Chevron dir="right" font={14} />
      </View>
    </If>
  )
}

export function JobsSheet(props: { open: () => boolean; onClose: () => void; sessionId: string; jobs: () => Job[] }) {
  const s = () => sections(props.jobs())
  return (
    <Sheet open={props.open()} onOpenChange={(e) => { if (!e.open) props.onClose() }} closeOnSwipe popupClass={SHEET} backdropStyle={SCRIM}>
      <View class="pt-3" style={{ paddingBottom: sheetBottom(), maxHeight: 640 }} testID="jobs-sheet">
        <Grabber />
        <Text class="px-5 pb-2 text-foreground text-[15px] font-semibold">{S.jobsTitle}</Text>
        <Scroll class="px-3" style={{ flexShrink: 1 }}>
          <If when={s().live.length}>
            <Text class="px-2 pt-1 pb-[6px] text-muted-foreground text-[13px]">{S.jobsRunning}</Text>
            <View class="rounded-[14px] border border-border bg-card overflow-hidden">
              <Each of={s().live} key={(j) => j.id}>{(j) => <JobRow sessionId={props.sessionId} job={j} divider={() => s().live[0]?.id !== j().id} />}</Each>
            </View>
          </If>
          <If when={s().settled.length}>
            <Text class="px-2 pt-3 pb-[6px] text-muted-foreground text-[13px]">{S.jobsFinished(s().settled.length)}</Text>
            <View class="rounded-[14px] border border-border bg-card overflow-hidden">
              <Each of={s().settled} key={(j) => j.id}>{(j) => <JobRow sessionId={props.sessionId} job={j} divider={() => s().settled[0]?.id !== j().id} />}</Each>
            </View>
          </If>
          <View class="h-3" />
        </Scroll>
      </View>
    </Sheet>
  )
}

// Keyed by job: a row keeps its open output while job/list sends new sets.
function JobRow(props: { sessionId: string; job: () => Job; divider: () => boolean }) {
  const open = signal(false)
  const confirming = signal(false)
  const problem = signal('')
  const output = signal<JobOutput>({ text: '', next: 0 })
  const now = signal(Date.now())
  const tick = setInterval(() => { if (isLive(props.job())) now.set(Date.now()) }, 1000)
  cleanup(() => clearInterval(tick))
  // The output streams only while the row is open.
  effect(() => {
    if (!open()) return
    const jobId = untracked(() => props.job().id)
    const stop = dsh().stream('job/follow', { request: { sessionId: props.sessionId, jobId } }, (f) => output.update((o) => followJob(o, f)), (e) => problem.set(readable(e)))
    cleanup(stop)
  })
  const stop = async () => {
    if (!confirming()) { haptic('tick'); confirming.set(true); setTimeout(() => confirming.set(false), 3000); return }
    confirming.set(false)
    try { await dsh().rpc('job/kill', { request: { sessionId: props.sessionId, jobId: props.job().id } }); haptic('confirm') } catch (e) { haptic('reject'); problem.set(`${S.jobStopFailed}: ${readable(e)}`) }
  }
  const j = props.job
  const took = () => duration((j().finishedAt ?? now()) - j().startedAt)
  return (
    <View class={props.divider() ? 'border-t border-border' : ''} testID={`job-${j().id}`}>
      <View role="button" accessibilityState={{ expanded: open() }} onPress={() => { haptic('tick'); open.set(!open()) }} class="flex-row items-center gap-3 px-[14px] min-h-[52px] py-[8px] active:bg-secondary">
        {isLive(j()) ? <LiveDot size={8} /> : <View class={`w-[8px] h-[8px] rounded-full ${j().status === 'completed' ? 'bg-muted-foreground' : 'bg-destructive'}`} />}
        <View class="flex-1 gap-[2px]">
          <Text class="text-foreground text-[15px] leading-[21px] line-clamp-2 font-mono">{j().label}</Text>
          <Text class="text-muted-foreground text-[12px]">{`${S.jobStatus[j().status]}, ${took()}`}</Text>
        </View>
        <If when={j().status === 'running'}>
          <View role="button" testID="job-stop" onPress={stop} hitSlop={6} class={`h-[30px] px-[12px] rounded-full items-center justify-center active:opacity-70 ${confirming() ? 'bg-destructive' : 'bg-secondary'}`}>
            <Text class={`text-[13px] font-medium ${confirming() ? 'text-white' : 'text-foreground'}`}>{confirming() ? S.jobConfirmStop : S.jobStop}</Text>
          </View>
        </If>
        <View class={`transition-transform duration-200 ${open() ? 'rotate-90' : 'rotate-0'}`}><Chevron dir="right" font={14} /></View>
      </View>
      <If when={problem()}><Text class="px-[14px] pb-2 text-destructive text-[12px]">{problem()}</Text></If>
      <If when={open()}>
        <Scroll class="mx-[14px] mb-[12px] rounded-[8px] bg-background border border-border" style={{ maxHeight: 220 }} testID="job-output">
          <Text class="px-[10px] py-[8px] font-mono text-[12px] leading-[16px] text-foreground">{output().text || S.jobNoOutput}</Text>
        </Scroll>
      </If>
    </View>
  )
}
