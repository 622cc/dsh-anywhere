// What the phone sends for a message with attachments: photos inline in session/prompt, files as the receipts
// their upload returned (docs/research/dsh-protocol-parity.md, section 4).
import { expect, test } from 'nsh/test'
import { base64, promptContent, sizeLabel } from './attach.ts'

test('text, photos, then files, as DSH takes them; no text part when there is no text', () => {
  const photo = { kind: 'image' as const, id: 'p1', name: 'photo.jpg', mediaType: 'image/jpeg', data: 'AAEC' }
  const file = { kind: 'file' as const, id: 'r1', name: 'report.pdf', bytes: 12345, receiptId: 'r1' }
  expect(promptContent('  look  ', [file, photo])).toEqual([
    { type: 'text', text: 'look' },
    { type: 'image', mediaType: 'image/jpeg', data: 'AAEC', name: 'photo.jpg' },
    { type: 'file', receiptId: 'r1' },
  ])
  expect(promptContent('', [photo])).toEqual([{ type: 'image', mediaType: 'image/jpeg', data: 'AAEC', name: 'photo.jpg' }])
})

test('bytes become standard base64, also past one chunk', () => {
  expect(base64(new Uint8Array([0, 1, 2, 253, 254, 255]))).toBe('AAEC/f7/')
  const big = new Uint8Array(100_000).map((_, i) => i % 256)
  expect(atob(base64(big)).length).toBe(100_000)
  expect(atob(base64(big)).charCodeAt(99_999)).toBe(99_999 % 256)
})

test('sizes read as people read them', () => {
  expect(sizeLabel(900)).toBe('900 B')
  expect(sizeLabel(12_345)).toBe('12 KB')
  expect(sizeLabel(3_400_000)).toBe('3.4 MB')
})
