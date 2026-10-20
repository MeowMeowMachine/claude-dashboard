// A session reports its own progress: node progress.mjs <percent> "<what was just finished>"
// Writes progress/<session id>.json (id from CLAUDE_CODE_SESSION_ID) and re-renders usage.html at once.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pageHtml } from '../hooks/page.ts'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const id = process.env.CLAUDE_CODE_SESSION_ID
const pct = Math.round(Number(process.argv[2]))
if (!id || !/^[\w-]+$/.test(id)) throw new Error('CLAUDE_CODE_SESSION_ID not set: run this from a Claude Code session')
if (!(pct >= 0 && pct <= 100)) throw new Error('usage: node progress.mjs <0-100> "<what was just finished>"')

fs.mkdirSync(path.join(root, 'progress'), { recursive: true })
fs.writeFileSync(path.join(root, 'progress', id + '.json'), JSON.stringify({ pct, note: String(process.argv[3] || '').slice(0, 200), at: Date.now() }))
const data = JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts', 'usage.mjs')], { encoding: 'utf8', maxBuffer: 64 << 20 }))
fs.writeFileSync(path.join(root, 'usage.html'), pageHtml(data))
console.log(`Progress ${pct}% sent to the dashboard`)
