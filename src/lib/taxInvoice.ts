import { db } from '../db/db'
import type {
  Member,
  Sale,
  Settings,
  TaxInvoice,
  TaxInvoiceCustomer,
  TaxInvoiceKind,
} from '../db/types'
import { getActor, type Actor } from './actor'
import { DOC_PREFIX, formatDocNo, nextSeq } from './docNo'
import { endOfDay, r2, startOfDay } from './format'

/* =========================================================
   ใบกำกับภาษีเต็มรูป (ม.86/4) และใบลดหนี้ (ม.86/10)
   - 1 บิล ออกใบกำกับที่ยังไม่ถูกยกเลิกได้ 1 ใบ (sale.taxInvoiceId)
   - เอกสารคืนสินค้า (kind='refund') → ออกเป็น "ใบลดหนี้" อ้างอิงใบกำกับเดิม
   - ยอดในใบเก็บเป็นค่าบวกเสมอ ทิศทางอยู่ที่ kind (รายงานภาษีขายหักใบลดหนี้ออก)
   ========================================================= */

export const HEAD_OFFICE = 'สำนักงานใหญ่'

/**
 * แยกมูลค่าสินค้ากับ VAT ของบิล
 * ทั้งกรณีราคารวม VAT และบวก VAT: net = |total| − |vat| (total คือยอดที่ลูกค้าจ่ายจริง)
 */
export function taxInvoiceAmounts(sale: Sale): { net: number; vat: number; total: number } {
  const total = r2(Math.abs(sale.total))
  const vat = r2(Math.abs(sale.vatAmount))
  return { net: r2(total - vat), vat, total }
}

/** เลขผู้เสียภาษี 13 หลัก + ตรวจเลขตรวจสอบ (หลักสุดท้าย) */
export function checkTaxIdDigits(taxId: string): boolean {
  const d = taxId.replace(/\D/g, '')
  if (d.length !== 13) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(d[12])
}

/** ตรวจเลขผู้เสียภาษี — คืนข้อความผิดพลาด (undefined = ผ่าน) */
export function validateTaxId(taxId: string): string | undefined {
  const d = taxId.replace(/\D/g, '')
  if (d.length === 0) return 'กรุณากรอกเลขประจำตัวผู้เสียภาษี'
  if (d.length !== 13) return 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก'
  return undefined
}

/** ตรวจข้อมูลผู้ซื้อให้ครบตามที่กฎหมายกำหนด */
export function validateCustomer(c: TaxInvoiceCustomer): string | undefined {
  if (!c.name.trim()) return 'กรุณากรอกชื่อผู้ซื้อ'
  const tax = validateTaxId(c.taxId)
  if (tax) return tax
  if (!c.address.trim()) return 'กรุณากรอกที่อยู่ผู้ซื้อ (ใบกำกับภาษีเต็มรูปต้องมีที่อยู่)'
  return undefined
}

/** ร้านพร้อมออกใบกำกับภาษีหรือยัง — คืนข้อความที่ต้องแก้ก่อน (undefined = พร้อม) */
export function shopTaxReadiness(settings: Settings): string | undefined {
  if (!settings.vatRegistered) {
    return 'ร้านยังไม่ได้ระบุว่าจดทะเบียนภาษีมูลค่าเพิ่ม — เปิดที่ ตั้งค่า › ใบกำกับภาษี'
  }
  if (!settings.taxId || settings.taxId.replace(/\D/g, '').length !== 13) {
    return 'ยังไม่ได้กรอกเลขประจำตัวผู้เสียภาษีของร้าน (13 หลัก) — กรอกที่ ตั้งค่า › ข้อมูลร้าน'
  }
  if (!settings.address.trim()) {
    return 'ยังไม่ได้กรอกที่อยู่ร้าน — ใบกำกับภาษีเต็มรูปต้องมีที่อยู่ผู้ขาย'
  }
  return undefined
}

/** เติมข้อมูลผู้ซื้อจากสมาชิก (ถ้าเคยบันทึกข้อมูลภาษีไว้) */
export function memberToCustomer(m: Member): TaxInvoiceCustomer {
  return {
    name: m.name,
    taxId: m.taxId ?? '',
    taxBranch: m.taxBranch || HEAD_OFFICE,
    address: m.address ?? '',
    phone: m.phone,
  }
}

/** ผู้ซื้อที่เคยออกใบกำกับให้ (ไว้เลือกซ้ำเร็วๆ) — ตัดซ้ำด้วยเลขผู้เสียภาษี */
export async function suggestCustomers(q: string, limit = 8): Promise<TaxInvoiceCustomer[]> {
  const term = q.trim().toLowerCase()
  const rows = await db.taxInvoices.orderBy('issuedAt').reverse().limit(300).toArray()
  const seen = new Set<string>()
  const out: TaxInvoiceCustomer[] = []
  for (const r of rows) {
    const key = r.customer.taxId.replace(/\D/g, '') || r.customer.name
    if (seen.has(key)) continue
    if (
      term &&
      !r.customer.name.toLowerCase().includes(term) &&
      !r.customer.taxId.includes(term)
    ) {
      continue
    }
    seen.add(key)
    out.push(r.customer)
    if (out.length >= limit) break
  }
  return out
}

/** ใบกำกับภาษีของบิลนี้ที่ยังไม่ถูกยกเลิก */
export async function activeInvoiceOfSale(saleId: number): Promise<TaxInvoice | undefined> {
  const rows = await db.taxInvoices.where('saleId').equals(saleId).toArray()
  return rows.find((r) => r.cancelledAt == null)
}

export interface IssueTaxInvoiceInput {
  saleId: number
  customer: TaxInvoiceCustomer
  note?: string
  actor?: Actor
}

/**
 * ออกใบกำกับภาษีเต็มรูป / ใบลดหนี้ จากบิลที่ขายแล้ว
 * ตรวจซ้ำใน transaction เดียวกับการเขียน เพื่อกันกดสองครั้งแล้วได้สองใบ
 */
export async function issueTaxInvoice(input: IssueTaxInvoiceInput): Promise<TaxInvoice> {
  const issuedAt = Date.now()
  const actor = input.actor ?? getActor()
  const customer: TaxInvoiceCustomer = {
    name: input.customer.name.trim(),
    taxId: input.customer.taxId.replace(/\D/g, ''),
    taxBranch: input.customer.taxBranch.trim() || HEAD_OFFICE,
    address: input.customer.address.trim(),
    phone: input.customer.phone?.trim() || undefined,
  }
  const invalid = validateCustomer(customer)
  if (invalid) throw new Error(invalid)

  return db.transaction('rw', [db.taxInvoices, db.sales, db.settings], async () => {
    const settings = await db.settings.get(1)
    if (!settings) throw new Error('ยังไม่ได้ตั้งค่าข้อมูลร้าน')
    const notReady = shopTaxReadiness(settings)
    if (notReady) throw new Error(notReady)

    const sale = await db.sales.get(input.saleId)
    if (!sale || sale.id == null) throw new Error('ไม่พบบิลนี้')
    if (sale.status !== 'completed') throw new Error('บิลที่ถูกยกเลิกแล้วออกใบกำกับภาษีไม่ได้')
    if (sale.vatRate <= 0 || Math.abs(sale.vatAmount) <= 0) {
      throw new Error('บิลนี้ไม่มีภาษีมูลค่าเพิ่ม จึงออกใบกำกับภาษีไม่ได้')
    }

    const existing = (await db.taxInvoices.where('saleId').equals(sale.id).toArray()).find(
      (r) => r.cancelledAt == null,
    )
    if (existing) {
      throw new Error(`บิลนี้ออกเอกสารเลขที่ ${existing.docNo} ไปแล้ว`)
    }

    const kind: TaxInvoiceKind = sale.kind === 'refund' ? 'creditNote' : 'invoice'
    const prefix = kind === 'creditNote' ? DOC_PREFIX.creditNote : DOC_PREFIX.taxInvoice

    /* ใบลดหนี้ต้องอ้างอิงใบกำกับภาษีของบิลต้นทาง
       ม.86/10(5) บังคับให้ใบลดหนี้แสดง "มูลค่าของสินค้าตามที่ลงในใบกำกับภาษีเดิม" ด้วย
       จึงคัดลอกยอดของใบเดิม (net/vat/total) มาเก็บไว้ในใบลดหนี้ตอนออก
       (เก็บเป็น snapshot ไม่ไปอ่านสดตอนพิมพ์ เพราะใบเดิมอาจถูกยกเลิกภายหลัง) */
    let refInvoiceNo: string | undefined
    let refInvoiceDate: number | undefined
    let refNetAmount: number | undefined
    let refVatAmount: number | undefined
    let refTotal: number | undefined
    if (kind === 'creditNote') {
      if (sale.refOriginalId == null) throw new Error('เอกสารคืนสินค้าไม่มีบิลต้นทาง')
      const origInvoice = (
        await db.taxInvoices.where('saleId').equals(sale.refOriginalId).toArray()
      ).find((r) => r.cancelledAt == null && r.kind === 'invoice')
      if (!origInvoice) {
        throw new Error(
          `บิลต้นทาง ${sale.refOriginalNo ?? ''} ยังไม่ได้ออกใบกำกับภาษี — ต้องออกใบกำกับภาษีของบิลขายก่อนจึงจะออกใบลดหนี้ได้`,
        )
      }
      refInvoiceNo = origInvoice.docNo
      refInvoiceDate = origInvoice.issuedAt
      refNetAmount = origInvoice.netAmount
      refVatAmount = origInvoice.vatAmount
      refTotal = origInvoice.total
    }

    const sameDay = await db.taxInvoices
      .where('issuedAt')
      .between(startOfDay(issuedAt), endOfDay(issuedAt), true, true)
      .toArray()
    const docNo = formatDocNo(
      prefix,
      issuedAt,
      nextSeq(
        sameDay.map((r) => r.docNo),
        prefix,
        issuedAt,
      ),
    )

    const { net, vat, total } = taxInvoiceAmounts(sale)
    const doc: TaxInvoice = {
      docNo,
      kind,
      saleId: sale.id,
      saleReceiptNo: sale.receiptNo,
      saleDate: sale.createdAt,
      customer,
      netAmount: net,
      vatRate: sale.vatRate,
      vatAmount: vat,
      total,
      refInvoiceNo,
      refInvoiceDate,
      refNetAmount,
      refVatAmount,
      refTotal,
      reason: kind === 'creditNote' ? sale.refundReason || 'รับคืนสินค้า' : undefined,
      note: input.note?.trim() || undefined,
      issuedAt,
      issuedById: actor.id,
      issuedByName: actor.name,
    }
    const id = await db.taxInvoices.add(doc)
    await db.sales.update(sale.id, { taxInvoiceId: id, taxInvoiceNo: docNo })
    return { ...doc, id }
  })
}

/**
 * ยกเลิกใบกำกับภาษี — เก็บใบเดิมไว้เป็นหลักฐาน (เลขที่ไม่นำกลับมาใช้ซ้ำ) แล้วปลดล็อกบิลให้ออกใบใหม่ได้
 * ตามระเบียบต้องเก็บต้นฉบับที่ยกเลิกไว้พร้อมเขียน "ยกเลิก" และอ้างถึงใบใหม่
 */
export async function cancelTaxInvoice(id: number, reason: string): Promise<void> {
  const note = reason.trim()
  if (!note) throw new Error('กรุณาระบุเหตุผลการยกเลิก')

  await db.transaction('rw', [db.taxInvoices, db.sales], async () => {
    const doc = await db.taxInvoices.get(id)
    if (!doc) throw new Error('ไม่พบเอกสารนี้')
    if (doc.cancelledAt != null) throw new Error('เอกสารนี้ถูกยกเลิกไปแล้ว')

    // ใบกำกับที่มีใบลดหนี้อ้างอิงอยู่ ยกเลิกไม่ได้ (ต้องยกเลิกใบลดหนี้ก่อน)
    if (doc.kind === 'invoice') {
      const child = (await db.taxInvoices.where('kind').equals('creditNote').toArray()).find(
        (r) => r.refInvoiceNo === doc.docNo && r.cancelledAt == null,
      )
      if (child) {
        throw new Error(`มีใบลดหนี้ ${child.docNo} อ้างอิงใบนี้อยู่ — ต้องยกเลิกใบลดหนี้ก่อน`)
      }
    }

    await db.taxInvoices.update(id, { cancelledAt: Date.now(), cancelReason: note })

    // ปลดลิงก์ที่บิล เพื่อให้ออกใบใหม่แทนใบที่ยกเลิกได้
    // ใช้ put ทั้งแถว (ไม่ใช้ update ด้วยค่า undefined) เพื่อให้ฟิลด์หายจริงแน่นอน
    const sale = await db.sales.get(doc.saleId)
    if (sale?.id != null && sale.taxInvoiceId === id) {
      const { taxInvoiceId: _dropId, taxInvoiceNo: _dropNo, ...rest } = sale
      await db.sales.put({ ...rest, id: sale.id })
    }
  })
}
