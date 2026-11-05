// The phone's half of DSH's duplex terminal (terminal/attach), following DSH's own web terminal client
// (dsh-api-terminal-controller types/client/model.js, rc.3): input is numbered from 1 per attachment, frames in
// flight stay within the snapshot's input window, acks come back in order and free room, input past the
// environment's limits is refused, and output arrives in sequence.
import { expect, test } from 'nsh/test'
import { TerminalLink, utf8Bytes } from './terminal.ts'

const env = { cwd: '/w', maxInputBytes: 64, maxBufferedBytes: 400, maxCols: 200, maxRows: 80, scrollback: 1000 }
const info = (state = 'running') => ({ id: 't1', title: 'zsh', shell: { path: '/bin/zsh', args: [], name: 'zsh' }, cwd: '/w', cols: 80, rows: 24, state, exitCode: null })
const snapshot = (window?: { maxBytes: number; frameOverheadBytes: number }, sequence = 7) => ({ type: 'snapshot', sequence, screen: 'prompt$ ', info: info(), writable: true, ...(window ? { inputWindow: window } : {}) })

function link() {
  const sent: any[] = []; const screen: string[] = []; const resets: number[] = []; const problems: string[] = []
  const l = new TerminalLink(env, (v) => { sent.push(v); return true }, { write: (d) => screen.push(d), reset: () => resets.push(1), problem: (p) => problems.push(p) })
  return { l, sent, screen, resets, problems }
}

test('utf8Bytes counts what the host counts', () => {
  expect([utf8Bytes('a'), utf8Bytes('é'), utf8Bytes('中'), utf8Bytes('😀')]).toEqual([1, 2, 3, 4])
})

test('a snapshot resets the screen to what it carries; output after it is written in sequence', () => {
  const { l, screen, resets, problems } = link()
  l.receive(snapshot())
  l.receive({ type: 'output', sequence: 8, data: 'ls\r\n' })
  expect([resets.length, screen]).toEqual([1, ['prompt$ ', 'ls\r\n']])
  l.receive({ type: 'output', sequence: 10, data: 'x' }) // 9 is missing
  expect(problems).toEqual(['invalidOutput'])
})

test('input is numbered from 1 for each attachment and sent at once while it fits', () => {
  const { l, sent } = link()
  l.receive(snapshot())
  expect(l.write('ls\r')).toBe(true)
  l.resize(100, 30)
  expect(sent).toEqual([{ type: 'write', sequence: 1, data: 'ls\r' }, { type: 'resize', sequence: 2, cols: 100, rows: 30 }])
  l.receive(snapshot(undefined, 20)) // a reconnect is a new attachment
  l.write('a')
  expect(sent.at(-1)).toEqual({ type: 'write', sequence: 1, data: 'a' })
})

test('frames beyond the input window wait for acks, which come in order and release room', () => {
  const { l, sent, problems } = link()
  const one = utf8Bytes(JSON.stringify({ type: 'write', sequence: 1, data: 'aaaa' })) + 10
  l.receive(snapshot({ maxBytes: one * 2, frameOverheadBytes: 10 }))
  l.write('aaaa'); l.write('bbbb'); l.write('cccc')
  expect(sent.map((c) => c.sequence)).toEqual([1, 2])
  l.receive({ type: 'ack', sequence: 1 })
  expect(sent.map((c) => c.sequence)).toEqual([1, 2, 3])
  l.receive({ type: 'ack', sequence: 3 }) // 2 first
  expect(problems).toEqual(['invalidOutput'])
})

test('input past the environment\'s limit is refused, as the web terminal\'s "input full"', () => {
  const { l, problems } = link()
  l.receive(snapshot())
  expect(l.write('x'.repeat(65))).toBe(false)
  expect(problems).toEqual(['inputFull'])
})

test('nothing is sent before the snapshot, after the shell exits, or once the host refuses input', () => {
  const { l, sent } = link()
  expect(l.write('early')).toBe(false)
  l.receive(snapshot())
  l.write('a')
  l.receive({ type: 'ack', sequence: 1, refusal: 'read-only' })
  expect([l.writable, l.write('b')]).toEqual([false, false])
  l.receive(snapshot(undefined, 30))
  l.receive({ type: 'state', info: info('exited'), writable: false })
  expect([l.writable, l.write('c'), sent.length]).toEqual([false, false, 1])
})

test('a resize is clamped to the environment and skipped when nothing changes', () => {
  const { l, sent } = link()
  l.receive(snapshot())
  l.resize(80, 24)
  l.resize(500, 300)
  expect(sent).toEqual([{ type: 'resize', sequence: 1, cols: 200, rows: 80 }])
})
