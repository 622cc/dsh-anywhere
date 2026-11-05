// The phone's half of DSH's duplex terminal (terminal/attach), as DSH's own web terminal client does it
// (dsh-api-terminal-controller types/client/model.js, rc.3). Each snapshot starts an attachment: input is numbered
// from 1, encoded frames in flight stay within the snapshot's input window and the rest wait, acks arrive in order
// and free that room, and input past the environment's limits is refused ("input full") rather than queued.

/** `terminal/environment`'s limits. */
export interface TerminalEnvironment { cwd: string; maxInputBytes: number; maxBufferedBytes: number; maxCols: number; maxRows: number; scrollback: number }
export interface TerminalInfo { id: string; title: string; cwd: string; cols: number; rows: number; state: 'failed' | 'running' | 'exited'; exitCode: number | null; error?: string }
type Command = { type: 'write'; sequence: number; data: string } | { type: 'resize'; sequence: number; cols: number; rows: number }
interface Entry { command: Command; inputBytes: number; frameBytes: number }
export type TerminalProblem = 'inputFull' | 'invalidOutput'

/** UTF-8 length, which is what the host's byte limits count. */
export function utf8Bytes(text: string): number {
  let n = 0
  for (const ch of text) { const c = ch.codePointAt(0)!; n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4 }
  return n
}

export class TerminalLink {
  info: TerminalInfo | undefined
  writable = false
  private window: { maxBytes: number; frameOverheadBytes: number } | undefined
  private attached = false
  private output = 0
  private sequence = 0
  private acknowledged = 0
  private queued: Entry[] = []
  private pending = new Map<number, Entry>()
  private inputBytes = 0
  private bufferedBytes = 0
  private inFlightBytes = 0

  constructor(private env: TerminalEnvironment, private send: (command: Command) => boolean,
    private screen: { write: (data: string) => void; reset: () => void; problem: (p: TerminalProblem) => void; changed?: () => void }) {}

  /** One downlink frame. A snapshot replaces the screen and starts a new attachment. */
  receive(frame: any): void {
    if (frame?.type === 'snapshot') {
      this.attached = true; this.output = frame.sequence; this.window = frame.inputWindow
      this.sequence = 0; this.acknowledged = 0; this.queued = []; this.pending.clear(); this.inputBytes = 0; this.bufferedBytes = 0; this.inFlightBytes = 0
      this.state(frame.info, frame.writable)
      this.screen.reset(); if (frame.screen) this.screen.write(frame.screen)
      return
    }
    if (!this.attached) return
    if (frame?.type === 'output') {
      if (frame.sequence !== this.output + 1) { this.fail('invalidOutput'); return }
      this.output = frame.sequence; this.screen.write(frame.data)
    } else if (frame?.type === 'state') this.state(frame.info, frame.writable)
    else if (frame?.type === 'ack') {
      const entry = this.pending.get(frame.sequence)
      if (frame.sequence !== this.acknowledged + 1 || !entry) { this.fail('invalidOutput'); return }
      this.acknowledged = frame.sequence; this.pending.delete(frame.sequence)
      this.inputBytes -= entry.inputBytes; this.bufferedBytes -= entry.frameBytes; this.inFlightBytes -= entry.frameBytes
      if (frame.refusal !== undefined) { this.writable = false; this.screen.changed?.() }
      this.flush()
    }
  }

  /** Keyboard input; false when it was not taken (not writable, or over a limit). */
  write(data: string): boolean {
    if (!this.writable || !data) return false
    const bytes = utf8Bytes(data)
    if (this.inputBytes + bytes > this.env.maxInputBytes) { this.screen.problem('inputFull'); return false }
    return this.admit({ type: 'write', sequence: this.sequence + 1, data }, bytes)
  }

  /** Ordered with input, clamped to the environment, skipped when the size is already right. */
  resize(cols: number, rows: number): void {
    if (!this.writable || !this.info || (this.info.cols === cols && this.info.rows === rows)) return
    cols = Math.min(cols, this.env.maxCols); rows = Math.min(rows, this.env.maxRows)
    if (this.admit({ type: 'resize', sequence: this.sequence + 1, cols, rows }, 0)) this.info = { ...this.info, cols, rows }
  }

  private state(info: TerminalInfo, writable: boolean) { this.info = info; this.writable = info?.state === 'running' && writable === true; this.screen.changed?.() }

  private admit(command: Command, inputBytes: number): boolean {
    const frameBytes = utf8Bytes(JSON.stringify(command)) + (this.window?.frameOverheadBytes ?? 0)
    if (this.bufferedBytes + frameBytes > this.env.maxBufferedBytes || (this.window && frameBytes > this.window.maxBytes)) { this.screen.problem('inputFull'); return false }
    this.queued.push({ command, inputBytes, frameBytes })
    this.sequence = command.sequence; this.inputBytes += inputBytes; this.bufferedBytes += frameBytes
    this.flush()
    return true
  }

  private flush() {
    while (this.writable && this.queued.length) {
      const next = this.queued[0]!
      if (this.window && this.inFlightBytes + next.frameBytes > this.window.maxBytes) return
      if (!this.send(next.command)) return
      this.queued.shift(); this.pending.set(next.command.sequence, next); this.inFlightBytes += next.frameBytes
    }
  }

  private fail(p: TerminalProblem) { this.attached = false; this.writable = false; this.screen.problem(p); this.screen.changed?.() }
}
