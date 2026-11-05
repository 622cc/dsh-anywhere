import { expect, test } from 'nsh/test'
import { TerminalSession, newTerminalId, withCtrl } from './terminals.ts'

const ENV = { cwd: '/w', maxInputBytes: 64, maxBufferedBytes: 4000, maxCols: 200, maxRows: 80, scrollback: 1000 }
const INFO = { id: 't1', title: 'zsh', cwd: '/w', cols: 80, rows: 24, state: 'running', exitCode: null }

/** A computer that answers the terminal endpoints and records what the phone sends. */
function computer(opts: { list?: unknown[]; fail?: Record<string, string> } = {}) {
  const calls: { method: string; args: any }[] = []
  const holds: { args: any; push: (v: unknown) => void; stopped: boolean }[] = []
  const links: { args: any; push: (v: unknown) => void; sent: any[]; stopped: boolean; error?: (e: any) => void }[] = []
  const remote = {
    async rpc(method: string, args: any) {
      calls.push({ method, args })
      if (opts.fail?.[method]) throw Object.assign(new Error(opts.fail[method]), { code: opts.fail[method] })
      if (method === 'terminal/environment') return ENV
      if (method === 'terminal/create') return { ...INFO, id: args.request.id, cols: args.request.cols, rows: args.request.rows }
      if (method === 'terminal/list') return opts.list ?? []
      return undefined
    },
    stream(_endpoint: string, args: any, onItem: (v: unknown) => void) {
      const h = { args, push: onItem, stopped: false }
      holds.push(h)
      return () => { h.stopped = true }
    },
    duplex(_endpoint: string, args: any, onItem: (v: unknown) => void, onError?: (e: any) => void) {
      const l = { args, push: onItem, sent: [] as any[], stopped: false, error: onError }
      links.push(l)
      return { send: (v: unknown) => { if (l.stopped) return false; l.sent.push(v); return true }, stop: () => { l.stopped = true } }
    },
  }
  return { remote, calls, holds, links }
}
const screen = () => {
  const out: string[] = []
  return { out, sink: { write: (d: string) => out.push(d), reset: () => out.push('<reset>'), problem: (p: string) => out.push(`<${p}>`) } }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

test('a new terminal is created at the page size within the limits, held, then attached once the hold is acknowledged', async () => {
  const c = computer(), s = screen()
  const t = new TerminalSession(c.remote, 's1', { id: 'n1', create: true }, s.sink)
  await t.start(300, 30)
  expect(c.calls.map((x) => x.method)).toEqual(['terminal/environment', 'terminal/create'])
  expect(c.calls[0]!.args).toEqual({ agentId: 's1' })
  expect(c.calls[1]!.args).toEqual({ agentId: 's1', request: { id: 'n1', cols: 200, rows: 30 } })
  expect(c.holds[0]!.args).toEqual({ sessionId: 's1', id: 'n1' })
  expect(c.links.length).toBe(0)
  expect(t.phase).toBe('connecting')
  c.holds[0]!.push({ type: 'retained' })
  expect(c.links[0]!.args).toEqual({ agentId: 's1', id: 'n1' })
  c.links[0]!.push({ type: 'snapshot', sequence: 0, screen: '$ ', info: { ...INFO, id: 'n1', cols: 200, rows: 30 }, writable: true })
  expect(t.phase).toBe('live')
  expect(s.out).toEqual(['<reset>', '$ '])
  c.holds[0]!.push({ type: 'retained' }) // the hold reopened after a reconnect: still one attachment
  expect(c.links.length).toBe(1)
})

test('an existing terminal is adopted from the list and never created again; a missing one fails', async () => {
  const c = computer({ list: [INFO] })
  const t = new TerminalSession(c.remote, 's1', { id: 't1', create: false }, screen().sink)
  await t.start(80, 24)
  expect(c.calls.map((x) => x.method)).toEqual(['terminal/environment', 'terminal/list'])
  expect(c.calls[1]!.args).toEqual({ sessionId: 's1' })
  expect(c.holds.length).toBe(1)
  const gone = computer({ list: [] })
  const g = new TerminalSession(gone.remote, 's1', { id: 't9', create: false }, screen().sink)
  await g.start(80, 24)
  expect(g.phase).toBe('failed')
  expect(g.error).toBe('missing')
  expect(gone.holds.length).toBe(0)
})

test('typing goes up as numbered writes, and the page size is applied after each snapshot', async () => {
  const c = computer({ list: [INFO] })
  const t = new TerminalSession(c.remote, 's1', { id: 't1', create: false }, screen().sink)
  await t.start(100, 40)
  c.holds[0]!.push({ type: 'retained' })
  c.links[0]!.push({ type: 'snapshot', sequence: 0, screen: '', info: INFO, writable: true })
  t.input('ls\r')
  expect(c.links[0]!.sent).toEqual([{ type: 'resize', sequence: 1, cols: 100, rows: 40 }, { type: 'write', sequence: 2, data: 'ls\r' }])
})

test('another window taking input makes the phone read-only until it takes control back with a new attachment', async () => {
  const c = computer({ list: [INFO] })
  const t = new TerminalSession(c.remote, 's1', { id: 't1', create: false }, screen().sink)
  await t.start(80, 24)
  c.holds[0]!.push({ type: 'retained' })
  c.links[0]!.push({ type: 'snapshot', sequence: 0, screen: '', info: INFO, writable: true })
  c.links[0]!.push({ type: 'state', info: INFO, writable: false })
  expect(t.phase).toBe('readOnly')
  expect(t.input('x')).toBe(false)
  t.takeControl()
  expect(c.links[0]!.stopped).toBe(true)
  expect(c.links.length).toBe(2)
  expect(t.phase).toBe('connecting')
  c.links[1]!.push({ type: 'snapshot', sequence: 0, screen: '', info: INFO, writable: true })
  expect(t.phase).toBe('live')
})

test('an exited shell shows its exit code and takes no input', async () => {
  const c = computer({ list: [INFO] })
  const t = new TerminalSession(c.remote, 's1', { id: 't1', create: false }, screen().sink)
  await t.start(80, 24)
  c.holds[0]!.push({ type: 'retained' })
  c.links[0]!.push({ type: 'snapshot', sequence: 0, screen: '', info: INFO, writable: true })
  c.links[0]!.push({ type: 'state', info: { ...INFO, state: 'exited', exitCode: 3 }, writable: false })
  expect(t.phase).toBe('exited')
  expect(t.info?.exitCode).toBe(3)
})

test('the session limit and stream errors are reported, and stop releases the hold and the attachment', async () => {
  const full = computer({ fail: { 'terminal/create': 'terminal/limit-reached' } })
  const f = new TerminalSession(full.remote, 's1', { id: 'n1', create: true }, screen().sink)
  await f.start(80, 24)
  expect(f.phase).toBe('failed')
  expect(f.error).toBe('limit')
  const c = computer({ list: [INFO] })
  const t = new TerminalSession(c.remote, 's1', { id: 't1', create: false }, screen().sink)
  await t.start(80, 24)
  c.holds[0]!.push({ type: 'retained' })
  c.links[0]!.error?.({ code: 'terminal/unavailable', message: 'gone' })
  expect(t.phase).toBe('failed')
  expect(t.error).toBe('missing')
  t.stop()
  expect(c.holds[0]!.stopped).toBe(true)
  expect(c.links[0]!.stopped).toBe(true)
})

test('closing asks the computer to end the shell and lets go of it', async () => {
  const c = computer({ list: [INFO] })
  const t = new TerminalSession(c.remote, 's1', { id: 't1', create: false }, screen().sink)
  await t.start(80, 24)
  await t.close()
  expect(c.calls.at(-1)).toEqual({ method: 'terminal/close', args: { agentId: 's1', id: 't1' } })
  expect(c.holds[0]!.stopped).toBe(true)
  expect(t.phase).toBe('closed')
  await tick()
})

test('terminal ids fit the host pattern, and Ctrl turns a letter into its control character', () => {
  expect(/^[\w-]{1,128}$/.test(newTerminalId())).toBe(true)
  expect(newTerminalId() === newTerminalId()).toBe(false)
  expect(withCtrl('c')).toBe('\x03')
  expect(withCtrl('C')).toBe('\x03')
  expect(withCtrl('[')).toBe('\x1b')
  expect(withCtrl(' ')).toBe('\x00')
  expect(withCtrl('ab')).toBe('ab')
})
