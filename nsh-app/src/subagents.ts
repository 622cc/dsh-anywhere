// A chat's subagents, as DSH 0.2.1-rc.3 publishes them: the parent's `subagentCatalog` projection lists its
// children (the follow snapshot's, then each `subagent/catalog` event appends one); session/list says which run, as
// Desktop's catalog reads them. A child is read through session/follow's subagent address; a continuable child takes
// follow-ups through subagents/prompt (dsh-subagent, dsh-client-ui-subagent).
export type SubagentMode = 'one-shot' | 'external' | 'continuable' | 'unknown'
export interface Subagent { id: string; createdAt: number; mode: SubagentMode; label?: string }
export interface Child extends Subagent { running: boolean; name: string }

const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const MODES: SubagentMode[] = ['one-shot', 'external', 'continuable', 'unknown']

export function catalogOf(v: unknown): Subagent[] {
  return (Array.isArray(v) ? v : []).flatMap((e) => {
    const s = obj(e)
    if (typeof s?.id !== 'string') return []
    return [{ id: s.id, createdAt: Number(s.createdAt) || 0, mode: MODES.includes(s.mode) ? s.mode : 'unknown', ...(typeof s.label === 'string' && s.label ? { label: s.label } : {}) }]
  })
}

/** The catalog's children with whether each runs (session/list's `running`), newest first. A row is named by the
 * child's label, else its own title, else its id, as Desktop's catalog rows are. */
export function children(catalog: Subagent[], list: unknown): Child[] {
  const listed = new Map<string, Record<string, any>>()
  for (const s of Array.isArray(obj(list)?.items) ? obj(list)!.items : []) if (typeof s?.sessionId === 'string') listed.set(s.sessionId, s)
  return catalog.map((c) => {
    const s = listed.get(c.id), title = s?.projections?.values?.title
    return { ...c, running: s?.running === true, name: c.label ?? (typeof title === 'string' && title ? title : c.id) }
  }).sort((a, b) => b.createdAt - a.createdAt)
}

/** One `subagent/catalog` event's child, added once. */
export function catalogAdd(catalog: Subagent[], data: unknown): Subagent[] {
  const d = obj(data)
  const [entry] = catalogOf([{ ...d, id: d?.childId, createdAt: d?.childCreatedAt }])
  return entry && !catalog.some((c) => c.id === entry.id) ? [...catalog, entry] : catalog
}

/** session/follow's address for a child; an external task has no mode of its own there. */
export function addressOf(parentSessionId: string, child: Subagent) {
  return { kind: 'subagent' as const, parentSessionId, childSessionId: child.id, mode: child.mode === 'external' ? 'unknown' as const : child.mode }
}

/** What a child's composer is, as Desktop elects it: a continuable child takes follow-ups; a one-shot child is a
 * finished record; any other is read-only until its own history says more. */
export function composerOf(mode: SubagentMode): 'compose' | 'one-shot' | 'read-only' {
  return mode === 'continuable' ? 'compose' : mode === 'one-shot' ? 'one-shot' : 'read-only'
}

/** An external task is a leaf of the catalog: it has no conversation to open. */
export const opens = (child: Subagent) => child.mode !== 'external'

/** subagents/prompt's request: the person's follow-up joins the child's inbox, through the parent's address. */
export function followUp(parentSessionId: string, childSessionId: string, requestId: string, content: unknown[]) {
  return { request: { requestId, parentSessionId, childSessionId, mode: 'continuable' as const, delivery: 'queue' as const, content } }
}
