// The to-do dock under a chat, as the chat screen places it: touching the chat folds the list (src/todos.test.tsx).
import { mount, signal, Text, View } from 'nsh'
import { TodoDock } from '../todos.tsx'
import type { Todo } from '../fold.ts'

const todos: Todo[] = [{ content: 'Read the code', status: 'completed' }, { content: 'Fix the bug', status: 'in_progress' }, { content: 'Run tests', status: 'pending' }]

function App() {
  const open = signal(false)
  return (
    <View class="flex-1 bg-background">
      <View class="flex-1" onTouchStart={() => open.set(false)}><Text testID="message">A message in the chat</Text></View>
      <TodoDock todos={() => todos} open={open} />
    </View>
  )
}
mount(App)
