// A chat header's activity button and its panel on their own, with a context reading, to-dos, jobs and subagents
// part done (src/activity.test.tsx).
import { mount, signal, Text, View } from 'nsh'
import { ActivityButton, ActivityDock, ActivityPanel, createActivity } from '../activity.tsx'
import { ActionSheetHost } from '../ui.tsx'

const a = createActivity()
a.context.set({ used: 54_000, window: 128_000, percent: 42 })
a.goal.set({ objective: 'Ship the mobile app', phase: 'active' })
a.todos.set([{ content: 'Write the parser', status: 'completed' }, { content: 'Wire the screen', status: 'in_progress' }, { content: 'Ship it', status: 'pending' }])
a.jobs.set([{ id: 'j1', kind: 'shell', label: 'npm run dev', status: 'running', startedAt: 0 }, { id: 'j2', kind: 'shell', label: 'npm test', status: 'completed', startedAt: 0, finishedAt: 1 }])
a.children.set([{ id: 'c1', createdAt: 1, mode: 'continuable', running: false, name: 'Read the docs' }])

function App() {
  const opened = signal('')
  const typing = signal(false) // the keyboard up, as the chat's composer has it
  return (
    <View class="flex-1 bg-background pt-[60px]">
      <View class="absolute top-[12px] right-[12px]"><ActivityButton activity={a} /></View>
      <Text testID="opened">{opened()}</Text>
      <View role="button" testID="typing" onPress={() => typing.set(true)}><Text>type</Text></View>
      <View role="button" testID="not-typing" onPress={() => typing.set(false)}><Text>done typing</Text></View>
      <View class="flex-1">
        <ActivityPanel activity={a} openJobs={() => opened.set('jobs')} openChildren={() => opened.set('children')} onOpenChild={(c) => opened.set(`child ${c.id}`)} />
      </View>
      <View class="px-3 pb-3"><ActivityDock activity={a} typing={typing} openJobs={() => opened.set('jobs')} openChildren={() => opened.set('children')} onOpenChild={(c) => opened.set(`child ${c.id}`)} /></View>
      <ActionSheetHost />
    </View>
  )
}
mount(App)
