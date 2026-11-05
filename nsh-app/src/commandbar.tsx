// Commands on the phone, as buttons in place of a terminal's key chords: the chat's controls (plan mode,
// permissions, goal, compact) in one sheet, each showing DSH's current value and sending the command the Desktop
// would; other commands and skills from the same sheet or by typing "/"; files, folders and chats by typing "@".
import { effect, signal, Scroll, Text, View, type JSX } from 'nsh'
import { Input, Sheet, Switch } from 'nsh/base'
import { confirmationFor, controlsOf, goalLine, permissionLine, planLine, presetLabel, presetsOf, type Controls, type Preset } from './controls.ts'
import type { Command, Reference, Skill, Suggestion } from './commands.ts'
import { isSuggestion, referenceText } from './commands.ts'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { Grabber, haptic, Icon, SCRIM, SHEET, sheetBottom, sheetMax, type IconName } from './ui.tsx'

/** Runs a command line through commands/execute; resolves to the error to show, if any. */
export type Run = (line: string) => Promise<string | undefined>

export function ControlsSheet(props: { open: () => boolean; onClose: () => void; sessionId: string; commands: () => Command[]; skills: () => Skill[]; run: Run; insert: (text: string) => void; reload: () => void }) {
  const controls = signal<Controls>(controlsOf(null))
  const presets = signal<Preset[]>([])
  const busy = signal('')
  const problem = signal('')
  const goal = signal('')
  const confirming = signal<string | undefined>(undefined)
  const refresh = async () => { try { controls.set(controlsOf(await dsh().rpc('session/projections', { request: { sessionId: props.sessionId } }))) } catch (e) { problem.set(readable(e)) } }
  const opened = async () => {
    problem.set(''); goal.set(''); confirming.set(undefined); props.reload(); refresh()
    try { presets.set(presetsOf(await dsh().rpc('permissionPresets/catalog', {}))) } catch { presets.set([]) }
  }
  const send = async (key: string, line: string) => {
    if (busy()) return
    busy.set(key); problem.set('')
    const failed = await props.run(line)
    busy.set('')
    if (failed) { haptic('reject'); problem.set(failed) } else haptic('confirm')
    await refresh()
  }
  // Full access and Auto review ask first, with the Desktop's words.
  const choosePreset = (value: string) => {
    if (controls().preset === value || busy()) return
    if (confirmationFor(value)) { haptic('tick'); confirming.set(value) } else { confirming.set(undefined); send(`preset-${value}`, permissionLine(value)) }
  }
  const describe = (p: Preset) => p.description || (p.value === 'auto' ? S.autoDescription : '')
  const shown = new Set(['plan', 'permission', 'goal', 'compact'])
  const others = () => props.commands().filter((c) => !shown.has(c.name))
  const pick = (text: string) => { props.onClose(); props.insert(text) }
  const g = () => controls().goal
  return (
    <Sheet open={props.open()} onOpen={opened} onOpenChange={(e) => { if (!e.open) props.onClose() }} closeOnSwipe popupClass={SHEET} backdropStyle={SCRIM}>
      <View class="pt-3" style={{ paddingBottom: sheetBottom(), maxHeight: sheetMax(640) }} testID="controls">
        <Grabber />
        <Text class="px-5 pb-2 text-foreground text-[15px] font-semibold">{S.controls}</Text>
        <Scroll class="px-3" style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" testID="controls-scroll">
          <If when={problem()}><Text class="mx-2 mb-2 text-destructive text-[13px] leading-[18px]">{problem()}</Text></If>
          <Group>
            <View class="flex-row items-center gap-3 px-[14px] py-3">
              <View class="flex-1 gap-[2px]">
                <Text class="text-foreground text-[15px]">{S.planMode}</Text>
                <Text class="text-muted-foreground text-[13px] leading-[18px]">{controls().planPending || busy() === 'plan' ? S.switching : S.planHint}</Text>
              </View>
              <Switch testID="plan" accessibilityLabel={S.planMode} checked={controls().plan} disabled={Boolean(busy())} onChange={(e) => send('plan', planLine(e.checked))}
                class="w-[46px] h-[28px] disabled:opacity-50" trackClass="w-full h-full rounded-full bg-input checked:bg-primary justify-center px-[3px] transition-colors duration-150"
                thumbClass="w-[22px] h-[22px] rounded-full bg-background shadow-sm checked:translate-x-[18px] transition-transform duration-150" />
            </View>
          </Group>
          <If when={presets().length}>
            <Label text={S.permissions} />
            <Group>
              {presets().map((p, i) => (
                <View role="radio" testID={`preset-${p.value}`} accessibilityLabel={presetLabel(p.value, p.name)} onPress={() => choosePreset(p.value)}
                  class={`flex-row items-center gap-3 px-[14px] py-[11px] active:bg-secondary ${i ? 'border-t border-border' : ''}`}>
                  <View class="flex-1 gap-[2px]">
                    <Text class="text-foreground text-[15px]">{presetLabel(p.value, p.name)}</Text>
                    <If when={describe(p)}><Text class="text-muted-foreground text-[13px] leading-[18px]">{describe(p)}</Text></If>
                  </View>
                  <If when={controls().preset === p.value}><Icon name="check" size={18} class="tint-foreground" /></If>
                </View>
              ))}
            </Group>
            <Each of={confirming() ? [confirming()!] : []} key={(v) => v}>{(v) => { const c = confirmationFor(v())!; return (
              <View class="mt-2 rounded-[14px] border border-destructive px-[14px] py-3 gap-2" testID="preset-confirm">
                <Text class="text-foreground text-[15px] font-semibold">{c.title}</Text>
                <Text class="text-muted-foreground text-[13px] leading-[19px]">{c.description}</Text>
                <View class="flex-row justify-end gap-2 pt-1">
                  <Pill label={S.cancel} testID="preset-cancel" onPress={() => confirming.set(undefined)} />
                  <View role="button" testID="preset-enable" onPress={() => { confirming.set(undefined); send(`preset-${v()}`, permissionLine(v())) }} hitSlop={6} class="h-[30px] px-[12px] rounded-full bg-destructive items-center justify-center active:opacity-80">
                    <Text class="text-white text-[13px] font-medium">{c.enable}</Text>
                  </View>
                </View>
              </View>
            ) }}</Each>
          </If>
          <Label text={S.goal} />
          <Group>
            <If when={g()} else={
              <View class="flex-row items-center gap-2 pl-[14px] pr-[6px] py-[6px]">
                <Input testID="goal-input" value={goal()} onChange={(e) => goal.set(e.value)} placeholder={S.goalPlaceholder} returnKeyType="done"
                  onSubmit={() => { if (goal().trim()) send('goal', goalLine({ set: goal() })) }}
                  class="flex-1 bg-transparent py-[8px] text-foreground placeholder:text-muted-foreground text-[15px]" />
                <Pill label={S.save} testID="goal-set" disabled={!goal().trim()} onPress={() => send('goal', goalLine({ set: goal() }))} />
              </View>
            }>
              <View class="px-[14px] pt-3 pb-[10px] gap-2">
                <Text class="text-foreground text-[15px] leading-[21px]" testID="goal-objective">{g()?.objective}</Text>
                <View class="flex-row items-center gap-2">
                  <Text class="flex-1 text-muted-foreground text-[13px]">{S.goalPhase[g()?.phase ?? 'active']}</Text>
                  <If when={g()?.phase === 'active'}><Pill label={S.pause} testID="goal-pause" onPress={() => send('goal', goalLine('pause'))} /></If>
                  <If when={g()?.phase === 'paused' || g()?.phase === 'blocked'}><Pill label={S.resume} testID="goal-resume" onPress={() => send('goal', goalLine('resume'))} /></If>
                  <Pill label={S.clear} testID="goal-clear" onPress={() => send('goal', goalLine('clear'))} />
                </View>
              </View>
            </If>
          </Group>
          <Group class="mt-3">
            <Row icon="archive" title={S.compact} detail={busy() === 'compact' ? S.sending : S.compactHint} testID="compact" onPress={() => send('compact', '/compact')} />
          </Group>
          <If when={others().length}>
            <Label text={S.moreCommands} />
            <Group>{others().map((c, i) => <Row title={`/${c.name}${c.hint ? ` ${c.hint}` : ''}`} detail={c.description} divider={i > 0} testID={`command-${c.name}`} onPress={() => pick(`/${c.name} `)} />)}</Group>
          </If>
          <If when={props.skills().length}>
            <Label text={S.skills} />
            <Group>{props.skills().map((s, i) => <Row title={`/${s.name}`} detail={s.description} divider={i > 0} testID={`skill-${s.name}`} onPress={() => pick(`/${s.name} `)} />)}</Group>
          </If>
          <View class="h-3" />
        </Scroll>
      </View>
    </Sheet>
  )
}

function Group(props: { children?: JSX.Element | JSX.Element[]; class?: string }) { return <View class={`rounded-[14px] bg-card border border-border overflow-hidden ${props.class ?? ''}`}>{props.children}</View> }
function Label(props: { text: string }) { return <Text class="px-2 pt-4 pb-[6px] text-muted-foreground text-[13px] font-medium">{props.text}</Text> }
function Pill(props: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) {
  return (
    <View role="button" testID={props.testID} onPress={() => { if (!props.disabled) props.onPress() }} hitSlop={6}
      class={`h-[30px] px-[12px] rounded-full items-center justify-center ${props.disabled ? 'bg-secondary opacity-50' : 'bg-secondary active:opacity-70'}`}>
      <Text class="text-foreground text-[13px] font-medium">{props.label}</Text>
    </View>
  )
}
function Row(props: { icon?: IconName; title: string; detail?: string; onPress: () => void; testID?: string; divider?: boolean }) {
  return (
    <View role="button" testID={props.testID} onPress={props.onPress} class={`flex-row items-center gap-3 px-[14px] py-[11px] active:bg-secondary ${props.divider ? 'border-t border-border' : ''}`}>
      {props.icon ? <Icon name={props.icon} size={18} class="tint-muted-foreground" /> : null}
      <View class="flex-1 gap-[2px]">
        <Text class="text-foreground text-[15px] line-clamp-1">{props.title}</Text>
        <If when={props.detail}><Text class="text-muted-foreground text-[13px] leading-[18px] line-clamp-2">{props.detail}</Text></If>
      </View>
    </View>
  )
}

/** What fits the word being typed: commands and skills after a "/", files, folders and chats after an "@". */
export function Suggestions(props: { items: () => (Suggestion | Reference)[]; onPick: (item: Suggestion | Reference) => void }) {
  // A command already starts with its "/"; a reference says by its icon what it points at.
  const icon = (i: Suggestion | Reference): IconName | undefined => (isSuggestion(i) ? undefined : i.kind === 'directory' ? 'folder' : i.kind === 'chat' ? 'message' : 'file')
  const title = (i: Suggestion | Reference) => (isSuggestion(i) ? `/${i.name}${i.kind === 'command' && i.hint ? ` ${i.hint}` : ''}` : i.kind === 'chat' ? i.label : referenceText(i).replace(/^@"?|"$/g, ''))
  const detail = (i: Suggestion | Reference) => (isSuggestion(i) ? i.description : '')
  return (
    <If when={props.items().length}>
      <View class="mb-2 rounded-[14px] border border-border bg-card py-[2px] max-h-[264px] overflow-hidden" testID="suggestions">
        <Scroll keyboardShouldPersistTaps="always">
          {props.items().slice(0, 8).map((i) => (
            <View role="button" testID={`suggest-${title(i)}`} onPress={() => { haptic('tick'); props.onPick(i) }} class="flex-row items-center gap-3 px-[14px] min-h-[44px] py-[6px] active:bg-secondary">
              {icon(i) ? <Icon name={icon(i)!} size={16} class="tint-muted-foreground" /> : null}
              <Text class="text-foreground text-[15px] line-clamp-1 shrink-0 max-w-[60%]">{title(i)}</Text>
              <Text class="flex-1 text-muted-foreground text-[13px] line-clamp-1">{detail(i)}</Text>
            </View>
          ))}
        </Scroll>
      </View>
    </If>
  )
}

/** File, folder and chat references for the "@word", asked of DSH a moment after typing stops. */
export function followReferences(sessionId: string, query: () => string | undefined, set: (items: Reference[]) => void, referencesOf: (files: unknown, chats: unknown) => Reference[]) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let asked = 0
  effect(() => {
    const q = query(); clearTimeout(timer)
    if (q === undefined) { set([]); return }
    const n = ++asked
    timer = setTimeout(async () => {
      const [files, chats] = await Promise.all([
        dsh().rpc('fileReferences/list', { agentId: sessionId, query: q }).catch(() => []),
        dsh().rpc('sessionReferenceResolver/candidates', { agentId: sessionId, query: q }).catch(() => []),
      ])
      if (n === asked) set(referencesOf(files, chats))
    }, 150)
  })
}
