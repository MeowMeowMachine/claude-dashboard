// input: waiting on the person; busy: mid-turn; idle: turn done, still open; closed: ended in the last 3h
// details are absent in state written before they existed: model, prompt and tool-call counts, subagent count,
// minutes from first to last message, and the task list as [done, total]
export type Session = {
  name: string
  status: 'input' | 'busy' | 'idle' | 'closed'
  doing: string
  cwd: string
  updatedAt: number
  entry: string
  // live sessions only: the session id, for closing it
  id?: string
  // desktop sessions only: the app's local_ id, for the claude:// link that opens it
  host?: string
  model?: string
  turns?: number
  tools?: number
  agents?: number
  mins?: number
  plan?: [number, number]
  // what the session last reported through scripts/progress.mjs
  reported?: { pct: number; note: string; at: number }
  // the last artifact the session published; design: made from an Artifact type (a Claude Design)
  art?: { title: string; url: string; design: boolean }
  // tokens today, subagents that wrote in the last 90 s, subagent pool as [["sonnet high", 2]], eco-mode subagents
  tokens?: number
  live?: number
  pool?: [string, number][]
  eco?: boolean
  // context size of the main thread's last request and the largest seen (tokens)
  ctx?: number
  ctxMax?: number
  // the session's block in the estimate log (claude-log/<TIER>.md); a section is done once its act time is filled
  log?: { tier: string; title: string; done: boolean; estK?: number; estMin?: number; sections: { k: string; what: string; done: boolean }[] }
}
export type Today = { id: string; title: string; branch: string; tokens: number }
// [input, output, cache write, cache read]
export type Split = [number, number, number, number]
export type Usage = {
  now: number
  hours: Record<string, number>
  sessions: Session[]
  today: Today[]
  split?: { today: Split; days14: Split }
  models?: { today: Record<string, number>; days14: Record<string, number> }
  // rate-limit windows (five_hour, seven_day) as of `at`; absent off a subscription
  limits?: { at: number; windows: { kind: string; percentUsed: number; resetsAt?: string }[] }
}

declare module 'claude-code' {
  interface PluginState {
    'usage-dashboard': { usage: Usage; error: string }
  }
}
