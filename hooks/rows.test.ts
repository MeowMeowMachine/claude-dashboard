import { test, expect } from 'claude-code/testing'

import { barSvg, detail, info, lineSvg, openUrl, pageHtml, progress, rows } from './register'

test('buckets hourly tokens into local days', async () => {
  const now = new Date(2026, 9, 18, 13, 30).getTime()
  const h = (d: Date) => String(Math.floor(d.getTime() / 36e5))
  const hours = {
    [h(new Date(2026, 9, 18, 12))]: 100,
    [h(new Date(2026, 9, 18, 2))]: 50,
    [h(new Date(2026, 9, 17, 23))]: 7,
    [h(new Date(2026, 8, 1))]: 999,
  }
  const days = rows({ now, hours, sessions: [], today: [] })
  expect(days.length).toBe(14)
  expect(days[13]).toEqual(['18.10.', 150])
  expect(days[12]).toEqual(['17.10.', 7])
  expect(lineSvg(days)).toContain('<polyline')
})

test('one bar per session, names escaped, branch as fallback', async () => {
  const svg = barSvg([
    { id: 'a', title: 'A & B', branch: 'feat/x', tokens: 200 },
    { id: 'b', title: '', branch: 'main', tokens: 100 },
  ])
  expect(svg.split('<rect').length - 1).toBe(2)
  expect(svg).toContain('A &#38; B')
  expect(svg).toContain('>main<')
})

test('browser page holds both charts and refreshes itself', async () => {
  const html = pageHtml({ now: Date.now(), hours: {}, sessions: [], today: [{ id: 'a', title: 'T', branch: '', tokens: 5 }] })
  expect(html).toContain('http-equiv="refresh"')
  expect(html).toContain('<polyline')
  expect(html).toContain('class="bar"')
})

test('sessions grouped by status on the page, input first', async () => {
  const s = (name: string, status: 'input' | 'busy' | 'idle' | 'closed') => ({ name, status, doing: name + ' doing', cwd: 'x', updatedAt: 0, entry: '' })
  const html = pageHtml({ now: 1, hours: {}, today: [], sessions: [s('B', 'busy'), s('Q', 'input'), s('C', 'closed')] })
  expect(html.indexOf('class="col input"')).toBeLessThan(html.indexOf('class="col busy"'))
  expect(html).toContain('Q doing')
  // the empty idle column shrinks: input, busy, closed full width
  expect(html).toContain('grid-template-columns:minmax(0,1fr) minmax(0,1fr) 150px minmax(0,1fr)')
})

test('task-list progress, session details, token split and model share', async () => {
  expect(progress([3, 4])).toBe('▰▰▰▰▰▰▱▱ 3/4 75%')
  expect(progress(undefined)).toBe('')
  const s = { name: 'S', status: 'busy' as const, doing: '', cwd: '', updatedAt: 0, entry: '', model: 'claude-opus-5-5', turns: 2, tools: 10, agents: 0, mins: 75, plan: [1, 2] as [number, number] }
  expect(detail(s)).toBe('opus-5-5 · 2 prompts · 10 tools · 1h15')
  const lines = info({ now: 0, hours: {}, sessions: [s], today: [], split: { today: [10, 20, 30, 60], days14: [0, 0, 0, 0] }, models: { today: { 'claude-opus-5-5': 3, 'claude-sonnet-5-5': 1 }, days14: {} } })
  expect(lines[0]?.[1][0]).toContain('cache hit 60%')
  expect(lines[1]?.[1][0]).toBe('Today: opus-5-5 3 (75%) · sonnet-5-5 1 (25%)')
  const html = pageHtml({ now: 1, hours: {}, today: [], sessions: [s], split: { today: [1, 1, 1, 1], days14: [1, 1, 1, 1] } })
  expect(html).toContain('style="--v:50"')
  expect(html).toContain('Token split')
})

test('desktop sessions link back into the app, others and odd ids do not', async () => {
  const s = (host?: string) => ({ name: 'S', status: 'idle' as const, doing: '', cwd: '', updatedAt: 0, entry: '', host })
  expect(openUrl(s('local_ab-12'))).toBe('claude://code/continue?session=local_ab-12')
  expect(openUrl(s(undefined))).toBe('')
  expect(openUrl(s('local_x"><script>'))).toBe('')
  const html = pageHtml({ now: 1, hours: {}, today: [], sessions: [s('local_ab-12')] })
  // the page no longer links sessions: the deep link did not open them
  expect(html).not.toContain('claude://')
})

test('a session report wins over its task list', async () => {
  expect(progress([1, 4], { pct: 60, note: 'x', at: 0 })).toBe('▰▰▰▰▰▱▱▱ ~60%')
})
