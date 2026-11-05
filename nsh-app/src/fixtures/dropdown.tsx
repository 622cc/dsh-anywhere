// The shared dropdown button (the model picker's), measured: its label's and chevron's frames go to Storage for
// src/dropdown.test.tsx, which checks the space around them.
import { mount, Storage, View } from 'nsh'
import { DropdownButton } from '../ui.tsx'

const keep = (key: string) => (b: { size: { width: number; height: number }; origin: { x: number; y: number } }) =>
  Storage.setItem(key, JSON.stringify({ x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height })).catch(() => {})

function App() {
  return (
    <View class="flex-1 bg-background items-start p-4">
      <DropdownButton label="DeepSeek-V4.1-Flash (High)" testID="model" onPress={() => {}}
        onButtonLayout={(e) => keep('button')(e.bounds)} onLabelLayout={(e) => keep('label')(e.bounds)} onChevronLayout={(e) => keep('chevron')(e.bounds)} />
    </View>
  )
}
mount(App)
