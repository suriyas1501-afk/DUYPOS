import { db } from '../db/db'
import type { SlipQueueItem } from '../db/types'

/* =========================================================
   รูปสลิปโอนเงิน — ย่อ เก็บ และล้างของเก่า

   **ห้ามใช้ resizeImage() จาก src/lib/image.ts** ตัวนั้นครอปกลางเป็นจัตุรัส 256px
   (image.ts:11-15) สลิปแนวตั้งจะถูกตัดหัว-ท้ายรวมเลขอ้างอิงที่เป็นสาระทั้งหมด
   และห้ามแก้ตัวนั้นด้วย เพราะรูปสินค้ากับโลโก้ร้านต้องการจัตุรัสจริง

   ขนาดที่ตั้งไว้ (1024px / ~180KB) มาจากโควตาที่คุยกันไว้ใน TABLE-ORDER-PLAN.md §11:
   ร้านนี้ไม่เกิน 50 บิล/วัน × 90 วัน = 4,500 รูป ที่ 180KB ≈ 800MB
   อยู่ในโควตาฟรีของที่เก็บบนคลาวด์ (1GB) พอดี ถ้าปล่อยให้ใหญ่กว่านี้จะเกิน
   ========================================================= */

/** ความกว้าง/สูงด้านยาวสุดของรูปสลิป — พออ่านเลขอ้างอิงออก */
export const SLIP_MAX_EDGE = 1024

/** เพดานขนาดไฟล์ต่อรูป (ไบต์) */
export const SLIP_MAX_BYTES = 180 * 1024

/**
 * เพดานจำนวนพิกเซลของ canvas บน iOS (4096×4096)
 *
 * เกินกว่านี้ Safari จะคืน canvas เปล่าหรือ toBlob คืนค่าว่าง **แบบไม่โยน error**
 * รูปจาก iPhone รุ่นใหม่ใหญ่กว่านี้ทุกใบ จึงต้องย่อก่อนวาดลง canvas เสมอ
 */
export const IOS_MAX_CANVAS_PIXELS = 16_777_216

/** จำนวนรูปสลิปที่เก็บไว้ในเครื่องได้มากสุด (กันพื้นที่เครื่องเต็มช่วงที่ยังไม่มีคลาวด์) */
export const SLIP_LOCAL_MAX = 300

export interface FitResult {
  width: number
  height: number
}

/**
 * คำนวณขนาดหลังย่อ — **ฟังก์ชันบริสุทธิ์ ทดสอบได้ ไม่ต้องมี canvas**
 *
 * ย่อให้ด้านยาวสุดไม่เกิน maxEdge ก่อน แล้วถ้ายังเกินเพดานพิกเซลของ canvas
 * ย่อลงอีกตามอัตราส่วนเดิม · ผลลัพธ์ต่ำสุดคือ 1×1 (ห้ามคืน 0 เพราะ canvas ขนาด 0 วาดไม่ได้)
 */
export function fitDimensions(
  srcW: number,
  srcH: number,
  maxEdge = SLIP_MAX_EDGE,
  maxPixels = IOS_MAX_CANVAS_PIXELS,
): FitResult {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return { width: 1, height: 1 }
  }
  let scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
  if (srcW * srcH * scale * scale > maxPixels) {
    scale = Math.sqrt(maxPixels / (srcW * srcH))
  }
  return {
    width: Math.max(1, Math.floor(srcW * scale)),
    height: Math.max(1, Math.floor(srcH * scale)),
  }
}

/** คุณภาพ JPEG ที่ไล่ลองลงมาจนได้ไฟล์ไม่เกินเพดาน */
const QUALITY_STEPS = [0.7, 0.55, 0.45, 0.35] as const

/** โหลดรูปเป็น bitmap พร้อมหมุนตาม EXIF ให้ถูกทาง */
async function loadBitmap(file: File): Promise<{ width: number; height: number; draw: CanvasImageSource }> {
  // createImageBitmap + imageOrientation จัดการ EXIF ให้เอง (Safari iOS 16+)
  // ถ้าไม่มีให้ถอยไปใช้ <img> ซึ่ง Safari ก็หมุนตาม EXIF ให้อยู่แล้ว
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { width: bmp.width, height: bmp.height, draw: bmp }
    } catch {
      /* ถอยไปทาง <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'))
      el.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight, draw: img }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface ResizedPhoto {
  blob: Blob
  width: number
  height: number
}

/**
 * ย่อรูปสลิปเป็น JPEG — คืนค่าเป็น **Blob ไม่ใช่ data URL**
 *
 * data URL บวมขึ้น ~33% จาก base64 ซึ่งทั้งกินโควตาและทำให้ไฟล์สำรองพัง
 * ถ้าเผลอเก็บลงตาราง sales (ดูคอมเมนต์เหนือ TABLES ใน src/lib/backup.ts)
 */
export async function resizePhoto(
  file: File,
  opts: { maxEdge?: number; maxBytes?: number } = {},
): Promise<ResizedPhoto> {
  const maxEdge = opts.maxEdge ?? SLIP_MAX_EDGE
  const maxBytes = opts.maxBytes ?? SLIP_MAX_BYTES

  const src = await loadBitmap(file)
  const { width, height } = fitDimensions(src.width, src.height, maxEdge)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เครื่องนี้ย่อรูปไม่ได้ (ไม่มี canvas)')
  // สลิปมีพื้นขาวเยอะ — เติมพื้นขาวไว้ก่อนกัน PNG โปร่งใสกลายเป็นพื้นดำตอนแปลงเป็น JPEG
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(src.draw, 0, 0, width, height)

  let out: Blob | null = null
  for (const q of QUALITY_STEPS) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', q),
    )
    // Safari คืน null/ขนาด 0 แบบเงียบเมื่อ canvas ใหญ่เกิน — ต้องเช็คทุกครั้ง
    if (blob && blob.size > 0) {
      out = blob
      if (blob.size <= maxBytes) break
    }
  }

  // คืนหน่วยความจำของ canvas บน iOS (ตั้งขนาดเป็น 0 คือวิธีที่ได้ผลจริง)
  canvas.width = 0
  canvas.height = 0
  if ('close' in src.draw && typeof src.draw.close === 'function') src.draw.close()

  if (!out) throw new Error('ย่อรูปไม่สำเร็จ ลองถ่ายใหม่อีกครั้ง')
  return { blob: out, width, height }
}

/** สร้างรหัสรูปสลิป — ต้องไม่ซ้ำข้ามเครื่อง เพราะจะเป็นชื่อไฟล์บนคลาวด์ */
export function newSlipId(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return `s-${c.randomUUID()}`
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
  return `s-${Date.now().toString(36)}-${rand}`
}

/**
 * เก็บรูปสลิปลงคิวรอส่งขึ้นคลาวด์
 *
 * ยังไม่มีตัวส่งขึ้นคลาวด์ในเฟสนี้ — แถวจะค้างสถานะ 'pending' ไว้ก่อน
 * เลขโต๊ะกับยอดเงินติดไปกับรูปด้วย เพื่อให้ตามได้ว่ารับเงินโต๊ะไหนไปเท่าไร
 * แม้ใบสั่งจะหาย (เป็นร่องรอยอิสระตาม TABLE-ORDER-PLAN.md §17 ข้อ 3)
 */
export async function saveSlip(input: {
  blob: Blob
  tableLabel?: string
  amount?: number
}): Promise<string> {
  const slipId = newSlipId()
  const row: SlipQueueItem = {
    slipId,
    blob: input.blob,
    state: 'pending',
    attempts: 0,
    tableLabel: input.tableLabel,
    amount: input.amount,
    createdAt: Date.now(),
  }
  await db.slipQueue.put(row)
  return slipId
}

export const loadSlip = (slipId: string) => db.slipQueue.get(slipId)

export async function deleteSlip(slipId: string): Promise<void> {
  await db.slipQueue.delete(slipId)
}

/**
 * ล้างรูปเก่าออกจากเครื่อง
 *
 * ช่วงที่ยังไม่มีตัวส่งขึ้นคลาวด์ รูปจะกองอยู่ในเครื่องไปเรื่อยๆ
 * โทรศัพท์พื้นที่เต็มคือสิ่งที่ทำให้ระบบเก็บดราฟต์พัง (ดู draftPersistence)
 * จึงต้องมีเพดานทั้งตามอายุและตามจำนวน
 */
export async function pruneSlipQueue(keepDays = 90, maxRows = SLIP_LOCAL_MAX): Promise<number> {
  const days = Number.isFinite(keepDays) && keepDays > 0 ? Math.floor(keepDays) : 90
  const cutoff = Date.now() - days * 86_400_000
  let removed = 0

  const old = await db.slipQueue.where('createdAt').below(cutoff).primaryKeys()
  if (old.length > 0) {
    await db.slipQueue.bulkDelete(old)
    removed += old.length
  }

  const total = await db.slipQueue.count()
  if (total > maxRows) {
    // ลบของเก่าสุดก่อน (createdAt เป็น index อยู่แล้วใน schema v7)
    const extra = await db.slipQueue
      .orderBy('createdAt')
      .limit(total - maxRows)
      .primaryKeys()
    if (extra.length > 0) {
      await db.slipQueue.bulkDelete(extra)
      removed += extra.length
    }
  }
  return removed
}
