// Approvals and questions for this chat, pinned above the composer (where Claude Code and Codex put permission
// prompts): they never scroll away while the agent waits.
import { Scroll, signal, Text, View, windowSize, type Bounds } from 'nsh'
import { Input, TextView } from 'nsh/base'
import { approvalAnswer, questionAnswer, type Request } from './events.ts'
import { toolLabel } from './fold.ts'
import { answer, asks, pending } from './state.ts'
import { readable, S } from './strings.ts'
import { haptic } from './ui.tsx'

export function Asks(props: { sessionId: string; onError: (m: string) => void }) {
  const requests = () => { asks(); return pending.forSession(props.sessionId) }
  return (
    <View class="gap-2 pb-2">
      {requests().map((r) => (r.kind === 'approval' ? <ApprovalCard request={r} onError={props.onError} /> : <QuestionCard request={r} onError={props.onError} />))}
    </View>
  )
}

/** The card's corners and its buttons' corners are concentric: a button in a corner sits the padding and the 1 pt border
 * in from both outer edges, and the card's radius is the button's plus that space. Inside the card's border nothing else
 * draws one. */
export const CONTROL_RADIUS = 10
export const CARD = { radius: CONTROL_RADIUS + 12 + 1 }
const card = 'border border-border bg-card p-[12px] gap-[10px]'
const cardStyle = { borderRadius: CARD.radius }
const button = (primary: boolean) => `flex-1 h-[36px] items-center justify-center ${primary ? 'bg-primary' : 'bg-secondary'} active:opacity-70`
const buttonStyle = { borderRadius: CONTROL_RADIUS }
type Layout = (e: { bounds: Bounds }) => void

export function ApprovalCard(props: { request: Extract<Request, { kind: 'approval' }>; onError: (m: string) => void; onCardLayout?: Layout; onRowLayout?: Layout; onButtonLayout?: Layout }) {
  const busy = signal(false)
  const reply = async (allow: boolean) => {
    busy.set(true)
    // Felt once the computer took the answer (Android's CONFIRM); a failed reply feels like a refusal.
    try { await answer(props.request.eventId, approvalAnswer(pending.clientId, props.request.eventId, allow)); haptic('confirm') } catch (e) { haptic('reject'); props.onError(readable(e)) } finally { busy.set(false) }
  }
  return (
    <View class={card} style={cardStyle} onLayout={props.onCardLayout} testID={`approval-${props.request.eventId}`}>
      <Text class="text-foreground text-[15px] leading-[21px] font-medium">{S.allowTool(toolLabel(props.request.tool))}</Text>
      {props.request.reason ? <Text class="text-muted-foreground text-[13px] leading-[18px] line-clamp-4">{props.request.reason}</Text> : null}
      <View class="flex-row gap-2" onLayout={props.onRowLayout}>
        <View role="button" testID="reject" onPress={() => { if (!busy()) reply(false) }} class={button(false)} style={buttonStyle} onLayout={props.onButtonLayout}><Text class="text-foreground text-[15px]">{S.reject}</Text></View>
        <View role="button" testID="allow" onPress={() => { if (!busy()) reply(true) }} class={button(true)} style={buttonStyle}><Text class="text-primary-foreground text-[15px] font-medium">{S.allow}</Text></View>
      </View>
    </View>
  )
}

function QuestionCard(props: { request: Extract<Request, { kind: 'question' }>; onError: (m: string) => void }) {
  const picks = signal<Record<string, { selected?: string[]; custom?: string }>>({})
  const busy = signal(false)
  const toggle = (id: string, label: string, multi: boolean) => { haptic('tick'); picks.update((p) => {
    const now = p[id]?.selected ?? []
    const selected = multi ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : (now[0] === label ? [] : [label])
    return { ...p, [id]: { ...p[id], selected } }
  }) }
  const submit = async () => {
    busy.set(true)
    try { await answer(props.request.eventId, questionAnswer(pending.clientId, props.request.eventId, props.request, picks())); haptic('confirm') } catch (e) { haptic('reject'); props.onError(readable(e)) } finally { busy.set(false) }
  }
  return (
    <View class={card} style={cardStyle} testID={`question-${props.request.eventId}`}>
      {props.request.questions.map((q) => (
        <View class="gap-2">
          {q.header ? <Text class="text-muted-foreground text-[12px] font-medium">{q.header}</Text> : null}
          <Text class="text-foreground text-[15px] leading-[21px] font-medium">{q.question}</Text>
          {/* A plan to review is markdown and can be long: formatted, in its own scroll, so the answers stay in reach. */}
          {q.detail ? (
            <Scroll style={{ maxHeight: Math.round(windowSize().height * 0.36), ...buttonStyle }} class="bg-background" testID={`detail-${q.id}`}>
              <View class="px-3 py-[10px]">
                <TextView markdown={q.detail} links="open" classes={{ root: 'text-foreground text-[13px] leading-[19px]', heading1: 'text-[15px] leading-[21px] font-semibold', heading2: 'text-[13px] leading-[19px] font-semibold', heading3: 'text-[13px] leading-[19px] font-semibold', code: 'font-mono text-[12px] bg-secondary rounded-[4px]', codeBlock: 'font-mono text-[12px] leading-[18px] bg-card rounded-[8px]' }} />
              </View>
            </Scroll>
          ) : null}
          <View class="flex-row flex-wrap gap-2">
            {q.options.map((o) => {
              const on = () => (picks()[q.id]?.selected ?? []).includes(o.label)
              return (
                <View role="button" testID={`option-${q.id}-${o.label}`} onPress={() => toggle(q.id, o.label, q.multiSelect)} class={`rounded-full px-[12px] h-[32px] justify-center ${on() ? 'bg-primary' : 'bg-secondary'} active:opacity-70`}>
                  <Text class={`text-[13px] ${on() ? 'text-primary-foreground' : 'text-foreground'}`}>{o.label}</Text>
                </View>
              )
            })}
          </View>
          <Input testID={`custom-${q.id}`} placeholder={q.options.length ? S.otherAnswer : S.yourAnswer} value={picks()[q.id]?.custom ?? ''} onChange={(e) => picks.update((p) => ({ ...p, [q.id]: { ...p[q.id], custom: e.value } }))}
            style={buttonStyle} class="bg-secondary px-3 py-[8px] text-foreground placeholder:text-muted-foreground text-[15px]" />
        </View>
      ))}
      <View class="flex-row gap-2">
        <View role="button" testID="submit-answer" onPress={() => { if (!busy()) submit() }} class={button(true)} style={buttonStyle}><Text class="text-primary-foreground text-[15px] font-medium">{S.sendAnswer}</Text></View>
      </View>
    </View>
  )
}
