// The activity panel's folded row ("2 completed"), measured: its row's, label's and chevron's frames go to Storage for
// src/folded.test.tsx, which checks where the chevron sits.
import { mount, Storage, Text, View } from 'nsh'
import { Folded } from '../activity.tsx'

const keep = (key: string) => (b: { size: { width: number; height: number }; origin: { x: number; y: number } }) =>
  Storage.setItem(key, JSON.stringify({ x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height })).catch(() => {})

function App() {
  return (
    <View class="flex-1 bg-background p-4">
      <Folded count={2} label={(n) => `${n} completed`} testID="done"
        onRowLayout={(e) => keep('row')(e.bounds)} onLabelLayout={(e) => keep('label')(e.bounds)} onChevronLayout={(e) => keep('chevron')(e.bounds)}>
        <Text>first</Text>
      </Folded>
    </View>
  )
}
mount(App)
