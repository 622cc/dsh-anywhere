// The app's words: English, which any other language reads, and Russian, here; Simplified and Traditional Chinese, Spanish, French, Korean and Japanese in strings.<language>.ts. Where DSH Desktop has wording, the English is
// Desktop's (dsh-client-ui-chat and dsh-client-ui-permission-presets dictionaries) and the Russian follows it.
import { locale, signal } from 'nsh'
import type { Activity, ProcessLabel, Step, Todo } from './fold.ts'
import type { SubagentMode } from './subagents.ts'
import type { ScheduleUnit } from './schedules.ts'
import { ES } from './strings.es.ts'
import { FR } from './strings.fr.ts'
import { JA } from './strings.ja.ts'
import { KO } from './strings.ko.ts'
import { ZH_HANT } from './strings.zh-hant.ts'
import { ZH } from './strings.zh.ts'

const counts = (todos: Todo[]) => { const done = todos.filter((t) => t.status === 'completed').length, active = todos.filter((t) => t.status === 'in_progress').length; return { done, active, pending: todos.length - done - active } }
/** Russian plural: 1 / 2–4 / 5+ (and 11–14). */
const ruPlural = (n: number, one: string, few: string, many: string) => { const t = n % 10, h = n % 100; return t === 1 && h !== 11 ? one : t >= 2 && t <= 4 && (h < 12 || h > 14) ? few : many }

/** Russian units after «раз в», «через» and «на»: one, few, many. */
const RU_UNITS: Record<ScheduleUnit, [string, string, string]> = { day: ['день', 'дня', 'дней'], hour: ['час', 'часа', 'часов'], minute: ['минуту', 'минуты', 'минут'], second: ['секунду', 'секунды', 'секунд'] }
const ruUnit = (n: number, unit: ScheduleUnit) => `${n} ${ruPlural(n, ...RU_UNITS[unit])}`

const EN = {
  think: 'Think', chats: 'Chats', newChat: 'New chat', untitled: 'New chat', message: 'Message DSH', send: 'Send', sending: 'Sending…', sendingSlow: 'Still sending. Your computer has not answered yet', delivered: 'Delivered', deliveredIdle: 'Delivered. The agent has not started on it yet', queued: 'Queued', notSent: 'Not sent. Tap to try again',
  privacy: 'Privacy', tryIt: { entry: 'Try it with sample data', banner: 'Sample data on this phone. Nothing is sent anywhere.', leave: 'Link a computer', exit: 'Leave the sample', computer: 'Sample computer', model: 'Sample model', onPhone: 'Sample data on this phone', noAttach: 'Attaching files needs a linked computer.', workspace: 'sample-project', fixTitle: 'Fix the failing login test', fixAsk: 'The login test fails. Can you fix it?', fixAnswer: 'The test expected the old error message. I updated it, and all 24 tests pass.', deleteTitle: 'Delete the old build folder', deleteAsk: 'Delete the old build folder, please.', deleteReason: 'Delete the folder build/old', deleteAnswer: 'Done. The old build folder is gone.', deleteRejected: 'OK, I left the folder alone.', nameTitle: 'Pick a name for the release', nameAsk: 'Help me name the next release.', nameQuestion: 'Which name do you like?', nameOptions: ['Harbor', 'Lantern', 'Meadow'], nameAnswer: (name: string) => `Good choice. The release is now called ${name}.`, reply: 'This is a sample answer. In the real app, your message goes to the agent on your computer and its answer comes back here.', taskTitle: 'Check dependencies', taskPrompt: 'Look for outdated dependencies and list them.', readme: '# Sample project\n\nA small project for trying DSH Anywhere.\n' },
  linkTitle: 'Link your computer', linkHow: 'Open DSH on your Mac, show the DSH Anywhere pairing code, and scan it with this phone.',
  scan: 'Scan pairing code', paste: 'Paste the code instead', linkCode: 'Link', linking: 'Linking…', unlink: 'Unlink', latest: 'Jump to latest', model: 'Model', thinking: 'Thinking',
  allow: 'Allow', reject: 'Reject', allowTool: (tool: string) => `Allow ${tool}?`, sendAnswer: 'Send answer', otherAnswer: 'Other answer', yourAnswer: 'Your answer', waiting: 'Waiting for you',
  answerReady: 'Answer ready', turnFailed: 'Stopped with an error',
  /** A turn's end as Desktop's turn-error row words it (dsh-client-ui-chat `message.turnError`, `message.failure.*`). */
  turnError: 'This turn failed', taskStopped: 'Task stopped',
  failure: { auth: 'API key is invalid', quota: 'Request quota exhausted.', accountSignedOut: 'Stopped because you signed out of DeepSeek.',
    interrupted: 'The DSH process exited before this turn finished (for example, it was killed, crashed, or timed out while shutting down), so the turn was closed when DSH restarted. Unfinished tool calls have unknown outcomes.',
    accountSignInRequired: 'Sign in to DeepSeek and ensure the request destination supports account authentication.' }, needsDecision: 'Agent needs your decision', watchingTitle: (n: number) => n === 1 ? 'An agent is working' : `${n} agents are working`,
  watchingBody: 'You’ll hear when it’s done or asks you something',
  rename: 'Rename', pin: 'Pin', unpin: 'Unpin', archive: 'Archive', unarchive: 'Bring back', save: 'Save', search: 'Search chats', clear: 'Clear', more: 'More', noResults: 'No chats match',
  showArchived: (n: number) => `Archived (${n})`,
  photo: 'Photo', file: 'File', cancel: 'Cancel', remove: 'Remove', uploading: 'Uploading…', attach: 'Attach a photo or file',
  workspace: 'Workspace', addWorkspace: 'Add workspace', agent: 'Agent', startChat: 'Start chat', starting: 'Starting…', quickChat: 'Chat without a project', defaultWorkspace: 'Default workspace', quickChatWhere: 'Starts now in DSH’s Default workspace', folderPath: 'Folder on the computer', addThisFolder: 'Add this folder', back: 'Back',
  /** The folder picker (folderpicker.tsx); "Home" and "Show hidden files" are Desktop's (dsh-client-ui-directory-picker-browse). */
  recentProjects: 'Recent projects', homeFolder: 'Home', foldersIn: (name: string) => `Folders in ${name}`, folderSearch: 'Search, or type a path', addPath: (path: string) => `Add ${path}`,
  noFolders: 'No folders here', noFolderMatches: 'No folders match', showHidden: 'Show hidden files', hideHidden: 'Hide hidden files', upTo: (name: string) => `Up to ${name}`,
  folderMissing: 'This folder doesn’t exist', createIn: (name: string, parent: string) => `Create “${name}” in ${parent}?`, createFolder: 'Create folder', creatingFolder: 'Creating…', adding: 'Adding…',
  parentMissing: (parent: string) => `The folder ${parent} doesn’t exist either. Check the path.`, notAFolder: 'This is a file, not a folder.', foldersTruncated: 'Too many folders: only the first ones are shown.',
  connecting: 'Connecting…', offline: 'Can’t reach your computer. Retrying…', noNetwork: 'No network on this phone', slowConnect: 'Connecting to your computer…', working: 'Working', empty: 'No chats yet', retry: 'Try again',
  stop: 'Stop', open: 'Open', copy: 'Copy', queue: 'Queue message', copied: 'Copied', selectText: 'Select text', close: 'Close',
  controls: 'Controls', planMode: 'Plan mode', planHint: 'The agent writes a plan for you to approve before carrying it out', switching: 'Switching…',
  permissions: 'Permissions', goal: 'Goal', setGoal: 'Set a goal for this chat', goalPlaceholder: 'What should the agent work toward?', pause: 'Pause', resume: 'Resume',
  goalPhase: { active: 'Active', paused: 'Paused', blocked: 'Blocked', complete: 'Done' } as Record<string, string>,
  compact: 'Compact history', compactHint: 'Summarizes older messages to free up the model’s context', moreCommands: 'More commands', skills: 'Skills',
  unknownCommand: (line: string) => `DSH has no command ${line.split(/\s/)[0]}`,
  steer: 'Steer', steerHint: 'Send now, into the running turn', steering: 'Steering', editQueued: 'Edit queued message', removeQueued: 'Remove from queue', notSentShort: 'Not sent. Tap to retry',
  process: {
    analyzing: 'Analyzing the request', commands: 'Running commands', read: 'Reading files', edit: 'Editing files',
    search: 'Searching code', web: 'Visiting web pages', plan: 'Updating the plan', tools: 'Calling tools', done: 'Completed',
  } as Record<ProcessLabel, string>,
  /** A tool call the model is still writing, by what it will do (message.stepProcess.prepare.*). */
  prepare: {
    read: 'Preparing to read files', readImage: 'Preparing to read images', write: 'Preparing to write files', search: 'Preparing to search code', edit: 'Preparing to edit files',
    commands: 'Preparing to run commands', code: 'Preparing to run code', webSearch: 'Preparing to search the web', webFetch: 'Preparing to visit web pages',
    subagents: 'Preparing to coordinate subagents', plan: 'Preparing to update the plan', questions: 'Preparing questions', tools: 'Preparing tool calls',
  },
  /** A finished process's title, by what it did (message.stepProcess.done.*). */
  done: {
    thinking: 'Analysis completed', read: 'Read files', readImage: 'Read images', write: 'Wrote files', search: 'Searched code', edit: 'Edited files',
    commands: 'Ran commands', code: 'Ran code', webSearch: 'Searched the web', webFetch: 'Visited web pages', subagents: 'Coordinated subagents',
    plan: 'Updated the plan', questions: 'Asked questions', tools: 'Called tools',
  } as Record<Activity, string>,
  joinTwo: (first: string, second: string) => `${first} and ${second}`,
  /** The chats in no workspace, in the chat list. */
  otherChats: 'Other',
  /** Between different facts about one thing ("Image, 2 MB"); `listSep` is for things of one kind. */
  factSep: ', ',
  /** How Desktop titles a turn DSH itself started, by its source (turnTriggerDetails). */
  triggers: {
    goal: 'Continuing goal', 'agent-message': 'Task message received', 'team-message': 'Team message received', 'subagent-settled': 'Subtask status updated',
    webhook: 'External event received', 'webhook:github': 'GitHub event received', schedule: 'Automation task', 'tool-jobs': 'Background task updated',
    'cordis-host-runner': 'Plugin status updated', default: 'Execution requested',
  } as Record<string, string>,
  presets: { 'read-only': 'Read Only', 'workspace-write': 'Workspace Write', 'danger-full-access': 'Full access', auto: 'Auto review' } as Record<string, string>,
  autoDescription: 'Run without a sandbox after an experimental same-model review of every native tool call and PTC inner call.',
  confirmFull: { title: 'Enable Full access?', enable: 'Enable Full access',
    description: 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.' },
  confirmAuto: { title: 'Enable Auto review (experimental)?', enable: 'Enable Auto review',
    description: 'Auto review runs without a sandbox. Before every native tool call and PTC inner call, the same model as the current agent reviews whether to allow it; you approve or reject each call it denies. This feature is experimental, can falsely allow or deny actions, and uses additional tokens.' },
  errors: {
    timeout: 'The computer did not answer. Try again.', network: 'Can’t reach your computer. Check that it is on and DSH is running.',
    unauthorized: 'The computer no longer accepts this phone. Link it again.', http: (status: string) => `The computer answered with an error (${status}). Try again.`,
    unknown: 'Something went wrong. Try again.',
  },
  /** What the phone's shell refuses, by the code it rejects with (`area/what`, `:detail` after). */
  shell: {
    'link/expired': 'This pairing code has expired. Make a new one on the computer.', 'link/invalid': 'This is not a DSH pairing code.',
    'link/certificate': 'The computer’s certificate does not match its pairing code. Make a new code on the computer.',
    'link/not-linked': 'This phone is not linked to a computer yet.', 'link/refused': (d: string) => `The computer refused the pairing (${d}).`,
    'link/tunnel': () => 'Can’t open the connection to your computer. Try again.', 'link/save': 'The link could not be saved on this phone.',
    'upload/failed': (d: string) => `The upload failed (${d}). Try again.`, 'upload/refused': 'The computer refused the file.', 'upload/unreadable': 'The computer’s answer to the upload can’t be read.',
    'file/unreadable': 'This file can’t be read.', 'ui/root-key': 'The computer’s key for interfaces is not valid.', 'ui/storage': 'There is no room on this phone for the interface.',
    'ui/download': (d: string) => `The interface could not be loaded (${d}). Try again.`,
  } as Record<string, string | ((detail: string) => string)>,
  todos: 'To-dos', todoState: { completed: 'Completed', in_progress: 'In progress', pending: 'Pending' } as Record<Todo['status'], string>,
  /** Desktop's to-do header: each state with items, "·"-joined. */
  todoProgress: (todos: Todo[]) => { const c = counts(todos); return [c.done ? `${c.done} completed` : '', c.active ? `${c.active} in progress` : '', c.pending ? `${c.pending} pending` : ''].filter(Boolean).join(', ') },
  /** DSH refusals Desktop words itself (dsh-client-ui-workspace). */
  dsh: {
    'session/fork-unavailable': 'This session has no completed turn',
    'session/migration-required': 'Open the original session on the computer to complete migration before creating a branch.',
    // The folder picker's refusals (DSH's directoryPicker codes, and the companion's: host/src/folders.ts).
    'directory-picker/outside-home': 'The phone opens folders only in your home folder and your workspaces.',
    'directory-picker/not-found': 'This folder is no longer there.', 'directory-picker/not-directory': 'This is not a folder.',
    'directory-picker/unreadable': 'The computer does not allow reading this folder.', 'directory-picker/create-failed': 'The folder could not be created.',
    'directory-picker/exists': 'Something with this name is already there.', 'workspace/invalid-path': 'This folder can’t be added. Check the path.',
  } as Record<string, string>,
  fork: 'Fork session',
  jobs: (live: number, total: number) => live ? `${live} background job${live === 1 ? '' : 's'} running` : `${total} background job${total === 1 ? '' : 's'}`,
  jobsTitle: 'Background jobs', jobsRunning: 'Running', jobsFinished: (n: number) => `Finished ${n}`,
  jobStatus: { running: 'running', stopping: 'stopping', completed: 'completed', failed: 'failed', killed: 'stopped' } as Record<string, string>,
  jobLine: (status: string, took: string) => `${status}, ${took}`,
  jobStop: 'Stop', jobConfirmStop: 'Confirm stop', jobStopFailed: 'Stop failed', jobGap: '… earlier output dropped …', jobNoOutput: 'No output yet',
  subagents: (running: number, total: number) => running ? `${running} subagent${running === 1 ? '' : 's'} running` : `${total} subagent${total === 1 ? '' : 's'}`,
  subagentsTitle: 'Subagent sessions', subagentRunning: 'running',
  activity: 'Activity', activityActive: (n: number) => n ? `${n} active` : 'nothing active', activeCount: (n: number) => `${n} active`, noneActive: 'None active',
  completedCount: (n: number) => `${n} completed`, todosDone: (done: number, total: number) => `${done} of ${total} done`, finishedCount: (n: number) => `${n} finished`, pinActivity: 'Pin', unpinActivity: 'Unpin', oneLineWhileTyping: 'One line while typing',
  subagentMode: { continuable: 'continuable', 'one-shot': 'one-shot', external: 'External task', unknown: 'unknown mode' } as Record<SubagentMode, string>,
  readOnlyTitle: 'This subagent is read-only for now',
  oneShotTitle: 'One-shot subagent record', oneShotBody: 'Follow-up messages are unavailable.',
  jobSeconds: (s: number) => `${s}s`, jobMinutes: (m: number, s: number) => `${m}m ${s}s`, jobHours: (h: number, m: number) => `${h}h ${m}m`,
  ago: { now: 'now', minutes: (n: number) => `${n} min`, hours: (n: number) => `${n} h`, date: 'en-US' },
  /** Scheduled tasks, as Desktop's task manager words them (dsh-client-ui-schedule). */
  schedules: 'Automation tasks', schedulesLoading: 'Loading tasks…', schedulesError: 'Could not load tasks.', schedulesEmpty: 'No tasks yet. Tasks created in your sessions appear here.',
  scheduleActive: 'Enabled', scheduleInactive: 'Inactive', scheduleOnce: 'Once',
  scheduleEvery: (n: number, unit: ScheduleUnit) => `Every ${n} ${unit}${n === 1 ? '' : 's'}`,
  scheduleDaily: (time: string) => `Daily at ${time}`, scheduleWeekly: (days: string, time: string) => `Weekly on ${days} at ${time}`, scheduleCron: (expression: string) => `Cron ${expression}`,
  scheduleZone: (rule: string, zone: string) => `${rule} (${zone})`, weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], listSep: ', ',
  scheduleDue: 'Due now', scheduleIn: (n: number, unit: ScheduleUnit) => `in ${n} ${unit}${n === 1 ? '' : 's'}`, scheduleOverdue: (n: number, unit: ScheduleUnit) => `${n} ${unit}${n === 1 ? '' : 's'} overdue`,
  scheduleNext: (when: string) => `Next run: ${when}`, scheduleLast: (when: string) => `Last sent: ${when}`, scheduleNever: 'Not sent yet', scheduleSent: (when: string) => `Sent ${when}`,
  scheduleRecords: 'Records', scheduleRecordsLoading: 'Loading delivery records…', scheduleRecordsError: 'Could not load delivery records.', scheduleRecordsEmpty: 'No delivery record available',
  scheduleMore: 'Load more', schedulePruned: 'Earlier delivery records have been cleared', scheduleUnavailable: 'Earlier delivery records may be unavailable', scheduleGone: 'This task is no longer available.',
  scheduleDelete: 'Delete task', scheduleDeleteTitle: 'Delete this task?', scheduleDeleteConfirm: 'Confirm deletion', scheduleDeleting: 'Deleting…', scheduleDeleteFailed: 'Could not delete the task.',
  scheduleDeleteBody: 'This stops the task from triggering and deletes it together with its saved delivery records. The original session and its messages remain; queued messages are not withdrawn.',
  // The Trajectory and Details pages (Desktop's dsh-client-ui-trajectory and context meter words).
  trajectory: 'Trajectory', loadingTrajectory: 'Loading trajectory…', noToolCalls: 'No tool calls yet', turn: (n: number) => `Turn ${n}`, betweenTurns: 'Between turns',
  toolCalls: (n: number) => `${n} tool call${n === 1 ? '' : 's'}`, callStatus: { in_progress: 'Running', completed: 'Completed', failed: 'Failed' } as Record<Step['status'], string>,
  details: 'Details', loading: 'Loading…', on: 'On', off: 'Off', context: 'Context', contextUsed: (percent: number) => `${percent}% of context used`, contextNotReported: 'Not reported yet',
  contextSystem: 'System prompt', contextTools: 'Tool definitions', contextMessages: 'Messages',
  usage: 'Tokens', usageInput: 'Input', usageCached: 'Cached', usageCacheCreated: 'Cache created', usageOutput: 'Output', noGoal: 'No goal', noJobs: 'No background jobs',
  /** The workspace browser (files.tsx); a problem by files.ts's `Problem`. */
  files: 'Files', filesLoading: 'Loading…', emptyFolder: 'This folder is empty', filesTruncated: (n: number) => `Showing the first ${n} items`,
  folder: 'Folder', emptyFile: 'This file is empty', mentionInChat: 'Mention in chat', noPreview: 'No preview for this file', lineNumber: (n: number) => `Line ${n}`,
  fileProblem: {
    'not-found': 'This file or folder is no longer there.', denied: 'The computer does not allow reading this.', 'not-directory': 'This is not a folder.',
    'not-file': 'This is not a regular file.', 'not-text': 'This file is not text.', 'too-large': 'This file is too large to show on the phone.', outside: 'This leads outside the chat’s workspace.',
  } as Record<string, string>,
  // The terminal (DSH's user shell: terminal/*). The shell runs as the computer's user, outside the agent's sandbox.
  terminals: 'Terminals', terminal: 'Terminal', newTerminal: 'New terminal', terminalsLoading: 'Loading terminals…', terminalsError: 'Could not load terminals.',
  terminalsEmpty: 'No terminals in this chat yet.', terminalNote: 'Commands run on your computer as your user, without the agent\u2019s sandbox or approvals.',
  terminalState: { running: 'Running', exited: 'Exited', failed: 'Failed' } as Record<'running' | 'exited' | 'failed', string>,
  terminalConnecting: 'Connecting…', terminalReadOnly: 'Another window has the input.', takeControl: 'Take control',
  terminalExited: (code: number | null) => (code === null ? 'The shell has exited.' : `The shell exited with code ${code}.`),
  terminalLimit: 'This chat already has as many terminals as it can hold. Close one first.', terminalMissing: 'This terminal is no longer on the computer.',
  terminalFailed: 'The terminal could not start.', terminalInputFull: 'Too much input at once.',
  closeTerminal: 'Close terminal', closeTerminalTitle: 'Close terminal? Its shell will end.',
  keyCtrl: 'Ctrl', keyEsc: 'Esc', keyTab: 'Tab', keyUp: 'Up', keyDown: 'Down', keyLeft: 'Left', keyRight: 'Right',
  /** The phone's own settings (settings.tsx). Appearance, Light / Dark / System, Language are Desktop's words (dsh-client-ui-theme, dsh-client-locale). */
  settings: 'Settings', computer: 'Computer', computerName: 'Name', connection: 'Connection', connectionStatus: 'Status',
  reach: { title: 'Connection', connected: 'Connected', slow: 'Connection is slow', blocked: 'This network can’t reach the relay', computer: 'Your computer isn’t answering', companion: 'DSH on your computer isn’t answering', refused: 'This phone is no longer linked',
    retryIn: (s: string) => `Retrying in ${s} s`, retrying: 'Retrying now…', noRetry: 'Not retrying', relink: 'Link again', latency: (ms: string) => `About ${ms} ms`,
    partPhone: 'Phone’s network', partRelay: 'Relay', partComputer: 'Your computer', partPairing: 'Pairing', partOk: 'OK', partFailed: 'Not working', partUnknown: 'Not known',
    why: { connected: '', slow: 'The connection works, but answers are taking a while. Messages may arrive a few seconds late.', trying: 'Checking which part isn’t answering.', 'no-network': 'It reconnects by itself once the phone is on Wi-Fi or mobile data.', blocked: 'The phone has a network, but can’t reach the relay that connects it to your computer. The network may block it or have no internet. Try another Wi-Fi or mobile data.', computer: 'The relay works, but your computer doesn’t answer. Check that it is on, awake, and DSH is running. If this phone was removed on the computer, it needs linking again.', companion: 'Your computer answers, but DSH’s companion on it doesn’t. Open DSH on your computer again.', refused: 'The computer no longer accepts this phone. Make a new pairing code on the computer and link again.' } },
  connectionState: { online: 'Connected', connecting: 'Reconnecting', offline: 'Disconnected' } as Record<'online' | 'connecting' | 'offline', string>,
  viaTailcat: 'End-to-end encrypted tunnel', pathDirect: 'Direct to your computer', pathRelay: (region: string) => `Through a relay (${region})`, pathUnknown: 'Finding the route…',
  dshVersion: 'DSH version', companionVersion: 'Companion version', unlinkHint: 'This phone stops reaching the computer until you scan a new pairing code.',
  appearance: 'Appearance', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark', language: 'Language', languageSystem: 'System',
  notifications: 'Notifications', notifyAnswers: 'Answer ready or stopped', notifyDecisions: 'Agent needs your decision', notifyBanners: 'Banners while in the app',
  notifyBackground: 'Keep watching in the background', notifyBackgroundHint: 'While an agent works, an ongoing notification keeps the phone listening.',
  notifyDenied: 'Notifications for DSH are off in the phone’s settings.', notifyAllow: 'Turn on notifications', openSystemSettings: 'Open phone settings',
}
export type Strings = typeof EN

const RU: Strings = {
  think: 'Думать', chats: 'Чаты', newChat: 'Новый чат', untitled: 'Новый чат', message: 'Сообщение для DSH', send: 'Отправить', sending: 'Отправка…', sendingSlow: 'Всё ещё отправляется. Компьютер пока не ответил', delivered: 'Доставлено', deliveredIdle: 'Доставлено. Агент ещё не приступил', queued: 'В очереди', notSent: 'Не отправлено. Нажмите, чтобы повторить',
  privacy: 'Конфиденциальность', tryIt: { entry: 'Попробовать на примере', banner: 'Пример хранится на этом телефоне. Ничего никуда не отправляется.', leave: 'Подключить компьютер', exit: 'Выйти из примера', computer: 'Компьютер-пример', model: 'Модель-пример', onPhone: 'Пример на этом телефоне', noAttach: 'Чтобы прикреплять файлы, подключите компьютер.', workspace: 'пример-проекта', fixTitle: 'Исправить падающий тест входа', fixAsk: 'Тест входа падает. Можешь исправить?', fixAnswer: 'Тест ждал старое сообщение об ошибке. Я обновил его, и все 24 теста проходят.', deleteTitle: 'Удалить старую папку сборки', deleteAsk: 'Удали, пожалуйста, старую папку сборки.', deleteReason: 'Удалить папку build/old', deleteAnswer: 'Готово. Старой папки сборки больше нет.', deleteRejected: 'Хорошо, папку не трогаю.', nameTitle: 'Выбрать название релиза', nameAsk: 'Помоги назвать следующий релиз.', nameQuestion: 'Какое название нравится?', nameOptions: ['Гавань', 'Фонарь', 'Луг'], nameAnswer: (name: string) => `Хороший выбор. Теперь релиз называется ${name}.`, reply: 'Это пример ответа. В настоящем приложении сообщение уходит агенту на вашем компьютере, а его ответ приходит сюда.', taskTitle: 'Проверить зависимости', taskPrompt: 'Найди устаревшие зависимости и перечисли их.', readme: '# Пример проекта\n\nНебольшой проект, чтобы попробовать DSH Anywhere.\n' },
  linkTitle: 'Подключите компьютер', linkHow: 'Откройте DSH на Mac, покажите код подключения DSH Anywhere и отсканируйте его этим телефоном.',
  scan: 'Сканировать код', paste: 'Вставить код', linkCode: 'Подключить', linking: 'Подключение…', unlink: 'Отключить', latest: 'К последнему', model: 'Модель', thinking: 'Рассуждения',
  allow: 'Разрешить', reject: 'Отклонить', allowTool: (tool: string) => `Разрешить ${tool}?`, sendAnswer: 'Отправить ответ', otherAnswer: 'Другой ответ', yourAnswer: 'Ваш ответ', waiting: 'Ждёт вас',
  answerReady: 'Ответ готов', turnFailed: 'Остановился с ошибкой',
  turnError: 'Ход завершился ошибкой', taskStopped: 'Задача остановлена',
  failure: { auth: 'API-ключ недействителен', quota: 'Квота запросов исчерпана.', accountSignedOut: 'Остановлено, потому что вы вышли из аккаунта DeepSeek.',
    interrupted: 'Процесс DSH завершился до конца этого хода (например, его принудительно остановили, он упал или не успел закрыться), поэтому ход закрыт при перезапуске DSH. Результаты незавершённых вызовов инструментов неизвестны.',
    accountSignInRequired: 'Войдите в DeepSeek и убедитесь, что адрес запроса поддерживает вход через аккаунт.' }, needsDecision: 'Агент ждёт вашего решения', watchingTitle: (n: number) => n === 1 ? 'Агент работает' : `Работают агенты: ${n}`,
  watchingBody: 'Сообщим, когда будет готово или понадобится ваш ответ',
  rename: 'Переименовать', pin: 'Закрепить', unpin: 'Открепить', archive: 'В архив', unarchive: 'Вернуть', save: 'Сохранить', search: 'Поиск по чатам', clear: 'Очистить', more: 'Ещё', noResults: 'Чатов не найдено',
  showArchived: (n: number) => `Архив (${n})`,
  photo: 'Фото', file: 'Файл', cancel: 'Отмена', remove: 'Удалить', uploading: 'Загрузка…', attach: 'Прикрепить фото или файл',
  workspace: 'Рабочая папка', addWorkspace: 'Добавить папку', agent: 'Агент', startChat: 'Начать чат', starting: 'Запуск…', quickChat: 'Чат без проекта', defaultWorkspace: 'Рабочая папка по умолчанию', quickChatWhere: 'Сразу, в рабочей папке DSH по умолчанию', folderPath: 'Папка на компьютере', addThisFolder: 'Добавить эту папку', back: 'Назад',
  recentProjects: 'Недавние проекты', homeFolder: 'Домашняя папка', foldersIn: (name: string) => `Папки: ${name}`, folderSearch: 'Поиск или путь к папке', addPath: (path: string) => `Добавить ${path}`,
  noFolders: 'Здесь нет папок', noFolderMatches: 'Подходящих папок нет', showHidden: 'Показать скрытые', hideHidden: 'Без скрытых', upTo: (name: string) => `Вверх: ${name}`,
  folderMissing: 'Такой папки нет', createIn: (name: string, parent: string) => `Создать «${name}» в ${parent}?`, createFolder: 'Создать папку', creatingFolder: 'Создание…', adding: 'Добавление…',
  parentMissing: (parent: string) => `Папки ${parent} тоже нет. Проверьте путь.`, notAFolder: 'Это файл, а не папка.', foldersTruncated: 'Папок слишком много: показаны только первые.',
  connecting: 'Подключение…', offline: 'Компьютер недоступен. Повторяем…', noNetwork: 'Телефон не подключён к сети', slowConnect: 'Подключаемся к компьютеру…', working: 'Работает', empty: 'Чатов пока нет', retry: 'Повторить',
  stop: 'Остановить', open: 'Открыть', copy: 'Копировать', queue: 'В очередь', copied: 'Скопировано', selectText: 'Выделить текст', close: 'Закрыть',
  controls: 'Управление', planMode: 'Режим плана', planHint: 'Агент пишет план и выполняет его после вашего одобрения', switching: 'Переключение…',
  permissions: 'Разрешения', goal: 'Цель', setGoal: 'Задать цель для этого чата', goalPlaceholder: 'К чему должен прийти агент?', pause: 'Пауза', resume: 'Продолжить',
  goalPhase: { active: 'Активна', paused: 'На паузе', blocked: 'Заблокирована', complete: 'Достигнута' },
  compact: 'Сжать историю', compactHint: 'Кратко пересказывает старые сообщения, чтобы освободить контекст модели', moreCommands: 'Другие команды', skills: 'Навыки',
  unknownCommand: (line: string) => `В DSH нет команды ${line.split(/\s/)[0]}`,
  steer: 'Сейчас', steerHint: 'Отправить сразу, в текущий ход', steering: 'Отправляется в ход', editQueued: 'Изменить сообщение в очереди', removeQueued: 'Убрать из очереди', notSentShort: 'Не отправлено. Повторить',
  process: {
    analyzing: 'Анализ запроса', commands: 'Выполнение команд', read: 'Чтение файлов', edit: 'Изменение файлов',
    search: 'Поиск по коду', web: 'Просмотр веб-страниц', plan: 'Обновление плана', tools: 'Вызов инструментов', done: 'Готово',
  },
  prepare: {
    read: 'Подготовка к чтению файлов', readImage: 'Подготовка к просмотру изображений', write: 'Подготовка к записи файлов', search: 'Подготовка к поиску по коду', edit: 'Подготовка к изменению файлов',
    commands: 'Подготовка к выполнению команд', code: 'Подготовка к запуску кода', webSearch: 'Подготовка к поиску в интернете', webFetch: 'Подготовка к открытию веб-страниц',
    subagents: 'Подготовка к работе с субагентами', plan: 'Подготовка к обновлению плана', questions: 'Подготовка вопросов', tools: 'Подготовка к вызову инструментов',
  },
  done: {
    thinking: 'Анализ завершён', read: 'Прочитаны файлы', readImage: 'Просмотрены изображения', write: 'Записаны файлы', search: 'Выполнен поиск по коду', edit: 'Изменены файлы',
    commands: 'Выполнены команды', code: 'Выполнен код', webSearch: 'Выполнен поиск в интернете', webFetch: 'Открыты веб-страницы', subagents: 'Согласованы субагенты',
    plan: 'Обновлён план', questions: 'Заданы вопросы', tools: 'Вызваны инструменты',
  },
  joinTwo: (first: string, second: string) => `${first} и ${second}`,
  otherChats: 'Другие',
  factSep: ', ',
  triggers: {
    goal: 'Продолжение цели', 'agent-message': 'Получено сообщение задачи', 'team-message': 'Получено сообщение команды', 'subagent-settled': 'Статус подзадачи обновлён',
    webhook: 'Получено внешнее событие', 'webhook:github': 'Получено событие GitHub', schedule: 'Задача по расписанию', 'tool-jobs': 'Фоновая задача обновлена',
    'cordis-host-runner': 'Статус плагина обновлён', default: 'Запрошено выполнение',
  },
  presets: { 'read-only': 'Только чтение', 'workspace-write': 'Запись в рабочую папку', 'danger-full-access': 'Полный доступ', auto: 'Автопроверка' },
  autoDescription: 'Работа без песочницы: каждый вызов инструмента и вложенный вызов PTC сначала проверяет та же модель (экспериментально).',
  confirmFull: { title: 'Включить полный доступ?', enable: 'Включить полный доступ',
    description: 'Полный доступ сокращает число подтверждений и позволяет агенту делать больше напрямую, включая чувствительные операции, изменения файлов и внешние команды. Включайте его, только если доверяете текущей задаче.' },
  confirmAuto: { title: 'Включить автопроверку (экспериментально)?', enable: 'Включить автопроверку',
    description: 'Автопроверка работает без песочницы. Перед каждым вызовом инструмента и вложенным вызовом PTC та же модель, что и у агента, решает, разрешить ли его; вызовы, которые она отклонит, одобряете или отклоняете вы. Функция экспериментальная: она может ошибочно разрешать или запрещать действия и расходует дополнительные токены.' },
  errors: {
    timeout: 'Компьютер не ответил. Попробуйте ещё раз.', network: 'Компьютер недоступен. Проверьте, что он включён и DSH запущен.',
    unauthorized: 'Компьютер больше не принимает этот телефон. Подключите его заново.', http: (status: string) => `Компьютер ответил ошибкой (${status}). Попробуйте ещё раз.`,
    unknown: 'Что-то пошло не так. Попробуйте ещё раз.',
  },
  shell: {
    'link/expired': 'Срок действия кода истёк. Создайте новый на компьютере.', 'link/invalid': 'Это не код подключения DSH.',
    'link/certificate': 'Сертификат компьютера не совпадает с кодом подключения. Создайте новый код на компьютере.',
    'link/not-linked': 'Этот телефон ещё не подключён к компьютеру.', 'link/refused': (d: string) => `Компьютер отклонил подключение (${d}).`,
    'link/tunnel': () => 'Не удаётся открыть соединение с компьютером. Попробуйте ещё раз.', 'link/save': 'Не удалось сохранить подключение на этом телефоне.',
    'upload/failed': (d: string) => `Загрузка не удалась (${d}). Попробуйте ещё раз.`, 'upload/refused': 'Компьютер отклонил файл.', 'upload/unreadable': 'Ответ компьютера на загрузку не читается.',
    'file/unreadable': 'Этот файл не читается.', 'ui/root-key': 'Ключ компьютера для интерфейсов недействителен.', 'ui/storage': 'На телефоне нет места для интерфейса.',
    'ui/download': (d: string) => `Не удалось загрузить интерфейс (${d}). Попробуйте ещё раз.`,
  },
  todos: 'Задачи', todoState: { completed: 'Выполнена', in_progress: 'В работе', pending: 'Ожидает' },
  todoProgress: (todos: Todo[]) => { const c = counts(todos); return [c.done ? `${c.done} ${ruPlural(c.done, 'выполнена', 'выполнены', 'выполнено')}` : '', c.active ? `${c.active} в работе` : '', c.pending ? `${c.pending} ${ruPlural(c.pending, 'ожидает', 'ожидают', 'ожидают')}` : ''].filter(Boolean).join(', ') },
  dsh: {
    'session/fork-unavailable': 'В этом чате ещё нет завершённого хода',
    'session/migration-required': 'Откройте исходный чат на компьютере, чтобы завершить миграцию, и только потом создавайте ответвление.',
    'directory-picker/outside-home': 'Телефон открывает папки только в домашней папке и в рабочих папках.',
    'directory-picker/not-found': 'Этой папки уже нет.', 'directory-picker/not-directory': 'Это не папка.',
    'directory-picker/unreadable': 'Компьютер не разрешает читать эту папку.', 'directory-picker/create-failed': 'Не удалось создать папку.',
    'directory-picker/exists': 'Здесь уже есть что-то с таким именем.', 'workspace/invalid-path': 'Эту папку нельзя добавить. Проверьте путь.',
  },
  fork: 'Ответвить чат',
  jobs: (live: number, total: number) => live ? `${live} ${ruPlural(live, 'фоновая задача выполняется', 'фоновые задачи выполняются', 'фоновых задач выполняются')}` : `${total} ${ruPlural(total, 'фоновая задача', 'фоновые задачи', 'фоновых задач')}`,
  jobsTitle: 'Фоновые задачи', jobsRunning: 'Выполняются', jobsFinished: (n: number) => `Завершены: ${n}`,
  jobStatus: { running: 'выполняется', stopping: 'останавливается', completed: 'завершена', failed: 'с ошибкой', killed: 'остановлена' },
  jobLine: (status: string, took: string) => `${status}, ${took}`,
  jobStop: 'Остановить', jobConfirmStop: 'Подтвердить остановку', jobStopFailed: 'Не удалось остановить', jobGap: '… начало вывода пропущено …', jobNoOutput: 'Вывода пока нет',
  subagents: (running: number, total: number) => running ? `${running} ${ruPlural(running, 'субагент работает', 'субагента работают', 'субагентов работают')}` : `${total} ${ruPlural(total, 'субагент', 'субагента', 'субагентов')}`,
  subagentsTitle: 'Сессии субагентов', subagentRunning: 'работает',
  activity: 'Активность', activityActive: (n: number) => n ? `активно: ${n}` : 'ничего не выполняется', activeCount: (n: number) => `активно: ${n}`, noneActive: 'Нет активных',
  completedCount: (n: number) => `Выполнено: ${n}`, todosDone: (done: number, total: number) => `Готово ${done} из ${total}`, finishedCount: (n: number) => `Завершено: ${n}`, pinActivity: 'Закрепить', unpinActivity: 'Открепить', oneLineWhileTyping: 'Одной строкой при наборе',
  subagentMode: { continuable: 'можно продолжить', 'one-shot': 'разовый', external: 'Внешняя задача', unknown: 'режим неизвестен' },
  readOnlyTitle: 'Этот субагент пока доступен только для чтения',
  oneShotTitle: 'Запись разового субагента', oneShotBody: 'Дополнительные сообщения недоступны.',
  jobSeconds: (s: number) => `${s} с`, jobMinutes: (m: number, s: number) => `${m} мин ${s} с`, jobHours: (h: number, m: number) => `${h} ч ${m} мин`,
  ago: { now: 'сейчас', minutes: (n: number) => `${n} мин`, hours: (n: number) => `${n} ч`, date: 'ru-RU' },
  schedules: 'Задачи по расписанию', schedulesLoading: 'Загрузка задач…', schedulesError: 'Не удалось загрузить задачи.', schedulesEmpty: 'Задач пока нет. Здесь появятся задачи, созданные в ваших чатах.',
  scheduleActive: 'Включена', scheduleInactive: 'Неактивна', scheduleOnce: 'Один раз',
  scheduleEvery: (n: number, unit: ScheduleUnit) => (n === 1 ? `Раз в ${RU_UNITS[unit][0]}` : `Раз в ${ruUnit(n, unit)}`),
  scheduleDaily: (time: string) => `Каждый день в ${time}`, scheduleWeekly: (days: string, time: string) => `По ${days} в ${time}`, scheduleCron: (expression: string) => `Cron ${expression}`,
  scheduleZone: (rule: string, zone: string) => `${rule} (${zone})`, weekdays: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'], listSep: ', ',
  scheduleDue: 'Запуск сейчас', scheduleIn: (n: number, unit: ScheduleUnit) => `через ${ruUnit(n, unit)}`, scheduleOverdue: (n: number, unit: ScheduleUnit) => `просрочена на ${ruUnit(n, unit)}`,
  scheduleNext: (when: string) => `Следующий запуск: ${when}`, scheduleLast: (when: string) => `Последняя отправка: ${when}`, scheduleNever: 'Ещё не отправлялась', scheduleSent: (when: string) => `Отправлено ${when}`,
  scheduleRecords: 'Записи', scheduleRecordsLoading: 'Загрузка записей об отправке…', scheduleRecordsError: 'Не удалось загрузить записи об отправке.', scheduleRecordsEmpty: 'Записей об отправке нет',
  scheduleMore: 'Показать ещё', schedulePruned: 'Более ранние записи об отправке удалены', scheduleUnavailable: 'Более ранних записей об отправке может не быть', scheduleGone: 'Этой задачи больше нет.',
  scheduleDelete: 'Удалить задачу', scheduleDeleteTitle: 'Удалить эту задачу?', scheduleDeleteConfirm: 'Подтвердить удаление', scheduleDeleting: 'Удаление…', scheduleDeleteFailed: 'Не удалось удалить задачу.',
  scheduleDeleteBody: 'Задача больше не будет запускаться и удалится вместе с сохранёнными записями об отправке. Исходный чат и его сообщения останутся; сообщения в очереди не отзываются.',
  trajectory: 'Траектория', loadingTrajectory: 'Загрузка траектории…', noToolCalls: 'Вызовов инструментов пока нет', turn: (n: number) => `Ход ${n}`, betweenTurns: 'Между ходами',
  toolCalls: (n: number) => `${n} ${ruPlural(n, 'вызов инструмента', 'вызова инструментов', 'вызовов инструментов')}`, callStatus: { in_progress: 'Выполняется', completed: 'Завершён', failed: 'С ошибкой' },
  details: 'Сведения', loading: 'Загрузка…', on: 'Вкл.', off: 'Выкл.', context: 'Контекст', contextUsed: (percent: number) => `Контекст занят на ${percent}%`, contextNotReported: 'Пока нет данных',
  contextSystem: 'Системный промпт', contextTools: 'Описания инструментов', contextMessages: 'Сообщения',
  usage: 'Токены', usageInput: 'Вход', usageCached: 'Из кэша', usageCacheCreated: 'Записано в кэш', usageOutput: 'Выход', noGoal: 'Цели нет', noJobs: 'Фоновых задач нет',
  files: 'Файлы', filesLoading: 'Загрузка…', emptyFolder: 'Папка пуста', filesTruncated: (n: number) => `Показаны первые ${n} ${ruPlural(n, 'элемент', 'элемента', 'элементов')}`,
  folder: 'Папка', emptyFile: 'Файл пуст', mentionInChat: 'Упомянуть в чате', noPreview: 'Для этого файла нет предпросмотра', lineNumber: (n: number) => `Строка ${n}`,
  fileProblem: {
    'not-found': 'Этого файла или папки больше нет.', denied: 'Компьютер не разрешает это читать.', 'not-directory': 'Это не папка.',
    'not-file': 'Это не обычный файл.', 'not-text': 'Это не текстовый файл.', 'too-large': 'Файл слишком большой, чтобы показать его на телефоне.', outside: 'Это ведёт за пределы рабочей папки чата.',
  },
  terminals: 'Терминалы', terminal: 'Терминал', newTerminal: 'Новый терминал', terminalsLoading: 'Загрузка терминалов…', terminalsError: 'Не удалось загрузить терминалы.',
  terminalsEmpty: 'В этом чате пока нет терминалов.', terminalNote: 'Команды выполняются на компьютере от имени вашего пользователя, без песочницы и подтверждений агента.',
  terminalState: { running: 'Работает', exited: 'Завершён', failed: 'Ошибка' },
  terminalConnecting: 'Подключение…', terminalReadOnly: 'Ввод сейчас у другого окна.', takeControl: 'Взять управление',
  terminalExited: (code: number | null) => (code === null ? 'Оболочка завершилась.' : `Оболочка завершилась с кодом ${code}.`),
  terminalLimit: 'В этом чате уже максимум терминалов. Сначала закройте один.', terminalMissing: 'Этого терминала больше нет на компьютере.',
  terminalFailed: 'Не удалось запустить терминал.', terminalInputFull: 'Слишком много ввода за раз.',
  closeTerminal: 'Закрыть терминал', closeTerminalTitle: 'Закрыть терминал? Оболочка завершится.',
  keyCtrl: 'Ctrl', keyEsc: 'Esc', keyTab: 'Tab', keyUp: 'Вверх', keyDown: 'Вниз', keyLeft: 'Влево', keyRight: 'Вправо',
  settings: 'Настройки', computer: 'Компьютер', computerName: 'Имя', connection: 'Подключение', connectionStatus: 'Состояние',
  reach: { title: 'Подключение', connected: 'Подключено', slow: 'Медленное соединение', blocked: 'Эта сеть не пропускает к ретранслятору', computer: 'Компьютер не отвечает', companion: 'DSH на компьютере не отвечает', refused: 'Этот телефон больше не привязан',
    retryIn: (s: string) => `Повтор через ${s} с`, retrying: 'Повторяем…', noRetry: 'Повторов не будет', relink: 'Привязать заново', latency: (ms: string) => `Около ${ms} мс`,
    partPhone: 'Сеть телефона', partRelay: 'Ретранслятор', partComputer: 'Компьютер', partPairing: 'Привязка', partOk: 'Работает', partFailed: 'Не работает', partUnknown: 'Неизвестно',
    why: { connected: '', slow: 'Соединение работает, но ответы идут долго. Сообщения могут приходить с задержкой в несколько секунд.', trying: 'Проверяем, какая часть не отвечает.', 'no-network': 'Подключится само, когда у телефона появится Wi-Fi или мобильная сеть.', blocked: 'У телефона есть сеть, но он не может достучаться до ретранслятора, через который связывается с компьютером. Сеть может его блокировать или не иметь выхода в интернет. Попробуйте другой Wi-Fi или мобильную сеть.', computer: 'Ретранслятор работает, но компьютер не отвечает. Проверьте, что он включён, не спит и DSH запущен. Если этот телефон удалили на компьютере, его нужно привязать заново.', companion: 'Компьютер отвечает, но компаньон DSH на нём — нет. Откройте DSH на компьютере заново.', refused: 'Компьютер больше не принимает этот телефон. Создайте новый код на компьютере и привяжите заново.' } },
  connectionState: { online: 'Подключено', connecting: 'Переподключение', offline: 'Нет связи' },
  viaTailcat: 'Зашифрованный туннель', pathDirect: 'Напрямую к компьютеру', pathRelay: (region: string) => `Через ретранслятор (${region})`, pathUnknown: 'Поиск маршрута…',
  dshVersion: 'Версия DSH', companionVersion: 'Версия компаньона', unlinkHint: 'Телефон перестанет подключаться к компьютеру, пока вы не отсканируете новый код.',
  appearance: 'Оформление', themeSystem: 'Как в системе', themeLight: 'Светлое', themeDark: 'Тёмное', language: 'Язык', languageSystem: 'Как в системе',
  notifications: 'Уведомления', notifyAnswers: 'Ответ готов или остановлен', notifyDecisions: 'Агенту нужно ваше решение', notifyBanners: 'Баннеры в приложении',
  notifyBackground: 'Следить в фоне', notifyBackgroundHint: 'Пока агент работает, постоянное уведомление не даёт телефону перестать слушать.',
  notifyDenied: 'Уведомления DSH выключены в настройках телефона.', notifyAllow: 'Включить уведомления', openSystemSettings: 'Открыть настройки телефона',
}

/** The strings for a BCP 47 tag; Russian for a language the app does not have. Taiwan, Hong Kong and Macau write Traditional Chinese, whichever way the tag says it. */
export const stringsFor = (tag: string): Strings => {
  const [lang] = tag.toLowerCase().split('-')
  if (lang === 'zh') return /-(hant|tw|hk|mo)(-|$)/i.test(tag) ? ZH_HANT : ZH
  return lang === 'ru' ? RU : lang === 'es' ? ES : lang === 'fr' ? FR : lang === 'ko' ? KO : lang === 'ja' ? JA : EN
}

/** The language picked in Settings (prefs.ts keeps it); `system` follows the phone's. */
export type Language = 'system' | 'zh' | 'zh-Hant' | 'en' | 'es' | 'fr' | 'ko' | 'ja' | 'ru'
export const language = signal<Language>('system')

/** The strings for the language now; read in a binding, they follow a change of language. */
export const S: Strings = new Proxy({} as Strings, { get: (_, key) => { const l = language(); return stringsFor(l === 'system' ? locale() : l === 'zh' ? 'zh-Hans' : l)[key as keyof Strings] } })
export const PROCESS: Record<ProcessLabel, string> = new Proxy({} as Record<ProcessLabel, string>, { get: (_, key) => S.process[key as ProcessLabel] })
/** The English preset names, which are also the names DSH sends. */
export const ENGLISH_PRESETS = EN.presets

/** What went wrong, for the person: the phone's own failures in its words; DSH's refusals as DSH words them. */
export function readable(e: unknown, strings: Strings = S): string {
  const code = (e as { code?: unknown })?.code, message = (e as { message?: unknown })?.message
  if (code === 'timeout' || code === 'network' || code === 'unauthorized') return strings.errors[code]
  if (typeof code === 'string' && code.startsWith('http/')) return strings.errors.http(code.slice(5))
  if (typeof code === 'string' && strings.dsh[code]) return strings.dsh[code]!
  const shell = typeof message === 'string' ? /^((?:link|upload|file|ui)\/[a-z-]+)(?::(.*))?$/s.exec(message) : null
  if (shell) { const words = strings.shell[shell[1]!]; return typeof words === 'function' ? words(shell[2] ?? '') : words ?? strings.errors.unknown }
  return typeof message === 'string' && message ? message : strings.errors.unknown
}

/** "now", "5 min", "3 h", "Oct 27" */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000), t = S.ago
  if (s < 60) return t.now
  if (s < 3600) return t.minutes(Math.floor(s / 60))
  if (s < 86400) return t.hours(Math.floor(s / 3600))
  return new Date(at).toLocaleDateString(t.date, { month: 'short', day: 'numeric' })
}
