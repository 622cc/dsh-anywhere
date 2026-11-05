// The agent's to-dos, docked above the composer as DSH Desktop docks them while any is open (and the chat's activity is pinned there): a header with the counts, folded by
// default; a press on it opens the list, and a press on the header or the open list folds it. The chat folds it too when it is touched (`open` is the chat's).
import { LayoutAnimation, type Signal, Text, View } from 'nsh'
import type { Todo } from './fold.ts'
import { todoParts } from './activity.ts'
import { S } from './strings.ts'
import { haptic, Chevron, Icon, LiveDot } from './ui.tsx'

export function TodoDock(props: { todos: () => Todo[]; open: Signal<boolean> }) {
  const open = props.open
  const toggle = () => { haptic('tick'); LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity')); open.set(!open()) }
  return (
    <If when={todoParts(props.todos()).active.length}>
      <View class="mb-2 rounded-[14px] border border-border bg-card" testID="todos">
        <View role="button" testID="todos-toggle" accessibilityLabel={S.todos} accessibilityState={{ expanded: open() }} onPress={toggle}
          class="flex-row items-center gap-2 px-[14px] min-h-[44px] active:bg-secondary rounded-[14px]">
          <Icon name="listChecks" size={16} />
          <Text class="text-foreground text-[15px] font-medium">{S.todos}</Text>
          <Text class="flex-1 text-muted-foreground text-[13px] line-clamp-1">{S.todoProgress(props.todos())}</Text>
          <View class={`transition-transform duration-200 ${open() ? 'rotate-180' : 'rotate-0'}`}><Chevron dir="down" font={13} /></View>
        </View>
        <If when={open()}>
          {/* The list grows upward and takes the header from under the finger: a press on it folds it as well. */}
          <View class="px-[14px] pb-[10px] gap-[6px]" testID="todo-list" onPress={toggle}>
            {[...todoParts(props.todos()).active, ...todoParts(props.todos()).done].map((t) => (
              <View class="flex-row items-start gap-[10px]" accessibilityLabel={`${S.todoState[t.status]}: ${t.content}`}>
                {t.status === 'in_progress' ? <LiveDot size={8} class="mt-[6px]" /> : <View class={`mt-[6px] w-[8px] h-[8px] rounded-full ${t.status === 'completed' ? 'bg-muted-foreground' : 'border border-muted-foreground'}`} />}
                <Text class={`flex-1 text-[15px] leading-[21px] ${t.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{t.content}</Text>
              </View>
            ))}
          </View>
        </If>
      </View>
    </If>
  )
}
