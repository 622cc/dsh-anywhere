// A chat's subagents, as DSH Desktop's header lists them: the children in a sheet, opened from the chat's activity
// panel or from a count ("2 subagents running") docked above the composer in a subagent’s chat; a child opens as its own chat. Running state and titles come from session/list,
// read every 5 s while the chat has children (the chat list's poll).
import { cleanup, Keyboard, computed, effect, signal, Scroll, Text, View } from 'nsh'
import { Sheet } from 'nsh/base'
import { dsh } from './state.ts'
import { children, opens, type Child, type Subagent } from './subagents.ts'
import { S } from './strings.ts'
import { Grabber, haptic, Chevron, Icon, SCRIM, SHEET, sheetBottom, LiveDot } from './ui.tsx'

/** The chat's children with whether each runs, read again every 5 s while the chat has any (the chat list's poll). */
export function followChildren(catalog: () => Subagent[]) {
  const listed = signal<unknown>(undefined)
  let asked = false
  const load = () => { if (catalog().length) dsh().rpc('session/list', { _request: {} }).then((v) => listed.set(v), () => {}) }
  const timer = setInterval(load, 5000)
  cleanup(() => clearInterval(timer))
  effect(() => { if (catalog().length && !asked) { asked = true; load() } })
  return { kids: computed(() => children(catalog(), listed())), load }
}

export function SubagentsDock(props: { kids: () => Child[]; onOpen: () => void }) {
  const running = () => props.kids().filter((k) => k.running).length
  return (
    <If when={running()}>
      <View role="button" testID="subagents" accessibilityLabel={S.subagentsTitle} onPress={() => { haptic('tick'); Keyboard.dismiss(); props.onOpen() }}
        class="mb-2 flex-row items-center gap-2 rounded-[14px] border border-border bg-card px-[14px] min-h-[44px] active:bg-secondary">
        <Icon name="bot" size={16} />
        <LiveDot />
        <Text class="flex-1 text-foreground text-[15px] line-clamp-1">{S.subagents(running(), props.kids().length)}</Text>
        <Chevron dir="right" font={14} />
      </View>
    </If>
  )
}

export function SubagentsSheet(props: { open: () => boolean; onClose: () => void; kids: () => Child[]; onOpen: (child: Child) => void }) {
  const kids = props.kids
  const choose = (k: Child) => { haptic('tick'); props.onClose(); props.onOpen(k) }
  return (
    <Sheet open={props.open()} onOpenChange={(e) => { if (!e.open) props.onClose() }} closeOnSwipe popupClass={SHEET} backdropStyle={SCRIM}>
      <View class="pt-3" style={{ paddingBottom: sheetBottom(), maxHeight: 640 }} testID="subagents-sheet">
        <Grabber />
        <Text class="px-5 pb-2 text-foreground text-[15px] font-semibold">{S.subagentsTitle}</Text>
        <Scroll class="px-3" style={{ flexShrink: 1 }}>
          <View class="rounded-[14px] border border-border bg-card overflow-hidden">
            <Each of={kids()} key={(k) => k.id}>{(k) => (
              <View role={opens(k()) ? 'button' : undefined} testID={`subagent-${k().id}`} onPress={opens(k()) ? () => choose(k()) : undefined}
                class={`flex-row items-center gap-3 px-[14px] min-h-[52px] py-[8px] ${kids()[0]?.id === k().id ? '' : 'border-t border-border'} ${opens(k()) ? 'active:bg-secondary' : ''}`}>
                {k().running ? <LiveDot size={8} /> : <View class="w-[8px] h-[8px] rounded-full bg-input" />}
                <View class="flex-1 gap-[2px]">
                  <Text class="text-foreground text-[15px] leading-[21px] line-clamp-2">{k().name}</Text>
                  <Text class="text-muted-foreground text-[12px]">{k().running ? `${S.subagentMode[k().mode]}, ${S.subagentRunning}` : S.subagentMode[k().mode]}</Text>
                </View>
                <If when={opens(k())}><Chevron dir="right" font={14} /></If>
              </View>
            )}</Each>
          </View>
          <View class="h-3" />
        </Scroll>
      </View>
    </Sheet>
  )
}
