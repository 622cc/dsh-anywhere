// Photos and files in a chat: a "+" beside the composer adds them (the system's photo picker; the system's file
// picker through the app's `files.pick`, which uploads the file for this chat), chips show what will be sent, and a
// sent message shows its photos (session/attachment) and files (name and size: DSH has no way to read a file back).
import { host, Image, Picker, signal, Text, View } from 'nsh'
import { base64, bytesOf, sizeLabel, type Draft } from './attach.ts'
import type { Attached } from './fold.ts'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { chooseAction, Icon, IconButton } from './ui.tsx'

let counter = 0

/** Asks Photo or File and adds what the person picks; uploads a file right away (a receipt belongs to this chat). */
export async function addAttachment(sessionId: string, add: (d: Draft) => void, onError: (m: string) => void, uploading: (on: boolean) => void) {
  const action = await chooseAction({ actions: [{ id: 'photo', label: S.photo, icon: 'image' }, { id: 'file', label: S.file, icon: 'file' }] })
  try {
    if (action === 'photo') {
      // DSH keeps at most 2048 px a side; scaling here keeps the message small.
      for (const p of await Picker.pickImages({ multiple: true, limit: 10, maxDimension: 2048, quality: 0.85 })) {
        const data = base64(new Uint8Array(await p.file.arrayBuffer()))
        add({ kind: 'image', id: `img-${counter++}`, name: p.file.name || 'photo.jpg', mediaType: p.file.type || 'image/jpeg', data, preview: URL.createObjectURL(p.file) })
      }
    } else if (action === 'file') {
      uploading(true)
      const v = await host.call<{ receiptId: string; file: { name: string; bytes: number } } | null>('files.pick', { sessionId })
      if (v) add({ kind: 'file', id: v.receiptId, name: v.file.name, bytes: v.file.bytes, receiptId: v.receiptId })
    }
  } catch (e) { onError(readable(e)) } finally { uploading(false) }
}

export function forget(d: Draft) { if (d.kind === 'image' && d.preview) URL.revokeObjectURL(d.preview) }

/** What will be sent with the message, each with a way to take it out. */
export function DraftChips(props: { items: () => Draft[]; uploading: () => boolean; remove: (d: Draft) => void }) {
  return (
    <If when={props.items().length || props.uploading()}>
      <View class="flex-row flex-wrap gap-2 px-[10px] pt-[10px]">
        {props.items().map((d) => (
          <View class="flex-row items-center rounded-[6px] bg-secondary overflow-hidden" testID={`draft-${d.id}`}>
            {d.kind === 'image' && d.preview ? <Image src={d.preview} class="w-[48px] h-[48px] object-cover" accessibilityLabel={d.name} /> : (
              <View class="flex-row items-center gap-[6px] pl-[10px] h-[36px]">
                <Icon name="file" size={15} />
                <Text class="text-foreground text-[13px] line-clamp-1 max-w-[150px]">{d.name}</Text>
                {d.kind === 'file' ? <Text class="text-muted-foreground text-[12px] tabular-nums">{sizeLabel(d.bytes)}</Text> : null}
              </View>
            )}
            <IconButton name="x" label={S.remove} onPress={() => props.remove(d)} size={14} class="w-[30px] h-[30px]" iconClass="tint-muted-foreground" />
          </View>
        ))}
        <If when={props.uploading()}><View class="rounded-[6px] bg-secondary px-[10px] h-[36px] justify-center"><Text class="text-muted-foreground text-[13px]">{S.uploading}</Text></View></If>
      </View>
    </If>
  )
}

const shown = new Map<string, string>() // attachmentId → blob URL, for the life of the app

/** A sent message's photos and files. */
export function SentAttachments(props: { sessionId: string; items: () => Attached[] }) {
  return (
    <If when={props.items().length}>
      <View class="flex-row flex-wrap justify-end gap-2 max-w-[85%] mb-[6px]">
        {props.items().map((a) => (a.kind === 'image' ? <Photo sessionId={props.sessionId} item={a} /> : (
          <View class="flex-row items-center gap-[6px] rounded-[12px] border border-border bg-card px-[10px] h-[38px]">
            <Icon name="file" size={15} />
            <Text class="text-foreground text-[13px] line-clamp-1 max-w-[200px]">{a.name}</Text>
            <Text class="text-muted-foreground text-[12px] tabular-nums">{sizeLabel(a.bytes)}</Text>
          </View>
        )))}
      </View>
    </If>
  )
}

function Photo(props: { sessionId: string; item: Attached }) {
  const src = signal(shown.get(props.item.attachmentId) ?? '')
  if (!src()) {
    dsh().rpc<{ data: string; attachment: { mediaType?: string } }>('session/attachment', { request: { sessionId: props.sessionId, attachmentId: props.item.attachmentId } })
      .then((v) => { const url = URL.createObjectURL(new Blob([bytesOf(v.data)], { type: v.attachment?.mediaType ?? 'image/jpeg' })); shown.set(props.item.attachmentId, url); src.set(url) })
      .catch(() => {}) // the name stays as the placeholder
  }
  const w = props.item.width ?? 1, h = props.item.height ?? 1
  const width = Math.min(200, Math.round(200 * Math.min(1, w / h))), height = Math.round(width * (h / w))
  return (
    <View class="rounded-[14px] border border-border bg-card overflow-hidden items-center justify-center" style={{ width, height: Math.max(40, Math.min(260, height)) }}>
      <If when={src()} else={<Text class="text-muted-foreground text-[12px] px-2 line-clamp-2">{props.item.name}</Text>}>
        <Image src={src()} class="object-cover" style={{ width, height: Math.max(40, Math.min(260, height)) }} accessibilityLabel={props.item.name} />
      </If>
    </View>
  )
}
