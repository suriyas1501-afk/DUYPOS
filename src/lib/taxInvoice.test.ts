import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { Sale, Settings, TaxInvoiceCustomer } from '../db/types'
import { computeTotals } from './totals'
import { finalizeSale, refundSale, voidSale } from './checkout'
import { activeInvoiceOfSale, cancelTaxInvoice, checkTaxIdDigits, issueTaxInvoice, taxInvoiceAmounts } from './taxInvoice'
import { bahtText } from './bahtText'
import { addProduct, cartLine, resetDb } from '../test/helpers'

/* =========================================================
   ใบกำกับภาษีเป็นส่วนที่ผิดแล้วเป็นปัญหากฎหมาย — ตรึงกฎทุกข้อไว้
   ========================================================= */

let settings: Settings
let productId: number

const CUSTOMER: TaxInvoiceCustomer = {
  name: 'บริษัท ทดสอบ จำกัด',
  taxId: '0105556123496',
  taxBranch: 'สำนักงานใหญ่',
  address: '1 ถนนทดสอบ กรุงเทพมหานคร',
}

const shopReady: Partial<Settings> = {
  vatRegistered: true,
  taxId: '0105556123496',
  address: '99 ถนนร้านค้า กรุงเทพมหานคร',
}

async function sell(price: number): Promise<Sale> {
  const items = [cartLine(productId, { price, cost: 0 })]
  const totals = computeTotals({
    items,
    promos: [],
    settings,
    billDiscountType: 'amount',
    billDiscountValue: 0,
    redeemPoints: 0,
  })
  return finalizeSale({ items, totals, settings, payments: [{ method: 'cash', amount: totals.payable }] })
}

describe('issueTaxInvoice', () => {
  beforeEach(async () => {
    settings = await resetDb(shopReady)
    productId = await addProduct({ name: 'สินค้า', price: 100, cost: 0, stock: 1000 })
  })

  it('แยกมูลค่าสินค้ากับ VAT ถูกต้อง และผลรวมต้องเท่ากับยอดที่ลูกค้าจ่าย', async () => {
    const sale = await sell(107)
    const inv = await issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })

    expect(inv.docNo).toMatch(/^TX\d{8}-0001$/)
    expect(inv.kind).toBe('invoice')
    expect(inv.netAmount).toBe(100)
    expect(inv.vatAmount).toBe(7)
    expect(inv.total).toBe(107)
    expect(inv.netAmount + inv.vatAmount).toBe(inv.total)

    const linked = await db.sales.get(sale.id!)
    expect(linked?.taxInvoiceNo).toBe(inv.docNo)
  })

  it('ร้านที่ VAT บวกเพิ่ม: net + vat = total เหมือนกัน', async () => {
    settings = await resetDb({ ...shopReady, vatIncluded: false })
    productId = await addProduct({ name: 'สินค้า', price: 100, cost: 0, stock: 100 })
    const sale = await sell(100)
    expect(sale.total).toBe(107)

    const { net, vat, total } = taxInvoiceAmounts(sale)
    expect(net).toBe(100)
    expect(vat).toBe(7)
    expect(total).toBe(107)
  })

  it('ออกใบซ้ำให้บิลเดียวกันไม่ได้', async () => {
    const sale = await sell(107)
    await issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })
    await expect(issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })).rejects.toThrow(/ไปแล้ว/)
    expect(await db.taxInvoices.count()).toBe(1)
  })

  it('ร้านที่ยังไม่ตั้งค่าว่าจด VAT ออกใบไม่ได้', async () => {
    settings = await resetDb({ vatRegistered: false })
    productId = await addProduct({ name: 'สินค้า', price: 100, cost: 0, stock: 100 })
    const sale = await sell(107)
    await expect(issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })).rejects.toThrow(/จดทะเบียน/)
  })

  it('ข้อมูลผู้ซื้อไม่ครบออกใบไม่ได้ (เลขผู้เสียภาษี 13 หลัก + ที่อยู่)', async () => {
    const sale = await sell(107)
    await expect(
      issueTaxInvoice({ saleId: sale.id!, customer: { ...CUSTOMER, taxId: '123' } }),
    ).rejects.toThrow(/13 หลัก/)
    await expect(
      issueTaxInvoice({ saleId: sale.id!, customer: { ...CUSTOMER, address: '  ' } }),
    ).rejects.toThrow(/ที่อยู่/)
  })

  it('ใบลดหนี้ต้องอ้างอิงใบกำกับภาษีของบิลต้นทาง และเก็บยอดเดิมไว้ (ม.86/10)', async () => {
    const sale = await sell(107)
    const refund = await refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'ชำรุด', payments: [] })

    // บิลต้นทางยังไม่มีใบกำกับ → ออกใบลดหนี้ไม่ได้
    await expect(issueTaxInvoice({ saleId: refund.id!, customer: CUSTOMER })).rejects.toThrow(
      /ยังไม่ได้ออกใบกำกับภาษี/,
    )

    const orig = await issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })
    const cn = await issueTaxInvoice({ saleId: refund.id!, customer: CUSTOMER })

    expect(cn.kind).toBe('creditNote')
    expect(cn.docNo).toMatch(/^CN\d{8}-0001$/)
    expect(cn.refInvoiceNo).toBe(orig.docNo)
    expect(cn.refNetAmount).toBe(orig.netAmount)
    expect(cn.refTotal).toBe(orig.total)
    expect(cn.reason).toBe('ชำรุด')
    // ยอดในใบลดหนี้เก็บเป็นค่าบวกเสมอ ทิศทางอยู่ที่ kind
    expect(cn.total).toBeGreaterThan(0)
  })
})

describe('cancelTaxInvoice + ความสัมพันธ์กับการยกเลิกบิล', () => {
  beforeEach(async () => {
    settings = await resetDb(shopReady)
    productId = await addProduct({ name: 'สินค้า', price: 100, cost: 0, stock: 1000 })
  })

  it('ยกเลิกบิลที่ออกใบกำกับภาษีแล้วไม่ได้ ต้องยกเลิกใบก่อน', async () => {
    const sale = await sell(107)
    const inv = await issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })

    await expect(voidSale(sale.id!, 'x')).rejects.toThrow(/ใบกำกับภาษี/)

    await cancelTaxInvoice(inv.id!, 'ลูกค้าแจ้งชื่อผิด')
    await voidSale(sale.id!, 'x')
    expect((await db.sales.get(sale.id!))?.status).toBe('voided')
  })

  it('ยกเลิกใบแล้วเลขที่ยังอยู่ (ห้ามใช้ซ้ำ) และบิลออกใบใหม่ได้เลขถัดไป', async () => {
    const sale = await sell(107)
    const inv = await issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })
    await cancelTaxInvoice(inv.id!, 'พิมพ์ผิด')

    const cancelled = await db.taxInvoices.get(inv.id!)
    expect(cancelled?.cancelledAt).toBeTypeOf('number')
    expect(cancelled?.cancelReason).toBe('พิมพ์ผิด')
    expect(await activeInvoiceOfSale(sale.id!)).toBeUndefined()

    const again = await issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })
    expect(again.docNo).toMatch(/-0002$/) // เลขเดินต่อ ไม่ใช้เลขเดิมซ้ำ
  })

  it('ยกเลิกใบกำกับที่มีใบลดหนี้อ้างอิงอยู่ไม่ได้', async () => {
    const sale = await sell(107)
    const inv = await issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })
    const refund = await refundSale(sale.id!, [{ itemIndex: 0, qty: 1 }], { reason: 'x', payments: [] })
    await issueTaxInvoice({ saleId: refund.id!, customer: CUSTOMER })

    await expect(cancelTaxInvoice(inv.id!, 'x')).rejects.toThrow(/ใบลดหนี้/)
  })

  it('ยกเลิกใบแล้วข้อมูลอื่นของบิลต้องไม่หาย', async () => {
    const sale = await sell(107)
    const before = await db.sales.get(sale.id!)
    const inv = await issueTaxInvoice({ saleId: sale.id!, customer: CUSTOMER })
    await cancelTaxInvoice(inv.id!, 'x')
    const after = await db.sales.get(sale.id!)

    for (const key of Object.keys(before!) as (keyof Sale)[]) {
      if (key === 'taxInvoiceId' || key === 'taxInvoiceNo') continue
      expect(after![key]).toEqual(before![key])
    }
    expect(after!.taxInvoiceId).toBeUndefined()
  })
})

describe('ตัวช่วยของใบกำกับภาษี', () => {
  it('เลขประจำตัวผู้เสียภาษีตรวจหลักตรวจสอบได้', () => {
    expect(checkTaxIdDigits('0105556123496')).toBe(true)
    expect(checkTaxIdDigits('0105556123499')).toBe(false)
    expect(checkTaxIdDigits('123')).toBe(false)
  })

  it('จำนวนเงินเป็นตัวอักษรไทย', () => {
    expect(bahtText(0)).toBe('ศูนย์บาทถ้วน')
    expect(bahtText(1)).toBe('หนึ่งบาทถ้วน')
    expect(bahtText(11)).toBe('สิบเอ็ดบาทถ้วน')
    expect(bahtText(21)).toBe('ยี่สิบเอ็ดบาทถ้วน')
    expect(bahtText(93)).toBe('เก้าสิบสามบาทถ้วน')
    expect(bahtText(100)).toBe('หนึ่งร้อยบาทถ้วน')
    expect(bahtText(1234.5)).toBe('หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์')
    expect(bahtText(0.25)).toBe('ยี่สิบห้าสตางค์')
    expect(bahtText(1000000)).toBe('หนึ่งล้านบาทถ้วน')
    expect(bahtText(-50)).toBe('ลบห้าสิบบาทถ้วน')
  })
})
