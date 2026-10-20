import type { EngineInterface, Register } from 'claude-code'

import type { Session, Usage } from '../types'

import { STATUS, STYLE, ago, barSvg, clip, detail, esc, fmt, groups, info, lineSvg, name, openUrl, pageHtml, pct, progress, rows, short } from './page'

export * from './page'

const PANE = 'usage-dashboard'
const usage = { plugin: 'usage-dashboard', key: 'usage' } as const
const error = { plugin: 'usage-dashboard', key: 'error' } as const


const pagePath = ($: EngineInterface) => `${$.plugin.root}/usage.html`

async function refresh($: EngineInterface) {
  try {
    // account-wide windows: whichever session refreshed last has the newest reading
    const { rateLimits } = await $.session.usage()
    if (rateLimits.length) await $.fs.write(`${$.plugin.root}/limits.json`, JSON.stringify({ at: Date.now(), windows: rateLimits }))
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/usage.mjs`], { timeoutMs: 600000 })
    if (r.exitCode !== 0) throw new Error(r.stderr.slice(0, 200))
    const data = JSON.parse(r.stdout) as Usage
    await $.state.set(usage, data)
    await $.fs.write(pagePath($), pageHtml(data))
    await $.state.set(error, '')
  } catch (err) {
    await $.state.set(error, String(err))
  }
}

// ends idle sessions (never this one) by killing their process; transcripts stay, the app can resume them
async function closeSessions($: EngineInterface, ids: string[]) {
  const own = await $.session.id()
  ids = ids.filter(id => id !== own)
  if (!ids.length) return
  const r = await $.process.run(['node', `${$.plugin.root}/scripts/close.mjs`, own, ...ids], { timeoutMs: 60000 })
  const n = Number(r.stdout.trim()) || 0
  await $.ui.toast(`Closed ${n} of ${ids.length} session${ids.length === 1 ? '' : 's'}`)
  await refresh($)
}

const URL = 'http://127.0.0.1:8765/'
// the page server outlives this session (hidden, detached); a second start exits when the port is taken
const serve = ($: EngineInterface) =>
  $.process.run(['powershell', '-NoProfile', '-Command', `Start-Process node -ArgumentList '"${$.plugin.root}/scripts/serve.mjs"' -WindowStyle Hidden`])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dashboard', description: 'Show token usage and active sessions; "tab" opens it in your browser, "app" in Claude\'s browser pane' })
    void serve($)
    void $.ui.open({ id: PANE, title: 'Usage' })
    void refresh($)
    return next(e)
  })

  // no timer: each session refreshes when its own main turn ends; progress reports push through scripts/progress.mjs
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) void refresh($)
    return r
  })

  on('command.run', { command: 'dashboard' }, async ($, e) => {
    if (e.args.trim() === 'tab') {
      const { value: u } = await $.state.get(usage)
      if (!u) return { text: 'No data yet, try again in a minute.' }
      await $.fs.write(pagePath($), pageHtml(u))
      // Windows default browser; start treats the first quoted arg as a window title
      await serve($)
      await $.process.run(['cmd', '/c', 'start', '', URL])
      return { text: `Usage dashboard opened in your browser at ${URL} (reloads every 5s with fresh data).` }
    }
    if (e.args.trim() === 'app') {
      await serve($)
      return { text: `Dashboard at ${URL}`, context: [`Open ${URL} in your built-in browser pane now (preview_start with that url), then say only that it is open.`] }
    }
    await $.ui.open({ id: PANE, title: 'Usage' })
    void refresh($)
    return { text: 'Usage dashboard opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // the terminal's table lists Svg but paints nothing for it: text fallback there
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const { value: u } = await $.state.get(usage)
    const { value: err = '' } = await $.state.get(error)
    const own = await $.session.id()
    // the idle sessions a close button may end
    const closable = (list: readonly Session[]) => list.filter(s => s.status === 'idle' && s.id && s.id !== own).map(s => s.id as string)
    if (!u) return <Text dimColor>{err || 'Reading transcripts (first run can take a minute)...'}</Text>
    const days = rows(u)
    const today = u.today ?? []
    const total = today.reduce((a, s) => a + s.tokens, 0)
    const width = Math.max(10, e.props.bodyColumns - 14)
    // the terminal has no Svg: a sparkline for the trend, text bars for today
    const dayMax = Math.max(1, ...days.map(d => d[1]))
    const spark = days.map(d => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((d[1] / dayMax) * 8))]).join('')
    const barMax = Math.max(1, ...today.map(s => s.tokens))
    return (
      <Box flexDirection="column">
        <Text bold>Tokens per day, last 14 days (in + out + cache writes)</Text>
        {Svg ? (
          <Svg source={lineSvg(days)} alt={days.map(([l, t]) => `${l} ${fmt(t)}`).join(', ')} isInteractive />
        ) : (
          <Text>
            <Text color="cyan">{spark}</Text> {days[0]?.[0]}-{days[13]?.[0]} · peak {fmt(dayMax)}
          </Text>
        )}
        <Text bold>
          Today by session ({today.length}, {fmt(total)})
        </Text>
        {today.length === 0 ? (
          <Text dimColor>No tokens yet today.</Text>
        ) : Svg ? (
          <Svg source={barSvg(today)} alt={today.map(s => `${name(s)} ${fmt(s.tokens)}`).join(', ')} isInteractive />
        ) : (
          today.map(s => (
            <Text wrap="truncate-end">
              {clip(name(s), 24).padEnd(24)} <Text color="cyan">{'█'.repeat(Math.round((s.tokens / barMax) * Math.max(4, width - 22))) || '·'}</Text> {fmt(s.tokens)}
            </Text>
          ))
        )}
        {info(u).map(([h, lines]) => (
          <Box flexDirection="column">
            <Text bold>{h}</Text>
            {lines.map(l => (
              <Text wrap="truncate-end">{l}</Text>
            ))}
          </Box>
        ))}
        {groups(u).map(([k, list]) => (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text bold>
                {STATUS[k][3]} ({list.length})
              </Text>
              {closable(list).length > 1 && (
                <Button key="close-all" onPress={() => void closeSessions($, closable(list))}>
                  Close all
                </Button>
              )}
            </Box>
            {list.map(s => (
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1}>
                {openUrl(s) && (
                  <Button key={`open-${s.id}`} onPress={() => void $.process.run(['cmd', '/c', 'start', '', openUrl(s)])}>
                    Open
                  </Button>
                )}
                {closable([s]).length > 0 && (
                  <Button key={`close-${s.id}`} onPress={() => void closeSessions($, closable([s]))}>
                    Close
                  </Button>
                )}
                <Text wrap="truncate-end">
                  <Text color={STATUS[k][1]}>{STATUS[k][0]}</Text> {s.name} <Text color="cyan">{progress(s.plan, s.reported)}</Text>{' '}
                  <Text dimColor>
                    {s.cwd} · {ago(u.now - s.updatedAt)}
                  </Text>
                </Text>
                </Box>
                <Text dimColor wrap="truncate-end">
                  {'  '}
                  {s.doing || '-'}
                </Text>
                <Text dimColor wrap="truncate-end">
                  {'  '}
                  {detail(s)}
                </Text>
              </Box>
            ))}
          </Box>
        ))}
        {err && <Text color="red">{err}</Text>}
      </Box>
    )
  })
}
