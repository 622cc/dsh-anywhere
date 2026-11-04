// Any socket the app opens reports itself to the test: Try it must open none (tryit.test.tsx).
import { host } from 'nsh'
class ReportingSocket {
  readyState = 0
  constructor(url: string) { host.post('test.socket', { url }) }
  send() {}
  close() {}
}
;(globalThis as any).WebSocket = ReportingSocket
