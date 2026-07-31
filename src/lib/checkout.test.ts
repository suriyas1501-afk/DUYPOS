import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { Settings } from '../db/types'
import { computeTotals } from './totals'
import { finalizeSale, refundSale, saleAmountByMethod, saleCogs, saleRevenue, voidSale } from './checkout'
import { addProduct, cartLine, resetDb, stockOf } from '../test/helpers'

/* =========================================================
   ตรึงพฤติกรรมของเอนจินคิดเงินไว้ก่อนผ่าตัดโครงสร้าง (ดู SYNC-PLAN.md เฟส 0)
   ตัวเลขในไฟล์นี้ = พฤติกรรมที่ทดสอบด้วยมือแล้วว่าถูกต้อง ถ้าเทสต์แดง
   แปลว่า "เปลี่ยนพฤติกรรมการเงิน" ต้องตั้งใจเปลี่ยนเท่านั้น ห้ามแก้ตัวเลขให้ผ่านเฉยๆ
   ========================================================= */

let settings: Settings

const totalsOf = (items: ReturnType<typeof cartLine>[], over?: Partial<Parameters<typeof computeTotals>[0]>) =>
  computeTotals({
    items,
    promos: [],
    settings,
    billDiscountType: 'amount',
    billDiscountValue: 0,
    redeemPoints: 0,
    ...over,
  })

describe('finalizeSale — ปิดการขาย', () => {
  beforeEach(async () => {
    settings = await resetDb()
  })

  it('บันทึกบิล ตัดสต็อกตามหน่วยฐาน และคิดเงินทอนถูกต้อง', async () => {
    const id = await addProduct({ name: 'น้ำดื่ม', price: 7, cost: 4.5, stock: 120 })
    // ขายแบบแพ็ค 6 ขวด ราคา 39 → ต้องตัดสต็อก 6 ขวด ไม่ใช่ 1
    const items = [cartLine(id, { price: 39, cost: 27, unitName: 'แพ็ค 6 ขวด', unitFactor: 6 })]
    const totals = totalsOf(items)

    const sale = await finalizeSale({
      items,
      totals,
      settings,
      payments: [{ method: 'cash', amount: 100 }],
    })

    expect(sale.receiptNo).toMatch(/^R\d{8}-0001$/)
    expect(sale.total).toBe(39)
    expect(sale.change).toBe(61)
    expect(sale.received).toBe(100)
    expect(await stockOf(id)).toBe(114)

    const moves = await db.stockMoves.toArray()
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ type: 'sale', qty: -6, refDocNo: sale.receiptNo })
  })

  it('VAT รวมในราคา: ยอดที่ลูกค้าจ่ายไม่เปลี่ยน แต่แยก VAT ออกมาแสดงได้', async () => {
    const id = await addProduct({ name: 'สินค้า', price: 107, cost: 50 })
    const items = [cartLine(id, { price: 107, cost: 50 })]
    const sale = await finalizeSale({
      items,
      totals: totalsOf(items),
      settings,
      payments: [{ method: 'cash', amount: 107 }],
    })

    expect(sale.total).toBe(107)
    expect(sale.vatAmount).toBe(7) // 107 × 7/107
    expect(saleRevenue(sale)).toBe(107) // ราคารวม VAT แล้ว รายได้ = ยอดจ่ายจริง
    expect(saleCogs(sale)).toBe(50)
  })

  it('VAT บวกเพิ่ม: รายได้ต้องหัก VAT ออกจากยอดที่ลูกค้าจ่าย', async () => {
    settings = await resetDb({ vatIncluded: false })
    const id = await addProduct({ name: 'สินค้า', price: 100, cost: 40 })
    const items = [cartLine(id, { price: 100, cost: 40 })]
    const totals = totalsOf(items)
    expect(totals.payable).toBe(107)

    const sale = await finalizeSale({
      items,
      totals,
      settings,
      payments: [{ method: 'cash', amount: 107 }],
    })
    expect(sale.vatAmount).toBe(7)
    expect(saleRevenue(sale)).toBe(100)
  })

  it('จ่ายผสมหลายช่องทาง: หักเงินทอนออกจากเงินสดเท่านั้น', async () => {
    const id = await addProduct({ name: 'สินค้า', price: 120, cost: 50 })
    const items = [cartLine(id, { price: 120, cost: 50 })]
    const sale = await finalizeSale({
      items,
      totals: totalsOf(items),
      settings,
      payments: [
        { method: 'cash', amount: 100 },
        { method: 'transfer', amount: 50 },
      ],
    })

    expect(sale.change).toBe(30)
    // เงินสดที่อยู่ในลิ้นชักจริง = 100 − 30 = 70
    expect(saleAmountByMethod(sale, 'cash')).toBe(70)
    expect(saleAmountByMethod(sale, 'transfer')).toBe(50)
    expect(saleAmountByMethod(sale, 'card')).toBe(0)
  })

  it('เลขที่บิลเดินต่อจากเลขมากสุดของวัน ไม่ใช่นับจำนวนแถว', async () => {
    const id = await addProduct({ name: 'สินค้า', price: 10, cost: 5, stock: 1000 })
    const mk = () => {
      const items = [cartLine(id, { price: 10, cost: 5 })]
      return finalizeSale({ items, totals: totalsOf(items), settings, payments: [{ method: 'cash', amount: 10 }] })
    }
    const a = await mk()
    const b = await mk()
    expect(a.receiptNo.endsWith('-0001')).toBe(true)
    expect(b.receiptNo.endsWith('-0002')).toBe(true)

    // ลบบิลแรกทิ้ง (จำลองการกู้คืน/ล้างข้อมูลกลางวัน) แล้วขายใหม่ — ห้ามได้เลขซ้ำกับที่พิมพ์ไปแล้ว
    await db.sales.delete(a.id!)
    const c = await mk()
    expect(c.receiptNo.endsWith('-0003')).toBe(true)
  })

  it('บังคับเปิดกะก่อนขาย: ไม่เปิดกะแล้วปิดบิลไม่ได้ และต้องไม่กินเลขที่บิล/ไม่ตัดสต็อก', async () => {
    settings = await resetDb({ shiftEnabled: true, requireShiftToSell: true })
    const id = await addProduct({ name: 'สินค้า', price: 50, cost: 20, stock: 10 })
    const items = [cartLine(id, { price: 50, cost: 20 })]

    await expect(
      finalizeSale({ items, totals: totalsOf(items), settings, payments: [{ method: 'cash', amount: 50 }] }),
    ).rejects.toThrow(/ยังไม่ได้เปิดกะ/)

    expect(await db.sales.count()).toBe(0)
    expect(await db.stockMoves.count()).toBe(0)
    expect(await stockOf(id)).toBe(10)
  })
})

describe('refundSale — คืนสินค้าบางรายการ', () => {
  beforeEach(async () => {
    settings = await resetDb()
  })

  it('สร้างเอกสารยอดติดลบ คืนสต็อก และบันทึกจำนวนที่คืนในบิลต้นทาง', async () => {
    const id = await addProduct({ name: 'สินค้า', price: 100, cost: 60, stock: 50 })
    const items = [cartLine(id, { price: 100, cost: 60, qty: 3 })]
    const sale = await finalizeSale({
      items,
      totals: totalsOf(items),
      settings,
      payments: [{ method: 'cash', amount: 300 }],
    })
    expect(await stockOf(id)).toBe(47)

    const doc = await refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], {
      reason: 'ชำรุด',
      payments: [{ method: 'cash', amount: 100 }],
    })

    expect(doc.kind).toBe('refund')
    expect(doc.receiptNo).toMatch(/^RF\d{8}-0001$/)
    // ทุกช่องยอดต้องติดลบ เพื่อให้ Σ ของรายงานหักกลบเองอัตโนมัติ
    expect(doc.total).toBe(-100)
    expect(doc.items[0].qty).toBe(-1)
    expect(doc.items[0].total).toBe(-100)
    expect(doc.vatAmount).toBeLessThan(0)
    expect(saleAmountByMethod(doc, 'cash')).toBe(-100)

    expect(await stockOf(id)).toBe(48)
    const orig = await db.sales.get(sale.id!)
    expect(orig?.items[0].refundedQty).toBe(1)
    expect(orig?.refundedTotal).toBe(100)
  })

  it('คืนเกินจำนวนที่ขายไม่ได้ และคืนซ้ำจนครบแล้วคืนอีกไม่ได้', async () => {
    const id = await addProduct({ name: 'สินค้า', price: 20, cost: 10, stock: 10 })
    const items = [cartLine(id, { price: 20, cost: 10, qty: 2 })]
    const sale = await finalizeSale({
      items,
      totals: totalsOf(items),
      settings,
      payments: [{ method: 'cash', amount: 40 }],
    })

    await expect(
      refundSale(sale.id!, [{ itemIndex: 0, qty: 3 }], { reason: 'x', payments: [] }),
    ).rejects.toThrow(/เกินจำนวน/)

    await refundSale(sale.id!, [{ itemIndex: 0, qty: 2 }], { reason: 'x', payments: [] })
    await expect(
      refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'x', payments: [] }),
    ).rejects.toThrow(/เกินจำนวน/)
  })

  it('ส่วนลดของเอกสารคืน: หัวเอกสารต้องตรงกับผลรวมของรายการที่คืนจริง', async () => {
    const id = await addProduct({ name: 'สินค้า', price: 100, cost: 50, stock: 20 })
    // ขาย 4 ชิ้น ส่วนลดรายการ 40 บาท → คืน 1 ชิ้น ต้องคืนส่วนลด 1/4 = 10 บาท
    const items = [cartLine(id, { price: 100, cost: 50, qty: 4, manualDiscount: 40 })]
    const sale = await finalizeSale({
      items,
      totals: totalsOf(items),
      settings,
      payments: [{ method: 'cash', amount: 360 }],
    })

    const doc = await refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'x', payments: [] })
    expect(doc.itemDiscount).toBe(-10)
    expect(doc.items[0].manualDiscount).toBe(-10)
    // ยอดหัวเอกสารต้องไล่ตามรายการได้: ยอดรวม − ส่วนลด = ยอดสุทธิ
    const lineTotal = doc.items.reduce((s, it) => s + it.total, 0)
    expect(lineTotal).toBe(-90)
    expect(doc.total).toBe(-90)
  })
})

describe('voidSale — ยกเลิกบิล', () => {
  beforeEach(async () => {
    settings = await resetDb()
  })

  const sell = async (productId: number, qty = 1) => {
    const items = [cartLine(productId, { price: 100, cost: 40, qty })]
    return finalizeSale({
      items,
      totals: totalsOf(items),
      settings,
      payments: [{ method: 'cash', amount: 100 * qty }],
    })
  }

  it('คืนสต็อกและบันทึกผู้ยกเลิก', async () => {
    const id = await addProduct({ name: 'สินค้า', price: 100, cost: 40, stock: 10 })
    const sale = await sell(id, 2)
    expect(await stockOf(id)).toBe(8)

    await voidSale(sale.id!, 'ลูกค้าไม่เอา', { id: 9, name: 'ผู้จัดการ' })

    const after = await db.sales.get(sale.id!)
    expect(after?.status).toBe('voided')
    expect(after?.voidedByName).toBe('ผู้จัดการ')
    expect(await stockOf(id)).toBe(10)
  })

  it('บิลที่คืนสินค้าบางส่วนแล้ว ยกเลิกทั้งบิลไม่ได้', async () => {
    const id = await addProduct({ name: 'สินค้า', price: 100, cost: 40, stock: 10 })
    const sale = await sell(id, 2)
    await refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'x', payments: [] })

    await expect(voidSale(sale.id!, 'x')).rejects.toThrow(/คืนสินค้าบางส่วน/)
  })

  it('เอกสารคืนสินค้ายกเลิกไม่ได้', async () => {
    const id = await addProduct({ name: 'สินค้า', price: 100, cost: 40, stock: 10 })
    const sale = await sell(id, 1)
    const doc = await refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'x', payments: [] })

    await expect(voidSale(doc.id!, 'x')).rejects.toThrow(/เอกสารคืนสินค้า/)
  })
})
