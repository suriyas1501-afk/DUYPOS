import { db } from '../db/db'
import type { OrderTicket, Payment, Sale, Settings } from '../db/types'
import type { Promotion } from '../db/types'
import type { CartItem } from '../stores/cartStore'
import type { Actor } from './actor'
import { finalizeSale } from './checkout'
import { computeTotals } from './totals'
import { r2 } from './format'

/* =========================================================
   ขั้นที่ 5-6 — เครื่องกลางรับใบสั่งจากมือถือ แล้วออกบิล

   **เครื่องกลางเป็นผู้ออกเลขบิลคนเดียว (single writer)** นี่คือเหตุผลทั้งหมด
   ที่โหมดนี้ใช้เวลา 7 สัปดาห์แทน 15-19 สัปดาห์ตาม SYNC-PLAN.md — มือถือส่ง
   "ใบสั่ง" ไม่ใช่ "บิล" จึงไม่มีเลขบิลซ้ำ ไม่มีสต็อกชนกัน ไม่มีกะซ้อน

   ไฟล์นี้ไม่รู้จักช่องทางส่งข้อมูลเลย (ยังไม่มีคลาวด์ในเฟสนี้) รับ ticket
   เป็นข้อมูลธรรมดา เพื่อให้ตรรกะที่อันตรายที่สุดถูกทดสอบได้ก่อนต่อ Supabase
   ========================================================= */

/**
 * เวอร์ชันของรูปแบบใบสั่ง
 *
 * มือถือติดเลขนี้มากับทุกใบสั่ง เครื่องกลางปฏิเสธถ้าไม่เข้ากัน —
 * จำเป็นเพราะหน้าที่เปิดค้างทั้งกะไม่เช็คเวอร์ชันเอง (ดู TABLE-ORDER-PLAN.md §12)
 * เครื่องหนึ่งอัปเดตแล้วอีกเครื่องยังเป็นของเก่าจึงเกิดได้จริง
 */
export const TICKET_SCHEMA_VERSION = 1

export interface TableOrderTicket {
  /** รหัสที่มือถือสร้างตอนเริ่มออเดอร์ — กุญแจกันบิลซ้ำทั้งหมดของโหมดนี้ */
  ticketUid: string
  schemaVersion: number
  tableLabel: string
  items: CartItem[]
  payments: Payment[]
  /** ยอดที่ลูกค้าจ่ายไปจริง (ยอดที่ฝังใน QR ตอนขั้นที่ 4) */
  paidAmount: number
  /** พนักงานที่รับออเดอร์และยืนยันว่าเงินเข้า */
  actor: Actor
  verifiedAt: number
  slipId?: string
  slipMissingReason?: string
}

export type IntakeResult =
  | { ok: true; sale: Sale; duplicate: boolean }
  | { ok: false; reason: string }

/** ผลต่างที่ยอมรับได้จากการปัดเศษ */
const EPS = 0.005

/**
 * ตรวจใบสั่งก่อนออกบิล — แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อทดสอบได้ง่าย
 *
 * **ยอดต้องตรงกับที่ลูกค้าจ่ายไปจริง** เครื่องกลางคิดยอดใหม่จาก items ที่ส่งมา
 * (ซึ่งพกราคาของตัวเองมาแบบ snapshot) แล้วเทียบกับ paidAmount
 * ถ้าไม่ตรง **ห้ามออกบิลเงียบๆ ด้วยยอดใดยอดหนึ่ง** เพราะ:
 *   - ใช้ยอดที่คิดใหม่ = บิลไม่ตรงกับเงินที่เข้าบัญชี
 *   - ใช้ยอดที่จ่ายมา = บิลไม่ตรงกับรายการสินค้าในบิลเอง
 * ต้องปฏิเสธให้คนมาดู (เกิดได้เมื่อโปรโมชันเปลี่ยนระหว่างที่ใบสั่งค้างอยู่)
 */
export function validateTicket(
  ticket: TableOrderTicket,
  recomputedPayable: number,
): { ok: true } | { ok: false; reason: string } {
  if (ticket.schemaVersion !== TICKET_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `แอปบนมือถือเป็นเวอร์ชันคนละรุ่นกับเครื่องกลาง (ใบสั่ง v${ticket.schemaVersion} · เครื่องนี้รับ v${TICKET_SCHEMA_VERSION}) — ปิดแล้วเปิดแอปใหม่ทั้งสองเครื่อง`,
    }
  }
  if (!ticket.ticketUid?.trim()) return { ok: false, reason: 'ใบสั่งไม่มีรหัสอ้างอิง' }
  if (ticket.items.length === 0) return { ok: false, reason: 'ใบสั่งไม่มีรายการสินค้า' }
  if (ticket.verifiedAt == null) {
    return { ok: false, reason: 'ใบสั่งนี้ยังไม่มีการยืนยันว่าเงินเข้า' }
  }
  if (Math.abs(r2(recomputedPayable) - r2(ticket.paidAmount)) > EPS) {
    return {
      ok: false,
      reason: `ยอดไม่ตรงกับที่ลูกค้าจ่าย (จ่ายมา ฿${r2(ticket.paidAmount)} · คิดได้ ฿${r2(recomputedPayable)}) — อาจมีโปรโมชันเปลี่ยนระหว่างรับออเดอร์ ให้ตรวจก่อนออกบิล`,
    }
  }
  return { ok: true }
}

/**
 * รับใบสั่งแล้วออกบิล — **ทั้งหมดอยู่ในทรานแซกชันเดียว**
 *
 * ต้องอยู่ในทรานแซกชันเดียวเพราะ "ทำเครื่องหมายว่าออกบิลแล้ว" กับ "ออกบิล"
 * ต้องเกิดพร้อมกันหรือไม่เกิดเลย ไม่งั้นมือถือกดส่งซ้ำ (เน็ตช้าแล้วกดใหม่)
 * จะได้บิลใบที่สอง ซึ่งกินเลขบิล ตัดสต็อกซ้ำ และเก็บเงินลูกค้าสองรอบในรายงาน
 *
 * กดส่งซ้ำด้วย ticketUid เดิมจะได้บิลใบเดิมคืนไป (duplicate: true)
 */
export async function receiveTicket(
  ticket: TableOrderTicket,
  settings: Settings,
  promos: Promotion[],
): Promise<IntakeResult> {
  const totals = computeTotals({
    items: ticket.items,
    promos,
    settings,
    billDiscountType: 'amount',
    billDiscountValue: 0,
    redeemPoints: 0,
  })

  return db.transaction(
    'rw',
    [
      db.orderTickets,
      db.sales,
      db.products,
      db.members,
      db.stockMoves,
      db.coupons,
      db.shifts,
      db.settings,
    ],
    async () => {
      const existing = await db.orderTickets.get(ticket.ticketUid)

      /* ===== ด่านกันบิลซ้ำต้องมาก่อนทุกอย่าง =====
         เดิมตรวจความถูกต้องก่อนแล้วค่อยเช็คซ้ำ ซึ่งพังเพราะทางปฏิเสธ put() ทับทั้งแถว
         ทำให้แถวที่เป็น 'billed' เสีย saleId ไป แล้วด่านนี้ก็ผ่านฉลุย → ออกบิลใบที่สอง
         ใบสั่งที่ออกบิลแล้วต้องคืนบิลใบเดิมทันที ไม่ต้องตรวจอะไรอีก */
      if (existing?.state === 'billed') {
        if (existing.saleId != null) {
          const sale = await db.sales.get(existing.saleId)
          if (sale) return { ok: true as const, sale, duplicate: true }
        }
        // แถวบอกว่าออกบิลแล้วแต่หาบิลไม่เจอ = ข้อมูลไม่สอดคล้อง ห้ามเดาออกใบใหม่
        return {
          ok: false as const,
          reason: 'ใบสั่งนี้เคยออกบิลแล้วแต่หาบิลไม่พบ — ให้ตรวจที่ประวัติการขายก่อน',
        }
      }

      const check = validateTicket(ticket, totals.payable)
      if (!check.ok) {
        /* บันทึกว่าปฏิเสธเพราะอะไร — **ต้องอยู่ในทรานแซกชันนี้** และห้ามทับแถว 'billed'
           (ด่านข้างบนคัดกรองไปแล้ว) · คง createdAt เดิมไว้ ไม่งั้นเวลาที่ใช้ตามเรื่องจะเพี้ยน */
        await db.orderTickets.put({
          ticketUid: ticket.ticketUid,
          state: 'rejected',
          rejectReason: check.reason,
          tableLabel: ticket.tableLabel,
          createdAt: existing?.createdAt ?? Date.now(),
        })
        return { ok: false as const, reason: check.reason }
      }

      const sale = await finalizeSale({
        items: ticket.items,
        totals,
        settings,
        payments: ticket.payments,
        // **ต้องส่ง actor ของพนักงานที่โต๊ะทับ** ไม่งั้น getActor() จะให้ชื่อ
        // แคชเชียร์ที่เครื่องกลางเป็นผู้ขาย (ดู checkout.ts บรรทัด actor)
        actor: ticket.actor,
      })
      if (sale.id == null) throw new Error('ออกบิลไม่สำเร็จ')

      /* ฟิลด์ของโหมดโต๊ะที่ finalizeSale ไม่รู้จัก — เขียนทับเฉพาะฟิลด์
         ไม่ใช่ put() ทั้งแถว (กฎเดียวกับ taxInvoice.ts ใน CLAUDE.md) */
      const cashPaid = ticket.payments.some((p) => p.method === 'cash' && p.amount > 0)
      const patch: Partial<Sale> = {
        orderChannel: 'table',
        tableLabel: ticket.tableLabel,
        ticketUid: ticket.ticketUid,
        paymentVerifiedAt: ticket.verifiedAt,
        paymentVerifiedById: ticket.actor.id,
        paymentVerifiedByName: ticket.actor.name,
        slipId: ticket.slipId,
        slipMissingReason: ticket.slipMissingReason,
      }
      /* เงินสดที่รับไว้ที่โต๊ะยังไม่ถึงลิ้นชัก — ต้องทำเครื่องหมายไว้
         ไม่งั้น computeShiftSummary จะนับว่าอยู่ในลิ้นชักแล้วและปิดกะจะขาด
         (ดูเหตุผลเต็มใน TABLE-ORDER-PLAN.md §13) */
      if (cashPaid && settings.tableCashEnabled) {
        patch.cashCustody = 'staff'
        patch.cashCustodyById = ticket.actor.id
        patch.cashCustodyByName = ticket.actor.name
      }
      await db.sales.update(sale.id, patch)

      const row: OrderTicket = {
        ticketUid: ticket.ticketUid,
        state: 'billed',
        saleId: sale.id,
        tableLabel: ticket.tableLabel,
        createdAt: existing?.createdAt ?? Date.now(),
        billedAt: Date.now(),
      }
      await db.orderTickets.put(row)

      return { ok: true as const, sale: { ...sale, ...patch }, duplicate: false }
    },
  )
}

/* ---------------------------------------------------------
   บทบาทของเครื่อง — เก็บใน appState เพราะเป็นค่า "ของเครื่องนี้"
   ไม่ใช่ค่าของร้าน (appState อยู่นอก TABLES จึงไม่ติดไปกับไฟล์สำรอง
   และไม่ถูกทับตอนนำเข้าข้อมูลจากอีกเครื่อง — ดู src/lib/backup.ts)

   **เครื่องกลางต้องมีเครื่องเดียว** นี่คือหลักที่ทำให้ไม่มีเลขบิลซ้ำ
   ถ้ามือถือออกบิลเองด้วย เลขบิลจะชนกับเครื่องเคาน์เตอร์ทันที
   (nextSeq() ใน docNo.ts หาเลขมากสุด "ในเครื่องตัวเอง" เท่านั้น)
   --------------------------------------------------------- */

const DEVICE_ROLE_KEY = 'deviceRole'

/** 'central' = เครื่องที่ออกบิล · 'handheld' = มือถือรับออเดอร์ที่โต๊ะ */
export type DeviceRole = 'central' | 'handheld'

/** ไม่เคยตั้ง = undefined (ยังออกบิลจากใบสั่งไม่ได้ ต้องเลือกก่อน) */
export async function getDeviceRole(): Promise<DeviceRole | undefined> {
  const row = await db.appState.get(DEVICE_ROLE_KEY)
  const v = row?.value
  return v === 'central' || v === 'handheld' ? v : undefined
}

export async function setDeviceRole(role: DeviceRole | undefined): Promise<void> {
  if (role == null) await db.appState.delete(DEVICE_ROLE_KEY)
  else await db.appState.put({ key: DEVICE_ROLE_KEY, value: role })
}

/**
 * เครื่องนี้ออกบิลจากใบสั่งที่โต๊ะได้ไหม
 *
 * ยังไม่มีช่องทางส่งข้อมูลข้ามเครื่องในเฟสนี้ ดังนั้น "ส่งเข้าเครื่องกลาง"
 * ทำได้เฉพาะเมื่อเครื่องที่รับออเดอร์กับเครื่องที่ออกบิลเป็นเครื่องเดียวกัน
 * (ผู้เขียนบิลคนเดียว = ปลอดภัย) พอต่อคลาวด์แล้วค่อยเปิดให้มือถือส่งข้ามเครื่องได้
 */
export function canBillHere(role: DeviceRole | undefined): { ok: true } | { ok: false; reason: string } {
  if (role === 'central') return { ok: true }
  if (role === 'handheld') {
    return {
      ok: false,
      reason: 'เครื่องนี้ตั้งเป็นมือถือรับออเดอร์ — การส่งข้ามเครื่องต้องรอการต่อคลาวด์',
    }
  }
  return {
    ok: false,
    reason: 'ยังไม่ได้ตั้งว่าเครื่องนี้เป็นเครื่องกลางหรือมือถือ — ตั้งได้ที่หน้าตั้งค่า',
  }
}

/** ใบสั่งที่เครื่องกลางปฏิเสธไว้ (ไว้แสดงให้คนมาตาม) */
export const rejectedTickets = () =>
  db.orderTickets.where('state').equals('rejected').reverse().sortBy('createdAt')
