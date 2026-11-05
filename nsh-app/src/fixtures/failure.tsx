// A failed turn's row under the message that started it, as the chat draws it (src/failure.test.tsx).
import { mount, View } from 'nsh'
import { FailureView } from '../failure.tsx'

function App() {
  return (
    <View class="flex-1 bg-background p-4 gap-4">
      <FailureView failure={() => ({ kind: 'failure', id: 'failure:1', code: 'AUTH', message: '', at: 0 })} />
      <FailureView failure={() => ({ kind: 'failure', id: 'failure:2', code: 'INTERRUPTED', message: '', at: 0 })} />
    </View>
  )
}
mount(App)
