// A chat's menu, as DSH Desktop's sidebar has it: rename (session/rename), pin (workspace/pinSession), archive
// (workspace/archiveSession, stopping what it is doing) and bring back. The list updates from workspace/follow.
import { signal, Text, View, type InputRef } from 'nsh'
import { Input, Sheet } from 'nsh/base'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { chooseAction, Grabber, SCRIM, SHEET, sheetBottom, type SheetAction } from './ui.tsx'
import type { Summary } from './sessions.tsx'

export async function chatMenu(chat: Summary, state: { pinned: boolean; archived: boolean }, rename: () => void, onError: (m: string) => void, onForked: (chat: Summary) => void) {
  const actions: SheetAction[] = state.archived
    ? [{ id: 'unarchive', label: S.unarchive, icon: 'restore' }]
    : [{ id: 'rename', label: S.rename, icon: 'pencil' }, { id: 'fork', label: S.fork, icon: 'fork' }, { id: state.pinned ? 'unpin' : 'pin', label: state.pinned ? S.unpin : S.pin, icon: 'pin' }, { id: 'archive', label: S.archive, icon: 'archive', destructive: true }]
  try {
    const action = await chooseAction({ title: chat.title, actions })
    if (action === 'rename') rename()
    else if (action === 'fork') onForked(await forkChat(chat))
    else if (action) await chatAction(action as ChatAction, chat)
  } catch (e) { onError(readable(e)) }
}

/** A new chat with this one's history up to its last finished turn, in the same workspace (session/fork). */
export async function forkChat(chat: Summary): Promise<Summary> {
  const v = await dsh().rpc<{ sessionId: string }>('session/fork', { request: { sessionId: chat.sessionId } })
  return { ...chat, sessionId: v.sessionId, running: false, updatedAt: Date.now() }
}

export type ChatAction = 'pin' | 'unpin' | 'archive' | 'unarchive'
/** Pins, unpins, archives (stopping what it is doing) or brings back a chat; the list follows workspace/follow. */
export async function chatAction(action: ChatAction, chat: Summary) {
  const request = { sessionId: chat.sessionId }
  if (action === 'pin') await dsh().rpc('workspace/pinSession', { request })
  else if (action === 'unpin') await dsh().rpc('workspace/unpinSession', { request })
  else if (action === 'archive') await dsh().rpc('workspace/archiveSession', { request: { ...request, stopActivity: true } })
  else await dsh().rpc('workspace/unarchiveSession', { request })
}

export function RenameSheet(props: { chat: () => Summary | undefined; onClose: () => void; onRenamed: (sessionId: string, title: string) => void }) {
  const title = signal('')
  const error = signal('')
  const busy = signal(false)
  let input: InputRef | undefined
  const save = async () => {
    const chat = props.chat(), next = title().trim(); if (!chat || !next || busy()) return
    busy.set(true); error.set('')
    try { const v = await dsh().rpc<{ title: string }>('session/rename', { request: { sessionId: chat.sessionId, title: next } }); props.onRenamed(chat.sessionId, v.title ?? next); props.onClose() }
    catch (e) { error.set(readable(e)) } finally { busy.set(false) }
  }
  return (
    <Sheet open={Boolean(props.chat())} onOpen={() => { const t = props.chat()?.title ?? ''; title.set(t); error.set(''); setTimeout(() => input?.setSelection(t.length), 50) }} onOpenChange={(e) => { if (!e.open) props.onClose() }} closeOnSwipe popupClass={SHEET} backdropStyle={SCRIM}>
      <View class="px-5 pt-3 gap-3" style={{ paddingBottom: sheetBottom() }}>
        <Grabber />
        <Text class="text-foreground text-[15px] font-semibold">{S.rename}</Text>
        <Input ref={input} testID="rename" value={title()} onChange={(e) => title.set(e.value)} autoFocus returnKeyType="done" onSubmit={save}
          class="rounded-[10px] bg-secondary px-3 py-[10px] text-foreground text-[15px]" />
        <If when={error()}><Text class="text-destructive text-[13px]">{error()}</Text></If>
        <View role="button" testID="save-title" onPress={save} class={`rounded-[12px] h-[44px] justify-center items-center mb-2 ${title().trim() ? 'bg-primary active:opacity-80' : 'bg-secondary'}`}>
          <Text class={`text-[15px] font-medium ${title().trim() ? 'text-primary-foreground' : 'text-muted-foreground'}`}>{S.save}</Text>
        </View>
      </View>
    </Sheet>
  )
}
