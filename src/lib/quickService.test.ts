import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { Payment, Sale, Settings } from '../db/types'
import { computeTotals } from './totals'
import { finalizeSale, refundSale, voidSale } from './checkout'
import {
  amountNeedingVerify,
  canSendToKitchen,
  isFullyRefunded,
  isOrderLate,
  isPaymentVerified,
  methodsNeedingVerify,
  minutesSinceSent,
  nextStatus,
  openOrders,
  prevStatus,
  remainingItems,
  sendToKitchen,
  setOrderStatus,
  verifyPayment,
} from './quickService'
import { addProduct, cartLine, resetDb } from '../test/helpers'

/* =========================================================
   ด่านตรวจการชำระเงินก่อนเข้าครัว — ผิดแล้วครัวทำอาหารทิ้งจากสลิปปลอม
   กติกา: เงินสด = ตรวจแล้วในตัว · โอน/บัตร = ต้องมีคนกดยืนยันก่อน
   ========================================================= */

let settings: Settings
let productId: number

async function sell(price: number, payments: Payment[]): Promise<Sale> {
  const items = [cartLine(productId, { price, cost: 0 })]
  const totals = computeTotals({
    items,
    promos: [],
    settings,
    billDiscountType: 'amount',
    billDiscountValue: 0,
    redeemPoints: 0,
  })
  return finalizeSale({ items, totals, settings, payments })
}

describe('ด่านตรวจการชำระเงิน', () => {
  beforeEach(async () => {
    settings = await resetDb({ quickServiceEnabled: true, vatRate: 0 })
    productId = await addProduct({ name: 'ข้าวผัด', price: 60, cost: 0, stock: 1000 })
  })

  it('จ่ายเงินสดล้วน: ถือว่าตรวจแล้ว ส่งเข้าครัวได้เลย', async () => {
    const sale = await sell(60, [{ method: 'cash', amount: 100 }])

    expect(methodsNeedingVerify(sale)).toEqual([])
    expect(isPaymentVerified(sale, settings)).toBe(true)
    expect(canSendToKitchen(sale, settings)).toEqual({ ok: true })
  })

  it('จ่ายด้วยการโอน: ส่งเข้าครัวไม่ได้จนกว่าจะมีคนกดยืนยัน', async () => {
    const sale = await sell(60, [{ method: 'transfer', amount: 60 }])

    expect(methodsNeedingVerify(sale)).toEqual(['transfer'])
    expect(amountNeedingVerify(sale)).toBe(60)
    expect(isPaymentVerified(sale, settings)).toBe(false)

    const gate = canSendToKitchen(sale, settings)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.reason).toMatch(/ยังไม่ได้ตรวจการชำระเงิน/)

    // เรียกตรงๆ ก็ต้องถูกปฏิเสธ (กันการข้ามด่านจากที่อื่น)
    await expect(sendToKitchen(sale.id!)).rejects.toThrow(/ยังไม่ได้ตรวจการชำระเงิน/)
    expect((await db.sales.get(sale.id!))?.orderStatus).toBeUndefined()
  })

  it('กดยืนยันแล้วส่งเข้าครัวได้ และบันทึกว่าใครเป็นคนตรวจ', async () => {
    const sale = await sell(60, [{ method: 'transfer', amount: 60 }])
    await verifyPayment(sale.id!, { ref: '4821', actor: { id: 3, name: 'สมหญิง' } })

    const checked = await db.sales.get(sale.id!)
    expect(checked?.paymentVerifiedByName).toBe('สมหญิง')
    expect(checked?.paymentRef).toBe('4821')
    expect(isPaymentVerified(checked!, settings)).toBe(true)

    const sent = await sendToKitchen(sale.id!)
    expect(sent.orderStatus).toBe('new')
    expect(sent.orderSentAt).toBeTypeOf('number')
    // ผู้ตรวจต้องไม่ถูกเขียนทับด้วยคนที่กดส่งเข้าครัว
    expect((await db.sales.get(sale.id!))?.paymentVerifiedByName).toBe('สมหญิง')
  })

  it('จ่ายผสมเงินสด + โอน: ยังต้องตรวจเฉพาะส่วนที่โอน', async () => {
    const sale = await sell(100, [
      { method: 'cash', amount: 50 },
      { method: 'transfer', amount: 50 },
    ])
    expect(methodsNeedingVerify(sale)).toEqual(['transfer'])
    expect(amountNeedingVerify(sale)).toBe(50)
    expect(canSendToKitchen(sale, settings).ok).toBe(false)
  })

  it('ปิดการบังคับตรวจ (requirePaymentVerify = false) → โอนก็ส่งเข้าครัวได้ทันที', async () => {
    settings = await resetDb({ quickServiceEnabled: true, requirePaymentVerify: false, vatRate: 0 })
    productId = await addProduct({ name: 'ข้าวผัด', price: 60, cost: 0, stock: 100 })
    const sale = await sell(60, [{ method: 'transfer', amount: 60 }])

    expect(isPaymentVerified(sale, settings)).toBe(true)
    const sent = await sendToKitchen(sale.id!)
    expect(sent.orderStatus).toBe('new')
    // ไม่มีใครกดตรวจ → บันทึกคนที่กดส่งเข้าครัวเป็นผู้รับผิดชอบแทน
    expect(sent.paymentVerifiedAt).toBeTypeOf('number')
  })

  it('ส่งเข้าครัวซ้ำไม่ได้ และเอกสารคืนสินค้า/บิลที่ยกเลิกส่งไม่ได้', async () => {
    const sale = await sell(60, [{ method: 'cash', amount: 60 }])
    await sendToKitchen(sale.id!)
    await expect(sendToKitchen(sale.id!)).rejects.toThrow(/ส่งเข้าครัวไปแล้ว/)

    const other = await sell(60, [{ method: 'cash', amount: 60 }])
    const refund = await refundSale(other.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'x', payments: [] })
    await expect(sendToKitchen(refund.id!)).rejects.toThrow(/คืนสินค้า/)

    const third = await sell(60, [{ method: 'cash', amount: 60 }])
    await voidSale(third.id!, 'ลูกค้ายกเลิก')
    await expect(sendToKitchen(third.id!)).rejects.toThrow(/ยกเลิก/)
  })
})

describe('วงจรสถานะออเดอร์', () => {
  beforeEach(async () => {
    settings = await resetDb({ quickServiceEnabled: true, vatRate: 0, kitchenAlertMinutes: 10 })
    productId = await addProduct({ name: 'ข้าวผัด', price: 60, cost: 0, stock: 1000 })
  })

  it('เดินหน้าทีละขั้นและจดเวลาไว้ทุกจุด', async () => {
    const sale = await sell(60, [{ method: 'cash', amount: 60 }])
    await sendToKitchen(sale.id!)

    expect(nextStatus('new')).toBe('preparing')
    expect(nextStatus('served')).toBeUndefined()
    expect(prevStatus('new')).toBeUndefined()
    expect(prevStatus('ready')).toBe('preparing')

    await setOrderStatus(sale.id!, 'preparing')
    await setOrderStatus(sale.id!, 'ready')
    await setOrderStatus(sale.id!, 'served')

    const done = await db.sales.get(sale.id!)
    expect(done?.orderStatus).toBe('served')
    expect(done?.orderReadyAt).toBeTypeOf('number')
    expect(done?.orderServedAt).toBeTypeOf('number')
  })

  it('ออเดอร์ที่ยังไม่ได้ส่งเข้าครัว เดินสถานะไม่ได้', async () => {
    const sale = await sell(60, [{ method: 'cash', amount: 60 }])
    await expect(setOrderStatus(sale.id!, 'preparing')).rejects.toThrow(/ยังไม่ได้ส่งเข้าครัว/)
  })

  it('จอครัวเห็นเฉพาะออเดอร์ที่ยังไม่เสิร์ฟ และบิลที่ถูกยกเลิกต้องหายไป', async () => {
    const a = await sell(60, [{ method: 'cash', amount: 60 }])
    const b = await sell(60, [{ method: 'cash', amount: 60 }])
    const c = await sell(60, [{ method: 'cash', amount: 60 }])
    await sendToKitchen(a.id!)
    await sendToKitchen(b.id!)
    await sendToKitchen(c.id!)

    await setOrderStatus(b.id!, 'served') // เสิร์ฟแล้ว → ออกจากจอ
    await voidSale(c.id!, 'ลูกค้ายกเลิก') // ยกเลิกบิล → ต้องหายจากจอด้วย

    const open = await openOrders()
    expect(open.map((s) => s.id)).toEqual([a.id])
  })

  it('คืนสินค้าครบทั้งใบหลังส่งเข้าครัว → ออเดอร์ต้องหายจากจอครัว', async () => {
    const a = await sell(60, [{ method: 'cash', amount: 60 }])
    const b = await sell(60, [{ method: 'cash', amount: 60 }])
    await sendToKitchen(a.id!)
    await sendToKitchen(b.id!)
    expect((await openOrders()).length).toBe(2)

    await refundSale(a.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'ลูกค้ายกเลิก', payments: [] })

    const open = await openOrders()
    expect(open.map((s) => s.id)).toEqual([b.id])
  })

  it('คืนบางส่วน → ยังอยู่บนจอครัว แต่จำนวนที่ต้องทำเหลือเท่าที่ยังไม่คืน', async () => {
    const items = [cartLine(productId, { price: 60, cost: 0, qty: 3 })]
    const totals = computeTotals({
      items,
      promos: [],
      settings,
      billDiscountType: 'amount',
      billDiscountValue: 0,
      redeemPoints: 0,
    })
    const sale = await finalizeSale({
      items,
      totals,
      settings,
      payments: [{ method: 'cash', amount: 180 }],
    })
    await sendToKitchen(sale.id!)
    await refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'ลดจำนวน', payments: [] })

    const open = await openOrders()
    expect(open.map((s) => s.id)).toEqual([sale.id])
    const left = remainingItems(open[0])
    expect(left).toHaveLength(1)
    expect(left[0].qty).toBe(2) // ขาย 3 คืน 1 → ครัวต้องทำ 2
    expect(isFullyRefunded(open[0])).toBe(false)
  })

  it('บิลที่คืนครบแล้ว ส่งเข้าครัวย้อนหลังไม่ได้', async () => {
    const sale = await sell(60, [{ method: 'cash', amount: 60 }])
    await refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'ยกเลิก', payments: [] })

    const fresh = (await db.sales.get(sale.id!))!
    expect(isFullyRefunded(fresh)).toBe(true)
    const gate = canSendToKitchen(fresh, settings)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.reason).toMatch(/คืนสินค้าครบ/)
    await expect(sendToKitchen(sale.id!)).rejects.toThrow(/คืนสินค้าครบ/)
  })

  it('เตือนเมื่อออเดอร์ค้างนานเกินที่ตั้งไว้', async () => {
    const sale = await sell(60, [{ method: 'cash', amount: 60 }])
    const sent = await sendToKitchen(sale.id!)

    const justNow = sent.orderSentAt!
    expect(minutesSinceSent(sent, justNow)).toBe(0)
    expect(isOrderLate(sent, settings, justNow)).toBe(false)

    const elevenMinutesLater = justNow + 11 * 60000
    expect(minutesSinceSent(sent, elevenMinutesLater)).toBe(11)
    expect(isOrderLate(sent, settings, elevenMinutesLater)).toBe(true)

    // ปิดการเตือน (0) แล้วต้องไม่เตือนอีก
    expect(isOrderLate(sent, { ...settings, kitchenAlertMinutes: 0 }, elevenMinutesLater)).toBe(false)
    // ออเดอร์ที่เสิร์ฟแล้วไม่ต้องเตือน
    expect(isOrderLate({ ...sent, orderStatus: 'served' }, settings, elevenMinutesLater)).toBe(false)
  })
})
