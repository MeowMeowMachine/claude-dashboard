// Serves usage.html on http://127.0.0.1:8765/ so Claude's in-app browser pane (and any browser) can show it live.
// Only that one file, only on loopback. A second copy exits quietly when the port is taken.
// Each request re-renders the page from fresh transcript data (~0.25 s), so the 5 s page reload shows live numbers.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pageHtml } from '../hooks/page.ts'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const page = path.join(root, 'usage.html')

const render = () =>
  new Promise(done =>
    execFile(process.execPath, [path.join(root, 'scripts', 'usage.mjs')], { maxBuffer: 64 << 20, timeout: 30000 }, (err, out) => {
      try {
        if (!err) fs.writeFileSync(page, pageHtml(JSON.parse(out)))
      } catch {}
      done()
    })
  )

http
  .createServer(async (req, res) => {
    if (!['/', '/usage.html'].includes(req.url.split('?')[0])) return res.writeHead(404).end()
    await render() // on failure the last written page is served
    fs.readFile(page, (err, body) => {
      if (err) return res.writeHead(503, { 'content-type': 'text/plain' }).end('No data yet: start a Claude session.')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body)
    })
  })
  .on('error', e => process.exit(e.code === 'EADDRINUSE' ? 0 : 1))
  .listen(8765, '127.0.0.1')
