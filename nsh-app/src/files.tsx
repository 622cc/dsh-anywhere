// The workspace browser: a chat's folders and files, read-only, one page per folder and per file (App.tsx stacks them,
// so back goes up). A folder lists through workspaceFiles/list; text reads a page of lines at a time
// (workspaceFiles/read); the four image types are read whole (workspaceFiles/readBytes); anything else is described,
// with a way to mention it in the chat. Nothing here writes.
import { cleanup, fontScale, Image, List, signal, Text, View } from 'nsh'
import { NavPage } from 'nsh/base'
import { sizeLabel } from './attach.ts'
import { addPage, childPath, imageType, listingOf, listPath, mention, nameOf, pageOf, previewKind, problemOf, shortPath, smallerLimit, typeLabel, PAGE_LINES, type Doc, type FileEntry, type Listing, type Problem } from './files.ts'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { ConnectionBar } from './status.tsx'
import { Chevron, Icon } from './ui.tsx'

/** Larger pictures are described instead: readBytes sends the whole file, and the phone holds it twice to show it. */
const IMAGE_MAX = 10_000_000
interface Failed { problem: Problem; text: string }
const scope = (sessionId: string, path: string) => ({ workspaceFileScopeId: sessionId, path })
const failed = (e: unknown): Failed => { const problem = problemOf(e); return { problem, text: S.fileProblem[problem] ?? readable(e) } }

export function FilesPage(props: { sessionId: string; path: string; file?: FileEntry; headerClass: string; onOpen: (path: string, entry: FileEntry) => void; onMentioned: () => void }) {
  const file = props.file
  return (
    <NavPage title={file ? file.name : props.path ? nameOf(props.path) : S.files} headerClass={props.headerClass} class="bg-background">
      <View class="flex-1 bg-background">
        <ConnectionBar />
        <If when={props.path}>
          <Text accessibilityLabel={props.path} class="mx-4 mb-1 text-muted-foreground font-mono text-[12px] leading-[17px] line-clamp-1">{shortPath(props.path)}</Text>
        </If>
        {file ? <FileView sessionId={props.sessionId} path={props.path} file={file} onMentioned={props.onMentioned} /> : <FolderView sessionId={props.sessionId} path={props.path} onOpen={props.onOpen} />}
      </View>
    </NavPage>
  )
}

function Centered(props: { text: string; onRetry?: () => void }) {
  return (
    <View class="absolute inset-0 items-center justify-center px-8 gap-3" style={{ pointerEvents: props.onRetry ? 'box-none' : 'none' }}>
      <Text class="text-muted-foreground text-[15px] leading-[21px] text-center">{props.text}</Text>
      <If when={props.onRetry}>
        <View role="button" testID="files-retry" accessibilityLabel={S.retry} onPress={() => props.onRetry?.()} class="px-4 min-h-[40px] rounded-[10px] bg-secondary items-center justify-center active:opacity-70">
          <Text class="text-foreground text-[15px] font-medium">{S.retry}</Text>
        </View>
      </If>
    </View>
  )
}

function FolderView(props: { sessionId: string; path: string; onOpen: (path: string, entry: FileEntry) => void }) {
  const listing = signal<Listing | undefined>(undefined)
  const failure = signal<Failed | undefined>(undefined)
  const loading = signal(true)
  const load = async () => {
    loading.set(true); failure.set(undefined)
    try { listing.set(listingOf(await dsh().rpc('workspaceFiles/list', scope(props.sessionId, listPath(props.path))))) }
    catch (e) { failure.set(failed(e)) } finally { loading.set(false) }
  }
  load()
  return (
    <View class="flex-1">
      <If when={listing()?.truncated}><Text class="mx-4 mb-1 text-muted-foreground text-[12px]">{S.filesTruncated(listing()?.entries.length ?? 0)}</Text></If>
      <List each={listing()?.entries ?? []} keyExtractor={(e) => `${e.type}:${e.name}`} estimatedItemSize={52} testID="entries" style={{ flex: 1 }} contentStyle={{ paddingBottom: 24 }}>
        {(e) => <EntryRow entry={e} onPress={() => props.onOpen(childPath(listing()?.path ?? props.path, e().name), e())} />}
      </List>
      <If when={loading() && !listing()}><Centered text={S.filesLoading} /></If>
      <If when={!loading() && !failure() && listing() && !listing()!.entries.length}><Centered text={S.emptyFolder} /></If>
      <If when={failure()}><Centered text={failure()?.text ?? ''} onRetry={load} /></If>
    </View>
  )
}

/** One child of a folder; it reads `props.entry()` where it is used because the List reuses rows. */
function EntryRow(props: { entry: () => FileEntry; onPress: () => void }) {
  const e = props.entry
  const folder = () => e().type === 'directory'
  const size = () => e().size
  return (
    <View role="button" testID={`entry-${e().name}`} onPress={props.onPress}
      accessibilityLabel={folder() ? `${e().name}, ${S.folder}` : size() !== undefined ? `${e().name}, ${sizeLabel(size()!)}` : e().name}
      class="flex-row items-center gap-3 px-4 py-[10px] min-h-[52px] active:bg-secondary">
      <Icon name={folder() ? 'folder' : 'file'} size={18} />
      <Text class="flex-1 text-foreground text-[15px] leading-[21px] line-clamp-3">{e().name}</Text>
      <If when={!folder() && size() !== undefined}><Text class="text-muted-foreground text-[13px] tabular-nums">{sizeLabel(size() ?? 0)}</Text></If>
      <If when={folder()}><Chevron dir="right" font={14} /></If>
    </View>
  )
}

function FileView(props: { sessionId: string; path: string; file: FileEntry; onMentioned: () => void }) {
  const first = previewKind(props.file)
  const kind = signal(first === 'image' && (props.file.size ?? 0) > IMAGE_MAX ? 'other' : first)
  return (
    <View class="flex-1">
      <If when={kind() === 'text'}><TextPreview sessionId={props.sessionId} path={props.path} onNotText={() => kind.set('other')} /></If>
      <If when={kind() === 'image'}><ImagePreview sessionId={props.sessionId} path={props.path} name={props.file.name} onUnreadable={() => kind.set('other')} /></If>
      <If when={kind() === 'other'}><About sessionId={props.sessionId} path={props.path} file={props.file} onMentioned={props.onMentioned} /></If>
    </View>
  )
}

function TextPreview(props: { sessionId: string; path: string; onNotText: () => void }) {
  const doc = signal<Doc | undefined>(undefined)
  const failure = signal<Failed | undefined>(undefined)
  let busy = false
  let limit = PAGE_LINES
  const more = async () => {
    if (busy || doc()?.eof) return
    busy = true; failure.set(undefined)
    try {
      for (let tries = 0; tries < 8; tries++) {
        const d = doc()
        try {
          const page = pageOf(await dsh().rpc('workspaceFiles/read', { ...scope(props.sessionId, props.path), range: { offset: d?.next ?? 1, limit } }))
          const next = addPage(d, page)
          doc.set(next) // undefined: the file changed since its first page, so it is read again from the start
          if (next) return
        } catch (e) {
          const f = failed(e)
          if (f.problem === 'not-text') return props.onNotText()
          const fewer = f.problem === 'too-large' ? smallerLimit(limit) : undefined
          if (!fewer) return void failure.set(f)
          limit = fewer
        }
      }
    } finally { busy = false }
  }
  more()
  const gutter = () => String(doc()?.lines.at(-1)?.n ?? 1).length * 7.5 * fontScale() + 4
  return (
    <View class="flex-1">
      <List each={doc()?.lines ?? []} keyExtractor={(l) => String(l.n)} estimatedItemSize={19} testID="lines" style={{ flex: 1 }} onLoadMore={more}
        contentStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 24 }}>
        {(l) => (
          <View class="flex-row" accessibilityLabel={`${S.lineNumber(l().n)}: ${l().text}`}>
            <Text class="mr-3 text-right text-muted-foreground font-mono text-[12px] leading-[19px] tabular-nums" style={{ width: gutter() }}>{String(l().n)}</Text>
            <Text class="flex-1 text-foreground font-mono text-[12px] leading-[18px]">{l().text}</Text>
          </View>
        )}
      </List>
      <If when={!doc() && !failure()}><Centered text={S.filesLoading} /></If>
      <If when={doc()?.eof && !doc()?.lines.length}><Centered text={S.emptyFile} /></If>
      <If when={failure()}><Centered text={failure()?.text ?? ''} onRetry={more} /></If>
    </View>
  )
}

function ImagePreview(props: { sessionId: string; path: string; name: string; onUnreadable: () => void }) {
  const src = signal('')
  const failure = signal<Failed | undefined>(undefined)
  const load = async () => {
    failure.set(undefined)
    try {
      const v = await dsh().rpc<{ data?: unknown }>('workspaceFiles/readBytes', { ...scope(props.sessionId, props.path), options: {} })
      if (!(v?.data instanceof Uint8Array)) return props.onUnreadable()
      src.set(URL.createObjectURL(new Blob([v.data], { type: imageType(props.name) ?? 'application/octet-stream' })))
    } catch (e) { const f = failed(e); if (f.problem === 'too-large' || f.problem === 'not-file') props.onUnreadable(); else failure.set(f) }
  }
  cleanup(() => { if (src()) URL.revokeObjectURL(src()) })
  load()
  return (
    <View class="flex-1 p-4">
      <If when={src()}><Image testID="file-image" src={src()} accessibilityLabel={props.name} class="flex-1 w-full object-contain" onError={props.onUnreadable} /></If>
      <If when={!src() && !failure()}><Centered text={S.filesLoading} /></If>
      <If when={failure()}><Centered text={failure()?.text ?? ''} onRetry={load} /></If>
    </View>
  )
}

/** A file the phone does not show: what it is, and a way to point the agent at it. */
function About(props: { sessionId: string; path: string; file: FileEntry; onMentioned: () => void }) {
  const facts = [typeLabel(props.file.name), props.file.size !== undefined ? sizeLabel(props.file.size) : ''].filter(Boolean).join(S.factSep)
  return (
    <View class="flex-1 items-center px-6 pt-8 gap-3">
      <Icon name="file" size={32} />
      <Text class="text-foreground text-[15px] leading-[22px] font-medium text-center">{props.file.name}</Text>
      <If when={facts}><Text class="text-muted-foreground text-[15px] tabular-nums">{facts}</Text></If>
      <Text class="text-muted-foreground text-[15px] leading-[21px] text-center">{S.noPreview}</Text>
      <View role="button" testID="mention" accessibilityLabel={S.mentionInChat} onPress={() => { if (mention(props.sessionId, props.path)) props.onMentioned() }}
        class="mt-2 flex-row items-center gap-2 rounded-[10px] bg-primary px-4 min-h-[44px] active:opacity-80">
        <Icon name="at" size={16} class="tint-primary-foreground" />
        <Text class="text-primary-foreground text-[15px] font-medium">{S.mentionInChat}</Text>
      </View>
    </View>
  )
}
