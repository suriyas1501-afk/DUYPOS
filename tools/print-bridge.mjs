#!/usr/bin/env node
/* =====================================================================
   สะพานพิมพ์ในวง LAN — ให้มือถือสั่งพิมพ์ใบเสร็จผ่านเครื่องเคาน์เตอร์

   ปัญหาที่แก้: เบราว์เซอร์บน iPhone เปิด TCP socket ดิบไม่ได้ ไม่มี Web Bluetooth
   และหน้าเว็บที่เสิร์ฟผ่าน https เรียก http://<ไอพีในวง LAN> ไม่ได้ (mixed content)
   ⇒ มือถือจึงยิงเข้าเครื่องพิมพ์ความร้อนตรงๆ ไม่ได้เลย ไม่ว่าจะรองรับ AirPrint หรือไม่

   วิธีของไฟล์นี้: ไม่พิมพ์เอง เป็นแค่ "กล่องจดหมาย"
     มือถือ  → POST /bridge/jobs       (ฝากงานพิมพ์)
     เคาน์เตอร์ → GET  /bridge/jobs?wait=1 (รอรับงาน แล้วสั่ง window.print() เอง)
     เคาน์เตอร์ → POST /bridge/jobs/<id>/ack (ยืนยันว่าพิมพ์แล้ว)

   **ตั้งใจไม่ยุ่งกับ ESC/POS** ภาษาไทยยังถูกจัดสระ/วรรณยุกต์โดย Chrome+Windows
   เหมือนเดิมเป๊ะ และใช้กับเครื่องพิมพ์ยี่ห้อไหนก็ได้ที่ Windows มองเห็น

   เสิร์ฟไฟล์ของแอปจาก dist/ ด้วย เพื่อให้มือถือกับสะพานอยู่ origin เดียวกัน
   (ไม่งั้นติดทั้ง CORS และ mixed content)

   รัน:  node tools/print-bridge.mjs            (ต้อง npm run build ก่อน)
         node tools/print-bridge.mjs --port 8080 --root dist
   ===================================================================== */

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize, extname, resolve } from 'node:path'
import { networkInterfaces } from 'node:os'
import { randomUUID } from 'node:crypto'

/* ===== ค่าตั้งต้น ===== */
const args = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}

const PORT = Number(argOf('--port', 8080))
const ROOT = resolve(argOf('--root', 'dist'))

/** งานพิมพ์ที่ค้างได้มากที่สุด — กันคนในวง LAN ยิงจนหน่วยความจำบวม */
const MAX_JOBS = 50
/** ตัวงานพิมพ์ใหญ่สุด (ใบเสร็จจริงราว 2-10KB) */
const MAX_BODY = 256 * 1024
/** เคาน์เตอร์รับงานไปแล้วไม่ยืนยันภายในเวลานี้ ⇒ คืนงานเข้าคิวให้เครื่องอื่นรับแทน */
const LEASE_MS = 45_000
/** งานที่ไม่มีใครมารับเลยภายในเวลานี้ ⇒ ทิ้ง (ใบเสร็จย้อนหลังพิมพ์ซ้ำจากหน้าประวัติการขายได้) */
const JOB_TTL_MS = 10 * 60_000
/** รอสูงสุดต่อการ long-poll หนึ่งครั้ง — สั้นกว่า timeout ของ proxy/เบราว์เซอร์ทั่วไป */
const POLL_MS = 25_000

/* ===== คิวงานพิมพ์ (อยู่ในหน่วยความจำล้วน) =====
   ปิดโปรแกรมแล้วงานที่ค้างหาย ซึ่งยอมรับได้: ใบเสร็จที่ไม่ได้พิมพ์
   กดพิมพ์ซ้ำจากหน้า "ประวัติการขาย" ได้เสมอ และเงินถูกบันทึกไปแล้วตั้งแต่ตอนปิดบิล */
/** @type {{id:string, kind:string, payload:unknown, createdAt:number, leasedAt:number}[]} */
let jobs = []
/** ผู้รอรับงาน (long-poll) ที่ยังไม่ได้ตอบกลับ */
let waiters = []
/** เวลาที่เครื่องพิมพ์มาถามงานครั้งล่าสุด — ใช้บอกมือถือว่าเคาน์เตอร์เปิดอยู่ไหม */
let printerSeenAt = 0

const now = () => Date.now()

function sweep() {
  const t = now()
  jobs = jobs.filter((j) => t - j.createdAt < JOB_TTL_MS)
  for (const j of jobs) if (j.leasedAt && t - j.leasedAt > LEASE_MS) j.leasedAt = 0
}

/** ปลุกคนที่รออยู่ทั้งหมด (มีงานใหม่เข้า) */
function wake() {
  const ws = waiters
  waiters = []
  for (const w of ws) w()
}

/* ===== ตัวช่วยตอบกลับ ===== */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req, res) {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        // ตอบให้อ่านรู้เรื่องก่อนตัดสาย — สายที่ถูกตัดเฉยๆ ฝั่งแอปจะเห็นแค่ "ส่งไม่สำเร็จ"
        // แล้วไล่สาเหตุไม่ได้เลยว่าเพราะข้อมูลใหญ่เกิน
        sendJson(res, 413, { error: 'งานพิมพ์ใหญ่เกินกำหนด' })
        fail(new Error('ข้อมูลใหญ่เกินกำหนด'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')))
    req.on('error', fail)
  })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

/** กันการไต่ออกนอกโฟลเดอร์ dist ด้วย ../ */
function safePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  const full = join(ROOT, clean)
  return full.startsWith(ROOT) ? full : null
}

async function serveStatic(req, res, urlPath) {
  let file = safePath(urlPath === '/' ? '/index.html' : urlPath)
  if (!file) return sendJson(res, 403, { error: 'เส้นทางไม่ถูกต้อง' })

  let info = await stat(file).catch(() => null)
  if (info?.isDirectory()) {
    file = join(file, 'index.html')
    info = await stat(file).catch(() => null)
  }

  // ไม่เจอไฟล์ = เป็นเส้นทางของ SPA (เช่น /pos, /settings) ⇒ ส่ง index.html กลับไป
  if (!info?.isFile()) {
    file = join(ROOT, 'index.html')
    info = await stat(file).catch(() => null)
    if (!info?.isFile()) {
      return sendJson(res, 404, {
        error: `ไม่พบ ${join(ROOT, 'index.html')} — สั่ง "npm run build" ก่อน แล้วค่อยเปิดสะพานพิมพ์`,
      })
    }
  }

  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
  // ไฟล์ที่มีแฮชในชื่ออยู่แล้ว cache ได้ยาว ส่วน index.html / sw.js ห้าม cache
  const hashed = /-[A-Za-z0-9_]{8,}\.(js|css|woff2?)$/.test(file)
  res.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

/* ===== เส้นทางของสะพาน ===== */
async function handleBridge(req, res, url) {
  const path = url.pathname

  if (path === '/bridge/health') {
    sweep()
    return sendJson(res, 200, {
      ok: true,
      // เคาน์เตอร์มาถามงานภายใน 1 นาทีล่าสุด = ถือว่าเครื่องพิมพ์พร้อม
      printerReady: now() - printerSeenAt < 60_000,
      queued: jobs.length,
    })
  }

  /* มือถือฝากงานพิมพ์ */
  if (path === '/bridge/jobs' && req.method === 'POST') {
    let body
    try {
      body = JSON.parse(await readBody(req, res))
    } catch {
      // ตอบ 413 ไปแล้วถ้าตัวใหญ่เกิน — เขียนซ้ำไม่ได้
      if (res.headersSent) return
      return sendJson(res, 400, { error: 'อ่านข้อมูลงานพิมพ์ไม่ได้' })
    }
    if (!body || typeof body.kind !== 'string' || body.payload == null) {
      return sendJson(res, 400, { error: 'รูปแบบงานพิมพ์ไม่ถูกต้อง' })
    }
    sweep()
    if (jobs.length >= MAX_JOBS) {
      return sendJson(res, 429, { error: 'งานพิมพ์ค้างเต็มคิว — ตรวจว่าเครื่องเคาน์เตอร์เปิดอยู่' })
    }
    const job = { id: randomUUID(), kind: body.kind, payload: body.payload, createdAt: now(), leasedAt: 0 }
    jobs.push(job)
    wake()
    return sendJson(res, 200, {
      id: job.id,
      printerReady: now() - printerSeenAt < 60_000,
      queued: jobs.length,
    })
  }

  /* เคาน์เตอร์มารอรับงาน */
  if (path === '/bridge/jobs' && req.method === 'GET') {
    printerSeenAt = now()
    sweep()

    const take = () => {
      const free = jobs.filter((j) => !j.leasedAt)
      for (const j of free) j.leasedAt = now()
      return free.map(({ id, kind, payload, createdAt }) => ({ id, kind, payload, createdAt }))
    }

    const ready = take()
    if (ready.length > 0 || url.searchParams.get('wait') !== '1') {
      return sendJson(res, 200, { jobs: ready })
    }

    // ไม่มีงาน และขอให้รอ ⇒ ค้างสายไว้ ได้งานใหม่เมื่อไหร่ค่อยตอบ (ไม่ต้อง poll ถี่)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      printerSeenAt = now()
      sendJson(res, 200, { jobs: take() })
    }
    const timer = setTimeout(finish, POLL_MS)
    waiters.push(finish)
    res.on('close', () => {
      done = true
      clearTimeout(timer)
      waiters = waiters.filter((w) => w !== finish)
    })
    return
  }

  /* เคาน์เตอร์ยืนยันว่าพิมพ์แล้ว */
  const ack = path.match(/^\/bridge\/jobs\/([A-Za-z0-9-]+)\/ack$/)
  if (ack && req.method === 'POST') {
    printerSeenAt = now()
    const before = jobs.length
    jobs = jobs.filter((j) => j.id !== ack[1])
    return sendJson(res, 200, { removed: before !== jobs.length, queued: jobs.length })
  }

  return sendJson(res, 404, { error: 'ไม่มีเส้นทางนี้' })
}

/* ===== เซิร์ฟเวอร์ ===== */
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/bridge/')) {
    handleBridge(req, res, url).catch((e) => {
      if (res.headersSent) return
      sendJson(res, 500, { error: e instanceof Error ? e.message : 'ผิดพลาดภายใน' })
    })
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'รองรับเฉพาะ GET' })
  }
  serveStatic(req, res, url.pathname).catch(() => sendJson(res, 500, { error: 'อ่านไฟล์ไม่ได้' }))
})

function lanAddresses() {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}

server.listen(PORT, () => {
  const lan = lanAddresses()
  console.log('')
  console.log('  สะพานพิมพ์เปิดแล้ว')
  console.log(`  ไฟล์แอปจาก: ${ROOT}`)
  console.log('')
  console.log('  เครื่องเคาน์เตอร์ (เครื่องที่ต่อเครื่องพิมพ์) เปิด:')
  console.log(`      http://localhost:${PORT}`)
  console.log('')
  if (lan.length > 0) {
    console.log('  มือถือในวง Wi-Fi เดียวกัน เปิด:')
    for (const ip of lan) console.log(`      http://${ip}:${PORT}`)
  } else {
    console.log('  ** ไม่พบไอพีในวง LAN — ต่อ Wi-Fi หรือสายแลนก่อน **')
  }
  console.log('')
  console.log('  ปิดด้วย Ctrl+C')
  console.log('')
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  พอร์ต ${PORT} ถูกใช้อยู่แล้ว — ปิดโปรแกรมที่ใช้พอร์ตนี้ หรือสั่ง --port 8081\n`)
  } else {
    console.error('\n  เปิดสะพานพิมพ์ไม่สำเร็จ:', e.message, '\n')
  }
  process.exit(1)
})
