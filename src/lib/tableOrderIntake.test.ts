import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { Promotion, Settings } from '../db/types'
import { TICKET_SCHEMA_VERSION, receiveTicket, type TableOrderTicket } from './tableOrderIntake'
import { openShift } from './shift'
import { setActor } from './actor'
import { addProduct, cartLine, resetDb, stockOf } from '../test/helpers'

/* =========================================================
   เครื่องกลางรับใบสั่งจากมือถือ (ขั้นที่ 5-6)

   จุดที่พลาดแล้วเสียหายที่สุด: **กดส่งซ้ำแล้วได้บิล 2 ใบ**
   = กินเลขบิล 2 เลข ตัดสต็อก 2 รอบ และรายงานบอกว่าเก็บเงินลูกค้า 2 เท่า
   เน็ตช้าแล้วพนักงานกดใหม่เป็นเรื่องที่เกิดทุกวัน ไม่ใช่กรณีขอบ
   ========================================================= */

let settings: Settings
let productId: number

/** พนักงานที่โต๊ะ — ต้องไม่ถูกแทนด้วยคนที่ล็อกอินอยู่ที่เครื่องกลาง */
const WAITER = { id: 42, name: 'สมศรี (เสิร์ฟ)' }

const noPromos: Promotion[] = []

function ticket(over: Partial<TableOrderTicket> = {}): TableOrderTicket {
  const items = over.items ?? [cartLine(productId, { price: 60, cost: 0 })]
  const paid = over.paidAmount ?? 60
  return {
    ticketUid: 't-test-1',
    schemaVersion: TICKET_SCHEMA_VERSION,
    tableLabel: '5',
    items,
    payments: [{ method: 'transfer', amount: paid }],
    paidAmount: paid,
    actor: WAITER,
    verifiedAt: Date.now(),
    slipId: 's-slip-1',
    ...over,
  }
}

beforeEach(async () => {
  settings = await resetDb({ tableOrderEnabled: true, vatRate: 0 })
  productId = await addProduct({ name: 'ข้าวผัด', price: 60, cost: 20, stock: 100 })
  // จำลองว่าเครื่องกลางมีแคชเชียร์คนอื่นล็อกอินอยู่
  setActor({ id: 7, name: 'แคชเชียร์หน้าร้าน' })
})

describe('ออกบิลจากใบสั่งที่โต๊ะ', () => {
  it('ออกบิลพร้อมข้อมูลโหมดโต๊ะครบ และผู้ขายเป็นพนักงานที่โต๊ะ ไม่ใช่แคชเชียร์', async () => {
    const res = await receiveTicket(ticket(), settings, noPromos)

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.duplicate).toBe(false)
    const s = res.sale
    expect(s.receiptNo).toMatch(/^R/)
    expect(s.total).toBe(60)
    expect(s.orderChannel).toBe('table')
    expect(s.tableLabel).toBe('5')
    expect(s.ticketUid).toBe('t-test-1')
    expect(s.slipId).toBe('s-slip-1')
    // ความรับผิดต้องอยู่กับคนที่รับออเดอร์และยืนยันเงิน
    expect(s.staffName).toBe(WAITER.name)
    expect(s.paymentVerifiedByName).toBe(WAITER.name)
    expect(s.paymentVerifiedAt).toBeTypeOf('number')
  })

  it('ตัดสต็อกจริง 1 รอบ', async () => {
    await receiveTicket(ticket(), settings, noPromos)
    expect(await stockOf(productId)).toBe(99)
  })

  it('กดส่งซ้ำด้วยรหัสเดิม → ได้บิลใบเดิม ไม่เกิดใบที่สอง', async () => {
    const first = await receiveTicket(ticket(), settings, noPromos)
    const second = await receiveTicket(ticket(), settings, noPromos)

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    expect(second.duplicate).toBe(true)
    expect(second.sale.id).toBe(first.sale.id)
    expect(second.sale.receiptNo).toBe(first.sale.receiptNo)

    // หลักฐานที่สำคัญกว่า: ในฐานข้อมูลมีบิลใบเดียว สต็อกตัดรอบเดียว
    expect(await db.sales.count()).toBe(1)
    expect(await stockOf(productId)).toBe(99)
    expect(await db.orderTickets.count()).toBe(1)
  })

  it('ส่งซ้ำ 5 ครั้งรัวๆ ก็ยังได้บิลใบเดียว', async () => {
    for (let i = 0; i < 5; i++) await receiveTicket(ticket(), settings, noPromos)
    expect(await db.sales.count()).toBe(1)
    expect(await stockOf(productId)).toBe(99)
  })

  it('ใบสั่งคนละรหัส = คนละบิล และเลขบิลต้องไม่ซ้ำกัน', async () => {
    const a = await receiveTicket(ticket({ ticketUid: 't-a' }), settings, noPromos)
    const b = await receiveTicket(ticket({ ticketUid: 't-b' }), settings, noPromos)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.sale.receiptNo).not.toBe(b.sale.receiptNo)
    expect(await db.sales.count()).toBe(2)
  })
})

describe('ด่านตรวจก่อนออกบิล', () => {
  it('ยอดไม่ตรงกับที่ลูกค้าจ่าย → ปฏิเสธ ไม่ออกบิล', async () => {
    // ลูกค้าจ่ายมา 50 แต่รายการคิดได้ 60 (เช่นโปรโมชันเปลี่ยนระหว่างรับออเดอร์)
    const res = await receiveTicket(ticket({ paidAmount: 50 }), settings, noPromos)

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/ยอดไม่ตรงกับที่ลูกค้าจ่าย/)
    expect(await db.sales.count()).toBe(0)
    expect(await stockOf(productId)).toBe(100)

    const row = await db.orderTickets.get('t-test-1')
    expect(row?.state).toBe('rejected')
    expect(row?.rejectReason).toMatch(/ยอดไม่ตรง/)
  })

  it('แอปมือถือเวอร์ชันคนละรุ่น → ปฏิเสธพร้อมบอกให้เปิดแอปใหม่', async () => {
    const res = await receiveTicket(
      ticket({ schemaVersion: TICKET_SCHEMA_VERSION + 1 }),
      settings,
      noPromos,
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/เวอร์ชันคนละรุ่น/)
    expect(await db.sales.count()).toBe(0)
  })

  it('ใบสั่งเปล่า → ปฏิเสธ', async () => {
    const res = await receiveTicket(ticket({ items: [], paidAmount: 0 }), settings, noPromos)
    expect(res.ok).toBe(false)
    expect(await db.sales.count()).toBe(0)
  })

  it('ยังไม่มีการยืนยันว่าเงินเข้า → ปฏิเสธ', async () => {
    const t = ticket({ ticketUid: 't-2' })
    // จำลองข้อมูลเสีย / มือถือรุ่นเก่าที่ไม่ได้ส่งเวลายืนยันมา
    const broken = { ...t, verifiedAt: undefined as unknown as number }
    const res = await receiveTicket(broken, settings, noPromos)

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/ยังไม่มีการยืนยันว่าเงินเข้า/)
    expect(await db.sales.count()).toBe(0)
  })

  it('ใบสั่งที่ถูกปฏิเสธไปแล้ว แก้ให้ถูกแล้วส่งใหม่ได้', async () => {
    const bad = await receiveTicket(ticket({ paidAmount: 50 }), settings, noPromos)
    expect(bad.ok).toBe(false)

    const good = await receiveTicket(ticket(), settings, noPromos)
    expect(good.ok).toBe(true)
    expect(await db.sales.count()).toBe(1)
    expect((await db.orderTickets.get('t-test-1'))?.state).toBe('billed')
  })
})

describe('เงินในลิ้นชักและกะ', () => {
  it('ยังไม่เปิดกะทั้งที่บังคับให้เปิดก่อนขาย → ไม่ออกบิล และใบสั่งต้องไม่ถูกทำเครื่องหมายว่าออกบิลแล้ว', async () => {
    settings = await resetDb({
      tableOrderEnabled: true,
      shiftEnabled: true,
      requireShiftToSell: true,
      vatRate: 0,
    })
    productId = await addProduct({ name: 'ข้าวผัด', price: 60, cost: 20, stock: 100 })

    await expect(receiveTicket(ticket(), settings, noPromos)).rejects.toThrow(/ยังไม่ได้เปิดกะ/)

    // ทรานแซกชันต้องม้วนกลับทั้งก้อน ไม่งั้นส่งใหม่จะถูกมองว่าซ้ำแล้วไม่มีบิลตลอดไป
    expect(await db.sales.count()).toBe(0)
    expect(await db.orderTickets.get('t-test-1')).toBeUndefined()
    expect(await stockOf(productId)).toBe(100)
  })

  it('รับเงินสดที่โต๊ะตอนเปิดสวิตช์ไว้ → ทำเครื่องหมายว่าเงินอยู่กับพนักงาน', async () => {
    settings = await resetDb({
      tableOrderEnabled: true,
      tableCashEnabled: true,
      shiftEnabled: true,
      vatRate: 0,
    })
    productId = await addProduct({ name: 'ข้าวผัด', price: 60, cost: 20, stock: 100 })
    await openShift({ openingCash: 0 })

    const res = await receiveTicket(
      ticket({ payments: [{ method: 'cash', amount: 60 }] }),
      settings,
      noPromos,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sale.cashCustody).toBe('staff')
    expect(res.sale.cashCustodyByName).toBe(WAITER.name)
  })

  it('ปิดสวิตช์เงินสดที่โต๊ะ → ไม่ทำเครื่องหมาย (เงินถือว่าเข้าลิ้นชักตามปกติ)', async () => {
    const res = await receiveTicket(
      ticket({ payments: [{ method: 'cash', amount: 60 }] }),
      settings,
      noPromos,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sale.cashCustody).toBeUndefined()
  })

  it('จ่ายด้วยการโอน แม้เปิดสวิตช์เงินสดไว้ ก็ไม่ใช่เงินที่อยู่กับพนักงาน', async () => {
    settings = await resetDb({ tableOrderEnabled: true, tableCashEnabled: true, vatRate: 0 })
    productId = await addProduct({ name: 'ข้าวผัด', price: 60, cost: 20, stock: 100 })

    const res = await receiveTicket(ticket(), settings, noPromos)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sale.cashCustody).toBeUndefined()
  })
})
