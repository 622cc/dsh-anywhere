// The workspace browser's rules, as DSH 0.2.1-rc.3's workspaceFiles calls answer (@deepseek-ai/dsh-api-workspace-files).
import { expect, test } from 'nsh/test'
import { DshError } from './dsh.ts'
import { addPage, childPath, listingOf, listPath, nameOf, nextRange, numbered, previewKind, problemOf, shortPath, smallerLimit, typeLabel, withMention, PAGE_LINES } from './files.ts'

test('a listing shows folders first, then files, then anything else, each by name whatever its case', () => {
  const l = listingOf({ path: 'src', truncated: false, entries: [
    { name: 'zeta.ts', type: 'file', size: 10 }, { name: 'Beta', type: 'directory' }, { name: 'sock', type: 'other' },
    { name: 'alpha.ts', type: 'file', size: 3 }, { name: 'alpha', type: 'directory' }, { type: 'file' }, 'junk',
  ] })
  expect(l.entries.map((e) => e.name)).toEqual(['alpha', 'Beta', 'alpha.ts', 'zeta.ts', 'sock'])
  expect(l.entries[2]).toEqual({ name: 'alpha.ts', type: 'file', size: 3 })
  expect([l.path, l.truncated]).toEqual(['src', false])
  expect(listingOf({ path: '', entries: [], truncated: true }).truncated).toBe(true)
  expect(listingOf(undefined)).toEqual({ path: '', entries: [], truncated: false })
})

test('workspace paths: the root is "" on the phone and "." on the wire, a child joins its folder with "/"', () => {
  expect([listPath(''), listPath('src/lib')]).toEqual(['.', 'src/lib'])
  expect([childPath('', 'src'), childPath('src', 'app.ts')]).toEqual(['src', 'src/app.ts'])
  expect([nameOf('src/lib/app.ts'), nameOf('README.md'), nameOf('')]).toEqual(['app.ts', 'README.md', ''])
})

test('a deep path keeps its first folder and as many of its last as fit, the middle elided', () => {
  expect(shortPath('src/app')).toBe('src/app')
  expect(shortPath('one/two/three/four/five/six/seven/eight/nine/ten', 24)).toBe('one/…/eight/nine/ten')
  expect(shortPath('a/b/c/' + 'x'.repeat(60), 24)).toBe('a/…/' + 'x'.repeat(60)) // the name itself always stays
  expect(shortPath('a/' + 'x'.repeat(60), 24)).toBe('a/' + 'x'.repeat(60))
})

test('a preview by the name and the listing type: images as pictures, text tried as text, the rest described', () => {
  const file = (name: string) => ({ name, type: 'file' as const })
  expect(['logo.png', 'photo.JPG', 'a.jpeg', 'anim.gif', 'pic.webp'].map((n) => previewKind(file(n)))).toEqual(['image', 'image', 'image', 'image', 'image'])
  expect(['app.ts', 'README.md', 'Makefile', '.env.example'].map((n) => previewKind(file(n)))).toEqual(['text', 'text', 'text', 'text'])
  expect(['paper.pdf', 'out.zip', 'font.woff2', 'icon.svg'].map((n) => previewKind(file(n)))).toEqual(['other', 'other', 'other', 'text'])
  expect(previewKind({ name: 'fifo', type: 'other' })).toBe('other')
  expect([typeLabel('out.zip'), typeLabel('Makefile'), typeLabel('.env')]).toEqual(['ZIP', '', ''])
})

test('text is read a page of lines at a time, numbered from where the page starts', () => {
  expect(nextRange(undefined)).toEqual({ offset: 1, limit: PAGE_LINES })
  const first = { offset: 1, text: 'a\n\nc', lines: 3, eof: false, version: 'v1' }
  expect(numbered(first)).toEqual([{ n: 1, text: 'a' }, { n: 2, text: '' }, { n: 3, text: 'c' }])
  expect(nextRange(first)).toEqual({ offset: 4, limit: PAGE_LINES })
  expect(nextRange({ ...first, eof: true })).toBe(undefined)
  // past the last line: no lines; one empty line: one
  expect(numbered({ offset: 9, text: '', lines: 0, eof: true, version: 'v1' })).toEqual([])
  expect(numbered({ offset: 9, text: '', lines: 1, eof: true, version: 'v1' })).toEqual([{ n: 9, text: '' }])
  expect(nextRange({ offset: 9, text: '', lines: 0, eof: false, version: 'v1' })).toBe(undefined)
})

test('pages join while the file stays the same version; a changed file starts over', () => {
  const doc = addPage(undefined, { offset: 1, text: 'a\nb', lines: 2, eof: false, version: 'v1' })!
  const more = addPage(doc, { offset: 3, text: 'c', lines: 1, eof: true, version: 'v1' })!
  expect(more.lines.map((l) => l.n)).toEqual([1, 2, 3])
  expect(more.eof).toBe(true)
  expect(addPage(doc, { offset: 3, text: 'c', lines: 1, eof: true, version: 'v2' })).toBe(undefined)
})

test('a page over DSH\'s byte cap is asked for again with fewer lines, down to one', () => {
  expect([smallerLimit(PAGE_LINES), smallerLimit(4), smallerLimit(1)]).toEqual([Math.floor(PAGE_LINES / 4), 1, undefined])
})

test('DSH\'s refusals map to what the person can do about them', () => {
  const e = (code: string, message = '') => new DshError(code, message)
  expect(['workspace-file/not-found', 'workspace-file/not-directory', 'workspace-file/not-regular-file', 'workspace-file/not-text', 'workspace-file/too-large', 'workspace-file/outside-workspace'].map((c) => problemOf(e(c))))
    .toEqual(['not-found', 'not-directory', 'not-file', 'not-text', 'too-large', 'outside'])
  // dsh-fs-local's FS_PERMISSION_DENIED crosses the gateway only as gateway/internal with its message.
  expect(problemOf(e('gateway/internal', 'cannot list "/w/project/secret": permission denied'))).toBe('denied')
  expect(problemOf(e('gateway/internal', 'disk on fire'))).toBe('other')
  expect([problemOf(e('network')), problemOf(e('timeout'))]).toEqual(['offline', 'offline'])
  expect(problemOf(new Error('x'))).toBe('other')
})

test('a file is mentioned in the draft as the composer\'s "@" picker writes it', () => {
  expect(withMention('', 'src/app.ts')).toEqual({ text: '@src/app.ts ', caret: 12 })
  expect(withMention('look at', 'src/app.ts').text).toBe('look at @src/app.ts ')
  expect(withMention('look at ', 'src/app.ts').text).toBe('look at @src/app.ts ')
  expect(withMention('', 'docs/my notes.md').text).toBe('@"docs/my notes.md" ')
})
