import type { Promotion } from '../db/types'
import { r2 } from './format'

/** ข้อมูลบรรทัดสินค้าที่เอนจินโปรโมชันต้องใช้ */
export interface PromoLine {
  productId: number
  categoryId?: number
  price: number // ราคาต่อหน่วย (รวมส่วนเพิ่มตัวเลือกแล้ว)
  qty: number
  manualDiscount: number // ส่วนลดที่กรอกเองต่อบรรทัด (บาท)
}

export interface PromoApplied {
  name: string
  amount: number
}

export interface PromoResult {
  /** ส่วนลดโปรโมชันต่อบรรทัด (เรียงตาม lines) */
  lineDiscounts: number[]
  /** ส่วนลดโปรโมชันระดับบิล (เลือกโปรที่ลดมากที่สุดตัวเดียว) */
  billDiscount: number
  applied: PromoApplied[]
}

/**
 * คำนวณโปรโมชันอัตโนมัติ
 * - โปรระดับรายการ (products/category): ใช้ทุกโปรที่เข้าเงื่อนไข
 * - โปรระดับบิล (bill): เลือกตัวที่ลดมากที่สุดเพียงตัวเดียว
 */
export function applyPromotions(
  lines: PromoLine[],
  promos: Promotion[],
  now: number = Date.now(),
): PromoResult {
  const active = promos.filter(
    (p) =>
      p.active &&
      (!p.startsAt || now >= p.startsAt) &&
      (!p.endsAt || now <= p.endsAt),
  )

  const lineDiscounts = lines.map(() => 0)
  const applied: PromoApplied[] = []

  const lineBase = (i: number) =>
    Math.max(0, r2(lines[i].price * lines[i].qty - lines[i].manualDiscount))

  const matches = (p: Promotion, ln: PromoLine) => {
    if (ln.productId === 0) return false // รายการกำหนดเองไม่ร่วมโปร
    if (p.scope === 'products') return (p.productIds ?? []).includes(ln.productId)
    if (p.scope === 'category') return p.categoryId != null && ln.categoryId === p.categoryId
    return false
  }

  // ----- โปรระดับรายการ -----
  for (const p of active) {
    if (p.scope === 'bill') continue
    let amount = 0

    /** หักส่วนลดเข้าบรรทัด i (ไม่เกินยอดคงเหลือของบรรทัด) */
    const addDiscount = (i: number, raw: number) => {
      const remaining = Math.max(0, lineBase(i) - lineDiscounts[i])
      const d = r2(Math.min(raw, remaining))
      if (d > 0) {
        lineDiscounts[i] = r2(lineDiscounts[i] + d)
        amount = r2(amount + d)
      }
    }

    if (p.type === 'buyxgety') {
      // ซื้อ X แถม Y: รวมจำนวนของสินค้าเดียวกันจากทุกบรรทัดก่อนคิดจำนวนเซ็ต
      // (สินค้าเดียวกันที่เลือกตัวเลือก/โน้ตต่างกันจะแยกเป็นคนละบรรทัดในตะกร้า)
      const buy = p.buyQty ?? 0
      const free = p.freeQty ?? 0
      if (buy > 0 && free > 0) {
        const groups = new Map<number, number[]>() // productId -> ดัชนีบรรทัด
        for (let i = 0; i < lines.length; i++) {
          if (!matches(p, lines[i])) continue
          const g = groups.get(lines[i].productId)
          if (g) g.push(i)
          else groups.set(lines[i].productId, [i])
        }
        for (const idxs of groups.values()) {
          const totalQty = idxs.reduce((s, i) => s + lines[i].qty, 0)
          let freeLeft = Math.floor(totalQty / (buy + free)) * free
          // แถมจากบรรทัดราคาต่ำสุดก่อน
          idxs.sort((a, b) => lines[a].price - lines[b].price)
          for (const i of idxs) {
            if (freeLeft <= 0) break
            const n = Math.min(freeLeft, lines[i].qty)
            freeLeft -= n
            addDiscount(i, n * lines[i].price)
          }
        }
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i]
        if (!matches(p, ln)) continue
        if (p.type === 'percent') addDiscount(i, (ln.price * ln.qty * p.value) / 100)
        else if (p.type === 'amount') addDiscount(i, p.value * ln.qty)
      }
    }

    if (amount > 0) applied.push({ name: p.name, amount })
  }

  // ----- โปรระดับบิล (เลือกตัวที่ดีที่สุด) -----
  const afterItems = r2(
    lines.reduce((s, _l, i) => s + lineBase(i), 0) -
      lineDiscounts.reduce((s, d) => s + d, 0),
  )
  let best: PromoApplied | null = null
  for (const p of active) {
    if (p.scope !== 'bill') continue
    if (p.minSubtotal && afterItems < p.minSubtotal) continue
    let d = 0
    if (p.type === 'percent') d = (afterItems * p.value) / 100
    else if (p.type === 'amount') d = p.value
    d = r2(Math.min(d, afterItems))
    if (d > 0 && (!best || d > best.amount)) best = { name: p.name, amount: d }
  }
  if (best) applied.push(best)

  return { lineDiscounts, billDiscount: best?.amount ?? 0, applied }
}
