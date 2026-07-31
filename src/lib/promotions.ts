import type { Promotion } from '../db/types'
import { r2 } from './format'

/** ข้อมูลบรรทัดสินค้าที่เอนจินโปรโมชันต้องใช้ */
export interface PromoLine {
  productId: number
  categoryId?: number
  price: number // ราคาต่อหน่วย (รวมส่วนเพิ่มตัวเลือกแล้ว)
  qty: number
  manualDiscount: number // ส่วนลดที่กรอกเองต่อบรรทัด (บาท)
  /** ตัวคูณหน่วยที่ขาย (แพ็ค/ลัง = จำนวนหน่วยฐานต่อ 1 หน่วยขาย) — ไม่ระบุ = 1 */
  unitFactor?: number
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

  /** ตัวคูณหน่วยของบรรทัด (ขายยกแพ็ค/ลัง = หลายหน่วยฐาน) */
  const factorOf = (ln: PromoLine) =>
    ln.unitFactor != null && ln.unitFactor > 0 ? ln.unitFactor : 1
  /** จำนวนหน่วยฐานของบรรทัด — โปร "ซื้อ X แถม Y" / "ลด N บาท/ชิ้น" ต้องนับเป็นหน่วยฐาน */
  const baseQtyOf = (ln: PromoLine) => ln.qty * factorOf(ln)
  /** ราคาต่อ 1 หน่วยฐานของบรรทัด (ใช้ตีมูลค่าของแถม) */
  const basePriceOf = (ln: PromoLine) => ln.price / factorOf(ln)

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
          // นับเป็นหน่วยฐาน — ขาย 1 แพ็ค 12 = 12 ชิ้น (ไม่ใช่ 1 ชิ้น)
          const totalBase = idxs.reduce((s, i) => s + baseQtyOf(lines[i]), 0)
          let freeBase = Math.floor(totalBase / (buy + free)) * free
          // แถมจากบรรทัดที่ราคาต่อหน่วยฐานต่ำสุดก่อน
          idxs.sort((a, b) => basePriceOf(lines[a]) - basePriceOf(lines[b]))
          for (const i of idxs) {
            if (freeBase <= 0) break
            const n = Math.min(freeBase, baseQtyOf(lines[i]))
            freeBase = r2(freeBase - n)
            addDiscount(i, n * basePriceOf(lines[i]))
          }
        }
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i]
        if (!matches(p, ln)) continue
        // percent คิดจากมูลค่าบรรทัด จึงไม่ขึ้นกับหน่วย — amount เป็นบาท/หน่วยฐาน ต้องคูณตัวคูณหน่วย
        if (p.type === 'percent') addDiscount(i, (ln.price * ln.qty * p.value) / 100)
        else if (p.type === 'amount') addDiscount(i, p.value * baseQtyOf(ln))
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
