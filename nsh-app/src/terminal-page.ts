// The terminal's web page: xterm.js draws the screen and reads the keyboard; everything else stays in the app.
// Page → app (window.nsh.postMessage, JSON): ready / size {cols, rows} once laid out and on each change, input {data}.
// App → page (WebViewRef.postMessage, JSON): reset, write {data}, key {name} (the key bar, encoded by xterm's own
// cursor-key mode), theme {dark}, focus.
import { FIT_JS, XTERM_CSS, XTERM_JS } from './vendor/xterm.ts'

export type PageMessage = { t: 'ready' | 'size'; cols: number; rows: number } | { t: 'input'; data: string }
export type BarKey = 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end'

const THEMES = {
  dark: { background: '#14120B', foreground: '#EDECEC', cursor: '#EDECEC', cursorAccent: '#14120B', selectionBackground: '#EDECEC40' },
  light: { background: '#F7F7F4', foreground: '#26251E', cursor: '#26251E', cursorAccent: '#F7F7F4', selectionBackground: '#26251E30' },
}

const BOOT = `(function () {
  var cfg = window.__terminal;
  var term = new Terminal({ fontFamily: 'ui-monospace, Menlo, "Roboto Mono", "Droid Sans Mono", monospace', fontSize: cfg.fontSize,
    scrollback: cfg.scrollback, cursorBlink: true, minimumContrastRatio: 4.5, theme: cfg.themes[cfg.dark ? 'dark' : 'light'] });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  var box = document.getElementById('t');
  term.open(box);
  function post(m) { window.nsh.postMessage(JSON.stringify(m)); }
  var last = '';
  function size() {
    try { fit.fit(); } catch (e) {}
    var now = term.cols + 'x' + term.rows;
    if (now !== last && term.cols > 0 && term.rows > 0) { var first = !last; last = now; post({ t: first ? 'ready' : 'size', cols: term.cols, rows: term.rows }); }
  }
  new ResizeObserver(size).observe(box);
  term.onData(function (d) { post({ t: 'input', data: d }); });
  var CSI = { up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F' };
  window.addEventListener('message', function (e) {
    if (typeof e.data !== 'string') return;
    var m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.t === 'reset') term.reset();
    else if (m.t === 'write') term.write(m.data);
    else if (m.t === 'theme') term.options.theme = cfg.themes[m.dark ? 'dark' : 'light'];
    else if (m.t === 'focus') term.focus();
    else if (m.t === 'key') {
      var seq = m.name === 'esc' ? '\\x1b' : m.name === 'tab' ? '\\t' : CSI[m.name] ? (term.modes.applicationCursorKeysMode ? '\\x1bO' : '\\x1b[') + CSI[m.name] : '';
      if (seq) post({ t: 'input', data: seq });
    }
  });
  size();
})();`

/** The whole page, scripts inline: it loads nothing from anywhere. */
export function terminalPage(opts: { dark: boolean; fontSize: number; scrollback: number }): string {
  const theme = THEMES[opts.dark ? 'dark' : 'light']
  const cfg = JSON.stringify({ dark: opts.dark, fontSize: opts.fontSize, scrollback: opts.scrollback, themes: THEMES })
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">`
    + `<style>${XTERM_CSS}\nhtml,body{margin:0;height:100%;background:${theme.background};overflow:hidden}#t{position:absolute;inset:4px 6px}</style></head>`
    + `<body><div id="t"></div><script>${XTERM_JS}</script><script>${FIT_JS}</script><script>window.__terminal=${cfg};${BOOT}</script></body></html>`
}

/** A page message, or undefined for anything else. */
export function readPageMessage(data: string): PageMessage | undefined {
  let m: any
  try { m = JSON.parse(data) } catch { return undefined }
  if ((m?.t === 'ready' || m?.t === 'size') && Number.isInteger(m.cols) && Number.isInteger(m.rows) && m.cols > 0 && m.rows > 0) return { t: m.t, cols: m.cols, rows: m.rows }
  if (m?.t === 'input' && typeof m.data === 'string') return { t: 'input', data: m.data }
  return undefined
}

/** The app's side of the page: output waits until the page is ready, and writes between two flushes go as one message. */
export class PageChannel {
  private open = false
  private queue: ({ t: 'write'; data: string } | { t: 'reset' })[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private post: (message: string) => void) {}
  ready() { this.open = true; this.schedule() }
  /** The page went away (reloaded or torn down): nothing more is sent until it says ready again. */
  lost() { this.open = false; this.queue = []; clearTimeout(this.timer); this.timer = undefined }
  write(data: string) {
    const tail = this.queue.at(-1)
    if (tail?.t === 'write') tail.data += data; else this.queue.push({ t: 'write', data })
    this.schedule()
  }
  reset() { this.queue.push({ t: 'reset' }); this.schedule() }
  key(name: BarKey) { if (this.open) this.post(JSON.stringify({ t: 'key', name })) }
  send(message: { t: 'theme'; dark: boolean } | { t: 'focus' }) { if (this.open) this.post(JSON.stringify(message)) }
  private schedule() {
    if (!this.open || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const q = this.queue; this.queue = []
      for (const m of q) this.post(JSON.stringify(m))
    }, 16)
  }
}
