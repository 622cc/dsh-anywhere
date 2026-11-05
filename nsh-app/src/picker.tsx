// The model and thinking-depth picker under the composer (where Claude's and ChatGPT's apps keep theirs): the chat's
// current model as a label; a press opens a sheet of DSH's routable models by provider and the chosen model's depths.
import { Scroll, signal, Text, View } from 'nsh'
import { Sheet } from 'nsh/base'
import { catalogOf, findModel, modelLabel, type Catalog, type Selection } from './models.ts'
import { dsh } from './state.ts'
import { readable, S } from './strings.ts'
import { DropdownButton, Grabber, haptic, SCRIM, SHEET, sheetBottom } from './ui.tsx'

let cached: Catalog | undefined

export function ModelPicker(props: { sessionId: string; selection: () => Selection | undefined; onSelected: (s: Selection) => void; onError: (message: string) => void }) {
  const catalog = signal<Catalog>(cached ?? { groups: [] })
  const open = signal(false)
  const load = async () => { try { cached = catalogOf(await dsh().rpc('session/modelCatalog', {})); catalog.set(cached) } catch (e) { props.onError(readable(e)) } }
  if (!cached) load()
  const current = () => props.selection() ?? catalog().default
  const choose = async (s: Selection) => {
    haptic('tick')
    try {
      await dsh().rpc('session/selectModel', { request: { sessionId: props.sessionId, ...s } })
      props.onSelected(s)
    } catch (e) { props.onError(readable(e)) }
  }
  const pickModel = (provider: string, model: string) => {
    const m = findModel(catalog(), { provider, model })
    const keep = current()?.reasoningEffort
    const effort = m?.efforts.some((e) => e.id === keep) ? keep : m?.defaultEffort
    choose(effort ? { provider, model, reasoningEffort: effort } : { provider, model })
    if (!m?.efforts.length) open.set(false)
  }
  const efforts = () => findModel(catalog(), current())?.efforts ?? []
  return (
    <>
      <DropdownButton testID="model" accessibilityLabel={S.model} onPress={() => { open.set(true); load() }} label={modelLabel(catalog(), current()) || S.model} />
      <Sheet open={open()} onOpenChange={(e) => open.set(e.open)} closeOnSwipe popupClass={SHEET} backdropStyle={SCRIM}>
        <View class="pt-3" style={{ maxHeight: 560, paddingBottom: sheetBottom() }}>
          <Grabber />
          <Text class="px-5 text-foreground text-[15px] font-semibold mb-1">{S.model}</Text>
          <Scroll style={{ flexShrink: 1 }} contentClass="pb-2">
            {catalog().groups.filter((g) => g.models.length).map((g) => (
              <View class="pt-3">
                <Text class="px-5 pb-1 text-muted-foreground text-[12px]">{g.name}</Text>
                {g.models.map((m) => {
                  const selected = () => current()?.provider === g.id && current()?.model === m.id
                  return (
                    <View role="button" testID={`model-${g.id}-${m.id}`} onPress={() => pickModel(g.id, m.id)} class="flex-row items-center gap-3 px-5 py-[10px] active:bg-secondary">
                      <View class="flex-1">
                        <Text class="text-foreground text-[15px] leading-5">{m.name}</Text>
                        {m.description ? <Text class="text-muted-foreground text-[12px] leading-[16px] line-clamp-2">{m.description}</Text> : null}
                      </View>
                      <Text class="text-foreground text-[15px]">{selected() ? '✓' : ''}</Text>
                    </View>
                  )
                })}
              </View>
            ))}
          </Scroll>
          <If when={efforts().length > 0}>
            <View class="px-5 pt-3 pb-2 border-t border-border gap-2">
              <Text class="text-muted-foreground text-[12px]">{S.thinking}</Text>
              <View class="flex-row flex-wrap gap-2">
                {efforts().map((e) => {
                  const active = () => (current()?.reasoningEffort ?? findModel(catalog(), current())?.defaultEffort) === e.id
                  return (
                    <View role="button" testID={`effort-${e.id}`} onPress={() => { const c = current(); if (c) choose({ provider: c.provider, model: c.model, reasoningEffort: e.id }) }}
                      class={`px-[12px] h-[30px] justify-center rounded-full border ${active() ? 'bg-primary border-primary' : 'border-border'} active:opacity-70`}>
                      <Text class={`text-[13px] ${active() ? 'text-primary-foreground' : 'text-foreground'}`}>{e.name}</Text>
                    </View>
                  )
                })}
              </View>
            </View>
          </If>
        </View>
      </Sheet>
    </>
  )
}
