// The new-chat sheet's "Add workspace": recent projects first, then the computer's folders one level at a time, with
// crumbs to go back up, a search that filters both as one types, and a typed path (from "/" or "~"). A folder that does
// not exist is said so, with Create folder and Cancel; the rules are in folders.ts.
import { Scroll, signal, Text, View } from 'nsh'
import { Input } from 'nsh/base'
import { addFolder, createAndAdd, FolderSource, matching, recentProjects, typedPath, type AddOutcome, type FolderEntry, type FolderListing } from './folders.ts'
import { shortPath } from './files.ts'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { Chevron, glide, Icon, IconButton } from './ui.tsx'
import type { Workspace } from './workspaces.ts'

type Problem = Exclude<AddOutcome, { kind: 'added' }>
const row = 'flex-row items-center gap-3 px-5 py-[10px] min-h-[48px] active:bg-secondary'

export function FolderPicker(props: { workspaces: () => Workspace[]; chats: () => { sessionId: string; updatedAt: number }[]; onAdded: (workspaceId: string) => Promise<void>; onBack: () => void }) {
  const io = dsh()
  const source = new FolderSource(io)
  const listing = signal<FolderListing | undefined>(undefined)
  const loading = signal(true)
  const failure = signal('')
  const query = signal('')
  const showHidden = signal(false)
  const busy = signal('')
  const problem = signal<Problem | undefined>(undefined)
  const error = signal('')
  let asked = 0
  let last: string | undefined
  const browse = async (path?: string) => {
    const n = ++asked; last = path
    loading.set(true); failure.set(''); error.set(''); problem.set(undefined)
    try { const l = await source.list(path); if (n === asked) { glide(); listing.set(l); if (path !== undefined) query.set('') } }
    catch (e) { if (n === asked) { glide(); failure.set(readable(e)) } }
    finally { if (n === asked) loading.set(false) }
  }
  browse()

  const home = () => listing()?.home || undefined
  const atTop = () => !listing() || listing()!.path === listing()!.home
  const typed = () => typedPath(query(), home())
  const search = () => (typed() ? '' : query())
  const recent = () => (atTop() ? matching(search(), recentProjects(props.workspaces(), props.chats()), (w) => [w.title, w.path]) : [])
  const entries = () => matching(search(), (listing()?.entries ?? []).filter((e) => showHidden() || !e.hidden), (e) => [e.name])
  const crumbs = () => listing()?.crumbs ?? []
  const crumbName = (c: FolderEntry, i: number) => (i === 0 && c.path === home() ? S.homeFolder : i === 0 ? shortPath(c.name, 24) : c.name)
  const here = () => { const c = crumbs(); return c.length ? crumbName(c.at(-1)!, c.length - 1) : '' }

  const add = async (path: string) => {
    if (busy()) return
    busy.set(S.adding); error.set(''); problem.set(undefined)
    try { const o = await addFolder(io, path); if (o.kind === 'added') await props.onAdded(o.workspaceId); else problem.set(o) }
    catch (e) { error.set(readable(e)) } finally { busy.set('') }
  }
  const create = async () => {
    const p = problem(); if (p?.kind !== 'missing' || busy()) return
    busy.set(S.creatingFolder); error.set('')
    try { const o = await createAndAdd(io, p); if (o.kind === 'added') await props.onAdded(o.workspaceId); else problem.set(o) }
    catch (e) { error.set(readable(e)) } finally { busy.set('') }
  }

  return (
    <View style={{ flexShrink: 1 }}>
      <View class="flex-row items-center pl-5 pr-3 mb-1">
        <Text class="flex-1 text-foreground text-[15px] font-semibold">{S.addWorkspace}</Text>
        <View role="button" testID="show-hidden" accessibilityLabel={showHidden() ? S.hideHidden : S.showHidden} accessibilityState={{ checked: showHidden() }}
          onPress={() => { glide(); showHidden.update((v) => !v) }} class="px-2 py-[6px] rounded-[8px] active:bg-secondary">
          <Text class={`text-[13px] ${showHidden() ? 'text-foreground' : 'text-muted-foreground'}`}>{showHidden() ? S.hideHidden : S.showHidden}</Text>
        </View>
      </View>
      <View class="mx-4 mb-1 flex-row items-center gap-2 rounded-[10px] bg-secondary px-[10px]">
        <Icon name="search" size={16} />
        <Input testID="folder-search" placeholder={S.folderSearch} value={query()} onChange={(e) => { query.set(e.value); problem.set(undefined); error.set('') }}
          autoCapitalize="none" autoCorrect={false} returnKeyType="go" onSubmit={() => { if (typed()) add(typed()!) }}
          class="flex-1 bg-transparent py-[8px] text-foreground placeholder:text-muted-foreground text-[15px]" />
        <If when={query()}><IconButton name="x" label={S.clear} onPress={() => query.set('')} size={16} class="w-[28px] h-[28px]" iconClass="tint-muted-foreground" /></If>
      </View>
      <If when={typed()}>
        <View role="button" testID="add-typed" accessibilityLabel={S.addPath(typed() ?? '')} onPress={() => add(typed()!)} class={row}>
          <Icon name="plus" size={18} class="tint-foreground" />
          <Text class="flex-1 text-foreground text-[15px] leading-[21px] font-mono line-clamp-2">{S.addPath(typed() ?? '')}</Text>
        </View>
      </If>
      <If when={crumbs().length > 0}>
        <View class="flex-row flex-wrap items-center px-4 pb-1" testID="crumbs">
          {crumbs().map((c, i) => (
            <View class="flex-row items-center">
              <If when={i > 0}><Chevron dir="right" font={12} /></If>
              <View role="button" testID={`crumb-${i}`} accessibilityLabel={crumbName(c, i)} onPress={() => browse(c.path)} class="px-[6px] py-[6px] rounded-[6px] active:bg-secondary">
                <Text class={`text-[13px] ${i === crumbs().length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{crumbName(c, i)}</Text>
              </View>
            </View>
          ))}
        </View>
      </If>
      <Scroll style={{ flexShrink: 1 }} contentClass="pb-2">
        <If when={recent().length > 0}>
          <Text class="px-5 pt-2 pb-1 text-muted-foreground text-[12px]">{S.recentProjects}</Text>
          {recent().map((w) => (
            <View role="button" testID={`recent-${w.workspaceId}`} accessibilityLabel={`${w.title}, ${w.path}`} onPress={() => browse(w.path)} class={row}>
              <Icon name="folder" size={18} />
              <View class="flex-1"><Text class="text-foreground text-[15px] leading-[21px] line-clamp-1">{w.title}</Text><Text class="text-muted-foreground text-[12px] leading-[17px] font-mono line-clamp-1">{w.path}</Text></View>
              <Chevron dir="right" font={14} />
            </View>
          ))}
        </If>
        <If when={crumbs().length > 1}>
          <View role="button" testID="folder-up" accessibilityLabel={S.upTo(crumbName(crumbs().at(-2)!, crumbs().length - 2))} onPress={() => browse(crumbs().at(-2)!.path)} class={row}>
            <View class="rotate-180"><Chevron dir="right" font={15} /></View>
            <Text class="flex-1 text-muted-foreground text-[15px] leading-[21px] line-clamp-1">{crumbName(crumbs().at(-2)!, crumbs().length - 2)}</Text>
          </View>
        </If>
        <If when={atTop() && listing() && entries().length > 0}><Text class="px-5 pt-3 pb-1 text-muted-foreground text-[12px]">{S.foldersIn(here())}</Text></If>
        {entries().map((e) => (
          <View role="button" testID={`folder-${e.name}`} accessibilityLabel={`${e.name}, ${S.folder}`} onPress={() => browse(e.path)} class={row}>
            <Icon name="folder" size={18} />
            <Text class={`flex-1 text-[15px] leading-[21px] line-clamp-2 ${e.hidden ? 'text-muted-foreground' : 'text-foreground'}`}>{e.name}</Text>
            <Chevron dir="right" font={14} />
          </View>
        ))}
        <If when={listing()?.truncated}><Text class="px-5 pt-2 text-muted-foreground text-[12px]">{S.foldersTruncated}</Text></If>
        <If when={loading()}><Text class="px-5 py-4 text-muted-foreground text-[15px]">{S.filesLoading}</Text></If>
        <If when={!loading() && !failure() && listing() && !entries().length}>
          <Text class="px-5 py-4 text-muted-foreground text-[15px]">{search().trim() ? S.noFolderMatches : S.noFolders}</Text>
        </If>
        <If when={failure()}>
          <View class="px-5 py-3 gap-2 items-start">
            <Text class="text-muted-foreground text-[15px] leading-[21px]">{failure()}</Text>
            <View role="button" testID="folders-retry" accessibilityLabel={S.retry} onPress={() => browse(last)} class="px-4 min-h-[40px] rounded-[10px] bg-secondary items-center justify-center active:opacity-70">
              <Text class="text-foreground text-[15px] font-medium">{S.retry}</Text>
            </View>
          </View>
        </If>
      </Scroll>
      <If when={problem()}>
        <View class="mx-4 mt-2 rounded-[12px] bg-secondary px-4 py-3 gap-2" testID="folder-problem">
          <If when={problem()?.kind === 'missing'}>
            <Text class="text-foreground text-[15px] leading-[21px] font-medium">{S.folderMissing}</Text>
            <Text class="text-muted-foreground text-[13px] leading-[18px]">{problem()?.kind === 'missing' ? S.createIn((problem() as Extract<Problem, { kind: 'missing' }>).name, (problem() as Extract<Problem, { kind: 'missing' }>).parent) : ''}</Text>
            <View class="flex-row gap-2 pt-1">
              <View role="button" testID="create-folder" accessibilityLabel={S.createFolder} onPress={create} class="flex-1 rounded-[10px] bg-primary py-[10px] items-center active:opacity-80">
                <Text class="text-primary-foreground text-[15px] font-medium">{busy() || S.createFolder}</Text>
              </View>
              <View role="button" testID="cancel-create" accessibilityLabel={S.cancel} onPress={() => problem.set(undefined)} class="flex-1 rounded-[10px] border border-border py-[10px] items-center active:opacity-70">
                <Text class="text-foreground text-[15px]">{S.cancel}</Text>
              </View>
            </View>
          </If>
          <If when={problem()?.kind === 'missing-parent'}>
            <Text class="text-foreground text-[15px] leading-[21px] font-medium">{S.folderMissing}</Text>
            <Text class="text-muted-foreground text-[13px] leading-[18px]">{problem()?.kind === 'missing-parent' ? S.parentMissing((problem() as Extract<Problem, { kind: 'missing-parent' }>).parent) : ''}</Text>
          </If>
          <If when={problem()?.kind === 'not-directory'}><Text class="text-foreground text-[15px] leading-[21px]">{S.notAFolder}</Text></If>
        </View>
      </If>
      <If when={error()}><Text class="px-5 pt-2 text-destructive text-[13px] leading-[18px]">{error()}</Text></If>
      <If when={listing() && !problem()}>
        <View class="px-5 pt-3 pb-1">
          <View role="button" testID="use-folder" accessibilityLabel={`${S.addThisFolder}: ${listing()?.path ?? ''}`} onPress={() => add(listing()!.path)} class="rounded-[10px] bg-primary py-3 items-center active:opacity-80">
            <Text class="text-primary-foreground text-[15px] font-medium">{busy() || S.addThisFolder}</Text>
          </View>
        </View>
      </If>
      <View role="button" testID="folders-back" onPress={props.onBack} class="px-5 py-3 items-center active:opacity-60"><Text class="text-muted-foreground text-[15px]">{S.back}</Text></View>
    </View>
  )
}
