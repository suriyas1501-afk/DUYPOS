import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Product, ProductUnit } from '../db/types'
import { r2 } from '../lib/format'

export interface CartItem {
  key: string // ใช้รวมบรรทัดที่เหมือนกัน (productId + หน่วย + options + โน้ต)
  productId: number // 0 = รายการกำหนดเอง
  categoryId?: number
  name: string
  /** ราคาต่อหน่วยที่ใช้จริง (รวมส่วนเพิ่มตัวเลือก + ราคาส่งถ้าเข้าเงื่อนไข) */
  price: number
  /** ราคาปกติต่อหน่วย (รวมส่วนเพิ่มตัวเลือก) — ใช้เทียบเมื่อได้ราคาส่ง */
  listPrice: number
  /** ราคาขายส่งต่อหน่วย (เฉพาะหน่วยฐาน) */
  wholesalePrice?: number
  wholesaleMinQty?: number
  cost: number
  qty: number
  /** ชื่อหน่วยที่ขาย (ไม่ระบุ = หน่วยฐาน) */
  unitName?: string
  /** ตัวคูณตัดสต็อกของหน่วยที่ขาย */
  unitFactor: number
  /** สินค้านี้ขายเป็นทศนิยมได้ (ชั่งน้ำหนัก) */
  allowDecimalQty: boolean
  options?: string[]
  note?: string
  manualDiscount: number // ส่วนลดต่อบรรทัด (บาท)
  trackStock: boolean
  stock: number // สต็อกคงเหลือ (หน่วยฐาน)
}

export type BillDiscountType = 'percent' | 'amount'

/** ราคาที่ใช้จริงตามจำนวน — ได้ราคาส่งเมื่อซื้อครบขั้นต่ำ (หน่วยฐานเท่านั้น) */
export function effectivePrice(
  it: Pick<CartItem, 'listPrice' | 'wholesalePrice' | 'wholesaleMinQty' | 'unitFactor'>,
  qty: number,
): number {
  if (
    it.unitFactor === 1 &&
    it.wholesalePrice != null &&
    it.wholesaleMinQty != null &&
    it.wholesaleMinQty > 0 &&
    qty >= it.wholesaleMinQty
  ) {
    return r2(it.wholesalePrice)
  }
  return r2(it.listPrice)
}

/**
 * เพดานจำนวนต่อบรรทัด — กันบาร์โค้ดที่ยิงลงช่องจำนวนโดยไม่ตั้งใจ
 * (เช่น '8850100100100') กลายเป็นยอดบิล/การตัดสต็อกระดับล้านล้าน
 */
export const MAX_LINE_QTY = 9999

/**
 * คีย์รวมบรรทัด — สินค้า + หน่วย + ตัวเลือก + โน้ต + ราคาปกติ
 * (ต้องคำนวณใหม่ทุกครั้งที่แก้โน้ต/ตัวเลือก ไม่งั้นบรรทัดจะรวมผิด)
 */
const lineKey = (
  it: Pick<CartItem, 'productId' | 'unitName' | 'options' | 'note' | 'listPrice'>,
) =>
  `${it.productId}|${it.unitName ?? ''}|${(it.options ?? []).join(',')}|${it.note ?? ''}|${it.listPrice}`

/** จัดจำนวนให้ถูกชนิด — สินค้าปกติเป็นจำนวนเต็ม, สินค้าชั่งน้ำหนักทศนิยม 2 ตำแหน่ง */
const normalizeQty = (qty: number, allowDecimal: boolean) => {
  const n = Number.isFinite(qty) ? qty : 0
  const clamped = Math.min(Math.max(0, n), MAX_LINE_QTY)
  return allowDecimal ? r2(clamped) : Math.round(clamped)
}

interface CartState {
  items: CartItem[]
  memberId?: number
  billDiscountType: BillDiscountType
  billDiscountValue: number
  redeemPoints: number
  /** โค้ดคูปองที่ใช้กับบิลนี้ (ตัวพิมพ์ใหญ่) */
  couponCode?: string
  /* ===== ผู้อนุมัติส่วนลดของ "บิลใบนี้" =====
     ต้องเก็บไว้ในตะกร้า ไม่ใช่ใน state ของคอมโพเนนต์ เพราะ "ตัวเลขส่วนลด" อยู่ในตะกร้า
     ซึ่ง persist ลง localStorage และถูกก๊อบไปเก็บใน heldBills ตอนพักบิล
     ถ้าสถานะอนุมัติอยู่คนละที่กับตัวเลข มันจะหลุดจากกันได้ (รีเฟรชหน้า / พักบิลแล้วเรียกกลับ)
     → ส่วนลดยังติดอยู่ทั้งที่ป้ายขึ้นว่า "ต้องขออนุมัติ" กลายเป็นอนุมัติครั้งเดียวใช้ได้ตลอด */
  discountApprovedById?: number
  discountApprovedByName?: string

  addProduct(
    p: Product,
    opts?: {
      options?: string[]
      priceDelta?: number
      note?: string
      qty?: number
      /** หน่วยที่เลือกขาย (ไม่ระบุ = หน่วยฐาน) */
      unit?: ProductUnit
    },
  ): void
  addCustomItem(name: string, price: number, qty: number): void
  setQty(key: string, qty: number): void
  updateItem(key: string, patch: Partial<Pick<CartItem, 'qty' | 'manualDiscount' | 'note'>>): void
  removeItem(key: string): void
  setMember(id?: number): void
  setBillDiscount(type: BillDiscountType, value: number): void
  setRedeemPoints(n: number): void
  setCouponCode(code?: string): void
  /** บันทึก/ล้างผู้อนุมัติส่วนลดของบิลนี้ (undefined = ยังไม่มีการอนุมัติ) */
  setDiscountApproval(actor: { id?: number; name?: string } | undefined): void
  /** ล้างส่วนลดทุกชนิดของบิลนี้ทิ้ง (รายบรรทัด + ท้ายบิล + คูปอง + แต้ม) พร้อมผู้อนุมัติ */
  clearDiscounts(): void
  clear(): void
  load(
    items: CartItem[],
    memberId?: number,
    opts?: {
      billDiscountType?: BillDiscountType
      billDiscountValue?: number
      redeemPoints?: number
      couponCode?: string
      discountApprovedById?: number
      discountApprovedByName?: string
    },
  ): void
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      memberId: undefined,
      billDiscountType: 'amount',
      billDiscountValue: 0,
      redeemPoints: 0,
      couponCode: undefined,
      discountApprovedById: undefined,
      discountApprovedByName: undefined,

      addProduct(p, opts) {
        const options = opts?.options
        const note = opts?.note?.trim() || undefined
        const unit = opts?.unit
        const delta = opts?.priceDelta ?? 0
        const listPrice = r2((unit ? unit.price : p.price) + delta)
        const unitFactor = unit ? unit.factor : 1
        const unitName = unit?.name
        const allowDecimalQty = !!p.allowDecimalQty && unitFactor === 1
        const wholesalePrice =
          !unit && p.wholesalePrice != null ? r2(p.wholesalePrice + delta) : undefined
        const wholesaleMinQty = !unit ? p.wholesaleMinQty : undefined

        const key = lineKey({ productId: p.id!, unitName, options, note, listPrice })
        const addQty = normalizeQty(opts?.qty ?? 1, allowDecimalQty) || (allowDecimalQty ? 0.01 : 1)

        set((s) => {
          const found = s.items.find((it) => it.key === key)
          if (found) {
            return {
              items: s.items.map((it) => {
                if (it.key !== key) return it
                const qty = normalizeQty(it.qty + addQty, it.allowDecimalQty)
                return { ...it, qty, price: effectivePrice(it, qty) }
              }),
            }
          }
          const base = {
            key,
            productId: p.id!,
            categoryId: p.categoryId,
            name: p.name,
            listPrice,
            wholesalePrice,
            wholesaleMinQty,
            cost: r2(p.cost * unitFactor),
            unitName,
            unitFactor,
            allowDecimalQty,
            options,
            note,
            manualDiscount: 0,
            trackStock: p.trackStock,
            stock: p.stock,
          }
          const item: CartItem = {
            ...base,
            qty: addQty,
            price: effectivePrice(base, addQty),
          }
          return { items: [...s.items, item] }
        })
      },

      addCustomItem(name, price, qty) {
        const p = r2(price)
        const item: CartItem = {
          key: `custom|${Date.now()}|${Math.round(p * 100)}`,
          productId: 0,
          name: name.trim() || 'รายการกำหนดเอง',
          price: p,
          listPrice: p,
          cost: 0,
          qty: Math.max(1, Math.round(qty)),
          unitFactor: 1,
          allowDecimalQty: false,
          manualDiscount: 0,
          trackStock: false,
          stock: 0,
        }
        set((s) => ({ items: [...s.items, item] }))
      },

      setQty(key, qty) {
        const target = get().items.find((it) => it.key === key)
        const next = normalizeQty(qty, target?.allowDecimalQty ?? false)
        if (next <= 0) {
          get().removeItem(key)
          return
        }
        set((s) => ({
          items: s.items.map((it) =>
            it.key === key ? { ...it, qty: next, price: effectivePrice(it, next) } : it,
          ),
        }))
      },

      updateItem(key, patch) {
        set((s) => {
          const idx = s.items.findIndex((it) => it.key === key)
          if (idx < 0) return {}
          const it = s.items[idx]
          const merged: CartItem = { ...it, ...patch }
          if (patch.qty != null) {
            merged.qty = normalizeQty(patch.qty, it.allowDecimalQty)
            merged.price = effectivePrice(it, merged.qty)
          }
          // โน้ตเป็นส่วนหนึ่งของคีย์ — ต้องคำนวณใหม่ ไม่งั้นสินค้าตัวเดิม (ไม่มีโน้ต)
          // ที่กดเพิ่มทีหลังจะถูกรวมเข้าบรรทัดนี้และติดโน้ตไปด้วย (สลิปครัวผิด)
          if (it.productId !== 0) merged.key = lineKey(merged)
          if (merged.key !== it.key) {
            const twinIdx = s.items.findIndex((x, i) => i !== idx && x.key === merged.key)
            if (twinIdx >= 0) {
              // ซ้ำกับอีกบรรทัดที่เหมือนกันทุกอย่างแล้ว → รวมเข้าด้วยกัน
              const twin = s.items[twinIdx]
              const qty = normalizeQty(twin.qty + merged.qty, twin.allowDecimalQty)
              const combined: CartItem = {
                ...twin,
                qty,
                price: effectivePrice(twin, qty),
                manualDiscount: r2(twin.manualDiscount + merged.manualDiscount),
              }
              return {
                items: s.items
                  .map((x, i) => (i === twinIdx ? combined : x))
                  .filter((_, i) => i !== idx),
              }
            }
          }
          return { items: s.items.map((x, i) => (i === idx ? merged : x)) }
        })
      },

      removeItem(key) {
        set((s) => {
          const items = s.items.filter((it) => it.key !== key)
          // ลบจนตะกร้าว่าง = จบบิลนั้นไปแล้ว — คูปอง/ส่วนลดท้ายบิล/แต้มที่กดแลกต้องไม่ค้าง
          // ไปใช้กับลูกค้าคนถัดไป (แผงสรุปยอดถูกซ่อนตอนตะกร้าว่าง จึงมองไม่เห็นว่ายังค้างอยู่)
          // การอนุมัติของผู้จัดการก็มีผลแค่บิลใบนั้น จึงต้องหมดอายุไปพร้อมกัน
          if (items.length === 0) {
            return {
              items,
              billDiscountType: 'amount' as BillDiscountType,
              billDiscountValue: 0,
              redeemPoints: 0,
              couponCode: undefined,
              discountApprovedById: undefined,
              discountApprovedByName: undefined,
            }
          }
          return { items }
        })
      },

      setMember(id) {
        set({ memberId: id, redeemPoints: 0 })
      },

      setBillDiscount(type, value) {
        set({ billDiscountType: type, billDiscountValue: Math.max(0, value) })
      },

      setRedeemPoints(n) {
        set({ redeemPoints: Math.max(0, Math.floor(n)) })
      },

      setCouponCode(code) {
        set({ couponCode: code ? code.trim().toUpperCase() : undefined })
      },

      setDiscountApproval(actor) {
        set({
          discountApprovedById: actor?.id,
          discountApprovedByName: actor?.id != null ? actor.name : undefined,
        })
      },

      clearDiscounts() {
        set((s) => ({
          // ส่วนลดรายบรรทัดก็ต้องหลุดไปด้วย ไม่งั้นยังมีส่วนลดที่ไม่มีใครรับผิดชอบค้างในบิล
          items: s.items.some((it) => it.manualDiscount !== 0)
            ? s.items.map((it) => (it.manualDiscount === 0 ? it : { ...it, manualDiscount: 0 }))
            : s.items,
          billDiscountType: 'amount' as BillDiscountType,
          billDiscountValue: 0,
          redeemPoints: 0,
          couponCode: undefined,
          discountApprovedById: undefined,
          discountApprovedByName: undefined,
        }))
      },

      clear() {
        set({
          items: [],
          memberId: undefined,
          billDiscountType: 'amount',
          billDiscountValue: 0,
          redeemPoints: 0,
          couponCode: undefined,
          discountApprovedById: undefined,
          discountApprovedByName: undefined,
        })
      },

      load(items, memberId, opts) {
        set({
          items,
          memberId,
          billDiscountType: opts?.billDiscountType ?? 'amount',
          billDiscountValue: opts?.billDiscountValue ?? 0,
          redeemPoints: opts?.redeemPoints ?? 0,
          couponCode: opts?.couponCode,
          // บิลที่พักไว้พกผู้อนุมัติเดิมกลับมาด้วย — ผู้จัดการอนุมัติ "บิลใบนี้" ไว้แล้ว
          // ไม่ต้องขออนุมัติซ้ำตอนเรียกกลับ (บิลที่ไม่มีผู้อนุมัติจะถูกล้างส่วนลดที่ CartPanel)
          discountApprovedById: opts?.discountApprovedById,
          discountApprovedByName: opts?.discountApprovedByName,
        })
      },
    }),
    {
      // กันตะกร้าหายเมื่อเผลอรีเฟรช/เครื่องรีสตาร์ทกลางบิล
      name: 'pos-cart',
      version: 1,
      partialize: (s) => ({
        items: s.items,
        memberId: s.memberId,
        billDiscountType: s.billDiscountType,
        billDiscountValue: s.billDiscountValue,
        redeemPoints: s.redeemPoints,
        couponCode: s.couponCode,
        // ต้อง persist คู่กับตัวเลขส่วนลดเสมอ — ถ้าเก็บแค่ตัวเลข ส่วนลดจะรอดการรีเฟรช
        // มาโดยไม่มีผู้อนุมัติ (CartPanel จะล้างทิ้งให้เมื่อคนที่ล็อกอินอยู่ไม่มีสิทธิ์)
        discountApprovedById: s.discountApprovedById,
        discountApprovedByName: s.discountApprovedByName,
      }),
    },
  ),
)
