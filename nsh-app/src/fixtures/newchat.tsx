// The new-chat sheet, open, over two registered workspaces whose chats were last active at different times
// (src/newchat.test.tsx). The chat it starts is written under the sheet.
import { host, LayoutAnimation, mount, signal, Text, View } from 'nsh'
import { settings } from '../state.ts'
import { NewChat } from '../newchat.tsx'
import type { Workspace } from '../workspaces.ts'

settings.set({ origin: 'http://127.0.0.1:40001/dsh', key: 'synthetic-device-token' })
const workspaces = signal<Workspace[]>([
  { workspaceId: 'w-site', path: '/home/me/site', title: 'site', sessionIds: ['s1'], updatedAt: 100 },
  { workspaceId: 'w-api', path: '/home/me/api', title: 'api', sessionIds: ['s2'], updatedAt: 100 },
])
// DSH's workspace/follow saying a workspace was added.
host.on('workspace', (w) => workspaces.update((list) => [w as unknown as Workspace, ...list]))
const chats = [{ sessionId: 's1', title: 'a', updatedAt: 1_000, running: false }, { sessionId: 's2', title: 'b', updatedAt: 5_000, running: false }]

// How many updates were asked to animate: a commit of its own here would use up the animation, so it shows a tick later.
const glides = signal(0)
let asked = 0
const configureNext = LayoutAnimation.configureNext
LayoutAnimation.configureNext = (...args: Parameters<typeof configureNext>) => { asked++; setTimeout(() => glides.set(asked), 0); return configureNext(...args) }

function App() {
  const started = signal('')
  return (
    <View class="flex-1 bg-background">
      <Text testID="started">{started()}</Text>
      <Text>{`glides:${glides()}`}</Text>
      <NewChat open={() => true} workspaces={workspaces} chats={() => chats} workspaceId={() => undefined} onClose={() => {}} onCreated={(id, where) => started.set(where ? `${id} in ${where.title} at ${where.path}` : id)} />
    </View>
  )
}
mount(App)
