import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import {
  IOS_MAX_CANVAS_PIXELS,
  SLIP_MAX_EDGE,
  fitDimensions,
  newSlipId,
  pruneSlipQueue,
  saveSlip,
} from './slipPhoto'
import { resetDb } from '../test/helpers'

/* =========================================================
   รูปสลิป — ส่วนที่ทดสอบได้โดยไม่ต้องมี canvas

   fitDimensions คือจุดที่พลาดแล้ว Safari จะคืนรูปเปล่า **แบบไม่โยน error**
   (เกินเพดานพิกเซลของ canvas) ซึ่งแปลว่าหลักฐานการจ่ายเงินหายเงียบ
   ========================================================= */

describe('fitDimensions — ย่อขนาดก่อนวาดลง canvas', () => {
  it('รูปเล็กกว่าเพดานอยู่แล้ว ไม่ขยายขึ้น', () => {
    expect(fitDimensions(400, 300)).toEqual({ width: 400, height: 300 })
  })

  it('ย่อให้ด้านยาวสุดเท่าเพดาน และคงอัตราส่วน', () => {
    // สลิปแนวตั้งจากมือถือ 3024x4032 (4:3) → ด้านยาว 1024
    const r = fitDimensions(3024, 4032)
    expect(r.height).toBe(SLIP_MAX_EDGE)
    expect(r.width).toBe(Math.floor(3024 * (SLIP_MAX_EDGE / 4032)))
    expect(Math.abs(r.width / r.height - 3024 / 4032)).toBeLessThan(0.01)
  })

  it('รูปแนวนอนย่อตามด้านกว้าง', () => {
    const r = fitDimensions(4032, 3024)
    expect(r.width).toBe(SLIP_MAX_EDGE)
  })

  it('ไม่เกินเพดานพิกเซลของ canvas บน iOS เด็ดขาด', () => {
    // ภาพพาโนรามาสุดโต่ง — ด้านยาวไม่เกิน 1024 แล้วก็จริง แต่ต้องไม่ทะลุเพดานพิกเซล
    const r = fitDimensions(100000, 100000, 1_000_000, IOS_MAX_CANVAS_PIXELS)
    expect(r.width * r.height).toBeLessThanOrEqual(IOS_MAX_CANVAS_PIXELS)
  })

  it('ค่าเพี้ยน (0 / ติดลบ / NaN) ต้องไม่ได้ขนาด 0 เพราะ canvas ขนาด 0 วาดไม่ได้', () => {
    expect(fitDimensions(0, 100)).toEqual({ width: 1, height: 1 })
    expect(fitDimensions(-5, 10)).toEqual({ width: 1, height: 1 })
    expect(fitDimensions(Number.NaN, 10)).toEqual({ width: 1, height: 1 })
  })

  it('รูปผอมมากต้องไม่ได้ด้านสั้นเป็น 0', () => {
    const r = fitDimensions(5000, 2)
    expect(r.width).toBe(SLIP_MAX_EDGE)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })
})

describe('newSlipId', () => {
  it('ไม่ซ้ำกันใน 500 ครั้ง', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSlipId()))
    expect(ids.size).toBe(500)
  })

  it('ขึ้นต้นด้วย s- เพื่อให้แยกจาก ticketUid ได้', () => {
    expect(newSlipId().startsWith('s-')).toBe(true)
  })
})

describe('pruneSlipQueue — กันรูปกองจนพื้นที่เครื่องเต็ม', () => {
  beforeEach(async () => {
    await resetDb()
    await db.slipQueue.clear()
  })

  const blob = () => new Blob(['x'], { type: 'image/jpeg' })

  /** ใส่รูปพร้อมกำหนดอายุย้อนหลังเป็นวัน */
  async function addSlip(daysAgo: number) {
    const id = await saveSlip({ blob: blob(), tableLabel: '5', amount: 100 })
    await db.slipQueue.update(id, { createdAt: Date.now() - daysAgo * 86_400_000 })
    return id
  }

  it('ลบรูปที่เก่ากว่าจำนวนวันที่ตั้งไว้ เก็บของใหม่ไว้', async () => {
    const old = await addSlip(100)
    const fresh = await addSlip(1)

    const removed = await pruneSlipQueue(90)

    expect(removed).toBe(1)
    expect(await db.slipQueue.get(old)).toBeUndefined()
    expect(await db.slipQueue.get(fresh)).toBeDefined()
  })

  it('เกินจำนวนที่เก็บได้ → ลบของเก่าสุดก่อน', async () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await addSlip(5 - i)) // ids[0] เก่าสุด

    await pruneSlipQueue(90, 3)

    expect(await db.slipQueue.count()).toBe(3)
    expect(await db.slipQueue.get(ids[0])).toBeUndefined()
    expect(await db.slipQueue.get(ids[1])).toBeUndefined()
    expect(await db.slipQueue.get(ids[4])).toBeDefined()
  })

  it('ค่าวันเพี้ยน (0 / ติดลบ) ต้องไม่กวาดรูปของวันนี้ทิ้ง', async () => {
    const today = await addSlip(0)
    await pruneSlipQueue(0)
    expect(await db.slipQueue.get(today)).toBeDefined()
    await pruneSlipQueue(-10)
    expect(await db.slipQueue.get(today)).toBeDefined()
  })

  it('เก็บเลขโต๊ะและยอดเงินไปกับรูป เพื่อตามได้แม้ใบสั่งหาย', async () => {
    const id = await saveSlip({ blob: blob(), tableLabel: '12', amount: 235.5 })
    const row = await db.slipQueue.get(id)
    expect(row?.tableLabel).toBe('12')
    expect(row?.amount).toBe(235.5)
    expect(row?.state).toBe('pending')
    expect(row?.attempts).toBe(0)
  })
})
