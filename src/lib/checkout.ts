import { db } from '../db/db'
import type { Coupon, Payment, PaymentMethod, Sale, SaleItem, Settings } from '../db/types'
import type { CartItem } from '../stores/cartStore'
import type { Totals } from './totals'
import { r2, startOfDay, endOfDay } from './format'
import { DOC_PREFIX, formatDocNo, nextSeq } from './docNo'
import { getActor, type Actor } from './actor'

/** ช่องทางหลักของบิล = ก้อนที่จ่ายมากที่สุด (ใช้กับรายงานที่ดูช่องทางเดียว) */
export function primaryMethod(payments: Payment[]): PaymentMethod {
  let best: Payment | undefined
  for (const p of payments) if (!best || p.amount > best.amount) best = p
  return best?.method ?? 'cash'
}

/** รวมยอดชำระทุกก้อน */
export const paymentsTotal = (payments: Payment[]) =>
  r2(payments.reduce((s, p) => s + p.amount, 0))

/** ยอดชำระแยกช่องทางของบิล (รองรับบิลเก่าที่ยังไม่มี payments[]) */
export function saleAmountByMethod(sale: Sale, method: PaymentMethod): number {
  if (sale.payments && sale.payments.length > 0) {
    let sum = 0
    for (const p of sale.payments) if (p.method === method) sum += p.amount
    // หักเงินทอนออกจากช่องทางเงินสด เพื่อให้ยอดตรงกับเงินที่อยู่ในลิ้นชักจริง
    if (method === 'cash' && sale.change > 0) sum = sum - sale.change
    return r2(sum)
  }
  return sale.paymentMethod === method ? r2(sale.total) : 0
}

/**
 * รายได้ของบิล (ไม่รวม VAT ที่บวกเพิ่ม) — s.total คือยอดที่ลูกค้าจ่ายจริง (payable)
 * เมื่อร้านตั้ง VAT แบบบวกเพิ่ม (vatIncluded=false) payable = net + vatAmount จึงต้องหัก vatAmount ออก
 * (เอกสารคืนสินค้า total/vatAmount ติดลบ → รายได้ติดลบ Σ หักกลบเองถูกต้อง)
 * หมายเหตุ: ส่วนลดทุกชนิดถูกหักอยู่ใน s.total แล้ว จึงห้ามหักซ้ำ
 */
export const saleRevenue = (s: Sale) => (s.vatIncluded ? s.total : r2(s.total - s.vatAmount))

/**
 * ต้นทุนขายของบิล = Σ it.cost × it.qty (เอกสารคืน qty ติดลบ → คืนต้นทุนกลับ)
 * กำไรขั้นต้น = Σ saleRevenue − Σ saleCogs — ใช้สูตรนี้ทั้ง Dashboard / รายงาน / บัญชี
 */
export const saleCogs = (s: Sale) => r2(s.items.reduce((t, it) => t + it.cost * it.qty, 0))

export interface CheckoutInput {
  items: CartItem[]
  totals: Totals
  settings: Settings
  memberId?: number
  /** การชำระเงินทุกก้อน (จ่ายผสมหลายช่องทางได้) */
  payments: Payment[]
  /** คูปองที่ใช้กับบิลนี้ (จะนับจำนวนการใช้ให้) */
  coupon?: Coupon
  /** พนักงานผู้ขาย (ไม่ระบุ = ผู้ที่เข้าสู่ระบบอยู่) */
  actor?: Actor
  /** ผู้จัดการที่ใส่ PIN อนุมัติส่วนลดให้บิลนี้ (ถ้ามี) — เก็บไว้ตรวจสอบย้อนหลัง */
  discountApprover?: Actor
}

/** ปิดการขาย: บันทึกบิล ตัดสต็อก อัปเดตแต้มสมาชิก/คูปอง (ทำใน transaction เดียว) */
export async function finalizeSale(input: CheckoutInput): Promise<Sale> {
  const { items, totals, settings } = input
  const createdAt = Date.now()
  const actor = input.actor ?? getActor()

  return db.transaction(
    'rw',
    [db.sales, db.products, db.members, db.stockMoves, db.coupons, db.shifts],
    async () => {
      // ผูกบิลกับกะที่เปิดอยู่ (ถ้ามี) เพื่อให้สรุปเงินสดของกะครบถ้วน
      const openShift = await db.shifts.where('status').equals('open').first()
      if (settings.shiftEnabled && settings.requireShiftToSell && !openShift) {
        throw new Error('ยังไม่ได้เปิดกะ — ไปที่หน้า "กะ / ลิ้นชัก" เพื่อเปิดกะก่อนขาย')
      }

      const dayLo = startOfDay(createdAt)
      const dayHi = endOfDay(createdAt)
      const todaySales = await db.sales
        .where('createdAt')
        .between(dayLo, dayHi, true, true)
        .toArray()

      const receiptNo = formatDocNo(
        DOC_PREFIX.sale,
        createdAt,
        nextSeq(
          todaySales.map((s) => s.receiptNo),
          DOC_PREFIX.sale,
          createdAt,
        ),
      )

      // เลขคิวประจำวัน (โหมดคาเฟ่/ร้านอาหาร)
      let queueNo: number | undefined
      if (settings.queueEnabled) {
        queueNo = todaySales.reduce((mx, s) => Math.max(mx, s.queueNo ?? 0), 0) + 1
      }

      const saleItems: SaleItem[] = items.map((it, i) => {
        const promoDiscount = totals.lineDiscounts[i] ?? 0
        const manualDiscount = Math.min(it.manualDiscount, r2(it.price * it.qty))
        return {
          productId: it.productId,
          name: it.name,
          price: it.price,
          qty: it.qty,
          unitName: it.unitName,
          unitFactor: it.unitFactor,
          options: it.options,
          note: it.note,
          manualDiscount,
          promoDiscount,
          cost: it.cost,
          total: Math.max(0, r2(it.price * it.qty - manualDiscount - promoDiscount)),
          refundedQty: 0,
        }
      })

      // ตัดสต็อก (หน่วยฐาน = จำนวน × ตัวคูณหน่วย)
      for (const it of items) {
        if (it.productId === 0) continue
        const p = await db.products.get(it.productId)
        if (!p || !p.trackStock) continue
        const baseQty = r2(it.qty * (it.unitFactor || 1))
        await db.products.update(it.productId, { stock: r2(p.stock - baseQty) })
        await db.stockMoves.add({
          productId: it.productId,
          type: 'sale',
          qty: -baseQty,
          refDocNo: receiptNo,
          createdAt,
        })
      }

      // อัปเดตสมาชิก
      let memberName: string | undefined
      if (input.memberId != null) {
        const m = await db.members.get(input.memberId)
        if (m) {
          memberName = m.name
          await db.members.update(input.memberId, {
            points: Math.max(0, m.points - totals.redeemedPoints + totals.earnPoints),
            totalSpent: r2(m.totalSpent + totals.payable),
            visits: m.visits + 1,
          })
        }
      }

      // นับการใช้คูปอง
      const couponCode = totals.couponDiscount > 0 ? input.coupon?.code : undefined
      if (couponCode && input.coupon?.id != null) {
        const c = await db.coupons.get(input.coupon.id)
        if (c) await db.coupons.update(input.coupon.id, { usedCount: c.usedCount + 1 })
      }

      const payments = input.payments
        .filter((p) => p.amount > 0)
        .map((p) => ({ method: p.method, amount: r2(p.amount) }))
      const received = paymentsTotal(payments)

      const sale: Sale = {
        receiptNo,
        kind: 'sale',
        items: saleItems,
        subtotal: totals.subtotal,
        itemDiscount: totals.itemManualDiscount,
        promoDiscount: r2(totals.promoLineDiscount + totals.promoBillDiscount),
        billDiscount: totals.billManualDiscount,
        couponDiscount: totals.couponDiscount,
        couponCode,
        pointDiscount: totals.pointDiscount,
        redeemedPoints: totals.redeemedPoints,
        vatRate: settings.vatRate,
        vatIncluded: settings.vatIncluded,
        vatAmount: totals.vatAmount,
        total: totals.payable,
        paymentMethod: primaryMethod(payments),
        payments,
        received,
        change: Math.max(0, r2(received - totals.payable)),
        memberId: input.memberId,
        memberName,
        earnedPoints: totals.earnPoints,
        appliedPromos: totals.applied.map((a) => a.name),
        queueNo,
        staffId: actor.id,
        staffName: actor.name,
        discountApprovedById: input.discountApprover?.id,
        discountApprovedByName: input.discountApprover?.name,
        shiftId: openShift?.id,
        refundedTotal: 0,
        status: 'completed',
        createdAt,
      }

      const id = await db.sales.add(sale)
      return { ...sale, id }
    },
  )
}

/**
 * ยกเลิกบิล: คืนสต็อก คืน/หักแต้มสมาชิก คืนสิทธิ์คูปอง
 * actor = ผู้ยกเลิก/ผู้อนุมัติ (ถ้าพนักงานขายไม่มีสิทธิ์ ให้ส่งผู้จัดการที่อนุมัติเข้ามา)
 */
export async function voidSale(saleId: number, reason: string, actor?: Actor): Promise<void> {
  const who = actor ?? getActor()
  await db.transaction(
    'rw',
    [db.sales, db.products, db.members, db.stockMoves, db.coupons, db.shifts, db.settings],
    async () => {
      const sale = await db.sales.get(saleId)
      if (!sale || sale.status !== 'completed') return
      if (sale.kind === 'refund') {
        throw new Error('ยกเลิกเอกสารคืนสินค้าไม่ได้ — ถ้าคืนผิดให้ทำรายการขายใหม่')
      }

      /* ยกเลิกบิลข้ามกะ = เงินสดออกจากลิ้นชักโดยไม่มีร่องรอยในกะไหนเลย
         (กะเดิมปิดไปแล้ว snapshot ไม่เปลี่ยน ส่วนกะปัจจุบันไม่นับบิลของกะอื่น)
         → บังคับให้ใช้ "คืนสินค้า" แทน ซึ่งสร้างเอกสารยอดติดลบผูกกับกะที่เปิดอยู่ */
      const settings = await db.settings.get(1)
      if (settings?.shiftEnabled && sale.shiftId != null) {
        const openShift = await db.shifts.where('status').equals('open').first()
        if (openShift?.id !== sale.shiftId) {
          throw new Error(
            'บิลนี้อยู่ในกะที่ปิดไปแล้ว — ให้ใช้ปุ่ม "คืนสินค้า" แทน เพื่อให้เงินที่จ่ายคืนถูกบันทึกในกะปัจจุบัน',
          )
        }
      }
      if ((sale.refundedTotal ?? 0) > 0) {
        throw new Error('บิลนี้มีการคืนสินค้าบางส่วนแล้ว ยกเลิกทั้งบิลไม่ได้')
      }
      if (sale.taxInvoiceId != null) {
        throw new Error(
          `บิลนี้ออกใบกำกับภาษี ${sale.taxInvoiceNo ?? ''} ไปแล้ว — ต้องยกเลิกใบกำกับภาษีก่อน`,
        )
      }
      const now = Date.now()

      for (const it of sale.items) {
        if (it.productId === 0) continue
        const p = await db.products.get(it.productId)
        if (!p || !p.trackStock) continue
        const baseQty = r2(it.qty * (it.unitFactor || 1))
        await db.products.update(it.productId, { stock: r2(p.stock + baseQty) })
        await db.stockMoves.add({
          productId: it.productId,
          type: 'void',
          qty: baseQty,
          note: `ยกเลิกบิล ${sale.receiptNo}`,
          refSaleId: saleId,
          refDocNo: sale.receiptNo,
          createdAt: now,
        })
      }

      if (sale.memberId != null) {
        const m = await db.members.get(sale.memberId)
        if (m) {
          await db.members.update(sale.memberId, {
            points: Math.max(0, m.points - sale.earnedPoints + sale.redeemedPoints),
            totalSpent: Math.max(0, r2(m.totalSpent - sale.total)),
            visits: Math.max(0, m.visits - 1),
          })
        }
      }

      // คืนสิทธิ์คูปองให้ใช้ได้อีกครั้ง
      if (sale.couponCode) {
        const c = await db.coupons.where('code').equals(sale.couponCode).first()
        if (c?.id != null) {
          await db.coupons.update(c.id, { usedCount: Math.max(0, c.usedCount - 1) })
        }
      }

      await db.sales.update(saleId, {
        status: 'voided',
        voidReason: reason,
        voidedById: who.id,
        voidedByName: who.name,
        voidedAt: now,
      })
    },
  )
}

/* =========================================================
   คืนสินค้าบางรายการ (partial refund) — สร้างเอกสารยอดติดลบ
   ========================================================= */

export interface RefundLine {
  /** ลำดับรายการในบิลต้นทาง */
  itemIndex: number
  /** จำนวนที่คืน (ค่าบวก) */
  qty: number
}

/** จำนวนที่ยังคืนได้ของรายการนั้น */
export const refundableQty = (it: SaleItem) => r2(it.qty - (it.refundedQty ?? 0))

/**
 * คืนสินค้าบางรายการ: สร้างเอกสารคืน (ยอด/จำนวนติดลบ) เพื่อให้รายงานทุกหน้าหักกลบเองอัตโนมัติ
 * คืนสต็อก ปรับแต้มสมาชิกตามสัดส่วน และบันทึกจำนวนที่คืนแล้วในบิลต้นทาง
 */
export async function refundSale(
  originalId: number,
  lines: RefundLine[],
  opts: { reason: string; payments: Payment[]; actor?: Actor },
): Promise<Sale> {
  const createdAt = Date.now()
  const actor = opts.actor ?? getActor()

  return db.transaction(
    'rw',
    [db.sales, db.products, db.members, db.stockMoves, db.shifts, db.settings],
    async () => {
      // เงินที่จ่ายคืนต้องออกจากลิ้นชักของกะที่เปิดอยู่ — ถ้าตั้งค่าให้ต้องเปิดกะก่อนขาย
      // การคืนเงินก็ต้องอยู่ในกะเช่นกัน (ไม่งั้นเงินหายจากสมการเหมือนกัน)
      const settings = await db.settings.get(1)
      const openShiftForRefund = await db.shifts.where('status').equals('open').first()
      if (settings?.shiftEnabled && settings.requireShiftToSell && !openShiftForRefund) {
        throw new Error('ยังไม่ได้เปิดกะ — ไปที่หน้า "กะ / ลิ้นชัก" เพื่อเปิดกะก่อนคืนสินค้า')
      }

      const orig = await db.sales.get(originalId)
      if (!orig || orig.id == null) throw new Error('ไม่พบบิลต้นทาง')
      if (orig.kind === 'refund') throw new Error('เอกสารคืนสินค้าไม่สามารถคืนซ้ำได้')
      if (orig.status !== 'completed') throw new Error('บิลนี้ถูกยกเลิกไปแล้ว')

      // ตรวจจำนวนที่ขอคืน
      const wanted = lines
        .map((l) => ({ ...l, qty: r2(l.qty) }))
        .filter((l) => l.qty > 0 && orig.items[l.itemIndex])
      if (wanted.length === 0) throw new Error('กรุณาเลือกรายการที่ต้องการคืน')
      for (const l of wanted) {
        const it = orig.items[l.itemIndex]
        if (l.qty > refundableQty(it) + 0.0001) {
          throw new Error(`คืน "${it.name}" เกินจำนวนที่ขายไว้`)
        }
      }

      // สัดส่วนของยอดที่คืน เทียบกับยอดรวมรายการทั้งบิล (ใช้เกลี่ยส่วนลดท้ายบิล/VAT/แต้ม)
      const itemsTotal = r2(orig.items.reduce((s, it) => s + it.total, 0))
      const refundItemsTotal = r2(
        wanted.reduce((s, l) => {
          const it = orig.items[l.itemIndex]
          return s + (it.qty === 0 ? 0 : (it.total * l.qty) / it.qty)
        }, 0),
      )
      const ratio = itemsTotal > 0 ? Math.min(1, refundItemsTotal / itemsTotal) : 0

      const neg = (n: number) => -r2(n)
      const refundItems: SaleItem[] = wanted.map((l) => {
        const it = orig.items[l.itemIndex]
        const share = it.qty === 0 ? 0 : l.qty / it.qty
        return {
          productId: it.productId,
          name: it.name,
          price: it.price,
          qty: neg(l.qty),
          unitName: it.unitName,
          unitFactor: it.unitFactor,
          options: it.options,
          note: it.note,
          manualDiscount: neg(it.manualDiscount * share),
          promoDiscount: neg(it.promoDiscount * share),
          cost: it.cost,
          total: neg(it.total * share),
        }
      })

      /* ส่วนลดของเอกสารคืน
         - ส่วนที่ผูกกับ "รายการ" (ส่วนลดกรอกเอง + โปรรายบรรทัด) ต้องคิดจากบรรทัดที่คืนจริง (share)
         - ส่วนที่เป็น "ระดับบิล" (โปรบิล/ส่วนลดท้ายบิล/คูปอง/แต้ม) จึงเกลี่ยด้วย ratio
         ถ้าเอาส่วนลดรายการมาเกลี่ยด้วย ratio หัวเอกสารจะไม่ตรงกับ items[] (ใบพิมพ์/CSV/กำไรเพี้ยน) */
      const refundItemDiscount = r2(refundItems.reduce((s, it) => s - it.manualDiscount, 0))
      const refundLinePromo = r2(refundItems.reduce((s, it) => s - it.promoDiscount, 0))
      const origLinePromo = r2(orig.items.reduce((s, it) => s + it.promoDiscount, 0))
      const origBillPromo = Math.max(0, r2(orig.promoDiscount - origLinePromo))
      const refundPromoDiscount = r2(refundLinePromo + origBillPromo * ratio)

      // เลขที่เอกสารคืน (RF...) — นับต่อจากเลขที่มากที่สุดของวันนั้น
      const receiptNoDay = await db.sales
        .where('createdAt')
        .between(startOfDay(createdAt), endOfDay(createdAt), true, true)
        .toArray()
      const receiptNo = formatDocNo(
        DOC_PREFIX.refund,
        createdAt,
        nextSeq(
          receiptNoDay.map((s) => s.receiptNo),
          DOC_PREFIX.refund,
          createdAt,
        ),
      )

      for (const l of wanted) {
        const it = orig.items[l.itemIndex]
        if (it.productId === 0) continue
        const p = await db.products.get(it.productId)
        if (!p || !p.trackStock) continue
        const baseQty = r2(l.qty * (it.unitFactor || 1))
        await db.products.update(it.productId, { stock: r2(p.stock + baseQty) })
        await db.stockMoves.add({
          productId: it.productId,
          type: 'refund',
          qty: baseQty,
          note: `คืนสินค้า ${receiptNo} (บิล ${orig.receiptNo})`,
          refSaleId: orig.id,
          refDocNo: receiptNo,
          createdAt,
        })
      }

      const refundTotal = r2(orig.total * ratio)
      const refundVat = r2(orig.vatAmount * ratio)
      const earnedBack = Math.round(orig.earnedPoints * ratio)
      const redeemedBack = Math.round(orig.redeemedPoints * ratio)

      // ปรับแต้ม/ยอดสะสมสมาชิกตามสัดส่วนที่คืน
      if (orig.memberId != null) {
        const m = await db.members.get(orig.memberId)
        if (m) {
          await db.members.update(orig.memberId, {
            points: Math.max(0, m.points - earnedBack + redeemedBack),
            totalSpent: Math.max(0, r2(m.totalSpent - refundTotal)),
          })
        }
      }

      const payments = opts.payments
        .filter((p) => p.amount > 0)
        .map((p) => ({ method: p.method, amount: r2(p.amount) }))
      const refundPayments = payments.length > 0 ? payments : [{ method: 'cash' as const, amount: refundTotal }]

      // ผูกเอกสารคืนกับกะที่เปิดอยู่ (เงินที่จ่ายคืนต้องหักจากลิ้นชักของกะนั้น)
      const openShift = openShiftForRefund

      const doc: Sale = {
        receiptNo,
        kind: 'refund',
        refOriginalId: orig.id,
        refOriginalNo: orig.receiptNo,
        refundReason: opts.reason.trim() || undefined,
        items: refundItems,
        subtotal: neg(wanted.reduce((s, l) => s + orig.items[l.itemIndex].price * l.qty, 0)),
        itemDiscount: neg(refundItemDiscount),
        promoDiscount: neg(refundPromoDiscount),
        billDiscount: neg(orig.billDiscount * ratio),
        couponDiscount: neg((orig.couponDiscount ?? 0) * ratio),
        couponCode: orig.couponCode,
        pointDiscount: neg(orig.pointDiscount * ratio),
        redeemedPoints: -redeemedBack,
        vatRate: orig.vatRate,
        vatIncluded: orig.vatIncluded,
        vatAmount: neg(refundVat),
        total: neg(refundTotal),
        paymentMethod: primaryMethod(refundPayments),
        payments: refundPayments.map((p) => ({ method: p.method, amount: neg(p.amount) })),
        received: neg(refundTotal),
        change: 0,
        memberId: orig.memberId,
        memberName: orig.memberName,
        earnedPoints: -earnedBack,
        appliedPromos: [],
        staffId: actor.id,
        staffName: actor.name,
        shiftId: openShift?.id,
        status: 'completed',
        createdAt,
      }

      // บันทึกจำนวน/ยอดที่คืนแล้วในบิลต้นทาง
      const updatedItems = orig.items.map((it, i) => {
        const l = wanted.find((w) => w.itemIndex === i)
        return l ? { ...it, refundedQty: r2((it.refundedQty ?? 0) + l.qty) } : it
      })
      await db.sales.update(orig.id, {
        items: updatedItems,
        refundedTotal: r2((orig.refundedTotal ?? 0) + refundTotal),
      })

      const id = await db.sales.add(doc)
      return { ...doc, id }
    },
  )
}
