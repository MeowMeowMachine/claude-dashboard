// Ends the given Claude sessions by id: kills each session's process tree.
// Skips sessions that are busy, the caller's own, and any whose pid now belongs to another process
// (procStart in the session file must equal the process's start time).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const [own, ...ids] = process.argv.slice(2)
const sdir = path.join(os.homedir(), '.claude', 'sessions')
let closed = 0
for (const n of fs.readdirSync(sdir)) {
  if (!n.endsWith('.json')) continue
  let s
  try { s = JSON.parse(fs.readFileSync(path.join(sdir, n), 'utf8')) } catch { continue }
  if (!ids.includes(s.sessionId) || s.sessionId === own || s.status === 'busy') continue
  try {
    const start = execFileSync('powershell', ['-NoProfile', '-c', `(Get-Process -Id ${Number(s.pid)}).StartTime.ToFileTimeUtc()`], { encoding: 'utf8' }).trim()
    if (start !== String(s.procStart)) continue
    execFileSync('taskkill', ['/PID', String(s.pid), '/T', '/F'], { stdio: 'ignore' })
    closed++
  } catch {}
}
console.log(closed)
