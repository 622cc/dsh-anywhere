// The terminal page's frame on its own, in each state, with a stand-in for the web view (src/shell.test.tsx).
import { mount, signal, Text, View } from 'nsh'
import { TerminalView } from '../shell.tsx'
import type { TerminalPhase } from '../terminals.ts'

function App() {
  const phase = signal<TerminalPhase>('connecting')
  const ctrl = signal(false)
  const log = signal('')
  const info = { id: 't1', title: 'zsh', cwd: '/w', cols: 80, rows: 24, state: 'exited' as const, exitCode: 3 }
  const set = (p: TerminalPhase) => <View role="button" testID={`set-${p}`} onPress={() => phase.set(p)}><Text>{p}</Text></View>
  return (
    <View class="flex-1 bg-background">
      <View class="flex-row">{set('live')}{set('readOnly')}{set('exited')}{set('failed')}</View>
      <Text testID="log">{log()}</Text>
      <TerminalView phase={phase} info={() => info} failure={() => 'The terminal could not start. boom'} notice={() => ''} ctrl={ctrl}
        onKey={(k) => { log.set(`key:${k}`); if (k === 'ctrl') ctrl.update((v) => !v) }} onTakeControl={() => log.set('take')} onRetry={() => log.set('retry')}
        screen={<View testID="terminal-screen" class="flex-1" />} />
    </View>
  )
}
mount(App)
