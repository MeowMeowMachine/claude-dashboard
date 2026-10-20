// Prints JSON for the dashboard: hourly token buckets (last 14 days) and live sessions.
// Per-file results are cached by size+mtime so only changed transcripts are re-read.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const home = path.join(os.homedir(), '.claude')
const cacheFile = path.join(home, 'mods', 'usage-dashboard', 'cache.json')
const since = Date.now() - 14 * 864e5

let cache = {}
try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) } catch {}

function walk(dir, out) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walk(p, out)
    else if (d.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

// task-list step statuses after one tool call: update_plan items/advance/done/start, wrap_up checks all off
function step(plan, b) {
  const i = b.input || {}
  if (b.name.endsWith('wrap_up')) return plan && plan.map(() => 'completed')
  if (!b.name.endsWith('update_plan')) return plan
  if (i.items) return i.items.map(x => x.status)
  if (!plan) return plan
  plan = [...plan]
  if (i.advance) {
    const cur = plan.indexOf('in_progress')
    if (cur >= 0) plan[cur] = 'completed'
    const n = plan.indexOf('pending')
    if (n >= 0) plan[n] = 'in_progress'
  }
  for (const d of i.done || []) plan[d - 1] = 'completed'
  if (i.start) plan[i.start - 1] = 'in_progress'
  return plan
}

// hour bucket (epoch hour) -> tokens; tokens = input + output + cache writes (cache reads excluded)
// split: hour -> [input, output, cache write, cache read]; models: hour -> model -> tokens
// plus the session's last custom title, git branch, model, prompt/tool counts, time span, task list
// and the last artifact it published: { title, url, design } (design: made from an Artifact type, a Claude Design)
function scan(file) {
  const hours = {}, split = {}, models = {}, seen = new Set()
  let title = '', branch = '', model = '', turns = 0, tools = 0, first = 0, last = 0, plan = null, art = null
  // lastPrompt: when the person last wrote (a progress report older than that belongs to an earlier task)
  // pool: [model, effort] per Agent call; eco: a subagent prompt opened with "Eco mode"; flows: Workflow runs
  // ctx: context size of the last request (input + cache write + cache read); ctxMax: largest seen, to pick the window
  let lastPrompt = 0, pool = [], eco = false, flows = 0, ctx = 0, ctxMax = 0
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const isTitle = line.includes('"custom-title"')
    const isPrompt = line.includes('"type":"user"') && !line.includes('"tool_use_id"')
    // a publish's result names the new artifact's url
    if (art && !art.url && line.includes('"tool_use_id"')) art.url = line.match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/)?.[0] || ''
    if (!isTitle && !isPrompt && !line.includes('"usage"')) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (r.type === 'custom-title') { title = r.customTitle || title; continue }
    const ts = Date.parse(r.timestamp)
    if (ts) { first ||= ts; last = ts }
    if (r.type === 'user') { if (!r.isMeta) { turns++; if (ts) lastPrompt = ts } continue }
    if (r.gitBranch) branch = r.gitBranch
    // streamed messages repeat their id across lines, one content block each: count blocks before deduping
    for (const b of Array.isArray(r.message?.content) ? r.message.content : []) if (b.type === 'tool_use') {
      tools++
      plan = step(plan, b)
      const i = b.input || {}
      if (b.name === 'Agent') { pool.push([i.model || '', i.effort || '']); if (/^\s*Eco mode/i.test(i.prompt || '')) eco = true }
      if (b.name === 'Workflow') flows++
      if (b.name === 'Artifact' && (!i.action || i.action === 'publish') && !i.asset)
        art = { title: i.title || art?.title || '', url: i.url || '', design: !!i.type_url || !!art?.design }
    }
    const u = r.message?.usage, id = r.message?.id
    if (!u || !ts || seen.has(id)) continue
    seen.add(id)
    if (r.message.model && r.message.model !== '<synthetic>') model = r.message.model
    const h = Math.floor(ts / 36e5)
    const p = [u.input_tokens || 0, u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0]
    ctx = p[0] + p[2] + p[3]
    ctxMax = Math.max(ctxMax, ctx)
    hours[h] = (hours[h] || 0) + p[0] + p[1] + p[2]
    const s = (split[h] ??= [0, 0, 0, 0])
    p.forEach((v, k) => (s[k] += v))
    if (model) { const m = (models[h] ??= {}); m[model] = (m[model] || 0) + p[0] + p[1] + p[2] }
  }
  return { v: 5, hours, split, models, title, branch, model, turns, tools, first, last, plan, art, lastPrompt, pool, eco, flows, ctx, ctxMax }
}

const projects = path.join(home, 'projects')
const todayHour = new Date().setHours(0, 0, 0, 0) / 36e5
const sinceHour = Math.floor(since / 36e5)
const next = {}, total = {}, bySession = {}, mainFile = {}
// token split [input, output, cache write, cache read] and tokens per model, today and over 14 days
const split = { today: [0, 0, 0, 0], days14: [0, 0, 0, 0] }, models = { today: {}, days14: {} }
for (const f of walk(projects, [])) {
  const st = fs.statSync(f)
  if (st.mtimeMs < since) continue
  const key = st.size + ':' + st.mtimeMs
  next[f] = cache[f]?.key === key && cache[f].v === 5 ? cache[f] : { key, ...scan(f) }
  const n = next[f]
  // <project>/<session>.jsonl or <project>/<session>/subagents/*.jsonl: subagents count toward their session
  const id = path.relative(projects, f).split(path.sep)[1].replace(/\.jsonl$/, '')
  const s = (bySession[id] ??= { id, title: '', branch: '', tokens: 0, tools: 0, agents: 0, live: 0, first: 0, last: 0 })
  if (!f.includes(path.sep + 'subagents' + path.sep)) {
    Object.assign(s, { title: n.title, branch: n.branch, model: n.model, turns: n.turns, plan: n.plan, art: n.art, lastPrompt: n.lastPrompt, pool: n.pool, eco: n.eco, flows: n.flows, ctx: n.ctx, ctxMax: n.ctxMax })
    mainFile[id] = { file: f, mtime: st.mtimeMs }
  } else {
    s.agents++
    if (st.mtimeMs > Date.now() - 9e4) s.live++ // wrote in the last 90 s: still running
  }
  s.tools += n.tools
  if (n.first && (!s.first || n.first < s.first)) s.first = n.first
  s.last = Math.max(s.last, n.last)
  for (const [h, t] of Object.entries(n.hours)) {
    total[h] = (total[h] || 0) + t
    if (Number(h) >= todayHour) s.tokens += t
  }
  for (const [k, scope] of [['today', todayHour], ['days14', sinceHour]]) {
    for (const [h, p] of Object.entries(n.split)) if (Number(h) >= scope) p.forEach((v, i) => (split[k][i] += v))
    for (const [h, m] of Object.entries(n.models)) if (Number(h) >= scope) for (const [name, t] of Object.entries(m)) models[k][name] = (models[k][name] || 0) + t
  }
}
const today = Object.values(bySession).filter(s => s.tokens > 0).sort((a, b) => b.tokens - a.tokens).map(({ id, title, branch, tokens }) => ({ id, title, branch, tokens }))
// per-session details for the session list; plan is [done, total] of its task list, absent without one
// plus the progress the session last reported itself through scripts/progress.mjs
// a report older than the session's last prompt belongs to an earlier task and is dropped
// plus its subagent pool as [["sonnet high", 2], ...], live subagents, eco mode and its estimate-log block
function details(id) {
  let reported
  try { reported = JSON.parse(fs.readFileSync(path.join(home, 'mods', 'usage-dashboard', 'progress', id + '.json'), 'utf8')) } catch {}
  const s = bySession[id]
  if (!s) return { id, reported, log: logs[id.slice(0, 8)] }
  if (reported && s.lastPrompt && reported.at < s.lastPrompt) reported = undefined
  const plan = s.plan?.length ? [s.plan.filter(x => x === 'completed').length, s.plan.length] : undefined
  const pool = {}
  for (const [m, e] of s.pool || []) { const k = [m || 'inherit', e].filter(Boolean).join(' '); pool[k] = (pool[k] || 0) + 1 }
  if (s.flows) pool.workflow = s.flows
  return { id, model: s.model || '', turns: s.turns || 0, tools: s.tools, agents: s.agents, live: s.live, tokens: s.tokens, mins: s.first ? Math.round((s.last - s.first) / 6e4) : 0, plan, reported, art: s.art?.url ? s.art : undefined, pool: Object.entries(pool), eco: s.eco, ctx: s.ctx, ctxMax: s.ctxMax, log: logs[id.slice(0, 8)] }
}

// the optional estimate log (see README): one block per task, keyed by the first 8 chars of the session id
// folder from CLAUDE_DASHBOARD_LOG_DIR, else ~/Documents/ace-of-ashes/claude-log; missing folder = no log column
const logs = {}
try {
  const dir = process.env.CLAUDE_DASHBOARD_LOG_DIR || path.join(os.homedir(), 'Documents', 'ace-of-ashes', 'claude-log')
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    let cur
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
      const h = l.match(/^## ([^|]+)\|[^|]*\|[^|]*\|([^|]+)\|\s*(.*)$/)
      if (h) { cur = logs[h[1].trim().slice(0, 8)] = { tier: f.slice(0, -3).toUpperCase(), title: h[2].trim(), done: /done/.test(h[3]), sections: [] }; continue }
      if (!cur) continue
      const e = l.match(/^est:\s*~?(\d+)k tok \/ ~?(\d+) min/)
      if (e) { cur.estK = +e[1]; cur.estMin = +e[2] }
      const x = l.match(/^- S\d+\s+(\w+)\s*\|([^|]*)(?:\|.*?\bact\s*([^|]*))?/)
      if (x) cur.sections.push({ k: x[1], what: x[2].trim().slice(0, 80), done: /\d/.test(x[3] || '') })
    }
  }
} catch {}
fs.writeFileSync(cacheFile, JSON.stringify(next))

// what a session is doing, from the tail of its transcript:
// 'input' when its last move asks the person (a question, a plan, a wrap-up ask), else its last tool or text
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const clip = (t, n = 90) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
function tool(b) {
  const i = b.input || {}, n = b.name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')
  return clip(`${n}: ${i.description || i.command || (i.file_path && path.basename(i.file_path)) || i.pattern || i.prompt || i.query || i.title || ''}`)
}
const OFFER = /^\W*(want|should i|shall i|do you want|would you like|soll ich|willst du|möchtest du)\b/i

function activity(file) {
  let text = ''
  try {
    const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, len = Math.min(size, 256 * 1024)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    fs.closeSync(fd)
    text = buf.toString('utf8')
  } catch { return { ask: false, doing: '' } }
  const lines = text.split('\n').slice(1).reverse()
  for (const l of lines) {
    let r
    try { r = JSON.parse(l) } catch { continue }
    if (r.type === 'user') {
      const c = r.message?.content
      if (typeof c === 'string') return { ask: false, doing: 'prompt: ' + clip(c) }
      if (Array.isArray(c) && c.some(b => b.type === 'text')) return { ask: false, doing: 'prompt: ' + clip(c.find(b => b.type === 'text').text) }
      continue // tool results: keep looking for the call
    }
    if (r.type !== 'assistant') continue
    const blocks = (r.message?.content || []).filter(b => b.type === 'tool_use' || b.type === 'text')
    if (!blocks.length) continue
    const b = blocks[blocks.length - 1]
    // a closing offer ("Want me to…?") is optional, not a question the session waits on
    if (b.type === 'text') return { ask: /\?\s*$/.test(b.text) && !OFFER.test(b.text.trim().split(/[.!:\n]\s+/).pop()), doing: clip(b.text) }
    if (ASKS.has(b.name)) return { ask: true, doing: clip(b.input?.questions?.[0]?.question || 'plan ready for approval') }
    if (b.name.endsWith('wrap_up')) return b.input?.ask ? { ask: true, doing: clip(b.input.ask) } : { ask: false, doing: clip(b.input?.recap) }
    return { ask: false, doing: tool(b) }
  }
  return { ask: false, doing: '' }
}

// status: 'input' (waiting on the person), 'busy' (mid-turn), 'idle' (turn done, still open), 'closed' (ended in the last 3h)
const sessions = [], live = new Set()
const sdir = path.join(home, 'sessions')
for (const n of fs.readdirSync(sdir)) {
  if (!n.endsWith('.json')) continue
  try {
    const s = JSON.parse(fs.readFileSync(path.join(sdir, n), 'utf8'))
    process.kill(s.pid, 0) // throws when the process is gone
    live.add(s.sessionId)
    const a = mainFile[s.sessionId] ? activity(mainFile[s.sessionId].file) : { ask: false, doing: '' }
    const status = a.ask ? 'input' : s.status === 'busy' ? 'busy' : 'idle'
    sessions.push({ name: s.name || s.sessionId.slice(0, 8), status, doing: a.doing, cwd: path.basename(s.cwd || ''), updatedAt: s.updatedAt || s.startedAt, entry: s.entrypoint || s.kind, id: s.sessionId, host: s.hostSessionId, ...details(s.sessionId) })
  } catch {}
}
for (const [id, m] of Object.entries(mainFile)) {
  if (live.has(id) || m.mtime < Date.now() - 3 * 36e5) continue
  const t = bySession[id]
  if (!t.title) continue // untitled: one-off runs (headless, SDK), not sessions worth listing
  sessions.push({ name: t.title, status: 'closed', doing: activity(m.file).doing, cwd: t.branch, updatedAt: m.mtime, entry: '', ...details(id) })
}
const order = { input: 0, busy: 1, idle: 2, closed: 3 }
sessions.sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt)

// the account's rate-limit windows, saved by the hooks module from the engine's last API response
let limits
try { limits = JSON.parse(fs.readFileSync(path.join(home, 'mods', 'usage-dashboard', 'limits.json'), 'utf8')) } catch {}
console.log(JSON.stringify({ now: Date.now(), hours: total, sessions, today, split, models, limits }))
