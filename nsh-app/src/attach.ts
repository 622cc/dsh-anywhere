// Attachments of a message being written: photos go inline in session/prompt (base64), files are uploaded first and
// cited by the receipt the upload returned (docs/research/dsh-protocol-parity.md, section 4).
export type Draft =
  | { kind: 'image'; id: string; name: string; mediaType: string; data: string; preview?: string }
  | { kind: 'file'; id: string; name: string; bytes: number; receiptId: string }

/** session/prompt's content: the text, then photos, then files. */
export function promptContent(text: string, attached: Draft[]): Record<string, unknown>[] {
  const trimmed = text.trim()
  return [
    ...(trimmed ? [{ type: 'text', text: trimmed }] : []),
    ...attached.flatMap((a) => (a.kind === 'image' ? [{ type: 'image', mediaType: a.mediaType, data: a.data, name: a.name }] : [])),
    ...attached.flatMap((a) => (a.kind === 'file' ? [{ type: 'file', receiptId: a.receiptId }] : [])),
  ]
}

export function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function bytesOf(data: string): Uint8Array {
  const binary = atob(data)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
