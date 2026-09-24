import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { Settings } from '../db/types'
import { computeTotals } from './totals'
import { finalizeSale, refundSale, voidSale } from './checkout'
import {
  addCashMove,
  closeShift,
  computeShiftSummary,
  countTotal,
  loadShiftDocs,
  openShift,
} from './shift'
import { addProduct, cartLine, resetDb } from '../test/helpers'

/* =========================================================
   เงินในลิ้นชักต้องตรงกับความจริงเสมอ — ตรึงทุกเคสที่เคยสงสัยไว้ที่นี่
   สูตร: ควรมี = เงินทอนตั้งต้น + ขายเงินสด − รายจ่ายเงินสด + นำเข้า − นำออก
   ========================================================= */

let settings: Settings
let productId: number

const totalsOf = (items: ReturnType<typeof cartLine>[]) =>
  computeTotals({
    items,
    promos: [],
    settings,
    billDiscountType: 'amount',
    billDiscountValue: 0,
    redeemPoints: 0,
  })

/** ขาย 1 บิลด้วยช่องทางที่กำหนด */
async function sell(price: number, payments: { method: 'cash' | 'transfer' | 'card'; amount: number }[]) {
  const items = [cartLine(productId, { price, cost: 0 })]
  return finalizeSale({ items, totals: totalsOf(items), settings, payments })
}

/**
 * คำนวณสรุปกะจากข้อมูลสดในฐานข้อมูล
 *
 * **ต้องดึงเอกสารด้วย loadShiftDocs() เหมือนโค้ดจริง** — เคยใช้ db.sales.toArray()
 * ทั้งตาราง ซึ่งทำให้เทสต์ผ่านทั้งที่โค้ดจริงพัง (บิลที่ openShift ดูดเข้ากะหลุด
 * จาก query ช่วงเวลา) เทสต์ที่ป้อนข้อมูลคนละทางกับของจริงคือเทสต์ที่โกหก
 */
async function summaryOf(shiftId: number, counted = 0) {
  const shift = await db.shifts.get(shiftId)
  const { sales, expenses } = await loadShiftDocs(shift!)
  return computeShiftSummary(shift!, sales, expenses, counted)
}

describe('computeShiftSummary — เงินสดที่ควรมีในลิ้นชัก', () => {
  beforeEach(async () => {
    settings = await resetDb({ shiftEnabled: true, vatRate: 0 })
    productId = await addProduct({ name: 'สินค้า', price: 100, cost: 0, stock: 1000 })
  })

  it('เงินทอนตั้งต้นอย่างเดียว', async () => {
    const shift = await openShift({ openingCash: 1000 })
    const s = await summaryOf(shift.id!)
    expect(s.expectedCash).toBe(1000)
    expect(s.billCount).toBe(0)
  })

  it('บิลเงินสด ฿100 รับมา ฿120 ทอน ฿20 → เพิ่มเฉพาะ ฿100', async () => {
    const shift = await openShift({ openingCash: 500 })
    await sell(100, [{ method: 'cash', amount: 120 }])
    const s = await summaryOf(shift.id!)
    expect(s.byMethod.cash).toBe(100)
    expect(s.expectedCash).toBe(600)
  })

  it('จ่ายผสม เงินสด ฿50 + โอน ฿37.75 → ลิ้นชักเพิ่มเฉพาะ ฿50', async () => {
    const shift = await openShift({ openingCash: 0 })
    await sell(87.75, [
      { method: 'cash', amount: 50 },
      { method: 'transfer', amount: 37.75 },
    ])
    const s = await summaryOf(shift.id!)
    expect(s.byMethod.cash).toBe(50)
    expect(s.byMethod.transfer).toBe(37.75)
    expect(s.expectedCash).toBe(50)
  })

  it('จ่ายผสมที่มีเงินทอน: เงินสด ฿100 + โอน ฿50 บิล ฿120 ทอน ฿30 → เงินสดสุทธิ ฿70', async () => {
    const shift = await openShift({ openingCash: 0 })
    await sell(120, [
      { method: 'cash', amount: 100 },
      { method: 'transfer', amount: 50 },
    ])
    const s = await summaryOf(shift.id!)
    expect(s.byMethod.cash).toBe(70)
    expect(s.byMethod.transfer).toBe(50)
    expect(s.expectedCash).toBe(70)
  })

  it('คืนสินค้าเป็นเงินสด → หักออกจากลิ้นชัก', async () => {
    const shift = await openShift({ openingCash: 1000 })
    const sale = await sell(100, [{ method: 'cash', amount: 100 }])
    await refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], {
      reason: 'คืน',
      payments: [{ method: 'cash', amount: 100 }],
    })
    const s = await summaryOf(shift.id!)
    expect(s.refundCount).toBe(1)
    expect(s.refundTotal).toBe(100)
    expect(s.byMethod.cash).toBe(0) // ขาย +100 คืน −100
    expect(s.expectedCash).toBe(1000)
    expect(s.billCount).toBe(1) // เอกสารคืนไม่นับเป็นบิลขาย
  })

  it('ยกเลิกบิลที่รับเงินสดมาแล้ว (ในกะเดียวกัน) → เงินออกจากลิ้นชักด้วย', async () => {
    const shift = await openShift({ openingCash: 1000 })
    const sale = await sell(100, [{ method: 'cash', amount: 100 }])
    expect((await summaryOf(shift.id!)).expectedCash).toBe(1100)

    await voidSale(sale.id!, 'ลูกค้าเปลี่ยนใจ')

    const s = await summaryOf(shift.id!)
    expect(s.voidedCount).toBe(1)
    expect(s.billCount).toBe(0)
    expect(s.byMethod.cash).toBe(0)
    expect(s.expectedCash).toBe(1000) // เงินคืนลูกค้าไปแล้ว ลิ้นชักกลับมาเท่าตั้งต้น
  })

  it('รายจ่ายเงินสดหักออก แต่รายจ่ายโอน/บัตรไม่หัก', async () => {
    const shift = await openShift({ openingCash: 1000 })
    await db.expenses.add({
      date: Date.now(),
      category: 'ค่าน้ำ / ค่าไฟ / เน็ต',
      description: 'ค่าไฟ',
      amount: 300,
      hasVatInvoice: false,
      vatAmount: 0,
      paymentMethod: 'cash',
      shiftId: shift.id,
      createdAt: Date.now(),
    })
    await db.expenses.add({
      date: Date.now(),
      category: 'ค่าเช่า',
      description: 'ค่าเช่าร้าน',
      amount: 5000,
      hasVatInvoice: false,
      vatAmount: 0,
      paymentMethod: 'transfer',
      shiftId: shift.id,
      createdAt: Date.now(),
    })
    const s = await summaryOf(shift.id!)
    expect(s.expenseCash).toBe(300)
    expect(s.expectedCash).toBe(700)
  })

  it('นำเงินเข้า/ออกลิ้นชัก และห้ามนำออกเกินเงินที่มี', async () => {
    const shift = await openShift({ openingCash: 500 })
    await addCashMove(shift.id!, { type: 'in', amount: 200, reason: 'เติมเงินทอน' })
    await addCashMove(shift.id!, { type: 'out', amount: 100, reason: 'ฝากธนาคาร' })

    const s = await summaryOf(shift.id!)
    expect(s.cashIn).toBe(200)
    expect(s.cashOut).toBe(100)
    expect(s.expectedCash).toBe(600)

    await expect(
      addCashMove(shift.id!, { type: 'out', amount: 9999, reason: 'เกิน' }),
    ).rejects.toThrow(/เกินเงินสด/)
  })
})

describe('openShift / closeShift', () => {
  beforeEach(async () => {
    settings = await resetDb({ shiftEnabled: true, vatRate: 0 })
    productId = await addProduct({ name: 'สินค้า', price: 100, cost: 0, stock: 1000 })
  })

  it('เปิดกะซ้อนไม่ได้', async () => {
    await openShift({ openingCash: 0 })
    await expect(openShift({ openingCash: 0 })).rejects.toThrow(/เปิดอยู่/)
  })

  it('บิลที่ขายตอนยังไม่เปิดกะ ถูกดูดเข้ากะใหม่ (เงินอยู่ในลิ้นชักจริง)', async () => {
    const sale = await sell(100, [{ method: 'cash', amount: 100 }])
    expect(sale.shiftId).toBeUndefined()

    const shift = await openShift({ openingCash: 0 })
    const adopted = await db.sales.get(sale.id!)
    expect(adopted?.shiftId).toBe(shift.id)

    const s = await summaryOf(shift.id!)
    expect(s.expectedCash).toBe(100)
  })

  it('ปิดกะคำนวณสรุปใหม่จากฐานข้อมูล ไม่เชื่อยอดที่ส่งมาจากหน้าจอ', async () => {
    const shift = await openShift({ openingCash: 1000 })
    await sell(250, [{ method: 'cash', amount: 250 }])

    // นับได้ 1,245 (ขาดไป 5 บาท)
    const closed = await closeShift(shift.id!, { countedCash: 1245, note: 'ทอนผิด' })

    expect(closed.status).toBe('closed')
    expect(closed.summary?.expectedCash).toBe(1250)
    expect(closed.summary?.countedCash).toBe(1245)
    expect(closed.summary?.diff).toBe(-5)
    expect(closed.summary?.billCount).toBe(1)

    await expect(closeShift(shift.id!, { countedCash: 0 })).rejects.toThrow(/ปิดแล้ว/)
  })

  it('ใบนับเงินรวมยอดถูกต้องรวมเหรียญสตางค์', async () => {
    expect(countTotal([{ denom: 1000, count: 1 }, { denom: 100, count: 2 }])).toBe(1200)
    expect(countTotal([{ denom: 0.5, count: 3 }, { denom: 0.25, count: 2 }])).toBe(2)
    expect(countTotal([])).toBe(0)
    expect(countTotal(undefined)).toBe(0)
  })
})

/* =========================================================
   บิลที่ขายตอนลืมเปิดกะ — openShift() ดูดเข้ากะให้แล้ว
   เงินอยู่ในลิ้นชักจริง จึงต้องถูกนับตอนปิดกะด้วย

   เคยพัง: ทุกจุดดึงบิลด้วย createdAt ตั้งแต่ openedAt เป็นต้นไป
   แต่บิลที่ถูกดูดมามี createdAt *ก่อน* openedAt จึงหลุดทุกใบ
   → ปิดกะแล้วขึ้นว่า "เงินเกิน" และ billCount/ยอดขายของกะหายไปด้วย
   ========================================================= */

describe('บิลที่ถูกดูดเข้ากะ ต้องถูกนับตอนปิดกะ', () => {
  beforeEach(async () => {
    settings = await resetDb({ shiftEnabled: true, vatRate: 0 })
    productId = await addProduct({ name: 'สินค้า', price: 100, cost: 0, stock: 1000 })
  })

  /** ขายก่อนเปิดกะ: ขายปกติแล้วย้อน createdAt ให้อยู่ก่อนเวลาเปิดกะ */
  async function sellBeforeShift(price: number, minutesAgo: number) {
    const sale = await sell(price, [{ method: 'cash', amount: price }])
    await db.sales.update(sale.id!, { createdAt: Date.now() - minutesAgo * 60000 })
    return sale
  }

  it('ขายเงินสดตอนลืมเปิดกะ → เปิดกะ → ปิดกะ: เงินต้องตรง ไม่ใช่ "เกิน"', async () => {
    const sale = await sellBeforeShift(100, 30)
    const shift = await openShift({ openingCash: 0 })

    expect((await db.sales.get(sale.id!))?.shiftId).toBe(shift.id)

    const s = await summaryOf(shift.id!, 100)
    expect(s.billCount).toBe(1)
    expect(s.byMethod.cash).toBe(100)
    expect(s.expectedCash).toBe(100)
    expect(s.diff).toBe(0) // เคยได้ 100 = "เงินเกิน" ทั้งที่ทุกอย่างถูกต้อง
  })

  it('ยอดที่ closeShift บันทึกลงฐานข้อมูลต้องรวมบิลที่ถูกดูดมาด้วย', async () => {
    await sellBeforeShift(100, 30)
    const shift = await openShift({ openingCash: 0 })
    const closed = await closeShift(shift.id!, { countedCash: 100 })

    expect(closed.summary?.billCount).toBe(1)
    expect(closed.summary?.byMethod.cash).toBe(100)
    expect(closed.summary?.expectedCash).toBe(100)
    expect(closed.summary?.diff).toBe(0)
  })

  it('นำเงินออกจากลิ้นชักได้ตามเงินที่มีจริง รวมบิลที่ถูกดูดมา', async () => {
    await sellBeforeShift(100, 30)
    const shift = await openShift({ openingCash: 0 })

    // เคยพัง: ระบบคิดว่าลิ้นชักมี ฿0 จึงบล็อกการนำเงินออกที่ถูกต้อง
    await addCashMove(shift.id!, { type: 'out', amount: 100, reason: 'ฝากธนาคาร' })

    const s = await summaryOf(shift.id!, 0)
    expect(s.cashOut).toBe(100)
    expect(s.expectedCash).toBe(0)
    expect(s.diff).toBe(0)
  })

  it('ไม่ดูดบิลของกะก่อนหน้าที่ปิดไปแล้ว', async () => {
    const first = await openShift({ openingCash: 0 })
    await sell(100, [{ method: 'cash', amount: 100 }])
    await closeShift(first.id!, { countedCash: 100 })

    const second = await openShift({ openingCash: 0 })
    const s = await summaryOf(second.id!, 0)
    expect(s.billCount).toBe(0)
    expect(s.expectedCash).toBe(0)
  })
})
