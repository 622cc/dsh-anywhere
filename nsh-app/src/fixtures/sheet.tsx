// An input and a button that asks with chooseAction (src/ui.tsx), for src/sheet.test.tsx.
import { mount, signal, Text, View } from 'nsh'
import { Input } from 'nsh/base'
import { ActionSheetHost, chooseAction } from '../ui.tsx'

function App() {
  const said = signal('')
  return (
    <View class="flex-1 bg-background pt-[60px]">
      <Input testID="field" placeholder="Message" onBlur={() => said.set('left the field')} />
      <View role="button" testID="ask" onPress={() => { chooseAction({ actions: [{ id: 'one', label: 'One' }] }) }}><Text>ask</Text></View>
      <Text testID="said">{said()}</Text>
      <ActionSheetHost />
    </View>
  )
}
mount(App)
