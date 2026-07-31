import type { Coupon, Promotion, Settings } from '../db/types'
import type { BillDiscountType, CartItem } from '../stores/cartStore'
import { applyPromotions, type PromoApplied } from './promotions'
import { couponDiscount } from './coupons'
import { r2 } from './format'

export interface Totals {
  subtotal: number
  itemManualDiscount: number
  promoLineDiscount: number
  promoBillDiscount: number
  couponDiscount: number
  couponCode?: string
  billManualDiscount: number
  pointDiscount: number
  redeemedPoints: number
  net: number // หลังหักส่วนลดทั้งหมด
  vatAmount: number
  payable: number // ยอดที่ลูกค้าต้องจ่ายจริง
  earnPoints: number
  applied: PromoApplied[]
  lineDiscounts: number[] // ส่วนลดโปรต่อบรรทัด
}

export interface TotalsInput {
  items: CartItem[]
  promos: Promotion[]
  settings: Settings
  billDiscountType: BillDiscountType
  billDiscountValue: number
  redeemPoints: number
  memberPoints?: number // แต้มคงเหลือของสมาชิก (undefined = ไม่มีสมาชิก)
  coupon?: Coupon // คูปองที่ใช้กับบิลนี้ (ถ้ามี)
}

export function computeTotals(input: TotalsInput): Totals {
  const { items, promos, settings } = input

  const subtotal = r2(items.reduce((s, it) => s + it.price * it.qty, 0))
  const itemManualDiscount = r2(
    items.reduce((s, it) => s + Math.min(it.manualDiscount, it.price * it.qty), 0),
  )

  const promo = applyPromotions(
    items.map((it) => ({
      productId: it.productId,
      categoryId: it.categoryId,
      price: it.price,
      qty: it.qty,
      manualDiscount: it.manualDiscount,
      // ส่งตัวคูณหน่วยไปด้วย เพื่อให้โปร "ซื้อ X แถม Y" / "ลดบาท/ชิ้น" นับเป็นหน่วยฐาน
      unitFactor: it.unitFactor,
    })),
    promos,
  )
  const promoLineDiscount = r2(promo.lineDiscounts.reduce((s, d) => s + d, 0))

  // ลำดับการหัก: รายการ → โปรบิล → คูปอง → ส่วนลดท้ายบิล (กรอกเอง) → แต้ม
  const base1 = Math.max(0, r2(subtotal - itemManualDiscount - promoLineDiscount))
  const promoBillDiscount = Math.min(promo.billDiscount, base1)
  const base2 = Math.max(0, r2(base1 - promoBillDiscount))

  const coupon = couponDiscount(input.coupon, base2)
  const base2b = Math.max(0, r2(base2 - coupon))

  let billManualDiscount =
    input.billDiscountType === 'percent'
      ? (base2b * input.billDiscountValue) / 100
      : input.billDiscountValue
  billManualDiscount = r2(Math.min(Math.max(0, billManualDiscount), base2b))
  const base3 = Math.max(0, r2(base2b - billManualDiscount))

  // แลกแต้ม
  const redeemValue = settings.redeemValue > 0 ? settings.redeemValue : 0
  let redeemedPoints = 0
  let pointDiscount = 0
  if (input.memberPoints != null && redeemValue > 0 && input.redeemPoints > 0) {
    const maxByBill = Math.floor(base3 / redeemValue)
    redeemedPoints = Math.min(input.redeemPoints, input.memberPoints, maxByBill)
    pointDiscount = r2(redeemedPoints * redeemValue)
  }

  const net = Math.max(0, r2(base3 - pointDiscount))

  // VAT: รวมใน (แสดงเฉยๆ) หรือบวกเพิ่ม
  let vatAmount = 0
  let payable = net
  if (settings.vatRate > 0) {
    if (settings.vatIncluded) {
      vatAmount = r2((net * settings.vatRate) / (100 + settings.vatRate))
    } else {
      vatAmount = r2((net * settings.vatRate) / 100)
      payable = r2(net + vatAmount)
    }
  }

  const earnPoints =
    input.memberPoints != null && settings.bahtPerPoint > 0
      ? Math.floor(payable / settings.bahtPerPoint)
      : 0

  return {
    subtotal,
    itemManualDiscount,
    promoLineDiscount,
    promoBillDiscount,
    couponDiscount: coupon,
    couponCode: coupon > 0 ? input.coupon?.code : undefined,
    billManualDiscount,
    pointDiscount,
    redeemedPoints,
    net,
    vatAmount,
    payable,
    earnPoints,
    applied: promo.applied,
    lineDiscounts: promo.lineDiscounts,
  }
}
