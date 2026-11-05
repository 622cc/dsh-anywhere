// A new chat, as DSH Desktop starts one: in a workspace, with an agent preset (session/create; agentPresets/list).
// A workspace is added from a folder on the computer (workspace/create), picked in folderpicker.tsx: recent projects
// first, then the computer's folders, or a typed path.
import { effect, Scroll, signal, Text, untracked, View } from 'nsh'
import { Sheet } from 'nsh/base'
import { FolderPicker } from './folderpicker.tsx'
import { quickWorkspace } from './folders.ts'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { glide, Grabber, SCRIM, SHEET, sheetBottom, sheetMax } from './ui.tsx'
import type { ChatSummary, Workspace } from './workspaces.ts'

const LIST_MS = 2000

interface Preset { id: string; name: string; isDefault: boolean; broken: boolean }

export function NewChat(props: { open: () => boolean; workspaces: () => Workspace[]; chats: () => ChatSummary[]; workspaceId: () => string | undefined; onClose: () => void; onCreated: (sessionId: string, where?: Workspace) => void }) {
  const chosen = signal<string | undefined>(undefined)
  const presets = signal<Preset[]>([])
  const preset = signal<string | undefined>(undefined)
  const adding = signal(false)
  const busy = signal(false)
  const error = signal('')
  const workspace = () => chosen() ?? props.workspaceId() ?? props.workspaces()[0]?.workspaceId
  const loadPresets = async () => {
    try {
      const v = await dsh().rpc<{ presets?: any[] }>('agentPresets/list', {})
      const list = (v.presets ?? []).filter((p) => typeof p?.id === 'string').map((p) => ({ id: p.id, name: typeof p.name === 'string' && p.name ? p.name : p.id, isDefault: p.isDefault === true, broken: p.broken === true }))
      if (list.length > 1) glide()
      presets.set(list); preset.set(list.find((p) => p.isDefault)?.id ?? list[0]?.id)
    } catch (e) { error.set(readable(e)) }
  }
  const quick = signal(false)
  const create = async (id: string) => {
    const v = await dsh().rpc<{ sessionId: string }>('session/create', { request: { workspaceId: id, ...(preset() ? { agentPreset: preset() } : {}) } })
    props.onCreated(v.sessionId, props.workspaces().find((w) => w.workspaceId === id))
  }
  const start = async () => {
    const id = workspace(); if (!id || busy()) return
    busy.set(true); error.set('')
    try { await create(id) } catch (e) { error.set(readable(e)) } finally { busy.set(false) }
  }
  // No project picked: DSH's Default workspace (folders.ts quickWorkspace), at once.
  const startQuick = async () => {
    if (busy()) return
    busy.set(true); quick.set(true); error.set('')
    try { await create(await quickWorkspace(dsh(), props.workspaces())) } catch (e) { error.set(readable(e)) } finally { busy.set(false); quick.set(false) }
  }
  // As it starts to open: the Sheet's onOpen comes once it has finished rising, which would send a quick tap on Add workspace
  // back to the panel and start asking for the Agent row only then.
  let wasOpen = false
  effect(() => {
    const on = props.open()
    if (on && !wasOpen) untracked(() => { loadPresets(); chosen.set(undefined); adding.set(false); error.set('') })
    wasOpen = on
  })
  const row = 'flex-row items-center gap-3 px-5 py-[11px] active:bg-secondary'
  const showPicker = (on: boolean) => { glide(); adding.set(on) }
  // The list hears of a new workspace a moment after DSH adds it (workspace/follow). The panel comes back together with
  // its row, so the sheet changes height once; a list that stays silent does not keep the person in the picker.
  const awaited = signal<string | undefined>(undefined)
  let arrived = () => {}
  const backWith = (id: string) => new Promise<void>((done) => {
    const limit = setTimeout(() => arrived(), LIST_MS)
    arrived = () => { clearTimeout(limit); arrived = () => {}; awaited.set(undefined); chosen.set(id); showPicker(false); done() }
    awaited.set(id)
  })
  effect(() => { const id = awaited(); if (id && props.workspaces().some((w) => w.workspaceId === id)) arrived() })
  return (
    <Sheet open={props.open()} onOpenChange={(e) => { if (!e.open) props.onClose() }} closeOnSwipe popupClass={SHEET} backdropStyle={SCRIM}>
      <View class="pt-3" style={{ maxHeight: sheetMax(600), paddingBottom: sheetBottom() }}>
        <Grabber />
        <If when={adding()} else={
          <>
            <Text class="px-5 text-foreground text-[15px] font-semibold mb-2">{S.newChat}</Text>
            <View role="button" testID="quick-chat" onPress={startQuick} class="mx-5 mb-2 flex-row items-center gap-3 rounded-[12px] border border-border px-4 py-[10px] active:bg-secondary">
              <View class="flex-1">
                <Text class="text-foreground text-[15px] font-medium">{quick() ? S.starting : S.quickChat}</Text>
                <Text class="text-muted-foreground text-[12px]">{S.quickChatWhere}</Text>
              </View>
            </View>
            <Scroll style={{ flexShrink: 1 }} contentClass="pb-2">
              <Text class="px-5 pt-1 pb-1 text-muted-foreground text-[12px]">{S.workspace}</Text>
              {props.workspaces().map((w) => (
                <View role="button" testID={`workspace-${w.workspaceId}`} onPress={() => chosen.set(w.workspaceId)} class={row}>
                  <View class="flex-1"><Text class="text-foreground text-[15px]">{w.title}</Text><Text class="text-muted-foreground text-[12px] font-mono line-clamp-1">{w.path}</Text></View>
                  <Text class="text-foreground text-[15px]">{workspace() === w.workspaceId ? '✓' : ''}</Text>
                </View>
              ))}
              <View role="button" testID="add-workspace" onPress={() => { showPicker(true); error.set('') }} class={row}><Text class="text-muted-foreground text-[15px]">{S.addWorkspace}…</Text></View>
              <If when={presets().length > 1}>
                <Text class="px-5 pt-3 pb-1 text-muted-foreground text-[12px]">{S.agent}</Text>
                <View class="px-5 flex-row flex-wrap gap-2">
                  {presets().map((p) => (
                    <View role="button" testID={`preset-${p.id}`} onPress={() => { if (!p.broken) preset.set(p.id) }} class={`px-[12px] h-[30px] justify-center rounded-full border ${preset() === p.id ? 'bg-primary border-primary' : 'border-border'} ${p.broken ? 'opacity-40' : 'active:opacity-70'}`}>
                      <Text class={`text-[13px] ${preset() === p.id ? 'text-primary-foreground' : 'text-foreground'}`}>{p.name}</Text>
                    </View>
                  ))}
                </View>
              </If>
            </Scroll>
            <If when={error()}><Text class="px-5 pt-2 text-destructive text-[13px]">{error()}</Text></If>
            <View class="px-5 pt-3 pb-2">
              <View role="button" testID="start-chat" onPress={start} class={`rounded-[12px] h-[44px] justify-center items-center ${workspace() ? 'bg-primary active:opacity-80' : 'bg-secondary'}`}><Text class={`text-[15px] font-medium ${workspace() ? 'text-primary-foreground' : 'text-muted-foreground'}`}>{busy() && !quick() ? S.starting : S.startChat}</Text></View>
            </View>
          </>
        }>
          <FolderPicker workspaces={props.workspaces} chats={props.chats} onAdded={backWith} onBack={() => showPicker(false)} />
        </If>
      </View>
    </Sheet>
  )
}
