// Page and text rendering shared by the hooks module and scripts/progress.mjs (node runs this file as TypeScript)
import type { Session, Split, Today, Usage } from '../types'

export const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)))
export const ago = (ms: number) => (ms < 6e4 ? 'now' : ms < 36e5 ? Math.round(ms / 6e4) + 'm' : Math.round(ms / 36e5) + 'h')
export const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
// icon, terminal colour, page colour and heading per session status, in display order
export const STATUS = {
  input: ['◆', 'yellow', '#d08a00', 'Needs your input'],
  busy: ['●', 'green', '#2e9e4f', 'Working'],
  idle: ['○', 'gray', '#888', 'Finished, still open'],
  closed: ['✓', 'gray', '#888', 'Closed in the last 3h'],
} as const
export const groups = (u: Usage) =>
  (Object.keys(STATUS) as (keyof typeof STATUS)[]).map(k => [k, u.sessions.filter(s => s.status === k)] as const).filter(g => g[1].length)
export const name = (s: Today) => s.title || s.branch || s.id.slice(0, 8)
// the Claude desktop deep link that brings a session to the front; none for sessions outside the app
export const openUrl = (s: Session) => (s.host && /^local_[A-Za-z0-9-]{1,64}$/.test(s.host) ? `claude://code/continue?session=${s.host}` : '')
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0) + '%'
export const short = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '')

// the session's progress as a bar: its own report (▰▰▰▰▰▱▱▱ ~60%) wins over its task list (▰▰▰▱▱▱▱▱ 3/8 38%)
export const progress = (p?: readonly [number, number], r?: Session['reported']) => {
  if (r) {
    const f = Math.round((Math.min(100, Math.max(0, r.pct)) / 100) * 8)
    return `${'▰'.repeat(f)}${'▱'.repeat(8 - f)} ~${r.pct}%`
  }
  if (!p) return ''
  const f = Math.round((p[0] / p[1]) * 8)
  return `${'▰'.repeat(f)}${'▱'.repeat(8 - f)} ${p[0]}/${p[1]} ${pct(p[0], p[1])}`
}

// model · prompts · tool calls · subagents · time from first to last message
export const detail = (s: Session) => {
  const m = s.mins ?? 0
  return [
    s.model && short(s.model),
    s.turns && `${s.turns} prompts`,
    s.tools && `${s.tools} tools`,
    s.agents && `${s.agents} agents`,
    m && (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`),
    s.reported?.note && `done: ${s.reported.note}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

// headed text lines for the token split and the per-model share, today and over 14 days
export function info(u: Usage) {
  const out: [string, string[]][] = []
  if (u.split) {
    const line = (k: string, [i, o, w, r]: Split) =>
      `${k}: in ${fmt(i)} · out ${fmt(o)} · cache write ${fmt(w)} · cache read ${fmt(r)} · cache hit ${pct(r, i + w + r)}`
    out.push(['Token split', [line('Today', u.split.today), line('14 days', u.split.days14)]])
  }
  if (u.models) {
    const line = (k: string, m: Record<string, number>) => {
      const all = Object.values(m).reduce((a, t) => a + t, 0)
      const parts = Object.entries(m).sort((a, b) => b[1] - a[1]).map(([n, t]) => `${short(n)} ${fmt(t)} (${pct(t, all)})`)
      return `${k}: ${parts.join(' · ') || '-'}`
    }
    out.push(['Per model', [line('Today', u.models.today), line('14 days', u.models.days14)]])
  }
  return out
}

// rows of [label, tokens] for the last 14 local days
export function rows(u: Usage) {
  const hourly = Object.entries(u.hours).map(([h, t]) => [Number(h) * 36e5, t] as const)
  const sum = (from: number, to: number) => hourly.reduce((a, [ts, t]) => (ts >= from && ts < to ? a + t : a), 0)
  const midnight = new Date(u.now).setHours(0, 0, 0, 0)
  return Array.from({ length: 14 }, (_, i) => {
    const from = new Date(midnight).setDate(new Date(midnight).getDate() - 13 + i)
    const to = new Date(from).setDate(new Date(from).getDate() + 1)
    const d = new Date(from)
    return [`${d.getDate()}.${d.getMonth() + 1}.`, sum(from, to)] as const
  })
}

// the svg is drawn isolated, so no host CSS reaches it: colours follow the viewer's theme here
export const STYLE = `<style>
text{font:11px system-ui,sans-serif;fill:#6b6b6b}.v{fill:#3a3a3a}.g{stroke:#e2e2e2}
.l{stroke:#2a7fd4;fill:none;stroke-width:2}.a{fill:#2a7fd4;opacity:.12}.p,.b{fill:#2a7fd4}
@media (prefers-color-scheme:dark){text{fill:#9a9a9a}.v{fill:#dcdcdc}.g{stroke:#3a3a3a}.l{stroke:#5aa9f0}.a,.p,.b{fill:#5aa9f0}}
</style>`

export function lineSvg(days: readonly (readonly [string, number])[]) {
  const W = 560, H = 200, L = 44, R = 12, T = 12, B = 24
  const max = Math.max(1, ...days.map(d => d[1]))
  const x = (i: number) => L + (i * (W - L - R)) / (days.length - 1)
  const y = (t: number) => T + (1 - t / max) * (H - T - B)
  const pts = days.map(([, t], i) => `${x(i).toFixed(1)},${y(t).toFixed(1)}`).join(' ')
  const grid = [0, 0.5, 1].map(f => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${fmt(max * f)}</text>`)
  // every second date label, always including today
  const labels = days.map(([l], i) => ((days.length - 1 - i) % 2 ? '' : `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${l}</text>`))
  const dots = days.map(([l, t], i) => `<circle class="p" cx="${x(i)}" cy="${y(t)}" r="3"><title>${l} ${fmt(t)}</title></circle>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${STYLE}${grid.join('')}<polygon class="a" points="${L},${y(0)} ${pts} ${W - R},${y(0)}"/><polyline class="l" pathLength="1" points="${pts}"/>${dots.join('')}${labels.join('')}</svg>`
}

// one horizontal bar per session, largest first
export function barSvg(today: Today[]) {
  const W = 560, row = 20, L = 210, R = 52
  const max = Math.max(1, ...today.map(s => s.tokens))
  const H = Math.max(1, today.length) * row + 4
  const bars = today.map((s, i) => {
    const w = Math.max(1, (s.tokens / max) * (W - L - R)), top = i * row + 2
    const tip = `${esc(name(s))}${s.branch ? ' (' + esc(s.branch) + ')' : ''}: ${s.tokens.toLocaleString()} tokens`
    return `<g><title>${tip}</title><text class="v" x="${L - 8}" y="${top + 13}" text-anchor="end">${esc(clip(name(s), 34))}</text><rect class="b" x="${L}" y="${top + 3}" width="${w.toFixed(1)}" height="${row - 6}" rx="2"/><text x="${L + w + 6}" y="${top + 13}">${fmt(s.tokens)}</text></g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${STYLE}${bars.join('')}</svg>`
}

// a session's progress as 0-100: its own report wins, then its open estimate-log block (sections with act time),
// then its task list; undefined without any
export const progressPct = (s: Session) => {
  if (s.reported) return Math.min(100, Math.max(0, s.reported.pct))
  const sec = s.log && !s.log.done ? s.log.sections : []
  if (sec.length) return Math.round((sec.filter(x => x.done).length / sec.length) * 100)
  return s.plan ? Math.round((s.plan[0] / s.plan[1]) * 100) : undefined
}

// task size: the tier from the estimate log, else a guess from the tool-call count
const TIERS: Record<string, [number, string]> = { EASY: [1, 'Small'], MEDIUM: [2, 'Feature'], COMPLEX: [3, 'Major'] }
export const size = (s: Session) => {
  const t = s.log && TIERS[s.log.tier]
  if (t) return { lvl: t[0], label: t[1], guess: false }
  const n = s.tools ?? 0
  return n ? { lvl: n < 40 ? 1 : n < 150 ? 2 : 3, label: n < 40 ? 'Small' : n < 150 ? 'Feature' : 'Major', guess: true } : undefined
}

// fixed categorical slot per model family, so a colour follows the model, never its rank
const FAMILY = ['opus', 'sonnet', 'haiku', 'fable']
const modelVar = (m: string) => `var(--c${FAMILY.findIndex(f => m.includes(f)) + 1 || 5})`

// one segmented share bar (2px gaps between segments) with a legend underneath
function shareBar(parts: [string, number, string][]) {
  const all = parts.reduce((a, p) => a + p[1], 0) || 1
  const segs = parts.filter(p => p[1] > 0).map(([l, v, c]) => `<i style="flex:${v};background:${c};color:${c}" title="${esc(l)} ${fmt(v)} (${pct(v, all)})"></i>`).join('')
  const legend = parts.map(([l, v, c]) => `<span><b style="background:${c};color:${c}"></b>${esc(l)} <em>${fmt(v)} · ${pct(v, all)}</em></span>`).join('')
  return `<div class="share">${segs || '<i style="flex:1;background:var(--grid)"></i>'}</div><div class="legend">${legend}</div>`
}

// '3h12m' or '2d 4h' until an ISO time
const until = (iso: string | undefined, now: number) => {
  const ms = iso ? Date.parse(iso) - now : NaN
  if (!(ms > 0)) return iso ? 'resetting' : ''
  const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4)
  return 'resets in ' + (h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`)
}

// one rate-limit window as a ring gauge (r 15.9155 makes the circumference 100, so the dash offset is 100 - percent)
// data-anim/data-v let the page script tween the ring and count the number up
function ring(label: string, kind: string, u: Usage) {
  const w = u.limits?.windows.find(x => x.kind === kind)
  const p = w ? Math.min(100, Math.max(0, Math.round(w.percentUsed))) : 0
  const c = p >= 90 ? 'var(--bad)' : p >= 70 ? 'var(--warn)' : 'var(--good)'
  const tip = w && u.limits ? ` title="${w.percentUsed}% used · reading ${ago(u.now - u.limits.at)} old"` : ''
  return `<div class="gauge"${tip}><div class="ring${p >= 90 ? ' hot' : ''}" style="color:${c}"><svg viewBox="0 0 36 36"><circle class="rt" cx="18" cy="18" r="15.9155"/><circle class="rf" cx="18" cy="18" r="15.9155" data-anim="ring-${kind}" data-v="${p}" style="--v:${p}"/></svg>` +
    `<b${w ? ` data-anim="ringn-${kind}" data-v="${p}" data-f="%"` : ''}>${w ? p + '%' : '–'}</b></div><div><small>${label}</small><em>${w ? until(w.resetsAt, u.now) : 'no reading yet'}</em></div></div>`
}

const dur = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`)

function card(s: Session, now: number, i: number) {
  const p = progressPct(s)
  const key = esc(s.id || s.name)
  const z = size(s)
  const busy = s.status === 'busy'
  const done = p === 100
  // a session that published an artifact links to it; a Claude Design gets its own chip colour
  const art = s.art && /^https:\/\/claude\.ai\/(code\/)?artifact\/[\w-]+$/.test(s.art.url)
    ? `<a class="chip" style="--cc:${s.art.design ? 'var(--c5)' : 'var(--muted)'}" href="${s.art.url}" target="_blank" title="Open on claude.ai">${s.art.design ? '◆ Design' : '▣ Artifact'} · ${esc(clip(s.art.title || 'untitled', 28))}</a>`
    : ''
  const tier = z
    ? `<span class="tier t${z.lvl}${z.guess ? ' guess' : ''}" title="${z.guess ? 'guessed from tool calls' : `${s.log!.tier}${s.log!.estMin ? ` · est ${s.log!.estMin} min / ${s.log!.estK}k tok` : ''}`}"><span class="lvl"><i></i><i></i><i></i></span>${z.guess ? '≈' : ''}${z.label}</span>`
    : ''
  const src = s.reported ? 'reported by the session' : s.log && !s.log.done && s.log.sections.length ? 'sections done in the estimate log' : 'task list'
  const prog = p !== undefined
    ? `<div class="prog"><div class="track"><div class="fill" data-anim="p-${key}" data-v="${p}" style="--v:${p}"></div></div><b class="pct" title="${src}" data-anim="pn-${key}" data-v="${p}" data-f="%">${p}%</b></div>`
    : busy ? `<div class="prog"><div class="track indet"><div class="fill"></div></div><b class="pct" title="no progress report yet">…</b></div>` : ''
  // estimate-log sections as steps: done, current (first open one), to do
  const sec = s.log?.sections ?? []
  const cur = s.log?.done ? -1 : sec.findIndex(x => !x.done)
  const steps = sec.length
    ? `<ol class="steps">${sec.map((x, j) => `<li class="${x.done ? 'done' : j === cur ? 'cur' : ''}" title="${esc(x.what)}">${esc(x.k)}</li>`).join('')}</ol>`
    : ''
  const left = s.log?.estMin && p !== undefined && p < 100 && s.status !== 'closed' ? Math.max(1, Math.round((s.log.estMin * (100 - p)) / 100)) : 0
  const chips = [
    s.model && `<span class="chip" style="--cc:${modelVar(s.model)}">${esc(short(s.model))}</span>`,
    ...(s.pool ?? []).map(([k, n]) => `<span class="chip sub" style="--cc:${modelVar(k)}" title="subagents started with this model and effort">⚙ ${esc(k)} ×${n}</span>`),
    s.live && `<span class="chip live">● ${s.live} agent${s.live === 1 ? '' : 's'} live</span>`,
    s.eco && `<span class="chip eco" title="subagents run in Eco mode">❦ eco</span>`,
    s.tokens && `<span class="chip" title="tokens today">◇ ${fmt(s.tokens)}</span>`,
    left && `<span class="chip eta" title="from the estimate in the log">~${left}m left</span>`,
    art,
  ].filter(Boolean).join('')
  // context window fill; ponytail: window guessed from the model family (Claude 5 = 1M, else 200k), read it from the API if it ever reports one
  const win = Math.max(/-5-|\[1m\]/.test(s.model ?? '') ? 1e6 : 2e5, s.ctxMax ?? 0)
  const cp = s.ctx ? Math.min(100, Math.round((s.ctx / win) * 100)) : 0
  const ctx = s.ctx
    ? `<div class="ctx${cp >= 80 ? ' bad' : cp >= 55 ? ' warn' : ''}" title="context of the last request: ${s.ctx.toLocaleString()} of ~${fmt(win)} tokens"><small>ctx</small><div class="ctrack"><div data-anim="c-${key}" data-v="${cp}" style="--v:${cp}"></div></div><em>${fmt(s.ctx)} / ${fmt(win)}</em></div>`
    : ''
  const doing = s.doing.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const meta = [s.cwd, s.turns && `${s.turns} prompts`, s.tools && `${s.tools} tools`, s.mins && dur(s.mins)].filter(Boolean).join(' · ')
  return `<article class="card ${s.status}${done ? ' done' : ''}${s.art?.design ? ' is-design' : ''}" data-key="${key}" data-status="${s.status}" data-pct="${p ?? ''}" style="--i:${i}">` +
    `<header><span class="name">${esc(s.name)}</span>${tier}<time>${ago(now - s.updatedAt)}</time></header>` + prog + steps +
    `<p class="doing">${busy ? '<span class="arrow">▸</span>' : ''}${esc(doing || '-')}${busy ? '<i class="caret"></i>' : ''}</p>` +
    (s.reported?.note ? `<p class="note">✓ ${esc(s.reported.note)}</p>` : '') +
    (chips ? `<div class="chips">${chips}</div>` : '') + ctx +
    (meta ? `<p class="meta">${esc(meta)}</p>` : '') + `</article>`
}

// browser side, as plain JS (no backticks, no backslashes): polls the page every 5 s and swaps #app in place,
// so gauges and bars tween to new values, new and finished sessions animate, and an opt-in chime plays
const CLIENT = String.raw`(function(){
var S={sound:false,ctx:null};
try{S.sound=localStorage.getItem('dash-sound')==='1'}catch(e){}
var F=function(n){return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?Math.round(n/1e3)+'k':String(Math.round(n))};
var all=function(q,r){return Array.prototype.slice.call((r||document).querySelectorAll(q))};
function vals(){var m={};all('[data-anim]').forEach(function(e){m[e.dataset.anim]=+e.dataset.v});return m}
function snap(){var m={};all('.card[data-key]').forEach(function(e){m[e.dataset.key]={s:e.dataset.status,p:e.dataset.pct===''?-1:+e.dataset.pct}});return m}
function count(e,from,to){var fin=e.textContent,t0=performance.now(),f=e.dataset.f;
 function step(t){var k=Math.min(1,(t-t0)/1100),v=from+(to-from)*(1-Math.pow(1-k,3));e.textContent=f==='%'?Math.round(v)+'%':F(v);if(k<1)requestAnimationFrame(step)}
 requestAnimationFrame(step);setTimeout(function(){e.textContent=fin},1300)}
function animate(old){all('[data-anim]').forEach(function(e){var to=+e.dataset.v,from=old?old[e.dataset.anim]:0;
 if(from===undefined||from===to)return;
 e.style.transition='none';e.style.setProperty('--v',from);e.getBoundingClientRect();e.style.transition='';e.style.setProperty('--v',to);
 if(e.dataset.f!==undefined)count(e,from,to)})}
var TONES={done:[[523,0],[659,.1],[784,.2],[1047,.3,.6]],ask:[[880,0,.18],[660,.2,.3]],new:[[440,0,.15],[660,.09,.25]]};
function tone(k){if(!S.sound)return;try{var c=S.ctx||(S.ctx=new (window.AudioContext||window.webkitAudioContext)());if(c.state==='suspended')c.resume();
 TONES[k].forEach(function(n){var o=c.createOscillator(),g=c.createGain(),t=c.currentTime+n[1],d=n[2]||.25;o.type='triangle';o.frequency.value=n[0];
 g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.12,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+d+.05)})}catch(e){}}
function fx(e,c){e.classList.add(c);setTimeout(function(){e.classList.remove(c)},2600)}
function burst(e){var cols=['var(--good)','var(--cyan)','var(--c4)','var(--c5)','#fff'];for(var i=0;i<18;i++){var s=document.createElement('i'),a=Math.random()*6.283,r=40+Math.random()*70;
 s.className='spark';s.style.setProperty('--dx',Math.cos(a)*r+'px');s.style.setProperty('--dy',Math.sin(a)*r*.6+'px');s.style.background=cols[i%5];s.style.animationDelay=Math.random()*.15+'s';e.appendChild(s)}
 setTimeout(function(){all('.spark',e).forEach(function(s){s.remove()})},1500)}
function toast(msg,kind){var t=document.createElement('div');t.className='toast '+kind;t.textContent=msg;document.getElementById('toasts').appendChild(t);
 setTimeout(function(){t.classList.add('out')},5200);setTimeout(function(){t.remove()},5800)}
function events(before){var play='';
 all('.card[data-key]').forEach(function(e){var b=before[e.dataset.key],s=e.dataset.status,p=e.dataset.pct===''?-1:+e.dataset.pct,n=e.querySelector('.name').textContent;
  if(!b){fx(e,'enter');play=play||(s==='input'?'ask':'new');return}
  if((b.s==='busy'&&(s==='idle'||s==='closed'))||(b.p<100&&p===100)){fx(e,'finish');burst(e);play='done';toast('✓ '+n+(p===100?' is done':' finished its turn'),'good')}
  else if(b.s!=='input'&&s==='input'){fx(e,'alert');if(play!=='done')play='ask';toast('◆ '+n+' needs your input','warn')}});
 if(play)tone(play)}
var busy=false;
function tick(){if(busy)return;busy=true;
 fetch(location.pathname+'?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.text():''}).then(function(h){
  var doc=h&&new DOMParser().parseFromString(h,'text/html'),next=doc&&doc.getElementById('app');if(!next)return;
  if(doc.querySelector('style').textContent!==document.querySelector('style').textContent)return location.reload();
  var old=vals(),before=snap(),sc=all('.scroll').map(function(e){return e.scrollTop});
  document.getElementById('app').replaceWith(next);
  all('.scroll').forEach(function(e,i){e.scrollTop=sc[i]||0});
  animate(old);events(before)}).catch(function(){}).then(function(){busy=false;setTimeout(tick,5000)})}
var btn=document.getElementById('snd');
function label(){btn.textContent=S.sound?'♪ Sound on':'♪ Sound off';btn.classList.toggle('on',S.sound)}
btn.onclick=function(){S.sound=!S.sound;try{localStorage.setItem('dash-sound',S.sound?'1':'0')}catch(e){}label();tone('done')};
label();animate(null);
setTimeout(function(){document.documentElement.classList.remove('intro')},2400);
setTimeout(tick,5000)})()`

// the dashboard as one screen for a browser tab or Claude's browser pane: panels scroll inside, the page does not
export function pageHtml(u: Usage) {
  const today = u.today ?? []
  const total = today.reduce((a, s) => a + s.tokens, 0)
  const days = rows(u)
  const week = days.reduce((a, d) => a + d[1], 0)
  const [i, o, w, r] = u.split?.today ?? [0, 0, 0, 0]
  const count = (k: Session['status']) => u.sessions.filter(s => s.status === k).length
  const live = u.sessions.reduce((a, s) => a + (s.live ?? 0), 0)
  const models = (m: Record<string, number> = {}) =>
    shareBar(Object.entries(m).sort((a, b) => b[1] - a[1]).map(([n, t]): [string, number, string] => [short(n), t, modelVar(n)]))
  const top = Math.max(1, ...today.map(s => s.tokens))
  // empty status columns shrink to their heading so the full ones get the room
  const keys = Object.keys(STATUS) as (keyof typeof STATUS)[]
  const widths = keys.map(k => (count(k) ? 'minmax(0,1fr)' : '150px')).join(' ')
  // nearest to done first; sessions without progress keep their recency order below
  const byPct = (a: Session, b: Session) => (progressPct(b) ?? -1) - (progressPct(a) ?? -1)
  const cols = keys
    .map(k => {
      const list = u.sessions.filter(s => s.status === k)
      if (k !== 'closed') list.sort(byPct)
      return `<section class="col ${k}"><h3><span class="dot"></span>${STATUS[k][3]}<em>${list.length}</em></h3><div class="scroll">${list.map((s, j) => card(s, u.now, j)).join('') || '<p class="empty">none</p>'}</div></section>`
    })
    .join('')
  const kpi = (label: string, n: number, value: string, sub = '', cls = '') =>
    `<div class="kpi ${cls}"><small>${label}</small><strong data-anim="k-${label}" data-v="${n}" data-f="k">${value}</strong><em>${sub}</em></div>`
  return `<!doctype html><html class="intro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><noscript><meta http-equiv="refresh" content="5"></noscript><title>Claude Usage</title><style>
@property --a{syntax:'<angle>';initial-value:0deg;inherits:false}
:root{color-scheme:dark;--bg:#0c0c0e;--panel:#16161a;--card:#1b1b20;--ink:#f0efec;--ink2:#c3c2b7;--muted:#8b8a83;--grid:#2a2a30;--accent:#3987e5;--cyan:#38d6e8;
--c1:#3987e5;--c2:#e0703a;--c3:#20b27c;--c4:#d9a21b;--c5:#9a8ff0;--good:#2fd07a;--warn:#f0b028;--bad:#ff5a5f;--idle:#77766f}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink);overflow:hidden}
body::before{content:'';position:fixed;inset:-25%;z-index:-2;pointer-events:none;
background:radial-gradient(35% 30% at 18% 12%,rgba(57,135,229,.20),transparent 70%),radial-gradient(30% 28% at 82% 18%,rgba(154,143,240,.17),transparent 70%),radial-gradient(38% 32% at 55% 95%,rgba(47,208,122,.10),transparent 70%);
animation:drift 26s ease-in-out infinite alternate}
body::after{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.5;
background:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px) 0 0/28px 28px,linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px) 0 0/28px 28px;
-webkit-mask:radial-gradient(ellipse at 50% 0,#000 30%,transparent 80%);mask:radial-gradient(ellipse at 50% 0,#000 30%,transparent 80%)}
@keyframes drift{to{transform:translate(4%,3%) rotate(4deg) scale(1.06)}}
#app{height:100%;display:grid;gap:12px;padding:14px;grid-template:auto auto minmax(0,1fr)/minmax(0,1fr)}
.panel,.kpi{--edge:var(--accent);border:1px solid transparent;border-radius:14px;
background:linear-gradient(180deg,rgba(255,255,255,.03),transparent 40%) padding-box,linear-gradient(var(--panel),var(--panel)) padding-box,
linear-gradient(150deg,color-mix(in srgb,var(--edge) 60%,transparent),var(--grid) 35%,var(--grid) 70%,color-mix(in srgb,var(--c5) 45%,transparent)) border-box;
box-shadow:0 10px 30px -18px rgba(0,0,0,.8),0 0 24px -16px var(--edge)}
.panel{padding:12px 14px;min-height:0;display:flex;flex-direction:column}
h2{font-size:12px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2);margin:0 0 8px;display:flex;justify-content:space-between;gap:8px;align-items:center}
h2::before{content:'';width:3px;height:12px;border-radius:2px;background:linear-gradient(var(--cyan),var(--edge));box-shadow:0 0 8px var(--cyan);margin-right:-2px}
h2 span{margin-right:auto}h2 em{font-style:normal;font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
.kpi{position:relative;overflow:hidden;padding:10px 14px;display:flex;flex-direction:column}
.kpi::after{content:'';position:absolute;right:-30px;top:-30px;width:90px;height:90px;border-radius:50%;background:radial-gradient(color-mix(in srgb,var(--edge) 35%,transparent),transparent 70%);pointer-events:none}
.kpi small{color:var(--ink2);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.kpi strong{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px;background:linear-gradient(90deg,var(--ink),color-mix(in srgb,var(--edge) 70%,var(--ink)));-webkit-background-clip:text;background-clip:text;color:transparent}
.kpi em{font-style:normal;color:var(--muted);font-size:11.5px}
.kpi.k2{--edge:var(--c5)}.kpi.warn{--edge:var(--warn)}.kpi.work{--edge:var(--good)}.kpi.design{--edge:var(--c5)}.kpi.limits{--edge:var(--cyan)}
.kpi.warn.on{animation:breathe 1.8s ease-in-out infinite}
.kpi.limits{grid-column:span 2}.gauges{display:flex;gap:22px;margin-top:4px;flex-wrap:wrap}
.gauge{display:flex;align-items:center;gap:10px}.gauge small{display:block}.gauge em{display:block}
.ring{position:relative;width:56px;height:56px;flex:none}.ring svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
.ring circle{fill:none;stroke-width:3.4}.ring .rt{stroke:var(--grid)}
.ring .rf{stroke:currentColor;stroke-linecap:round;stroke-dasharray:100 100;stroke-dashoffset:calc(100px - var(--v) * 1px);transition:stroke-dashoffset 1.3s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 3px currentColor)}
.ring b{position:absolute;inset:0;display:grid;place-items:center;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink)}
.ring.hot{animation:hot 1.2s ease-in-out infinite}
.row{display:grid;gap:12px;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr)}
.row svg{width:100%;height:auto;max-height:190px;overflow:visible}
.row svg text{fill:var(--muted)}.row svg .v{fill:var(--ink2)}.row svg .g{stroke:var(--grid);stroke-dasharray:3 4}
.row svg .l{stroke:url(#lg);stroke-width:2.5;filter:drop-shadow(0 0 5px rgba(56,214,232,.55))}.row svg .a{fill:url(#ag);opacity:1}.row svg .p{fill:var(--cyan);filter:drop-shadow(0 0 3px var(--cyan))}
.intro .row svg .l{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.8s cubic-bezier(.4,0,.2,1) .2s forwards}
.intro .row svg .a{animation:fade 1.6s ease .6s both}.intro .row svg .p{animation:fade .5s ease both;animation-delay:1.3s}
.share{display:flex;gap:2px;height:14px;border-radius:7px;overflow:hidden;margin:4px 0 8px}.share i{display:block;min-width:3px;box-shadow:0 0 10px -2px currentColor}
.intro .share{animation:grow 1.2s cubic-bezier(.2,.8,.2,1) both;transform-origin:left}
.legend{display:flex;flex-direction:column;gap:3px}.legend span{display:flex;align-items:center;gap:6px;color:var(--ink)}.legend b{width:9px;height:9px;border-radius:3px;flex:none;box-shadow:0 0 6px currentColor}
.legend em{font-style:normal;color:var(--muted);margin-left:auto;font-variant-numeric:tabular-nums}
.sub{color:var(--ink2);font-size:11px;margin:6px 0 0;text-transform:uppercase;letter-spacing:.05em}
.main{display:grid;gap:12px;grid-template-columns:minmax(0,3fr) minmax(0,1fr);min-height:0}
.board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;min-height:0;flex:1}
.col{--sc:var(--idle);display:flex;flex-direction:column;min-height:0;border-radius:12px;padding:8px;background:linear-gradient(180deg,color-mix(in srgb,var(--sc) 9%,transparent),rgba(0,0,0,.25) 120px);border:1px solid var(--grid);border-top:2px solid color-mix(in srgb,var(--sc) 70%,transparent)}
.col.input{--sc:var(--warn)}.col.busy{--sc:var(--good)}
.col h3{font-size:12px;margin:0 0 8px;display:flex;align-items:center;gap:7px;letter-spacing:.02em}.col h3 em{margin-left:auto;font-style:normal;color:var(--sc);font-weight:700;background:color-mix(in srgb,var(--sc) 15%,transparent);border-radius:999px;padding:0 8px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--sc);box-shadow:0 0 8px var(--sc)}.busy .dot,.input .dot{animation:ping 1.6s infinite}
.scroll{overflow:auto;min-height:0;display:flex;flex-direction:column;gap:9px;padding:2px 4px 6px 2px;scrollbar-width:thin;scrollbar-color:var(--grid) transparent}
.card{--sc:var(--idle);position:relative;border:1px solid transparent;border-radius:11px;padding:9px 11px;
background:linear-gradient(160deg,color-mix(in srgb,var(--sc) 10%,var(--card)),var(--card) 60%) padding-box,linear-gradient(160deg,color-mix(in srgb,var(--sc) 55%,transparent),var(--grid) 50%) border-box}
.card.input{--sc:var(--warn);animation:breathe 2s ease-in-out infinite}
.card.busy{--sc:var(--good);
background:linear-gradient(160deg,color-mix(in srgb,var(--sc) 10%,var(--card)),var(--card) 60%) padding-box,
conic-gradient(from var(--a),transparent 0 55%,var(--good) 70%,var(--cyan) 80%,#fff 83%,transparent 92%) border-box,
linear-gradient(color-mix(in srgb,var(--good) 25%,var(--grid)),color-mix(in srgb,var(--good) 25%,var(--grid))) border-box;
animation:spin 3.2s linear infinite;box-shadow:0 0 22px -10px var(--good)}
.card.done{--sc:var(--good)}.card.closed{opacity:.62}.card.closed:hover{opacity:1}
.card.is-design{box-shadow:0 0 0 1px color-mix(in srgb,var(--c5) 40%,transparent),0 0 20px -10px var(--c5)}
.intro .card{animation:rise .6s cubic-bezier(.2,.9,.3,1.2) both;animation-delay:calc(var(--i) * 55ms)}
.card.enter{animation:pop .8s cubic-bezier(.2,1.5,.4,1) both,flash 1.6s ease-out}
.card.finish{animation:finish 1.8s ease-out}
.card.alert{animation:shake .5s ease,breathe 2s ease-in-out .5s infinite}
.card{container-type:inline-size}@container (max-width:300px){.card header{flex-wrap:wrap;row-gap:3px}.card .name{flex-basis:100%;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}}
.card header{display:flex;gap:7px;align-items:center;font-weight:650}.card .name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card.done .name::before{content:'✓ ';color:var(--good);text-shadow:0 0 8px var(--good)}
.card time{margin-left:auto;color:var(--muted);font-weight:400;font-size:11px;flex:none}
.tier{--tc:var(--c3);flex:none;display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;padding:1px 7px 1px 5px;border-radius:999px;color:var(--tc);border:1px solid color-mix(in srgb,var(--tc) 50%,transparent);background:color-mix(in srgb,var(--tc) 12%,transparent)}
.tier.t2{--tc:var(--c1)}.tier.t3{--tc:#d36ee8;box-shadow:0 0 12px -3px #d36ee8}.tier.guess{border-style:dashed;opacity:.8}
.lvl{display:inline-flex;align-items:flex-end;gap:1.5px;height:9px}.lvl i{width:2.5px;border-radius:1px;background:currentColor;opacity:.25}
.lvl i:nth-child(1){height:4px}.lvl i:nth-child(2){height:6.5px}.lvl i:nth-child(3){height:9px}
.t1 .lvl i:nth-child(-n+1),.t2 .lvl i:nth-child(-n+2),.t3 .lvl i{opacity:1}
.prog{display:flex;align-items:center;gap:9px;margin:8px 0 2px}
.track{position:relative;flex:1;height:8px;border-radius:5px;background:rgba(255,255,255,.06);box-shadow:inset 0 1px 2px rgba(0,0,0,.5);overflow:hidden}
.fill{position:relative;height:100%;width:calc(var(--v) * 1%);border-radius:5px;background:linear-gradient(90deg,var(--c1),var(--cyan) 60%,var(--good));transition:width 1.3s cubic-bezier(.2,.8,.2,1);overflow:hidden}
.input .fill{background:linear-gradient(90deg,#c46a12,var(--warn))}.closed .fill,.idle .fill{background:linear-gradient(90deg,#4b4b52,#8b8a83)}
.done .fill{background:linear-gradient(90deg,var(--c3),var(--good));box-shadow:0 0 12px var(--good)}
.busy .fill{box-shadow:0 0 12px -1px var(--cyan)}
.busy .fill::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);animation:shine 1.9s ease-in-out infinite}
.track.indet .fill{width:35%;animation:indet 1.5s ease-in-out infinite}
.pct{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;min-width:44px;text-align:right;color:var(--ink)}
.busy .pct{color:var(--cyan);text-shadow:0 0 12px rgba(56,214,232,.6)}.done .pct{color:var(--good);text-shadow:0 0 12px rgba(47,208,122,.6)}.input .pct{color:var(--warn)}
.steps{display:flex;gap:4px;margin:6px 0 0;padding:0;list-style:none}
.steps li{flex:1;min-width:0;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;padding-top:3px;border-top:3px solid var(--grid);color:var(--muted);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:2px}
.steps li.done{border-color:var(--good);color:var(--ink2)}.steps li.cur{border-color:var(--cyan);color:var(--cyan);animation:cur 1.4s ease-in-out infinite}.card:not(.busy) .steps li.cur{animation:none}
.doing{margin:6px 0 0;color:var(--ink2);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.busy .doing{color:var(--ink)}.arrow{color:var(--good);margin-right:4px}
.caret{display:inline-block;width:6px;height:12px;margin-left:3px;vertical-align:-1px;background:var(--good);box-shadow:0 0 6px var(--good);animation:blink 1s steps(1) infinite}
.note{margin:3px 0 0;color:var(--good);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
.chip{--cc:var(--muted);display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:999px;font-size:10.5px;text-decoration:none;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;
color:color-mix(in srgb,var(--cc) 75%,#fff);background:color-mix(in srgb,var(--cc) 14%,transparent);border:1px solid color-mix(in srgb,var(--cc) 35%,transparent)}
a.chip:hover{filter:brightness(1.3)}
.chip.live{--cc:var(--good)}.chip.live::first-letter{animation:blink 1s steps(1) infinite}
.chip.eco{--cc:var(--c3)}.chip.eta{--cc:var(--cyan)}
.ctx{--cc:var(--c5);display:flex;align-items:center;gap:7px;margin-top:6px;font-size:10.5px;color:var(--muted)}.ctx.warn{--cc:var(--warn)}.ctx.bad{--cc:var(--bad)}
.ctx small{text-transform:uppercase;letter-spacing:.08em;font-size:9.5px}.ctx em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--ink2)}
.ctrack{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden}
.ctrack div{height:100%;width:calc(var(--v) * 1%);border-radius:2px;background:linear-gradient(90deg,color-mix(in srgb,var(--cc) 45%,transparent),var(--cc));box-shadow:0 0 8px -1px var(--cc);transition:width 1.3s cubic-bezier(.2,.8,.2,1)}
.ctx.bad .ctrack div{animation:blink 1.2s ease-in-out infinite}
.meta{margin:5px 0 0;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.empty{color:var(--muted);margin:4px;font-style:italic}
.bars{display:flex;flex-direction:column;gap:7px}.bar{display:grid;grid-template-columns:minmax(0,1fr) 44px;gap:3px 8px;font-size:12px}
.bar span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bar em{font-style:normal;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.bar i{grid-column:1/-1;height:6px;border-radius:3px;width:calc(var(--v) * 1%);background:linear-gradient(90deg,var(--c1),var(--cyan));box-shadow:0 0 10px -3px var(--cyan);transition:width 1.3s cubic-bezier(.2,.8,.2,1)}
footer{position:fixed;right:18px;bottom:3px;color:var(--muted);font-size:10.5px}
#snd{position:fixed;left:16px;bottom:3px;font:inherit;font-size:10.5px;color:var(--muted);background:transparent;border:1px solid var(--grid);border-radius:999px;padding:1px 9px;cursor:pointer}
#snd.on{color:var(--cyan);border-color:color-mix(in srgb,var(--cyan) 50%,transparent);box-shadow:0 0 10px -4px var(--cyan)}
#toasts{position:fixed;top:14px;right:14px;display:flex;flex-direction:column;gap:8px;z-index:9;pointer-events:none}
.toast{--tc:var(--good);padding:9px 14px;border-radius:10px;font-weight:600;background:color-mix(in srgb,var(--tc) 16%,var(--panel));border:1px solid color-mix(in srgb,var(--tc) 60%,transparent);box-shadow:0 8px 30px -8px var(--tc);animation:tin .5s cubic-bezier(.2,1.4,.4,1) both}
.toast.warn{--tc:var(--warn)}.toast.out{animation:tout .5s ease forwards}
.spark{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;pointer-events:none;box-shadow:0 0 8px currentColor;animation:spark 1.1s cubic-bezier(.1,.8,.3,1) both}
@keyframes spin{to{--a:360deg}}
@keyframes ping{0%{box-shadow:0 0 0 0 var(--sc)}100%{box-shadow:0 0 0 9px transparent}}
@keyframes breathe{50%{box-shadow:0 0 22px -4px var(--warn)}}
@keyframes hot{50%{filter:drop-shadow(0 0 8px var(--bad))}}
@keyframes shine{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes indet{0%{transform:translateX(-110%)}100%{transform:translateX(300%)}}
@keyframes blink{50%{opacity:0}}
@keyframes cur{50%{border-color:color-mix(in srgb,var(--cyan) 35%,transparent)}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes fade{from{opacity:0}}
@keyframes grow{from{transform:scaleX(0)}}
@keyframes rise{from{opacity:0;transform:translateY(12px) scale(.97)}}
@keyframes pop{0%{opacity:0;transform:scale(.8)}}
@keyframes flash{0%{box-shadow:0 0 0 2px var(--cyan),0 0 40px var(--cyan)}100%{box-shadow:0 0 0 0 transparent}}
@keyframes finish{0%{box-shadow:0 0 0 2px var(--good),0 0 50px var(--good);transform:scale(1.04)}100%{box-shadow:0 0 0 0 transparent;transform:none}}
@keyframes shake{20%,60%{transform:translateX(-4px)}40%,80%{transform:translateX(4px)}}
@keyframes spark{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(0);opacity:0}}
@keyframes tin{from{opacity:0;transform:translateX(40px) scale(.9)}}
@keyframes tout{to{opacity:0;transform:translateX(40px)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media (max-width:900px){body{overflow:auto}#app{height:auto;grid-template-rows:auto}.row,.main{grid-template-columns:minmax(0,1fr)}.board{grid-template-columns:repeat(2,minmax(0,1fr))!important}.col{max-height:460px}.kpi.limits{grid-column:auto}}
</style></head><body>
<div id="app">
<div class="kpis">
${kpi('Tokens today', total, fmt(total), `${today.length} sessions`)}
${kpi('Last 14 days', week, fmt(week), `peak ${fmt(Math.max(0, ...days.map(d => d[1])))}/day`, 'k2')}
<div class="kpi limits"><small>Limits</small><div class="gauges">${ring('Session (5h)', 'five_hour', u)}${ring('Weekly', 'seven_day', u)}</div></div>
${kpi('Needs you', count('input'), String(count('input')), 'waiting on input', count('input') ? 'warn on' : 'warn')}
${kpi('Working', count('busy'), String(count('busy')), `${live} agents live · ${count('idle')} idle · ${count('closed')} closed`, 'work')}
${kpi('Design sessions', u.sessions.filter(s => s.art?.design).length, String(u.sessions.filter(s => s.art?.design).length), `${u.sessions.filter(s => s.art?.design && s.status === 'busy').length} working now`, 'design')}
</div>
<div class="row">
<section class="panel"><h2><span>Tokens per day</span><em>in + out + cache writes, 14 days</em></h2>${lineSvg(days).replace('<polygon', '<defs><linearGradient id="lg"><stop offset="0" stop-color="#3987e5"/><stop offset="1" stop-color="#38d6e8"/></linearGradient><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38d6e8" stop-opacity=".35"/><stop offset="1" stop-color="#3987e5" stop-opacity="0"/></linearGradient></defs><polygon')}</section>
<section class="panel" style="--edge:var(--c2)"><h2><span>Models</span><em>share of tokens</em></h2><p class="sub">Today</p>${models(u.models?.today)}<p class="sub">14 days</p>${models(u.models?.days14)}</section>
<section class="panel" style="--edge:var(--c3)"><h2><span>Token split</span><em>today</em></h2>${shareBar([['Input', i, 'var(--c1)'], ['Output', o, 'var(--c2)'], ['Cache write', w, 'var(--c3)']])}<p class="sub">Cache read ${fmt(r)} (not counted above)</p></section>
</div>
<div class="main">
<section class="panel" style="--edge:var(--good)"><h2><span>Sessions</span><em>nearest to done first · size from the estimate log (≈ guessed)</em></h2><div class="board" style="grid-template-columns:${widths}">${cols}</div></section>
<section class="panel" style="--edge:var(--cyan)"><h2><span>Today by session</span><em>${fmt(total)}</em></h2><div class="scroll bars">${
    today
      .map(s => {
        const v = Math.max(1, Math.round((s.tokens / top) * 100))
        return `<div class="bar" title="${esc(name(s))}${s.branch ? ' (' + esc(s.branch) + ')' : ''}: ${fmt(s.tokens)}"><span>${esc(name(s))}</span><em>${fmt(s.tokens)}</em><i data-anim="b-${esc(s.id)}" data-v="${v}" style="--v:${v}"></i></div>`
      })
      .join('') || '<p class="empty">No tokens yet today.</p>'
  }</div></section>
</div>
<footer>Updated ${new Date(u.now).toLocaleTimeString()}</footer>
</div>
<button id="snd" type="button">♪ Sound off</button><div id="toasts"></div>
<script>${CLIENT}</script>
</body></html>`
}
