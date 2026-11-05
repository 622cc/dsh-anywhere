// The workspace browser stacked as App.tsx stacks it, one page per folder and per file, over a chat whose draft takes
// a mention (src/filebrowser.test.tsx). `host.params` names the page it opens on.
import { host, mount, signal, Text, View } from 'nsh'
import { createNavStack, NavPage, NavStack } from 'nsh/base'
import { settings } from '../state.ts'
import { FilesPage } from '../files.tsx'
import { mentionsInto, type FileEntry } from '../files.ts'

settings.set({ origin: 'http://127.0.0.1:40001/dsh', key: 'synthetic-device-token' })
type Route = { name: 'chat' } | { name: 'files'; path: string; file?: FileEntry }
const start = (host.params ?? {}) as { path?: string; file?: FileEntry }

function App() {
  const nav = createNavStack<Route>([{ name: 'chat' }, { name: 'files', path: start.path ?? '', file: start.file }])
  const draft = signal('')
  mentionsInto('s1', draft, (text) => draft.set(text))
  return (
    <NavStack state={nav} class="flex-1">{(route) => route.name === 'chat'
      ? <NavPage title="Chat" class="bg-background"><View class="flex-1"><Text testID="draft">{draft()}</Text></View></NavPage>
      : <FilesPage sessionId="s1" path={route.path} file={route.file} headerClass="bg-background text-foreground"
          onOpen={(path, entry) => nav.push({ name: 'files', path, file: entry.type === 'directory' ? undefined : entry })}
          onMentioned={() => nav.setRoutes([{ name: 'chat' }])} />}
    </NavStack>
  )
}
mount(App)
