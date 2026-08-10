import { db } from '../db/db'
import type { OrderStatus, PaymentMethod, Sale, Settings } from '../db/types'
import { getActor, type Actor } from './actor'
import { refundableQty, saleAmountByMethod } from './checkout'
import { r2 } from './format'

/* =========================================================
   โหมดบริการด่วน (quick service) — ด่านตรวจการชำระเงิน → คิวครัว

   กติกาสำคัญ: **ห้ามส่งออเดอร์เข้าครัวก่อนที่เงินจะได้รับจริง**
   - เงินสด: ถือว่าตรวจแล้วในตัว เพราะเงินอยู่ในมือและทอนไปแล้ว
   - โอน/QR และบัตร: ต้องมีคนกดยืนยันว่า "เห็นสลิป/อนุมัติแล้ว" ก่อน
     (ปัญหาจริงของร้าน: ลูกค้าโชว์สลิปปลอมหรือโอนไม่สำเร็จ แล้วครัวทำอาหารทิ้งไปแล้ว)
   ทุกอย่างเขียนผ่านฟังก์ชันในไฟล์นี้เท่านั้น เพื่อให้กติกาอยู่ที่เดียว
   ========================================================= */

/** ลำดับสถานะออเดอร์ — เดินหน้าทีละขั้น */
export const ORDER_FLOW: OrderStatus[] = ['new', 'preparing', 'ready', 'served']

export const ORDER_LABEL: Record<OrderStatus, string> = {
  new: 'เข้าคิวแล้ว',
  preparing: 'กำลังทำ',
  ready: 'พร้อมเสิร์ฟ',
  served: 'ส่งลูกค้าแล้ว',
}

/** ปุ่มที่จอครัวกดเพื่อเดินไปสถานะถัดไป */
export const NEXT_LABEL: Record<OrderStatus, string> = {
  new: 'เริ่มทำ',
  preparing: 'ทำเสร็จแล้ว',
  ready: 'ส่งลูกค้าแล้ว',
  served: '',
}

/** สถานะถัดไป (undefined = จบแล้ว) */
export const nextStatus = (s: OrderStatus): OrderStatus | undefined =>
  ORDER_FLOW[ORDER_FLOW.indexOf(s) + 1]

/** สถานะก่อนหน้า — ใช้เฉพาะตอนกดผิด (undefined = ย้อนไม่ได้แล้ว) */
export const prevStatus = (s: OrderStatus): OrderStatus | undefined => {
  const i = ORDER_FLOW.indexOf(s)
  return i > 0 ? ORDER_FLOW[i - 1] : undefined
}

/**
 * รายการที่ยังต้องทำจริง (หักส่วนที่ลูกค้าคืนไปแล้วออก)
 * ครัวต้องเห็นจำนวนที่เหลือ ไม่ใช่จำนวนตอนขาย — ไม่งั้นทำเกินแล้วของทิ้ง
 */
export const remainingItems = (sale: Sale) =>
  sale.items
    .map((it) => ({ item: it, qty: refundableQty(it) }))
    .filter((x) => x.qty > 0.0001)

/** บิลนี้ถูกคืนสินค้าครบทั้งใบแล้วหรือยัง (ไม่เหลืออะไรให้ครัวทำ) */
export const isFullyRefunded = (sale: Sale): boolean =>
  sale.kind !== 'refund' && sale.items.length > 0 && remainingItems(sale).length === 0

/** ช่องทางที่ต้องให้คนกดยืนยันก่อน (โอน/บัตร ที่มียอดจ่ายจริงในบิลนี้) */
export function methodsNeedingVerify(sale: Sale): PaymentMethod[] {
  const out: PaymentMethod[] = []
  for (const m of ['transfer', 'card'] as const) {
    if (r2(saleAmountByMethod(sale, m)) > 0) out.push(m)
  }
  return out
}

/** ยอดที่ต้องตรวจ (รวมโอน + บัตร) */
export const amountNeedingVerify = (sale: Sale) =>
  r2(methodsNeedingVerify(sale).reduce((s, m) => s + saleAmountByMethod(sale, m), 0))

/**
 * การชำระเงินของบิลนี้ผ่านการตรวจแล้วหรือยัง
 * - ปิดการบังคับตรวจ (requirePaymentVerify = false) → ผ่านเสมอ
 * - จ่ายเงินสดล้วน → ผ่านเสมอ (ไม่ต้องกดอะไร)
 * - มีโอน/บัตร → ต้องมี paymentVerifiedAt
 */
export function isPaymentVerified(sale: Sale, settings: Settings): boolean {
  if (settings.requirePaymentVerify === false) return true
  if (methodsNeedingVerify(sale).length === 0) return true
  return sale.paymentVerifiedAt != null
}

/** ส่งเข้าครัวได้ไหม — คืนเหตุผลภาษาไทยเมื่อยังไม่ได้ */
export function canSendToKitchen(
  sale: Sale,
  settings: Settings,
): { ok: true } | { ok: false; reason: string } {
  if (sale.status !== 'completed') return { ok: false, reason: 'บิลนี้ถูกยกเลิกไปแล้ว' }
  if (sale.kind === 'refund') return { ok: false, reason: 'เอกสารคืนสินค้าไม่ต้องส่งเข้าครัว' }
  if (sale.orderStatus != null) return { ok: false, reason: 'ออเดอร์นี้ส่งเข้าครัวไปแล้ว' }
  // คืนครบทั้งใบแล้ว = ลูกค้าไม่เอาแล้ว ห้ามส่งให้ครัวทำ
  if (isFullyRefunded(sale)) {
    return { ok: false, reason: 'บิลนี้ถูกคืนสินค้าครบแล้ว ไม่ต้องส่งเข้าครัว' }
  }
  if (!isPaymentVerified(sale, settings)) {
    const methods = methodsNeedingVerify(sale)
      .map((m) => (m === 'transfer' ? 'โอน / QR' : 'บัตร'))
      .join(' และ ')
    return {
      ok: false,
      reason: `ยังไม่ได้ตรวจการชำระเงิน (${methods}) — ตรวจสลิป/ยอดเงินให้ตรงก่อนส่งเข้าครัว`,
    }
  }
  return { ok: true }
}

/** บันทึกว่าตรวจการชำระเงินแล้ว (คนกดคือคนรับผิดชอบ) */
export async function verifyPayment(
  saleId: number,
  opts?: { ref?: string; actor?: Actor },
): Promise<Sale> {
  const who = opts?.actor ?? getActor()
  return db.transaction('rw', db.sales, async () => {
    const sale = await db.sales.get(saleId)
    if (!sale) throw new Error('ไม่พบบิลนี้')
    if (sale.status !== 'completed') throw new Error('บิลนี้ถูกยกเลิกไปแล้ว')
    if (sale.paymentVerifiedAt != null) return sale // ตรวจซ้ำไม่ต้องเขียนใหม่

    const patch = {
      paymentVerifiedAt: Date.now(),
      paymentVerifiedById: who.id,
      paymentVerifiedByName: who.name,
      paymentRef: opts?.ref?.trim() || undefined,
    }
    await db.sales.update(saleId, patch)
    return { ...sale, ...patch }
  })
}

/**
 * ส่งออเดอร์เข้าครัว — ตรวจกติกาซ้ำในทรานแซกชันเดียวกับการเขียน
 * (กันกดสองครั้งพร้อมกัน และกันเรียกจากที่อื่นโดยข้ามด่านตรวจ)
 */
export async function sendToKitchen(saleId: number, opts?: { actor?: Actor }): Promise<Sale> {
  const who = opts?.actor ?? getActor()
  return db.transaction('rw', [db.sales, db.settings], async () => {
    const settings = await db.settings.get(1)
    if (!settings) throw new Error('ยังไม่ได้ตั้งค่าข้อมูลร้าน')
    const sale = await db.sales.get(saleId)
    if (!sale) throw new Error('ไม่พบบิลนี้')

    const gate = canSendToKitchen(sale, settings)
    if (!gate.ok) throw new Error(gate.reason)

    const patch = {
      orderStatus: 'new' as const,
      orderSentAt: Date.now(),
      // ไม่มีใครกดยืนยัน (จ่ายเงินสดล้วน) ก็ถือว่าคนที่กดส่งเข้าครัวเป็นผู้รับผิดชอบ
      paymentVerifiedAt: sale.paymentVerifiedAt ?? Date.now(),
      paymentVerifiedById: sale.paymentVerifiedById ?? who.id,
      paymentVerifiedByName: sale.paymentVerifiedByName ?? who.name,
    }
    await db.sales.update(saleId, patch)
    return { ...sale, ...patch }
  })
}

/** เดินสถานะออเดอร์ (ไปข้างหน้าหรือย้อนกลับเมื่อกดผิด) */
export async function setOrderStatus(saleId: number, to: OrderStatus): Promise<void> {
  await db.transaction('rw', db.sales, async () => {
    const sale = await db.sales.get(saleId)
    if (!sale) throw new Error('ไม่พบออเดอร์นี้')
    if (sale.orderStatus == null) throw new Error('ออเดอร์นี้ยังไม่ได้ส่งเข้าครัว')
    if (sale.status !== 'completed') throw new Error('บิลนี้ถูกยกเลิกไปแล้ว')

    const now = Date.now()
    const patch: Partial<Sale> = { orderStatus: to }
    // จดเวลาไว้ครั้งแรกที่ถึงสถานะนั้น เพื่อวัดเวลาทำอาหารย้อนหลังได้
    if (to === 'ready' && sale.orderReadyAt == null) patch.orderReadyAt = now
    if (to === 'served' && sale.orderServedAt == null) patch.orderServedAt = now
    await db.sales.update(saleId, patch)
  })
}

/**
 * ออเดอร์ที่ยังไม่เสิร์ฟ (เรียงตามเวลาที่ส่งเข้าครัว — เข้าก่อนได้ก่อน)
 * ตัดบิลที่ถูกยกเลิกและบิลที่คืนสินค้าครบทั้งใบออก — ครัวต้องไม่ทำของที่ลูกค้าไม่เอาแล้ว
 * (คืนบางส่วนยังอยู่บนจอ แต่การ์ดจะแสดงจำนวนที่เหลือจริงผ่าน remainingItems)
 */
export async function openOrders(): Promise<Sale[]> {
  const rows = await db.sales.where('orderStatus').anyOf('new', 'preparing', 'ready').toArray()
  return rows
    .filter((s) => s.status === 'completed' && !isFullyRefunded(s))
    .sort((a, b) => (a.orderSentAt ?? 0) - (b.orderSentAt ?? 0))
}

/** ผ่านมากี่นาทีตั้งแต่ส่งเข้าครัว (ใช้เตือนออเดอร์ค้าง) */
export function minutesSinceSent(sale: Sale, now: number = Date.now()): number {
  if (!sale.orderSentAt) return 0
  return Math.max(0, Math.floor((now - sale.orderSentAt) / 60000))
}

/** ออเดอร์นี้ค้างนานเกินที่ตั้งไว้หรือยัง */
export function isOrderLate(sale: Sale, settings: Settings, now: number = Date.now()): boolean {
  const limit = settings.kitchenAlertMinutes ?? 10
  if (limit <= 0 || sale.orderStatus === 'served') return false
  return minutesSinceSent(sale, now) >= limit
}
