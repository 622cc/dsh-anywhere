// DSH's web-client protocol, as the Desktop's own web app speaks it, through the companion's owner proxy.
// Calls: POST /api/<method> {type:'client-request', rpcId, method, payload:{args}} → {result:{ok, value|error}}.
// Streams: one WebSocket at /api/remote.mux carrying {type:'open'|'item'|'cancel', streamId, endpoint, payload:{args}}
// up and {type:'item'|'error'|'end', streamId, value|error} down. A reopened follow starts with a fresh snapshot.
// NSH's WebSocket cannot set headers, so the socket carries the device key in the query (the proxy strips it).
// The phone's link to the computer can die without a word (a tunnel kept while the app was away): a socket that does
// not open within `connectMs` and a call not answered within `rpcMs` count as failures, and after two failures in a
// row the shell is asked to rebuild the link (`onStuck`) before the next try.

export interface SocketLike {
  onopen: (() => void) | null
  onmessage: ((e: { data: string }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  readyState: number
  send(data: string): void
  close(): void
}
export class DshError extends Error { constructor(public code: string, message: string) { super(message) } }
export type ConnectionState = 'connecting' | 'online' | 'offline'

interface Stream { id: string; endpoint: string; args: unknown; onItem: (v: unknown) => void; onError?: (e: DshError) => void }

/** A value holding bytes (workspaceFiles/readBytes) comes as multipart (dsh-client-connection `fullResponse`): the
 * envelope in `metadata` with null where each byte array sat, and `attachments` naming the part that fills each place. */
async function withBytes(res: Response): Promise<any> {
  const form = await res.formData()
  const meta = form.get('metadata')
  const body = JSON.parse(typeof meta === 'string' ? meta : await (meta as Blob | null)?.text() ?? '')
  for (const a of Array.isArray(body?.attachments) ? body.attachments : []) {
    const part = form.get(a?.part), path: (string | number)[] = Array.isArray(a?.path) ? a.path : []
    if (part === null || !path.length) continue
    const bytes = typeof part === 'string' ? new TextEncoder().encode(part) : new Uint8Array(await part.arrayBuffer())
    let at = body?.result?.value
    for (const key of path.slice(0, -1)) at = at?.[key]
    if (at && typeof at === 'object') at[path.at(-1)!] = bytes
  }
  return body
}

let counter = 0
const nextId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`

export class Dsh {
  private socket: SocketLike | undefined
  private streams = new Map<string, Stream>()
  private retry: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private attempt = 0
  private failures = 0
  private connecting: ReturnType<typeof setTimeout> | undefined
  onState: (s: ConnectionState) => void = () => {}
  /** When the next try is; undefined while one is under way, or when none is coming (`hold`). */
  onRetryAt: (at: number | undefined) => void = () => {}
  private held = false

  constructor(public origin: string, private readonly key: string, private readonly io: { fetch?: typeof fetch; socket?: (url: string) => SocketLike; retryMs?: number; connectMs?: number; rpcMs?: number; onStuck?: () => unknown } = {}) {}

  /** Two failures in a row: the link itself may be dead, so the shell rebuilds it (once until something works). */
  private failed() { if (++this.failures === 2) Promise.resolve(this.io.onStuck?.()).catch(() => {}) }
  private worked() { this.failures = 0 }

  async rpc<T = any>(method: string, args: Record<string, unknown>): Promise<T> { return this.call<T>(`${this.origin}/api/${method}`, method, args) }

  /** A call the companion answers itself (host/src/server.ts, /dsh/companion/*), in the same envelope as DSH's. */
  async companion<T = any>(method: string, args: Record<string, unknown>): Promise<T> { return this.call<T>(`${this.origin}/companion/${method}`, method, args) }

  /** The computer as the companion describes it (host/src/server.ts GET /v1/capabilities): its name (`computerName`,
   * else the companion's configured `hostName`) and the companion's and DSH's versions. */
  async computer(): Promise<{ name: string; companionVersion: string; dshVersion: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DshError('timeout', 'The computer did not answer')), this.io.rpcMs ?? 20_000) })
    let res: Response
    try { res = await Promise.race([(this.io.fetch ?? fetch)(`${this.origin.replace(/\/dsh\/?$/, '')}/v1/capabilities`, { method: 'GET', headers: { authorization: `Bearer ${this.key}` } } as RequestInit), timeout]) }
    catch (e) { throw e instanceof DshError ? e : new DshError('network', 'Can’t reach your computer') } finally { clearTimeout(timer) }
    if (res.status === 401) throw new DshError('unauthorized', 'The computer did not accept this phone')
    if (!res.ok) throw new DshError(`http/${res.status}`, `HTTP ${res.status}`)
    const v = (await res.json()) as Record<string, unknown>
    const text = (x: unknown) => (typeof x === 'string' ? x : '')
    return { name: text(v.computerName) || text(v.hostName), companionVersion: text(v.hostVersion), dshVersion: text(v.upstreamVersion) }
  }

  private async call<T>(url: string, method: string, args: Record<string, unknown>): Promise<T> {
    const rpcId = nextId()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DshError('timeout', 'The computer did not answer')), this.io.rpcMs ?? 20_000) })
    let res: Response
    try {
      res = await Promise.race([(this.io.fetch ?? fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
      } as RequestInit), timeout])
    } catch (e) { this.failed(); throw e instanceof DshError ? e : new DshError('network', 'Can’t reach your computer') } finally { clearTimeout(timer) }
    this.worked()
    if (res.status === 401) throw new DshError('unauthorized', 'The computer did not accept this phone')
    if (!res.ok) throw new DshError(`http/${res.status}`, `HTTP ${res.status}`)
    const body = /^\s*multipart\//i.test(res.headers?.get?.('content-type') ?? '') ? await withBytes(res) : await res.json()
    const result = body?.result
    if (result?.ok === true) return result.value as T
    throw new DshError(result?.error?.code ?? 'unknown', result?.error?.message ?? '')
  }

  /** Opens a logical stream on the shared socket; returns its cancel. Reopened after every reconnect. */
  stream(endpoint: string, args: unknown, onItem: (v: unknown) => void, onError?: (e: DshError) => void): () => void {
    const s: Stream = { id: nextId(), endpoint, args, onItem, onError }
    this.streams.set(s.id, s)
    if (this.socket?.readyState === 1) this.sendOpen(s); else this.ensure()
    return () => { if (this.streams.delete(s.id)) this.send({ type: 'cancel', streamId: s.id }) }
  }

  /** A stream that also carries items up (DSH's terminal/attach). `send` is false while the stream is not open on a
   * live socket; after a drop it reopens under a new id, which the host treats as a new attachment. */
  duplex(endpoint: string, args: unknown, onItem: (v: unknown) => void, onError?: (e: DshError) => void): { send: (value: unknown) => boolean; stop: () => void } {
    const s: Stream = { id: nextId(), endpoint, args, onItem, onError }
    this.streams.set(s.id, s)
    if (this.socket?.readyState === 1) this.sendOpen(s); else this.ensure()
    return {
      send: (value) => this.streams.get(s.id) === s && this.socket?.readyState === 1 && this.send({ type: 'item', streamId: s.id, value }),
      stop: () => { if (this.streams.delete(s.id)) this.send({ type: 'cancel', streamId: s.id }) },
    }
  }

  /** Tries the socket now instead of waiting for the next retry, with short pauses again. A try still waiting is given
   * up: one begun while the app was away (where Android gives it no network) would only time out. */
  retryNow(): void {
    clearTimeout(this.retry); this.attempt = 0; this.held = false
    if (!this.streams.size) return
    const waiting = this.socket
    if (waiting && waiting.readyState !== 1) {
      this.socket = undefined; clearTimeout(this.connecting)
      waiting.onopen = waiting.onmessage = waiting.onclose = waiting.onerror = null
      try { waiting.close() } catch {}
    }
    this.ensure()
  }

  /** No more tries until `retryNow`: trying again can't help, as with a computer that refuses this phone. */
  hold(): void { this.held = true; clearTimeout(this.retry); this.onRetryAt(undefined) }

  close(): void { this.closed = true; clearTimeout(this.retry); clearTimeout(this.connecting); this.streams.clear(); this.socket?.close() }

  private sendOpen(s: Stream) { this.send({ type: 'open', streamId: s.id, endpoint: s.endpoint, payload: { args: s.args } }) }

  /** A socket can die before it says so: a failed send drops it, and every stream reopens on the next one. */
  private send(message: unknown): boolean {
    const socket = this.socket
    if (socket?.readyState !== 1) return false
    try { socket.send(JSON.stringify(message)); return true } catch { this.drop(socket); try { socket.close() } catch {} return false }
  }

  private drop(socket: SocketLike) {
    if (this.socket !== socket) return
    this.socket = undefined
    clearTimeout(this.connecting)
    this.failed()
    this.onState('offline')
    if (this.closed || this.streams.size === 0 || this.held) return
    const wait = this.io.retryMs ?? Math.min(15_000, 500 * 2 ** this.attempt++)
    clearTimeout(this.retry); this.retry = setTimeout(() => this.ensure(), wait)
    this.onRetryAt(Date.now() + wait)
  }

  private ensure() {
    if (this.closed || this.socket) return
    const url = `${this.origin.replace(/^http/, 'ws')}/api/remote.mux?dshm_key=${encodeURIComponent(this.key)}`
    const socket = (this.io.socket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike))(url)
    this.socket = socket
    this.onRetryAt(undefined)
    this.onState('connecting')
    clearTimeout(this.connecting)
    this.connecting = setTimeout(() => { if (this.socket === socket && socket.readyState !== 1) { this.drop(socket); try { socket.close() } catch {} } }, this.io.connectMs ?? 10_000)
    socket.onopen = () => {
      clearTimeout(this.connecting)
      this.attempt = 0
      this.worked()
      this.onState('online')
      // Old stream ids belong to the dead socket: give every stream a new one and reopen it.
      const all = [...this.streams.values()]; this.streams.clear()
      for (const s of all) { s.id = nextId(); this.streams.set(s.id, s); this.sendOpen(s) }
    }
    socket.onmessage = (e) => {
      let m: any; try { m = JSON.parse(e.data) } catch { return }
      const s = this.streams.get(m?.streamId); if (!s) return
      if (m.type === 'item') s.onItem(m.value)
      else if (m.type === 'error') { this.streams.delete(s.id); s.onError?.(new DshError(m.error?.code ?? 'unknown', m.error?.message ?? '')) }
      else if (m.type === 'end') this.streams.delete(s.id)
    }
    socket.onclose = () => this.drop(socket)
    socket.onerror = () => { this.drop(socket); try { socket.close() } catch {} }
  }
}
