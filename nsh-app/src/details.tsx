// A chat's details, read-only: the model and effort, plan mode, the preset, context use as Desktop's meter counts
// it, the tokens spent, the goal and the background jobs. Values come from session/projections, read again every
// 5 s while the page is open (the chat list's poll); jobs from job/list, which the projections do not carry.
import { cleanup, signal, Scroll, Text, View, type JSX } from 'nsh'
import { presetLabel } from './controls.ts'
import { detailsOf, tokens, type Details } from './details.ts'
import { followJobs } from './jobs.tsx'
import { duration, isLive, sections, type Job } from './jobs.ts'
import { catalogOf, findModel, type Catalog } from './models.ts'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { ConnectionBar } from './status.tsx'
import { LiveDot } from './ui.tsx'

export function DetailsPage(props: { sessionId: string }) {
  const details = signal<Details | undefined>(undefined)
  const error = signal('')
  const catalog = signal<Catalog>({ groups: [] })
  const jobs = signal<Job[]>([])
  followJobs(props.sessionId, (j) => jobs.set(j))
  const load = async () => {
    try { details.set(detailsOf(await dsh().rpc('session/projections', { request: { sessionId: props.sessionId } }))); error.set('') } catch (e) { error.set(readable(e)) }
  }
  // Without the catalog the model reads as DSH's id.
  dsh().rpc('session/modelCatalog', {}).then((v) => catalog.set(catalogOf(v)), () => {})
  load()
  const timer = setInterval(load, 5000)
  cleanup(() => clearInterval(timer))
  return <DetailsView details={details} catalog={catalog} jobs={jobs} error={error} retry={() => { error.set(''); load() }} />
}

export function DetailsView(props: { details: () => Details | undefined; catalog: () => Catalog; jobs: () => Job[]; error: () => string; retry: () => void }) {
  const d = () => props.details()
  const model = () => findModel(props.catalog(), d()?.model)
  const effort = () => { const m = model(), id = d()?.model?.reasoningEffort ?? m?.defaultEffort; return id ? m?.efforts.find((e) => e.id === id)?.name ?? id : undefined }
  const plan = () => { const p = d()?.plan; return p ? (p.pending ? S.switching : p.active ? S.on : S.off) : undefined }
  const rows = () => [
    ...(d()?.model ? [{ label: S.model, value: model()?.name ?? d()!.model!.model }] : []),
    ...(effort() ? [{ label: S.thinking, value: effort()! }] : []),
    ...(plan() ? [{ label: S.planMode, value: plan()! }] : []),
    ...(d()?.preset ? [{ label: S.permissions, value: presetLabel(d()!.preset!, d()!.preset!) }] : []),
  ]
  const parts = () => { const b = d()?.breakdown; return b ? [{ label: S.contextSystem, value: `~${tokens(b.system)}` }, { label: S.contextTools, value: `~${tokens(b.tools)}` }, { label: S.contextMessages, value: `~${tokens(b.messages)}` }] : [] }
  const usage = () => { const u = d()?.usage; return u ? [{ label: S.usageInput, value: tokens(u.input) }, { label: S.usageCached, value: tokens(u.cacheRead) }, { label: S.usageCacheCreated, value: tokens(u.cacheWrite) }, { label: S.usageOutput, value: tokens(u.output) }] : [] }
  const listed = () => { const s = sections(props.jobs()); return [...s.live, ...s.settled] }
  const now = signal(Date.now())
  const tick = setInterval(() => { if (props.jobs().some(isLive)) now.set(Date.now()) }, 1000)
  cleanup(() => clearInterval(tick))
  return (
    <View class="flex-1 bg-background">
      <ConnectionBar />
      <If when={props.error()}>
        <View class="mx-4 mt-2 rounded-[10px] bg-secondary px-3 py-2 gap-2 flex-row items-center">
          <Text class="flex-1 text-muted-foreground text-[13px] leading-[18px]">{props.error()}</Text>
          <View role="button" testID="details-retry" onPress={props.retry} hitSlop={8} class="active:opacity-60"><Text class="text-foreground text-[13px] font-medium">{S.retry}</Text></View>
        </View>
      </If>
      <If when={!d() && !props.error()}>
        <View class="flex-1 items-center justify-center"><Text class="text-muted-foreground text-[15px]">{S.loading}</Text></View>
      </If>
      <If when={d()}>
        <Scroll style={{ flex: 1 }} contentClass="px-4 pt-2 pb-8" testID="details">
          <If when={rows().length}><Group>{rows().map((r, i) => <Row label={r.label} value={r.value} divider={i > 0} />)}</Group></If>
          <Label text={S.context} />
          <Group>
            <Each of={d()?.context ? [d()!.context!] : []} key={(c) => `${c.used}/${c.window}`}>{(c) => (
              <View class="px-[14px] py-3 gap-2" accessibilityLabel={`${S.contextUsed(c().percent)}, ~${tokens(c().used)} / ${tokens(c().window)}`}>
                <View class="flex-row flex-wrap items-baseline justify-between gap-x-3">
                  <Text class="text-foreground text-[15px]">{S.contextUsed(c().percent)}</Text>
                  <Text class="text-muted-foreground text-[13px] tabular-nums">{`~${tokens(c().used)} / ${tokens(c().window)}`}</Text>
                </View>
                <View class="h-[4px] rounded-full bg-secondary overflow-hidden"><View class="h-full rounded-full bg-muted-foreground" style={{ width: `${c().percent}%` }} /></View>
              </View>
            )}</Each>
            <If when={!d()?.context}><Row label={S.context} value={S.contextNotReported} /></If>
            {parts().map((r) => <Row label={r.label} value={r.value} divider />)}
          </Group>
          <If when={usage().length}>
            <Label text={S.usage} />
            <Group>{usage().map((r, i) => <Row label={r.label} value={r.value} divider={i > 0} />)}</Group>
          </If>
          <Label text={S.goal} />
          <Group>
            <If when={d()?.goal} else={<Text class="px-[14px] py-3 text-muted-foreground text-[15px]">{S.noGoal}</Text>}>
              <View class="px-[14px] py-3 gap-1" accessibilityLabel={`${S.goal}: ${d()?.goal?.objective}, ${S.goalPhase[d()?.goal?.phase ?? 'active']}`}>
                <Text class="text-foreground text-[15px] leading-[21px]">{d()?.goal?.objective}</Text>
                <Text class="text-muted-foreground text-[13px]">{S.goalPhase[d()?.goal?.phase ?? 'active']}</Text>
              </View>
            </If>
          </Group>
          <Label text={S.jobsTitle} />
          <Group>
            <If when={listed().length} else={<Text class="px-[14px] py-3 text-muted-foreground text-[15px]">{S.noJobs}</Text>}>
              <Each of={listed()} key={(j) => j.id}>{(j) => (
                <View class={`flex-row items-center gap-3 px-[14px] min-h-[52px] py-[8px] ${listed()[0]?.id === j().id ? '' : 'border-t border-border'}`}
                  accessibilityLabel={`${j().label}, ${S.jobStatus[j().status]}, ${duration((j().finishedAt ?? now()) - j().startedAt)}`}>
                  {isLive(j()) ? <LiveDot size={8} /> : <View class={`w-[8px] h-[8px] rounded-full ${j().status === 'completed' ? 'bg-muted-foreground' : 'bg-destructive'}`} />}
                  <View class="flex-1 gap-[2px]">
                    <Text class="text-foreground text-[15px] leading-[21px] line-clamp-2 font-mono">{j().label}</Text>
                    <Text class="text-muted-foreground text-[12px]">{`${S.jobStatus[j().status]}, ${duration((j().finishedAt ?? now()) - j().startedAt)}`}</Text>
                  </View>
                </View>
              )}</Each>
            </If>
          </Group>
        </Scroll>
      </If>
    </View>
  )
}

function Group(props: { children?: JSX.Element | JSX.Element[] }) { return <View class="rounded-[14px] bg-card border border-border overflow-hidden">{props.children}</View> }
function Label(props: { text: string }) { return <Text class="px-2 pt-5 pb-[6px] text-muted-foreground text-[13px] font-medium">{props.text}</Text> }
function Row(props: { label: string; value: string; divider?: boolean }) {
  return (
    <View accessibilityLabel={`${props.label}: ${props.value}`} class={`flex-row flex-wrap items-center justify-between gap-x-3 px-[14px] min-h-[44px] py-[10px] ${props.divider ? 'border-t border-border' : ''}`}>
      <Text class="text-foreground text-[15px]">{props.label}</Text>
      <Text class="shrink text-muted-foreground text-[15px] text-right">{props.value}</Text>
    </View>
  )
}
