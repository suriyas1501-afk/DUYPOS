import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { PaymentMethod, Product } from '../db/types'
import {
  addProductToItems,
  effectivePrice,
  normalizeQty,
  updateItemInItems,
  type AddProductOpts,
  type CartItem,
} from './cartStore'
import { r2 } from '../lib/format'

/* =========================================================
   ใบสั่งที่โต๊ะ (โหมดรับออเดอร์ที่โต๊ะด้วยมือถือ) — ขั้นที่ 1-3

   **ต้องเป็น store แยกจาก cartStore เด็ดขาด** ใช้คนละคีย์ใน localStorage
   ถ้าใช้ตะกร้าเดียวกัน พนักงานเดินรับออเดอร์ที่โต๊ะจะทับตะกร้าที่แคชเชียร์
   กำลังคิดเงินอยู่หน้าเคาน์เตอร์ (เครื่องกลางกับมือถือรันโค้ดชุดเดียวกัน)

   แต่ **การคิดราคาต้องใช้ addProductToItems() ร่วมกับ cartStore**
   ห้ามคัดลอกสูตรมาไว้ที่นี่ ไม่งั้นยอดสองทางจะเพี้ยนกันเมื่อไรก็ได้

   การ persist ไม่ใช่ของแถม — เป็นสิ่งที่ทำให้ลำดับ flow ของเจ้าของร้านปลอดภัย
   (ดู TABLE-ORDER-PLAN.md §17) iOS ตัดหน้าเว็บทิ้งได้ตอนพนักงานสลับไปแอปธนาคาร
   ดราฟต์ที่อยู่ใน localStorage คือสิ่งเดียวที่กันออเดอร์หายในจังหวะนั้น
   ========================================================= */

/* ---------------------------------------------------------
   ที่เก็บดราฟต์

   ดราฟต์ที่เซฟลงเครื่องคือ **สิ่งเดียว** ที่กันใบสั่งหายเมื่อ iOS ตัดหน้าเว็บทิ้ง
   ตอนพนักงานสลับไปเปิดแอปธนาคาร (ดู TABLE-ORDER-PLAN.md §12, §17)

   แต่ localStorage ใช้ไม่ได้เสมอไป — Safari โหมดส่วนตัว หรือเบราว์เซอร์ที่ถูกตั้ง
   ให้บล็อกข้อมูลเว็บ จะ throw ตอนเขียน ถ้าไม่ดักไว้ ดราฟต์จะหายเงียบๆ
   โดยที่พนักงานยังเชื่อว่าปลอดภัยอยู่ จึงต้อง
     1) ถอยไปเก็บในหน่วยความจำ เพื่อให้ใช้งานต่อได้ในรอบนั้น
     2) บอก UI ว่าตอนนี้เก็บลงเครื่องไม่ได้ (draftPersistence — subscribe ได้)
        เพื่อเตือนพนักงานว่าอย่าสลับแอปกลางทาง
   --------------------------------------------------------- */

function probeLocalStorage(): Storage | null {
  try {
    const ls = globalThis.localStorage
    if (!ls) return null
    const probe = '__pos_probe__'
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    return ls
  } catch {
    return null
  }
}

/** ที่เก็บสำรองในหน่วยความจำ — อยู่ได้เท่าที่หน้าเว็บยังเปิดอยู่ */
function memoryStorage(): Storage {
  const mem = new Map<string, string>()
  return {
    get length() {
      return mem.size
    },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
    clear: () => mem.clear(),
  } as Storage
}

/* ---------------------------------------------------------
   สถานะ "เก็บลงเครื่องได้ไหม" — ต้องเป็นค่าที่เปลี่ยนกลางทางได้

   การตรวจตอนเปิดแอปครั้งเดียวไม่พอ เพราะเขียนไม่ได้กลางทางเกิดได้จริง:
   พื้นที่เครื่องใกล้เต็ม (iOS มีโควตาจำกัด) · ผู้ใช้สลับสวิตช์บล็อกข้อมูลเว็บ ·
   origin ถูก evict · และการตรวจเขียนแค่ 1 ไบต์ผ่าน แต่ดราฟต์จริงหลาย KB ไม่ผ่าน

   ถ้าปล่อยให้ setItem โยน error ออกมา จะเกิด 2 อย่างที่แย่กว่าข้อมูลหาย:
     1) state ในหน่วยความจำเปลี่ยนแล้วแต่ของบนเครื่องค้างเป็นของเก่า
        → เปิดใหม่ได้ใบสั่ง "บางส่วน" แล้วล็อกยอดจากรายการที่ขาด = คิดเงินขาด
     2) error ทะลุออกจาก action ทำให้บรรทัดถัดไปใน onClick เดียวกันไม่ถูกรัน
        (zustand ห่อ set เป็น `(...a) => { set(...a); return setItem() }` ไม่มี try/catch)
        → กดย้ายโต๊ะแล้วหน้าเลือกโต๊ะค้างไม่ปิด กดทิ้งใบสั่งแล้วกล่องยืนยันไม่ปิด
   --------------------------------------------------------- */

type Listener = () => void

const realStorage = probeLocalStorage()
const fallback = memoryStorage()
let persistOk = realStorage != null
const listeners = new Set<Listener>()

function markPersistFailed() {
  if (!persistOk) return
  persistOk = false
  for (const l of listeners) l()
}

/**
 * ดราฟต์ถูกเก็บลงเครื่องจริงไหม (subscribe ได้ เพราะเปลี่ยนกลางทางได้)
 *
 * false = เก็บไว้ในหน่วยความจำเท่านั้น ปิดแท็บหรือ iOS ตัดหน้าเว็บ = ใบสั่งหาย
 * หน้าจอต้องเตือนพนักงานเมื่อเป็น false (ห้ามเงียบ)
 */
export const draftPersistence = {
  get ok(): boolean {
    return persistOk
  },
  subscribe(l: Listener): () => void {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
}

/**
 * ที่เก็บที่ล้มไม่เป็น — เขียนพลาดแล้วสลับไปหน่วยความจำ ไม่โยน error ออกไปข้างนอก
 * (ความถูกต้องของ UI สำคัญกว่าการรู้ว่าเขียนพลาด ส่วนการแจ้งเตือนใช้ธง draftPersistence)
 */
function resilientStorage(): Storage {
  const active = () => (persistOk && realStorage ? realStorage : fallback)
  return {
    get length() {
      return active().length
    },
    key: (i) => active().key(i),
    getItem: (k) => {
      try {
        return active().getItem(k)
      } catch {
        markPersistFailed()
        return fallback.getItem(k)
      }
    },
    setItem: (k, v) => {
      try {
        active().setItem(k, v)
      } catch {
        // เขียนลงเครื่องไม่ได้ → ประกาศให้ UI รู้ แล้วเขียนลงหน่วยความจำต่อ
        markPersistFailed()
        try {
          fallback.setItem(k, v)
        } catch {
          /* หน่วยความจำก็ยังพลาด = หมดทาง แต่ห้ามโยนออกไปทำให้ UI ค้าง */
        }
      }
    },
    removeItem: (k) => {
      try {
        active().removeItem(k)
      } catch {
        markPersistFailed()
      }
      try {
        fallback.removeItem(k)
      } catch {
        /* ไม่เป็นไร */
      }
    },
    clear: () => {
      try {
        active().clear()
      } catch {
        markPersistFailed()
      }
    },
  } as Storage
}

const draftStorage = createJSONStorage(() => resilientStorage())

/** ชื่อโต๊ะที่ใช้แทน "ไม่ระบุโต๊ะ" (ซื้อกลับบ้าน / รับหน้าร้าน) */
export const TAKEAWAY_LABEL = 'กลับบ้าน'

/** จำนวนโต๊ะเริ่มต้นเมื่อร้านยังไม่ได้ตั้งค่า */
export const DEFAULT_TABLE_COUNT = 20

/**
 * รหัสใบสั่ง — สร้างที่เครื่องพนักงาน ณ ขั้นที่ 1
 *
 * ตัวนี้คือกุญแจกันบิลซ้ำตอนส่งเข้าเครื่องกลาง (ดู OrderTicket ใน src/db/types.ts)
 * ต้องสร้างครั้งเดียวตอนเริ่มออเดอร์ **ห้ามสร้างใหม่ตอนกดส่ง** ไม่งั้นกดส่งซ้ำ
 * จะได้รหัสใหม่และเครื่องกลางจะออกบิลใบที่สอง
 *
 * crypto.randomUUID มีเฉพาะใน secure context — เปิดผ่าน http://<ไอพีในวง LAN>
 * จะไม่มี จึงต้องมีทางสำรองแบบเดียวกับ SHA-256 ใน src/lib/auth.ts
 */
export function newTicketUid(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return `t-${c.randomUUID()}`
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
  return `t-${Date.now().toString(36)}-${rand}`
}

interface TableOrderState {
  /** รหัสใบสั่ง — มีค่าเมื่อเริ่มออเดอร์แล้ว */
  ticketUid?: string
  /** เลขโต๊ะแบบสตริง เช่น "5" หรือ TAKEAWAY_LABEL */
  tableLabel?: string
  startedAt?: number
  items: CartItem[]
  /**
   * กดสรุปรายการแล้ว (ขั้นที่ 3 ผ่าน) = ยอดถูกล็อก
   *
   * ห้ามแก้รายการต่อในสถานะนี้ เพราะขั้นที่ 4 จะสร้าง QR พร้อมเพย์ที่ฝังยอดเงินไว้
   * ถ้าแก้รายการหลังกาง QR ยอดใน QR จะไม่ตรงกับบิล — ต้องกดย้อนกลับ (unlock)
   * ซึ่งเป็นการประกาศชัดว่าต้องสร้าง QR ใหม่
   */
  locked: boolean
  /**
   * เข้าหน้ารับเงินแล้ว (ขั้นที่ 4) — ต่อจาก locked
   * แยกจาก locked เพราะขั้นที่ 3 (ทบทวนยอด) กับขั้นที่ 4 (กาง QR + ถ่ายรูป) คนละหน้า
   */
  payStarted: boolean
  /**
   * ยอดที่ถูกล็อกตอนกดสรุปรายการ (ขั้นที่ 3)
   *
   * **ยอดนี้คือยอดเดียวที่ถูกต้อง** ตั้งแต่ขั้นที่ 3 ไปจนออกบิล — QR ฝังยอดนี้
   * ลูกค้าจ่ายยอดนี้ และบิลต้องเป็นยอดนี้
   * ห้ามคิดยอดสดใหม่ตอนกดส่ง เพราะโปรโมชันกรองตามเวลาจริง (promotions.ts ใช้ Date.now())
   * ใบสั่งที่ค้างข้ามช่วงโปรฯ จะได้ยอดใหม่ที่ไม่ตรงกับเงินที่ลูกค้าโอนมาแล้ว
   */
  lockedPayable?: number
  /** รูปสลิปที่แนบไว้ (อยู่ในตาราง slipQueue ไม่ใช่ในดราฟต์นี้) */
  slipId?: string
  /** เหตุผลที่ไม่มีรูปสลิป เช่น กล้องใช้ไม่ได้ */
  slipMissingReason?: string
  /**
   * ลูกค้าจ่ายด้วยอะไร — ต้องบันทึกไว้ ไม่ใช่เดาจากข้อความเหตุผล
   * เพราะเงินสดกับโอนเข้าลิ้นชักคนละทาง (ดู cashCustody ใน §13)
   */
  payMethod: PaymentMethod

  /** เริ่มออเดอร์ใหม่ที่โต๊ะนี้ (ทิ้งดราฟต์เดิมถ้ามี) */
  start(tableLabel: string): void
  /**
   * ย้ายใบสั่งที่กำลังทำอยู่ไปโต๊ะอื่น — **เก็บรายการและรหัสใบสั่งเดิมไว้**
   * พนักงานกดโต๊ะผิดเป็นเรื่องปกติ ไม่ควรต้องกดรายการใหม่ทั้งใบ
   * และห้ามสร้าง ticketUid ใหม่ ไม่งั้นถ้าเคยส่งไปแล้วจะเกิดบิลใบที่สอง
   */
  changeTable(tableLabel: string): void
  addProduct(p: Product, opts?: AddProductOpts): void
  setQty(key: string, qty: number): void
  setNote(key: string, note: string): void
  removeItem(key: string): void
  /** ล็อกยอด (กดสรุปรายการ) — ต้องส่งยอดที่คิดได้ ณ ตอนนั้นมาเก็บไว้ */
  lock(payable: number): void
  /**
   * กลับไปแก้รายการ
   *
   * **ทำไม่ได้ถ้ามีรูปสลิปแนบอยู่แล้ว** — สลิปคือหลักฐานว่าเงินเข้ามาแล้ว
   * ถ้าปล่อยให้ย้อนไปแก้รายการเงียบๆ ยอดจะไม่ตรงกับเงินที่รับไปจริง
   * ต้องถอนหลักฐานออกก่อนด้วย clearSlip() ซึ่งเป็นการกดที่ตั้งใจ
   */
  unlock(): void
  /** เข้าหน้ารับเงิน (ขั้นที่ 4) */
  startPay(): void
  /** ย้อนจากหน้ารับเงินกลับไปหน้าสรุป (ทำไม่ได้ถ้ามีสลิปแนบแล้ว) */
  backToSummary(): void
  /** แนบรูปสลิป (แทนใบเดิมถ้ามี — ผู้เรียกต้องลบไฟล์เก่าเอง) */
  attachSlip(slipId: string): void
  /** ถอนรูปสลิปออก (ผู้เรียกต้องลบไฟล์เอง) */
  clearSlip(): void
  /** บันทึกว่าไม่มีสลิปเพราะอะไร (ค่าว่าง = ล้างเหตุผล) */
  setSlipMissing(reason: string): void
  /** ลูกค้าจ่ายด้วยอะไร */
  setPayMethod(method: PaymentMethod): void
  clear(): void
}

const EMPTY = {
  ticketUid: undefined,
  tableLabel: undefined,
  startedAt: undefined,
  items: [] as CartItem[],
  locked: false,
  payStarted: false,
  lockedPayable: undefined,
  slipId: undefined,
  slipMissingReason: undefined,
  // ค่าเริ่มต้นเป็นโอน เพราะทางหลักของโหมดนี้คือกาง QR ให้ลูกค้าสแกน
  payMethod: 'transfer' as PaymentMethod,
}

export const useTableOrder = create<TableOrderState>()(
  persist(
    (set, get) => ({
      ...EMPTY,

      start(tableLabel) {
        set({
          ...EMPTY,
          ticketUid: newTicketUid(),
          tableLabel: tableLabel.trim() || TAKEAWAY_LABEL,
          startedAt: Date.now(),
        })
      },

      changeTable(tableLabel) {
        const label = tableLabel.trim() || TAKEAWAY_LABEL
        set((s) => (s.tableLabel == null ? s : { tableLabel: label }))
      },

      addProduct(p, opts) {
        // ล็อกยอดแล้วห้ามเพิ่มของ — กันยอดขยับหลังสร้าง QR
        if (get().locked) return
        set((s) => ({ items: addProductToItems(s.items, p, opts) }))
      },

      setQty(key, qty) {
        if (get().locked) return
        set((s) => ({
          items: s.items.flatMap((it) => {
            if (it.key !== key) return [it]
            const n = normalizeQty(qty, it.allowDecimalQty)
            // จำนวนเหลือ 0 = เอาออกจากใบสั่ง (ไม่เก็บบรรทัดว่างไว้ให้ครัวสับสน)
            if (n <= 0) return []
            return [{ ...it, qty: n, price: effectivePrice(it, n) }]
          }),
        }))
      },

      setNote(key, note) {
        if (get().locked) return
        // ต้องผ่าน updateItemInItems เพราะโน้ตเป็นส่วนหนึ่งของคีย์รวมบรรทัด
        // ถ้าเขียน map เองแล้วไม่คิดคีย์ใหม่ สินค้าตัวเดิมที่กดเพิ่มทีหลัง
        // จะถูกรวมเข้าบรรทัดที่มีโน้ต → ครัวได้คำสั่งผิด
        set((s) => ({ items: updateItemInItems(s.items, key, { note: note.trim() || undefined }) }))
      },

      removeItem(key) {
        if (get().locked) return
        set((s) => ({ items: s.items.filter((it) => it.key !== key) }))
      },

      lock(payable) {
        // ใบสั่งเปล่าล็อกไม่ได้ — ไม่มียอดให้ฝังใน QR
        if (get().items.length === 0) return
        if (!Number.isFinite(payable) || payable < 0) return
        set({ locked: true, lockedPayable: r2(payable) })
      },

      unlock() {
        // มีหลักฐานการจ่ายแล้ว = ห้ามย้อนไปแก้ยอดเงียบๆ
        if (get().slipId != null) return
        set({ locked: false, payStarted: false, lockedPayable: undefined })
      },

      startPay() {
        if (!get().locked) return
        set({ payStarted: true })
      },

      backToSummary() {
        if (get().slipId != null) return
        set({ payStarted: false })
      },

      attachSlip(slipId) {
        set({ slipId, slipMissingReason: undefined })
      },

      clearSlip() {
        set({ slipId: undefined })
      },

      setPayMethod(method) {
        set({ payMethod: method })
      },

      setSlipMissing(reason) {
        const trimmed = reason.trim() || undefined
        // ระบุเหตุผลว่าไม่มีสลิป = ถอนสลิปออก (สองอย่างนี้อยู่ด้วยกันไม่ได้)
        // แต่การล้างเหตุผลทิ้งต้องไม่ไปลบสลิปที่แนบอยู่
        set(trimmed ? { slipMissingReason: trimmed, slipId: undefined } : { slipMissingReason: undefined })
      },

      clear() {
        set({ ...EMPTY })
      },
    }),
    {
      // คนละคีย์กับ 'pos-cart' ของหน้าเคาน์เตอร์ — ห้ามใช้ร่วมกัน
      name: 'pos-table-order',
      version: 1,
      // กำหนดเองเพื่อให้ถอยไปหน่วยความจำได้เมื่อ localStorage ถูกบล็อก
      storage: draftStorage,
    },
  ),
)

/** มีดราฟต์ค้างอยู่ไหม (ใช้ถามผู้ใช้ว่าจะทำต่อหรือทิ้ง) */
export const hasTableDraft = (s: Pick<TableOrderState, 'tableLabel' | 'items'>) =>
  s.tableLabel != null && s.items.length > 0

/**
 * ดราฟต์นี้ไปถึงขั้นรับเงินแล้วหรือยัง
 *
 * ใช้ตัดสินว่า UI จะเสนอปุ่ม "ทิ้งใบสั่ง" แบบธรรมดาได้ไหม
 * 'paid' = มีหลักฐานการจ่ายแนบอยู่ = เงินเข้ามาแล้ว ห้ามเสนอให้ทิ้งลอยๆ
 * ต้องบอกยอดที่รับไปด้วย และห้ามลบร่องรอยในตาราง slipQueue ทิ้ง
 */
export type DraftPayStage = 'none' | 'paying' | 'paid'

export const draftPayStage = (
  s: Pick<TableOrderState, 'payStarted' | 'slipId' | 'slipMissingReason' | 'payMethod'>,
): DraftPayStage => {
  // เงินสด = เห็นเงินอยู่ในมือ ถือว่าตรวจแล้วในตัว (กติกาเดียวกับ src/lib/quickService.ts)
  // สลิปมีไว้สำหรับการโอน ซึ่งเป็นช่องทางที่ปลอมหลักฐานได้
  if (s.payMethod === 'cash') return 'paid'
  if (s.slipId != null || (s.slipMissingReason?.trim() ?? '') !== '') return 'paid'
  return s.payStarted ? 'paying' : 'none'
}

/** จำนวนชิ้นรวมในใบสั่ง (สินค้าชั่งน้ำหนักนับตามน้ำหนัก) */
export const tableItemCount = (items: CartItem[]) => items.reduce((n, it) => n + it.qty, 0)

/** ชื่อโต๊ะที่เลือกได้ทั้งหมด — "1".."N" แล้วต่อด้วยกลับบ้าน */
export function tableLabels(count: number | undefined): string[] {
  const n = Math.max(1, Math.min(200, Math.floor(count ?? DEFAULT_TABLE_COUNT)))
  return [...Array.from({ length: n }, (_, i) => String(i + 1)), TAKEAWAY_LABEL]
}
