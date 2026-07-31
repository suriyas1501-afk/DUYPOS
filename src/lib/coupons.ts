import type { Coupon } from '../db/types'
import { r2 } from './format'

/** ทำให้โค้ดคูปองเป็นรูปแบบมาตรฐาน (ตัวพิมพ์ใหญ่ ไม่มีช่องว่าง) */
export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '')

export interface CouponCheck {
  ok: boolean
  /** เหตุผลที่ใช้ไม่ได้ (ภาษาไทย พร้อมแสดงให้พนักงาน) */
  reason?: string
}

/**
 * ตรวจว่าคูปองใช้ได้กับยอดบิลนี้หรือไม่
 * @param base ยอดบิลหลังหักส่วนลดรายการและโปรโมชันแล้ว
 */
export function checkCoupon(
  coupon: Coupon | undefined,
  base: number,
  now: number = Date.now(),
): CouponCheck {
  if (!coupon) return { ok: false, reason: 'ไม่พบคูปองนี้ในระบบ' }
  if (!coupon.active) return { ok: false, reason: 'คูปองนี้ถูกปิดใช้งานแล้ว' }
  if (coupon.startsAt && now < coupon.startsAt)
    return { ok: false, reason: 'คูปองนี้ยังไม่ถึงวันเริ่มใช้' }
  if (coupon.endsAt && now > coupon.endsAt) return { ok: false, reason: 'คูปองนี้หมดอายุแล้ว' }
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit)
    return { ok: false, reason: 'คูปองนี้ถูกใช้ครบจำนวนที่กำหนดแล้ว' }
  if (coupon.minSubtotal && base < coupon.minSubtotal)
    return { ok: false, reason: `ต้องมียอดบิลอย่างน้อย ${coupon.minSubtotal.toLocaleString('th-TH')} บาท` }
  if (base <= 0) return { ok: false, reason: 'ยอดบิลเป็นศูนย์แล้ว ใช้คูปองไม่ได้' }
  return { ok: true }
}

/** คำนวณส่วนลดจากคูปอง (ไม่เกินยอดคงเหลือของบิล) */
export function couponDiscount(coupon: Coupon | undefined, base: number): number {
  if (!coupon) return 0
  if (!checkCoupon(coupon, base).ok) return 0
  let d = coupon.type === 'percent' ? (base * coupon.value) / 100 : coupon.value
  if (coupon.type === 'percent' && coupon.maxDiscount && coupon.maxDiscount > 0) {
    d = Math.min(d, coupon.maxDiscount)
  }
  return r2(Math.max(0, Math.min(d, base)))
}

/** คำอธิบายเงื่อนไขคูปองแบบอ่านง่าย (ใช้ในหน้าจัดการคูปองและหน้าขาย) */
export function describeCoupon(c: Coupon): string {
  const parts: string[] = []
  parts.push(
    c.type === 'percent'
      ? `ลด ${c.value}%${c.maxDiscount ? ` (สูงสุด ${c.maxDiscount.toLocaleString('th-TH')}.-)` : ''}`
      : `ลด ${c.value.toLocaleString('th-TH')}.-`,
  )
  if (c.minSubtotal) parts.push(`เมื่อซื้อครบ ${c.minSubtotal.toLocaleString('th-TH')}.-`)
  if (c.usageLimit) parts.push(`ใช้ได้ ${c.usedCount}/${c.usageLimit} ครั้ง`)
  return parts.join(' ')
}
