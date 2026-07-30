import { create } from 'zustand'
import type { Product } from '../db/types'
import { r2 } from '../lib/format'

export interface CartItem {
  key: string // ใช้รวมบรรทัดที่เหมือนกัน (productId + options)
  productId: number // 0 = รายการกำหนดเอง
  categoryId?: number
  name: string
  price: number // ราคาต่อหน่วย (รวมส่วนเพิ่มตัวเลือกแล้ว)
  cost: number
  qty: number
  options?: string[]
  note?: string
  manualDiscount: number // ส่วนลดต่อบรรทัด (บาท)
  trackStock: boolean
  stock: number
}

export type BillDiscountType = 'percent' | 'amount'

interface CartState {
  items: CartItem[]
  memberId?: number
  billDiscountType: BillDiscountType
  billDiscountValue: number
  redeemPoints: number

  addProduct(
    p: Product,
    opts?: { options?: string[]; priceDelta?: number; note?: string; qty?: number },
  ): void
  addCustomItem(name: string, price: number, qty: number): void
  setQty(key: string, qty: number): void
  updateItem(key: string, patch: Partial<Pick<CartItem, 'qty' | 'manualDiscount' | 'note'>>): void
  removeItem(key: string): void
  setMember(id?: number): void
  setBillDiscount(type: BillDiscountType, value: number): void
  setRedeemPoints(n: number): void
  clear(): void
  load(
    items: CartItem[],
    memberId?: number,
    opts?: {
      billDiscountType?: BillDiscountType
      billDiscountValue?: number
      redeemPoints?: number
    },
  ): void
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  memberId: undefined,
  billDiscountType: 'amount',
  billDiscountValue: 0,
  redeemPoints: 0,

  addProduct(p, opts) {
    const options = opts?.options
    const note = opts?.note?.trim() || undefined
    const price = r2(p.price + (opts?.priceDelta ?? 0))
    const key = `${p.id}|${(options ?? []).join(',')}|${note ?? ''}|${price}`
    const qty = opts?.qty ?? 1
    set((s) => {
      const found = s.items.find((it) => it.key === key)
      if (found) {
        return {
          items: s.items.map((it) => (it.key === key ? { ...it, qty: it.qty + qty } : it)),
        }
      }
      const item: CartItem = {
        key,
        productId: p.id!,
        categoryId: p.categoryId,
        name: p.name,
        price,
        cost: p.cost,
        qty,
        options,
        note,
        manualDiscount: 0,
        trackStock: p.trackStock,
        stock: p.stock,
      }
      return { items: [...s.items, item] }
    })
  },

  addCustomItem(name, price, qty) {
    const item: CartItem = {
      key: `custom|${Date.now()}`,
      productId: 0,
      name: name.trim() || 'รายการกำหนดเอง',
      price: r2(price),
      cost: 0,
      qty,
      manualDiscount: 0,
      trackStock: false,
      stock: 0,
    }
    set((s) => ({ items: [...s.items, item] }))
  },

  setQty(key, qty) {
    if (qty <= 0) {
      get().removeItem(key)
      return
    }
    set((s) => ({
      items: s.items.map((it) => (it.key === key ? { ...it, qty } : it)),
    }))
  },

  updateItem(key, patch) {
    set((s) => ({
      items: s.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    }))
  },

  removeItem(key) {
    set((s) => ({ items: s.items.filter((it) => it.key !== key) }))
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

  clear() {
    set({
      items: [],
      memberId: undefined,
      billDiscountType: 'amount',
      billDiscountValue: 0,
      redeemPoints: 0,
    })
  },

  load(items, memberId, opts) {
    set({
      items,
      memberId,
      billDiscountType: opts?.billDiscountType ?? 'amount',
      billDiscountValue: opts?.billDiscountValue ?? 0,
      redeemPoints: opts?.redeemPoints ?? 0,
    })
  },
}))
