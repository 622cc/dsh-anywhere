// One shell on the computer, as the phone's terminal page follows it (DSH 0.2.1-rc.3 terminal controller, as its web
// sidebar does it): read the Session's limits, create the shell under an identity the phone picked (or adopt one the
// computer already lists), hold it with `terminal/retain` so the computer does not reclaim it while the page shows it,
// and attach once that hold is acknowledged. The latest attachment owns input: another window attaching makes this one
// read-only until it takes control back with an attachment of its own. Input is never replayed after a drop.
import { TerminalLink, type TerminalEnvironment, type TerminalInfo, type TerminalProblem } from './terminal.ts'

export interface TerminalRemote {
  rpc(method: string, args: Record<string, unknown>): Promise<any>
  stream(endpoint: string, args: unknown, onItem: (v: unknown) => void, onError?: (e: any) => void): () => void
  duplex(endpoint: string, args: unknown, onItem: (v: unknown) => void, onError?: (e: any) => void): { send: (v: unknown) => boolean; stop: () => void }
}
export interface TerminalScreen { write: (data: string) => void; reset: () => void; problem: (p: TerminalProblem) => void }
export type TerminalPhase = 'loading' | 'connecting' | 'live' | 'readOnly' | 'exited' | 'failed' | 'closed'
/** Why a terminal failed: the Session's limit, a shell the computer no longer has, or anything else. */
export type TerminalFailure = 'limit' | 'missing' | 'other'

let made = 0
/** A new identity, within the host's `[\w-]{1,128}`. */
export const newTerminalId = () => `m-${Date.now().toString(36)}-${(made++).toString(36)}-${Math.floor(Math.random() * 1e8).toString(36)}`

/** The control character of one typed key (Ctrl+C is ETX); anything longer than a key passes unchanged. */
export function withCtrl(data: string): string {
  if (data.length !== 1) return data
  if (data === ' ') return '\x00'
  const c = data.toUpperCase().charCodeAt(0)
  return c >= 0x40 && c <= 0x5f ? String.fromCharCode(c - 0x40) : data
}

const failure = (e: any): TerminalFailure => {
  const code = String(e?.code ?? '')
  return code.includes('limit') ? 'limit' : code === 'terminal/unavailable' || code === 'session/not-found' ? 'missing' : 'other'
}

export class TerminalSession {
  phase: TerminalPhase = 'loading'
  error: TerminalFailure | undefined
  message = ''
  info: TerminalInfo | undefined
  env: TerminalEnvironment | undefined
  onChange: () => void = () => {}
  private link: TerminalLink | undefined
  private attachment: { send: (v: unknown) => boolean; stop: () => void } | undefined
  private releaseHold: (() => void) | undefined
  private size = { cols: 80, rows: 24 }
  private ended = false

  constructor(private remote: TerminalRemote, readonly sessionId: string, readonly target: { id: string; create: boolean }, private screen: TerminalScreen) {}

  async start(cols: number, rows: number): Promise<void> {
    this.size = { cols, rows }
    try {
      const env: TerminalEnvironment = await this.remote.rpc('terminal/environment', { agentId: this.sessionId })
      this.env = env
      if (this.target.create) {
        this.info = await this.remote.rpc('terminal/create', { agentId: this.sessionId, request: { id: this.target.id, cols: Math.min(cols, env.maxCols), rows: Math.min(rows, env.maxRows) } })
      } else {
        const list: TerminalInfo[] = await this.remote.rpc('terminal/list', { sessionId: this.sessionId })
        this.info = (Array.isArray(list) ? list : []).find((t) => t?.id === this.target.id)
        if (!this.info) { this.fail({ code: 'terminal/unavailable' }); return }
      }
    } catch (e) { this.fail(e); return }
    if (this.ended) return
    this.set('connecting')
    let held = false
    this.releaseHold = this.remote.stream('terminal/retain', { sessionId: this.sessionId, id: this.target.id }, (item: any) => {
      if (item?.type !== 'retained' || held || this.ended) return
      held = true
      this.attach()
    }, (e) => this.fail(e))
  }

  /** Keyboard input; false when the phone does not hold input (read-only, exited, or over a limit). */
  input(data: string): boolean { return this.link?.write(data) ?? false }

  /** The page's grid changed size. */
  resize(cols: number, rows: number) { this.size = { cols, rows }; this.link?.resize(cols, rows) }

  /** A new attachment, which the computer gives input to. */
  takeControl() { if (!this.ended && this.info) this.attach() }

  /** Lets go of the shell without ending it. */
  stop() {
    this.ended = true
    this.attachment?.stop(); this.attachment = undefined
    this.releaseHold?.(); this.releaseHold = undefined
  }

  /** Ends the shell on the computer. */
  async close(): Promise<void> {
    this.stop()
    try { await this.remote.rpc('terminal/close', { agentId: this.sessionId, id: this.target.id }) } catch (e) { this.message = String((e as Error)?.message ?? e) }
    this.set('closed')
  }

  private attach() {
    this.attachment?.stop()
    const env = this.env!
    let link: TerminalLink
    const attachment = this.remote.duplex('terminal/attach', { agentId: this.sessionId, id: this.target.id }, (frame: any) => {
      if (this.attachment !== attachment) return
      link.receive(frame)
      if (frame?.type === 'snapshot') link.resize(this.size.cols, this.size.rows)
      this.sync()
    }, (e) => { if (this.attachment === attachment) this.fail(e) })
    link = new TerminalLink(env, (command) => attachment.send(command), { ...this.screen, changed: () => this.sync() })
    this.link = link; this.attachment = attachment
    this.set('connecting')
  }

  private sync() {
    const link = this.link
    if (!link?.info || this.phase === 'failed' || this.phase === 'closed') return
    this.info = link.info
    this.set(link.info.state === 'exited' || link.info.state === 'failed' ? 'exited' : link.writable ? 'live' : 'readOnly')
  }

  private fail(e: any) {
    if (this.phase === 'closed') return
    this.error = failure(e); this.message = String(e?.message ?? '')
    this.stop()
    this.set('failed')
  }

  private set(phase: TerminalPhase) { if (this.phase !== phase) { this.phase = phase; this.onChange() } }
}
