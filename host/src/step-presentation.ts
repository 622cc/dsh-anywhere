// Tool steps and thinking for the phone. Vocabulary follows the Agent Client Protocol (kind/status of a
// tool_call), as DSH's own ACP bridge (dsh-acp, inspected in DSH 0.2.1-rc.3) derives it from tool/call,
// tool/result and assistant reasoning blocks. Titles come only from the argument fields named below:
// raw arguments and tool output never leave the desktop through this projection.

export type StepKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';
export type StepStatus = 'in_progress' | 'completed' | 'failed';
export interface StepInfo { callId: string; tool: string; kind: StepKind; status: StepStatus }

export const STEP_KINDS: ReadonlySet<string> = new Set(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other']);
export const STEP_STATUSES: ReadonlySet<string> = new Set(['in_progress', 'completed', 'failed']);
export const TOOL_NAME = /^[A-Za-z0-9_.:/-]{1,128}$/;
const TITLE_LIMIT = 160;
export const THOUGHT_LIMIT = 4000;

/** Thinking and tool steps are activity, not conversation: they never count toward the history window. */
export function isActivity(message: { kind?: string }): boolean {
  return message.kind === 'step' || message.kind === 'thought';
}

/**
 * Keep the newest `max` conversation messages and every activity item after the first kept one, so a
 * task with many steps cannot push the question and answer out of the window.
 */
/** Total items the phone accepts in one snapshot (conversation plus activity). */
export const MAX_WINDOW_ITEMS = 1000;
export function windowMessages<T extends { kind?: string }>(messages: T[], max: number): { messages: T[]; cut: boolean } {
  let seen = 0, start = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (isActivity(messages[index]!)) continue;
    if (++seen === max) { start = messages.slice(0, index).some(message => !isActivity(message)) ? index : 0; break; }
  }
  start = Math.max(start, messages.length - MAX_WINDOW_ITEMS);
  return { messages: start > 0 ? messages.slice(start) : messages, cut: start > 0 };
}

function oneLine(value: string): string {
  const line = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...line].length > TITLE_LIMIT ? [...line].slice(0, TITLE_LIMIT - 1).join('') + '…' : line;
}
function shortPath(value: string): string {
  const parts = value.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/') || value;
}
function host(value: string): string {
  try { return new URL(value).host || value; } catch { return value; }
}
function text(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Title and ACP kind for one tool call. Unknown tools show their name only. */
export function stepTitle(tool: string, rawArguments: unknown): { title: string; kind: StepKind } {
  let args: Record<string, unknown> = {};
  if (typeof rawArguments === 'string') {
    try { const parsed: unknown = JSON.parse(rawArguments); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>; } catch { /* malformed model output: name only */ }
  }
  const path = text(args, 'file_path') ?? text(args, 'path');
  switch (tool) {
    case 'bash': case 'pwsh': case 'bash_persistent': case 'pwsh_persistent': {
      // DSH's shell tools carry a model-written description; it is what the desktop shows. The command
      // line is only a fallback because it can contain credentials.
      const description = text(args, 'description');
      return { title: oneLine(description ?? (text(args, 'command')?.split('\n')[0] ?? tool)), kind: 'execute' };
    }
    case 'read': return { title: oneLine(path ? `Read ${shortPath(path)}` : 'Read file'), kind: 'read' };
    case 'edit': case 'str_replace_editor': return { title: oneLine(path ? `Edit ${shortPath(path)}` : 'Edit file'), kind: 'edit' };
    case 'write': return { title: oneLine(path ? `Write ${shortPath(path)}` : 'Write file'), kind: 'edit' };
    case 'glob': case 'grep': {
      const pattern = text(args, 'pattern');
      return { title: oneLine(pattern ? `Search ${pattern}` : 'Search'), kind: 'search' };
    }
    case 'web_fetch': { const url = text(args, 'url'); return { title: oneLine(url ? `Fetch ${host(url)}` : 'Fetch'), kind: 'fetch' }; }
    case 'web_search': return { title: 'Web search', kind: 'fetch' };
    case 'todo_write': return { title: 'Update plan', kind: 'think' };
    case 'show_interface': { const title = text(args, 'title'); return { title: oneLine(title ?? 'Interface'), kind: 'other' }; }
    case 'skill': { const name = text(args, 'name'); return { title: oneLine(name ? `Use skill ${name}` : 'Use skill'), kind: 'other' }; }
    default: return { title: oneLine(tool), kind: 'other' };
  }
}

/** Thinking text from committed assistant content; bounded, never from live stream deltas. */
export function reasoningText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const joined = content.map((part: unknown) => {
    const block = part && typeof part === 'object' ? part as Record<string, unknown> : undefined;
    return block?.type === 'reasoning' && typeof block.text === 'string' ? block.text : '';
  }).filter(Boolean).join('\n\n').trim();
  return [...joined].length > THOUGHT_LIMIT ? [...joined].slice(0, THOUGHT_LIMIT - 1).join('') + '…' : joined;
}
