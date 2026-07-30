import { db } from '../db/db'
import type { PaymentMethod, Sale, SaleItem, Settings } from '../db/types'
import type { CartItem } from '../stores/cartStore'
import type { Totals } from './totals'
import { r2, startOfDay, endOfDay, dayKey } from './format'

export interface CheckoutInput {
  items: CartItem[]
  totals: Totals
  settings: Settings
  memberId?: number
  paymentMethod: PaymentMethod
  received: number
}

/** ปิดการขาย: บันทึกบิล ตัดสต็อก อัปเดตแต้มสมาชิก (ทำใน transaction เดียว) */
export async function finalizeSale(input: CheckoutInput): Promise<Sale> {
  const { items, totals, settings } = input
  const createdAt = Date.now()

  return db.transaction('rw', db.sales, db.products, db.members, db.stockMoves, async () => {
    // เลขที่ใบเสร็จ: R20260724-0001 (นับต่อวัน)
    const todayCount = await db.sales
      .where('createdAt')
      .between(startOfDay(createdAt), endOfDay(createdAt), true, true)
      .count()
    const receiptNo = `R${dayKey(createdAt).replaceAll('-', '')}-${String(todayCount + 1).padStart(4, '0')}`

    const saleItems: SaleItem[] = items.map((it, i) => {
      const promoDiscount = totals.lineDiscounts[i] ?? 0
      const manualDiscount = Math.min(it.manualDiscount, r2(it.price * it.qty))
      return {
        productId: it.productId,
        name: it.name,
        price: it.price,
        qty: it.qty,
        options: it.options,
        note: it.note,
        manualDiscount,
        promoDiscount,
        cost: it.cost,
        total: Math.max(0, r2(it.price * it.qty - manualDiscount - promoDiscount)),
      }
    })

    // ตัดสต็อก
    for (const it of items) {
      if (it.productId === 0) continue
      const p = await db.products.get(it.productId)
      if (!p || !p.trackStock) continue
      await db.products.update(it.productId, { stock: r2(p.stock - it.qty) })
      await db.stockMoves.add({
        productId: it.productId,
        type: 'sale',
        qty: -it.qty,
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

    const received = input.paymentMethod === 'cash' ? r2(input.received) : totals.payable
    const sale: Sale = {
      receiptNo,
      items: saleItems,
      subtotal: totals.subtotal,
      itemDiscount: totals.itemManualDiscount,
      promoDiscount: r2(totals.promoLineDiscount + totals.promoBillDiscount),
      billDiscount: totals.billManualDiscount,
      pointDiscount: totals.pointDiscount,
      redeemedPoints: totals.redeemedPoints,
      vatRate: settings.vatRate,
      vatIncluded: settings.vatIncluded,
      vatAmount: totals.vatAmount,
      total: totals.payable,
      paymentMethod: input.paymentMethod,
      received,
      change: Math.max(0, r2(received - totals.payable)),
      memberId: input.memberId,
      memberName,
      earnedPoints: totals.earnPoints,
      appliedPromos: totals.applied.map((a) => a.name),
      status: 'completed',
      createdAt,
    }

    const id = await db.sales.add(sale)
    return { ...sale, id }
  })
}

/** ยกเลิกบิล: คืนสต็อก คืน/หักแต้มสมาชิก */
export async function voidSale(saleId: number, reason: string): Promise<void> {
  await db.transaction('rw', db.sales, db.products, db.members, db.stockMoves, async () => {
    const sale = await db.sales.get(saleId)
    if (!sale || sale.status !== 'completed') return
    const now = Date.now()

    for (const it of sale.items) {
      if (it.productId === 0) continue
      const p = await db.products.get(it.productId)
      if (!p || !p.trackStock) continue
      await db.products.update(it.productId, { stock: r2(p.stock + it.qty) })
      await db.stockMoves.add({
        productId: it.productId,
        type: 'void',
        qty: it.qty,
        note: `ยกเลิกบิล ${sale.receiptNo}`,
        refSaleId: saleId,
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

    await db.sales.update(saleId, { status: 'voided', voidReason: reason, voidedAt: now })
  })
}
