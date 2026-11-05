// A turn that ended in an error or was stopped, as Desktop's TurnErrorItem draws it under the turn: a red dot, the
// title in red, the reason in secondary text, and the code. Without it a failed turn looks like an agent that never
// answered.
import { Text, View } from 'nsh'
import { failureCopy, type Row } from './fold.ts'

export function FailureView(props: { failure: () => Extract<Row, { kind: 'failure' }> }) {
  const copy = () => failureCopy(props.failure())
  return (
    <View class="flex-row items-start gap-2" testID="turn-failure">
      <View class="mt-[7px] w-[6px] h-[6px] rounded-full bg-destructive" />
      <View class="flex-1">
        <Text class="text-destructive text-[13px] leading-5 font-semibold">{copy().title}</Text>
        <If when={copy().message}><Text class="text-muted-foreground text-[13px] leading-5">{copy().message}</Text></If>
      </View>
      <If when={copy().code}><Text class="text-muted-foreground text-[12px] leading-5 font-mono">{copy().code}</Text></If>
    </View>
  )
}
