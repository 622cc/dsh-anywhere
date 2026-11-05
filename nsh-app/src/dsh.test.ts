// The phone speaks DSH's own web-client protocol through the companion's owner proxy:
// POST /api/<method> with a client-request envelope, and logical streams over /api/remote.mux.
import { expect, test } from 'nsh/test'
import { Dsh, type SocketLike } from './dsh.ts'

class FakeSocket implements SocketLike {
  sent: any[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  constructor(public url: string) {}
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  push(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }) }
}

test('rpc sends the client-request envelope with the device key and unwraps the result', async () => {
  const calls: { url: string; init: any }[] = []
  const fetchImpl = async (url: any, init: any) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ type: 'server-response', rpcId: JSON.parse(init.body).rpcId, result: { ok: true, value: { items: [] } } }) } as any }
  const dsh = new Dsh('http://127.0.0.1:19446', 'k3y', { fetch: fetchImpl, socket: (u) => new FakeSocket(u) })
  expect(await dsh.rpc('session/list', { _request: {} })).toEqual({ items: [] })
  expect(calls[0]!.url).toBe('http://127.0.0.1:19446/api/session/list')
  expect(calls[0]!.init.headers.authorization).toBe('Bearer k3y')
  const body = JSON.parse(calls[0]!.init.body)
  expect([body.type, body.method, body.payload]).toEqual(['client-request', 'session/list', { args: { _request: {} } }])
})

test('a DSH error comes back as an error with its code', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ type: 'server-response', rpcId: 'x', result: { ok: false, error: { code: 'session/not-found', message: 'gone' } } }) }) as any
  const dsh = new Dsh('http://h', 'k', { fetch: fetchImpl, socket: (u) => new FakeSocket(u) })
  let code = ''
  try { await dsh.rpc('session/prompt', {}) } catch (e) { code = (e as { code?: string }).code ?? '' }
  expect(code).toBe('session/not-found')
})

test('streams ride one mux socket keyed by streamId; after a drop they reopen and get a fresh snapshot', async () => {
  const sockets: FakeSocket[] = []
  const dsh = new Dsh('http://127.0.0.1:19446', 'k3y', { fetch: (async () => { throw new Error('unused') }) as any, socket: (u) => { const s = new FakeSocket(u); sockets.push(s); return s }, retryMs: 0 })
  const got: unknown[] = []
  const stop = dsh.stream('session/follow', { request: { address: { kind: 'session', sessionId: 's1' }, assistantStream: true, maxMessages: 100 } }, (item) => got.push(item))
  expect(sockets[0]!.url).toBe('ws://127.0.0.1:19446/api/remote.mux?dshm_key=k3y')
  sockets[0]!.open()
  const open = sockets[0]!.sent.find((m) => m.endpoint === 'session/follow')
  expect(open.type).toBe('open')
  expect(open.payload.args.request.address.sessionId).toBe('s1')
  sockets[0]!.push({ type: 'item', streamId: open.streamId, value: { type: 'snapshot', n: 1 } })
  sockets[0]!.push({ type: 'item', streamId: 'other', value: { type: 'snapshot', n: 99 } })
  expect(got).toEqual([{ type: 'snapshot', n: 1 }])
  sockets[0]!.close()
  await new Promise((r) => setTimeout(r, 5))
  expect(sockets.length).toBe(2)
  sockets[1]!.open()
  const reopened = sockets[1]!.sent.find((m) => m.endpoint === 'session/follow')
  sockets[1]!.push({ type: 'item', streamId: reopened.streamId, value: { type: 'snapshot', n: 2 } })
  expect(got).toEqual([{ type: 'snapshot', n: 1 }, { type: 'snapshot', n: 2 }])
  stop()
  expect(sockets[1]!.sent.at(-1)).toEqual({ type: 'cancel', streamId: reopened.streamId })
})

test('a socket that died without saying so: opening a stream never throws into the screen, and it reopens on a fresh socket', async () => {
  const sockets: FakeSocket[] = []
  const dsh = new Dsh('http://h', 'k', { fetch: (async () => { throw new Error('unused') }) as any, socket: (u) => { const s = new FakeSocket(u); sockets.push(s); return s }, retryMs: 0 })
  dsh.stream('$events', {}, () => {})
  sockets[0]!.open()
  sockets[0]!.send = () => { throw new Error('WebSocket outbound queue is full or closed') }
  const got: unknown[] = []
  expect(() => dsh.stream('session/follow', { request: {} }, (v) => got.push(v))).not.toThrow()
  await new Promise((r) => setTimeout(r, 5))
  expect(sockets.length).toBe(2)
  sockets[1]!.open()
  expect(sockets[1]!.sent.map((m) => m.endpoint).sort()).toEqual(['$events', 'session/follow'])
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Waits for `ok` (timers run late on a busy machine), failing after `ms`. */
const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('condition not met'); await wait(5) } }

test('a socket that never opens is given up after the connect timeout, reported offline, and tried again', async () => {
  const sockets: FakeSocket[] = []; const states: string[] = []
  const dsh = new Dsh('http://h', 'k', { socket: (u) => { const s = new FakeSocket(u); sockets.push(s); return s }, connectMs: 30, retryMs: 10 })
  dsh.onState = (s) => states.push(s)
  dsh.stream('session/follow', {}, () => {})
  await until(() => sockets.length >= 2)
  expect(sockets[0]!.readyState).toBe(3)
  expect(states.slice(0, 2)).toEqual(['connecting', 'offline'])
  sockets.at(-1)!.open()
  expect(states.at(-1)).toBe('online')
  dsh.close()
})

// Seen on the Android emulator: the app came back while a try begun in the background (where Android gives it no
// network) was still waiting; trying now did nothing, that try timed out, and the next waited the longest pause, 15 s.
test('trying now gives up a try still waiting and starts over, with short pauses again', async () => {
  const sockets: FakeSocket[] = []
  const dsh = new Dsh('http://h', 'k', { socket: (u) => { const s = new FakeSocket(u); sockets.push(s); return s }, connectMs: 10_000 })
  dsh.stream('$events', {}, () => {})
  expect(sockets.length).toBe(1)
  dsh.retryNow()
  expect(sockets.length).toBe(2)
  expect(sockets[0]!.readyState).toBe(3)
  sockets[1]!.close() // the new try fails too: the next one comes after the shortest pause
  await until(() => sockets.length >= 3, 1_500)
  dsh.close()
})

test('when connecting keeps failing, the phone is asked once to rebuild its link to the computer', async () => {
  let rebuilt = 0
  const sockets: FakeSocket[] = []
  const dsh = new Dsh('http://h', 'k', { socket: (u) => { const s = new FakeSocket(u); sockets.push(s); return s }, connectMs: 15, retryMs: 5, onStuck: () => { rebuilt++ } })
  dsh.stream('session/follow', {}, () => {})
  await until(() => rebuilt > 0)
  await until(() => sockets.length >= 8) // it keeps trying after asking once
  expect(rebuilt).toBe(1)
  sockets.at(-1)!.open()
  dsh.close()
})

test('a call the computer never answers fails with a timeout instead of waiting forever', async () => {
  const dsh = new Dsh('http://h', 'k', { fetch: () => new Promise(() => {}), socket: (u) => new FakeSocket(u), rpcMs: 30 })
  let code = ''
  try { await dsh.rpc('session/list', {}) } catch (e) { code = (e as { code?: string }).code ?? '' }
  expect(code).toBe('timeout')
})

test('an answer that carries bytes comes as multipart, as DSH sends readBytes: the bytes land where the envelope says', async () => {
  // dsh-client-connection fullResponse: a `metadata` part with null where bytes sat, one `bytes-N` part per array.
  const meta = { type: 'server-response', rpcId: 'x', result: { ok: true, value: { offset: 0, data: null, eof: true, absolutePath: '/w/project/logo.png', version: 'v1', bytes: 4 } },
    attachments: [{ path: ['data'], codec: 'bytes', part: 'bytes-0' }] }
  const body = ['--b', 'Content-Disposition: form-data; name="bytes-0"; filename="blob"', 'Content-Type: application/octet-stream', '', 'GIF8',
    '--b', 'Content-Disposition: form-data; name="metadata"', '', JSON.stringify(meta), '--b--', ''].join('\r\n')
  const fetchImpl = async () => new Response(body, { headers: { 'content-type': 'multipart/form-data; boundary=b' } })
  const dsh = new Dsh('http://h', 'k', { fetch: fetchImpl as any, socket: (u) => new FakeSocket(u) })
  const v = await dsh.rpc<{ data: Uint8Array; version: string }>('workspaceFiles/readBytes', {})
  expect([...v.data]).toEqual([71, 73, 70, 56])
  expect(v.version).toBe('v1')
})

test('a duplex stream carries items up on its current stream id, and reopens as a new attachment after a drop', async () => {
  const sockets: FakeSocket[] = []
  const dsh = new Dsh('http://h', 'k', { socket: (u) => { const s = new FakeSocket(u); sockets.push(s); return s }, retryMs: 0 })
  const got: unknown[] = []
  const link = dsh.duplex('terminal/attach', { agentId: 's1', id: 't1' }, (v) => got.push(v))
  expect(link.send({ type: 'write', sequence: 1, data: 'x' })).toBe(false) // not open yet
  sockets[0]!.open()
  const open = sockets[0]!.sent.find((m) => m.type === 'open')
  expect([open.endpoint, open.payload.args]).toEqual(['terminal/attach', { agentId: 's1', id: 't1' }])
  expect(link.send({ type: 'write', sequence: 1, data: 'ls' })).toBe(true)
  expect(sockets[0]!.sent.at(-1)).toEqual({ type: 'item', streamId: open.streamId, value: { type: 'write', sequence: 1, data: 'ls' } })
  sockets[0]!.close()
  await until(() => sockets.length === 2)
  sockets[1]!.open()
  const reopened = sockets[1]!.sent.find((m) => m.type === 'open')
  link.send({ type: 'write', sequence: 1, data: 'again' })
  expect(sockets[1]!.sent.at(-1)).toEqual({ type: 'item', streamId: reopened.streamId, value: { type: 'write', sequence: 1, data: 'again' } })
  link.stop()
  expect(sockets[1]!.sent.at(-1)).toEqual({ type: 'cancel', streamId: reopened.streamId })
  expect(link.send({ type: 'write', sequence: 2, data: 'late' })).toBe(false)
})

// The companion's own route beside DSH's (host/src/server.ts GET /v1/capabilities): the computer's name and versions.
test('the computer\'s own description comes from the companion beside DSH, with the device key', async () => {
  const calls: { url: string; init: any }[] = []
  const fetchImpl = async (url: any, init: any) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ hostName: 'Studio', hostVersion: '0.7.13', upstreamVersion: '0.2.1-rc.3' }) } as any }
  const dsh = new Dsh('http://127.0.0.1:19446/dsh', 'k3y', { fetch: fetchImpl, socket: (u) => new FakeSocket(u) })
  expect(await dsh.computer()).toEqual({ name: 'Studio', companionVersion: '0.7.13', dshVersion: '0.2.1-rc.3' })
  expect(calls[0]!.url).toBe('http://127.0.0.1:19446/v1/capabilities')
  expect([calls[0]!.init.method ?? 'GET', calls[0]!.init.headers.authorization]).toEqual(['GET', 'Bearer k3y'])
})

test('says when the next try is, and that none is coming once held; trying now lifts the hold', async () => {
  const sockets: FakeSocket[] = []
  const at: (number | undefined)[] = []
  const dsh = new Dsh('http://h', 'k', { socket: (u) => { const s = new FakeSocket(u); sockets.push(s); return s }, connectMs: 10_000, retryMs: 60 })
  dsh.onRetryAt = (t) => at.push(t)
  dsh.stream('$events', {}, () => {})
  const before = Date.now()
  sockets[0]!.close()
  expect(typeof at.at(-1)).toBe('number')
  expect(at.at(-1)! >= before + 60).toBe(true)
  await until(() => sockets.length === 2) // the try it announced
  expect(at.at(-1)).toBe(undefined)
  dsh.hold()
  sockets[1]!.close()
  expect(at.at(-1)).toBe(undefined)
  await new Promise((r) => setTimeout(r, 120))
  expect(sockets.length).toBe(2)
  dsh.retryNow()
  expect(sockets.length).toBe(3)
  sockets[2]!.close()
  expect(typeof at.at(-1)).toBe('number')
  dsh.close()
})
