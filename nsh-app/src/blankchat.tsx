// A chat with nothing in it yet says which project it was started in; its title only says it is new.
import { Text, View } from 'nsh'

export function BlankChat(props: { title: string; path: string }) {
  return (
    <View testID="blank-chat" class="absolute inset-0 items-center justify-center px-8 pointer-events-none">
      <Text class="text-foreground text-[17px] font-semibold text-center line-clamp-2">{props.title}</Text>
      <Text class="mt-1 text-muted-foreground text-[13px] font-mono text-center line-clamp-2">{props.path}</Text>
    </View>
  )
}
