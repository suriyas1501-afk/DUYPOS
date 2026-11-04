import { db } from '../db/db'
import type { Sale } from '../db/types'

/* =========================================================
   สะพานพิมพ์ในวง LAN — ฝั่งแอป

   ทำไมต้องมี: เบราว์เซอร์บน iPhone เปิด TCP socket ดิบไม่ได้ ไม่มี Web Bluetooth
   และหน้าเว็บที่เสิร์ฟผ่าน https เรียก http://<ไอพีในวง LAN> ไม่ได้ (mixed content)
   ⇒ มือถือยิงเข้าเครื่องพิมพ์ความร้อนตรงๆ ไม่ได้เลย ไม่ว่าเครื่องพิมพ์จะรองรับ AirPrint หรือไม่

   ทางออก: มือถือฝาก "ข้อมูลบิล" ไว้ที่สะพาน (tools/print-bridge.mjs)
   แล้วเครื่องเคาน์เตอร์ที่เปิดแอปค้างไว้มารับไปสั่ง window.print() เอง

   **ส่งข้อมูลบิล ไม่ใช่ HTML โดยเจตนา** — ถ้าส่ง HTML มาวางใน #print-area ตรงๆ
   ใครก็ตามที่อยู่ในวง Wi-Fi จะยิง `<img onerror=...>` เข้ามารันสคริปต์บนหน้าจอ
   ที่ถือข้อมูลทั้งร้านได้ · ส่งเป็นข้อมูลแล้วให้เคาน์เตอร์ประกอบ HTML เองด้วย
   builder ตัวเดิม ซึ่ง esc() ข้อความของผู้ใช้ทุกจุดอยู่แล้ว

   และเคาน์เตอร์ประกอบใบเสร็จด้วย **ค่าตั้งค่าของเครื่องตัวเอง** ไม่ใช่ของมือถือ
   (หัวใบเสร็จ โลโก้ ความกว้างกระดาษ เป็นของเครื่องที่พิมพ์จริง และโลโก้เป็น
   data URL ก้อนใหญ่ที่ไม่ควรวิ่งผ่านเครือข่ายทุกใบ)
   ========================================================= */

export type PrintJobKind = 'receipt' | 'kitchen'

export interface PrintJobPayload {
  sale: Sale
  opts?: { copy?: boolean }
}

export interface PrintJob {
  id: string
  kind: PrintJobKind
  payload: PrintJobPayload
  createdAt: number
}

export interface BridgeHealth {
  /** เคาน์เตอร์มารับงานภายใน 1 นาทีล่าสุดไหม */
  printerReady: boolean
  queued: number
}

/** คีย์ใน appState — ตารางนี้อยู่นอกไฟล์สำรองโดยเจตนา
 *  ถ้าเก็บใน settings แล้วกู้ไฟล์สำรองของเคาน์เตอร์ลงมือถือ มือถือจะนึกว่าตัวเอง
 *  เป็นเครื่องพิมพ์ แล้วทั้งร้านจะไม่มีใครพิมพ์เลย */
const HOST_KEY = 'printBridgeHost'

/** เครื่องนี้ถูกตั้งให้เป็นเครื่องพิมพ์ของร้านหรือไม่ */
export async function isPrintHost(): Promise<boolean> {
  return (await db.appState.get(HOST_KEY))?.value === true
}

export async function setPrintHost(on: boolean): Promise<void> {
  if (on) await db.appState.put({ key: HOST_KEY, value: true })
  else await db.appState.delete(HOST_KEY)
}

/* ===== การคุยกับสะพาน ===== */

/** ยิงคำขอแบบมีเพดานเวลา — สะพานไม่ตอบต้องไม่ค้างหน้าขายไว้ */
async function call(path: string, init?: RequestInit, timeoutMs = 8000): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    return await fetch(path, { ...init, signal: init?.signal ?? ctl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * แอปนี้ถูกเสิร์ฟมาจากสะพานหรือไม่
 *
 * ถามแบบ relative path เสมอ — ถ้าเปิดจาก https://…github.io จะไม่มีเส้นทางนี้
 * และต่อให้เดาไอพีถูกก็เรียกข้าม origin ไม่ได้อยู่ดี (mixed content)
 * คืน null = ไม่มีสะพาน ให้พิมพ์ที่เครื่องตัวเองตามเดิม
 */
export async function probeBridge(): Promise<BridgeHealth | null> {
  try {
    const res = await call('bridge/health', undefined, 3000)
    if (!res.ok) return null
    const j = (await res.json()) as { ok?: boolean; printerReady?: boolean; queued?: number }
    if (!j?.ok) return null
    return { printerReady: !!j.printerReady, queued: Number(j.queued) || 0 }
  } catch {
    return null
  }
}

/** ฝากงานพิมพ์ให้เครื่องเคาน์เตอร์ — คืนสถานะว่าเคาน์เตอร์พร้อมรับไหม */
export async function submitPrintJob(
  kind: PrintJobKind,
  payload: PrintJobPayload,
): Promise<{ id: string; printerReady: boolean }> {
  const res = await call('bridge/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, payload }),
  })
  const j = (await res.json().catch(() => null)) as
    | { id?: string; printerReady?: boolean; error?: string }
    | null
  if (!res.ok || !j?.id) throw new Error(j?.error ?? 'ส่งงานพิมพ์ไม่สำเร็จ')
  return { id: j.id, printerReady: !!j.printerReady }
}

/** รอรับงานพิมพ์ (ค้างสายไว้จนมีงานหรือครบเวลา) — เรียกวนบนเครื่องเคาน์เตอร์ */
export async function waitForPrintJobs(signal: AbortSignal): Promise<PrintJob[]> {
  const res = await call('bridge/jobs?wait=1', { signal }, 40_000)
  if (!res.ok) throw new Error('รับงานพิมพ์ไม่สำเร็จ')
  const j = (await res.json()) as { jobs?: unknown }
  return Array.isArray(j.jobs) ? (j.jobs as PrintJob[]).filter(isUsableJob) : []
}

export async function ackPrintJob(id: string): Promise<void> {
  await call(`bridge/jobs/${encodeURIComponent(id)}/ack`, { method: 'POST' }).catch(() => {})
}

/**
 * งานที่รับมาพอจะพิมพ์ได้จริงไหม
 *
 * สะพานไม่มีรหัสผ่าน ใครอยู่ในวง Wi-Fi ก็ยิงเข้ามาได้ · ตัว builder esc() ข้อความ
 * อยู่แล้วจึงไม่มีช่องรันสคริปต์ แต่ยังควรกันของที่ประกอบไม่ได้ ไม่ให้ไปพังตอน render
 * แล้วทำให้ลูปรับงานของเคาน์เตอร์ตายทั้งตัว
 */
export function isUsableJob(job: unknown): job is PrintJob {
  if (!job || typeof job !== 'object') return false
  const j = job as Partial<PrintJob>
  if (typeof j.id !== 'string' || !j.id) return false
  if (j.kind !== 'receipt' && j.kind !== 'kitchen') return false
  const sale = j.payload?.sale as Partial<Sale> | undefined
  if (!sale || typeof sale !== 'object') return false
  if (typeof sale.receiptNo !== 'string' || !sale.receiptNo) return false
  if (!Array.isArray(sale.items) || sale.items.length === 0) return false
  if (!Number.isFinite(sale.total)) return false
  return true
}
