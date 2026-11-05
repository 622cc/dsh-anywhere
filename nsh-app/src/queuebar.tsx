// The queue above the composer, as Codex's and t3code's apps show it: what was sent while the agent worked waits
// here, not in the chat. Steer hands it to the running turn now; a press edits it; ✕ takes it back.
// Changes go through session/updateQueue; the list itself follows DSH's inbox.
import { effect, LayoutAnimation, signal, Text, View, type InputRef } from 'nsh'
import { Input, Sheet } from 'nsh/base'
import { S } from './strings.ts'
import { Grabber, haptic, IconButton, SCRIM, SHEET, sheetBottom } from './ui.tsx'
import type { Waiting } from './queue.ts'

export function QueueBar(props: { items: () => Waiting[]; running: () => boolean; steer: (w: Waiting) => void; remove: (w: Waiting) => void; edit: (w: Waiting, text: string) => Promise<void>; retry: (w: Waiting) => void }) {
  const editing = signal<Waiting | undefined>(undefined)
  let count = props.items().length
  effect(() => { const n = props.items().length; if (n !== count) { count = n; LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity')) } })
  return (
    <>
      <If when={props.items().length}>
        <View class="mb-2 rounded-[14px] border border-border bg-card py-[2px]" testID="queue">
          {props.items().map((w) => (
            <View role="button" testID={`queued-${w.state}`} accessibilityLabel={w.text} onPress={() => { if (w.state === 'failed') props.retry(w); else if (w.item && !w.item.steering) editing.set(w) }}
              class="flex-row items-center gap-2 pl-[14px] pr-[4px] min-h-[44px] active:bg-secondary">
              <Text class={`flex-1 text-[15px] leading-[21px] line-clamp-1 ${w.state === 'sending' ? 'text-muted-foreground' : 'text-foreground'}`}>{w.text}</Text>
              <If when={w.state === 'failed'}><Text class="text-destructive text-[12px]">{S.notSentShort}</Text></If>
              <If when={w.state === 'sending'}><Text class="text-muted-foreground text-[12px] pr-[10px]">{S.sending}</Text></If>
              <If when={w.item?.steering}><Text class="text-muted-foreground text-[12px]">{S.steering}</Text></If>
              <If when={w.item && !w.item.steering && props.running()}>
                <View role="button" testID="steer" accessibilityLabel={S.steerHint} onPress={() => { haptic('tick'); props.steer(w) }} hitSlop={6}
                  class="h-[28px] px-[12px] rounded-full bg-secondary items-center justify-center active:opacity-70">
                  <Text class="text-foreground text-[13px] font-medium">{S.steer}</Text>
                </View>
              </If>
              <If when={w.state !== 'sending'}>
                <IconButton name="x" label={S.removeQueued} testID="unqueue" onPress={() => props.remove(w)} size={16} class="w-[32px] h-[32px]" iconClass="tint-muted-foreground" />
              </If>
            </View>
          ))}
        </View>
      </If>
      <EditSheet item={editing} onClose={() => editing.set(undefined)} save={props.edit} />
    </>
  )
}

function EditSheet(props: { item: () => Waiting | undefined; onClose: () => void; save: (w: Waiting, text: string) => Promise<void> }) {
  const text = signal('')
  const busy = signal(false)
  let input: InputRef | undefined
  const save = async () => {
    const w = props.item(), next = text().trim(); if (!w || !next || busy()) return
    busy.set(true)
    try { await props.save(w, next); props.onClose() } finally { busy.set(false) }
  }
  return (
    <Sheet open={Boolean(props.item())} onOpen={() => { const t = props.item()?.text ?? ''; text.set(t); setTimeout(() => input?.setSelection(t.length), 50) }} onOpenChange={(e) => { if (!e.open) props.onClose() }} closeOnSwipe popupClass={SHEET} backdropStyle={SCRIM}>
      <View class="px-5 pt-3 gap-3" style={{ paddingBottom: sheetBottom() }}>
        <Grabber />
        <Text class="text-foreground text-[15px] font-semibold">{S.editQueued}</Text>
        <Input ref={input} testID="queued-text" value={text()} onChange={(e) => text.set(e.value)} autoFocus multiline submitBehavior="newline"
          class="rounded-[10px] bg-secondary px-3 py-[10px] text-foreground text-[15px] leading-[22px] max-h-[160px]" />
        <View role="button" testID="save-queued" onPress={save} class={`rounded-[12px] h-[44px] justify-center items-center mb-2 ${text().trim() ? 'bg-primary active:opacity-80' : 'bg-secondary'}`}>
          <Text class={`text-[15px] font-medium ${text().trim() ? 'text-primary-foreground' : 'text-muted-foreground'}`}>{S.save}</Text>
        </View>
      </View>
    </Sheet>
  )
}
