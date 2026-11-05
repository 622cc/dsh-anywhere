// A computer behind a fake socket: its workspace/follow names one workspace after the device key the socket was opened
// with, so a screen shows which link its stream is on. Import this before the app (App.test.tsx).
class FakeSocket {
  readyState = 0
  onopen?: () => void
  onmessage?: (e: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  private readonly key: string
  constructor(url: string) {
    this.key = /dshm_key=([^&]+)/.exec(url)?.[1] ?? '?'
    setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
  }
  send(raw: string) {
    const m = JSON.parse(raw)
    if (m.type === 'open' && m.endpoint === 'workspace/follow') {
      const w = { workspaceId: `w-${this.key}`, path: `/w/${this.key}`, title: `linked-${this.key}`, sessionIds: [], updatedAt: 1 }
      this.onmessage?.({ data: JSON.stringify({ type: 'item', streamId: m.streamId, value: { type: 'baseline', value: { items: [w], archivedSessionIds: [], pinnedSessionIds: [] } } }) })
    }
  }
  close() { this.readyState = 3; this.onclose?.() }
}
;(globalThis as any).WebSocket = FakeSocket
