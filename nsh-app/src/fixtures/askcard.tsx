// An approval card on its own, measured: the card's, its button row's and the first button's frames go to Storage for
// src/askcard.test.tsx, which checks the corners.
import { mount, Storage, View } from 'nsh'
import { ApprovalCard } from '../asks.tsx'

const keep = (key: string) => (e: { bounds: { size: { width: number; height: number }; origin: { x: number; y: number } } }) =>
  Storage.setItem(key, JSON.stringify({ x: e.bounds.origin.x, y: e.bounds.origin.y, w: e.bounds.size.width, h: e.bounds.size.height })).catch(() => {})

function App() {
  return (
    <View class="flex-1 bg-background p-4">
      <ApprovalCard request={{ kind: 'approval', eventId: 'e1', sessionId: 's1', tool: 'shell', reason: 'Run the tests' }} onError={() => {}}
        onCardLayout={keep('card')} onRowLayout={keep('row')} onButtonLayout={keep('button')} />
    </View>
  )
}
mount(App)
