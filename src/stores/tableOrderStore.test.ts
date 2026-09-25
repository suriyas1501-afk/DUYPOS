import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product, Settings } from '../db/types'
import { DEFAULT_SETTINGS } from '../db/db'
import { computeTotals } from '../lib/totals'
import { TAKEAWAY_LABEL, tableLabels, useTableOrder } from './tableOrderStore'

/* =========================================================
   ใบสั่งที่โต๊ะ — ขั้นที่ 1-3

   สิ่งที่ต้องตรึงไว้ที่สุดคือ **ยอดในหน้าสรุปต้องเท่ากับที่ computeTotals คิด**
   เพราะยอดนั้นจะถูกฝังใน QR พร้อมเพย์ (ขั้นที่ 4) แล้วเครื่องกลางจะคิดใหม่
   ด้วย finalizeSale (ขั้นที่ 6) — ถ้าสองทางไม่เท่ากัน ลูกค้าจ่ายไม่ตรงบิล
   ========================================================= */

const product = (over: Partial<Product> = {}): Product => ({
  id: 1,
  name: 'ข้าวผัด',
  price: 60,
  cost: 30,
  unit: 'จาน',
  trackStock: true,
  stock: 100,
  active: true,
  createdAt: Date.now(),
  ...over,
})

const settings: Settings = { ...DEFAULT_SETTINGS, vatRate: 0 }

/** state สดจาก store (zustand เก็บ state ไว้นอก React) */
const s = () => useTableOrder.getState()

describe('ใบสั่งที่โต๊ะ — เริ่มออเดอร์และแก้รายการ', () => {
  beforeEach(() => {
    s().clear()
  })

  it('เลือกโต๊ะแล้วได้รหัสใบสั่งใหม่ รายการว่าง ยังไม่ล็อก', () => {
    s().start('5')

    expect(s().tableLabel).toBe('5')
    expect(s().ticketUid).toMatch(/^t-/)
    expect(s().items).toEqual([])
    expect(s().locked).toBe(false)
    expect(s().startedAt).toBeTypeOf('number')
  })

  it('กดสินค้าเดิมซ้ำ = รวมบรรทัดเดียวกัน จำนวนบวกขึ้น', () => {
    s().start('5')
    s().addProduct(product())
    s().addProduct(product())

    expect(s().items).toHaveLength(1)
    expect(s().items[0].qty).toBe(2)
  })

  it('โน้ตต่างกัน = คนละบรรทัด (ครัวต้องเห็นแยก)', () => {
    s().start('5')
    s().addProduct(product(), { note: 'ไม่ใส่ผัก' })
    s().addProduct(product(), { note: 'เผ็ดน้อย' })

    expect(s().items).toHaveLength(2)
  })

  it('ลดจำนวนถึง 0 = เอาบรรทัดออก ไม่ค้างบรรทัดว่างไว้', () => {
    s().start('5')
    s().addProduct(product())
    const key = s().items[0].key

    s().setQty(key, 0)
    expect(s().items).toHaveLength(0)
  })

  it('ย้ายโต๊ะ: รายการและรหัสใบสั่งต้องอยู่ครบ (กดผิดโต๊ะเป็นเรื่องปกติ)', () => {
    s().start('5')
    s().addProduct(product())
    const uid = s().ticketUid

    s().changeTable('12')

    expect(s().tableLabel).toBe('12')
    expect(s().ticketUid).toBe(uid) // ห้ามสร้างใหม่ ไม่งั้นเสี่ยงเกิดบิล 2 ใบ
    expect(s().items).toHaveLength(1)
  })

  it('ย้ายโต๊ะตอนยังไม่ได้เริ่มออเดอร์ ไม่ทำอะไร', () => {
    s().changeTable('7')
    expect(s().tableLabel).toBeUndefined()
  })
})

describe('ใบสั่งที่โต๊ะ — ล็อกยอด (ขั้นที่ 3)', () => {
  beforeEach(() => {
    s().clear()
  })

  it('ใบสั่งเปล่าล็อกไม่ได้ — ไม่มียอดให้ฝังใน QR', () => {
    s().start('5')
    s().lock()
    expect(s().locked).toBe(false)
  })

  it('ล็อกแล้วแก้รายการไม่ได้ทุกทาง จนกดย้อนกลับ', () => {
    s().start('5')
    s().addProduct(product())
    const key = s().items[0].key
    s().lock()
    expect(s().locked).toBe(true)

    s().addProduct(product({ id: 2, name: 'ผัดไทย' }))
    s().setQty(key, 9)
    s().setNote(key, 'เพิ่มไข่')
    s().removeItem(key)

    expect(s().items).toHaveLength(1)
    expect(s().items[0].qty).toBe(1)
    expect(s().items[0].note).toBeUndefined()

    s().unlock()
    s().addProduct(product({ id: 2, name: 'ผัดไทย' }))
    expect(s().items).toHaveLength(2)
  })
})

describe('ใบสั่งที่โต๊ะ — ยอดเงินต้องตรงกับเอนจินคิดเงิน', () => {
  beforeEach(() => {
    s().clear()
  })

  it('ยอดที่จะฝังใน QR = computeTotals().payable', () => {
    s().start('5')
    s().addProduct(product(), { qty: 3 })
    s().addProduct(product({ id: 2, name: 'ชาเย็น', price: 25 }), { qty: 2 })

    const totals = computeTotals({
      items: s().items,
      promos: [],
      settings,
      billDiscountType: 'amount',
      billDiscountValue: 0,
      redeemPoints: 0,
    })

    expect(totals.subtotal).toBe(60 * 3 + 25 * 2)
    expect(totals.payable).toBe(230)
  })

  it('ราคาส่งเด้งเองเหมือนหน้าเคาน์เตอร์ (ใช้ addProductToItems ตัวเดียวกัน)', () => {
    s().start('5')
    const wholesale = product({ price: 60, wholesalePrice: 50, wholesaleMinQty: 10 })

    s().addProduct(wholesale, { qty: 9 })
    expect(s().items[0].price).toBe(60)

    s().addProduct(wholesale, { qty: 1 }) // ครบ 10 → ได้ราคาส่ง
    expect(s().items[0].qty).toBe(10)
    expect(s().items[0].price).toBe(50)
  })

  it('VAT บวกเพิ่ม: ยอดที่ลูกค้าจ่ายต้องรวม VAT แล้ว', () => {
    s().start('5')
    s().addProduct(product({ price: 100 }))

    const totals = computeTotals({
      items: s().items,
      promos: [],
      settings: { ...DEFAULT_SETTINGS, vatRate: 7, vatIncluded: false },
      billDiscountType: 'amount',
      billDiscountValue: 0,
      redeemPoints: 0,
    })

    expect(totals.vatAmount).toBe(7)
    expect(totals.payable).toBe(107)
  })
})

describe('รายชื่อโต๊ะ', () => {
  it('โต๊ะ 1 ถึง N แล้วต่อด้วยกลับบ้าน', () => {
    expect(tableLabels(3)).toEqual(['1', '2', '3', TAKEAWAY_LABEL])
  })

  it('ไม่ตั้งค่า = 20 โต๊ะ', () => {
    expect(tableLabels(undefined)).toHaveLength(21)
  })

  it('ค่าเพี้ยน (0 / ติดลบ / ทศนิยม / มหาศาล) ไม่ทำให้แอปพัง', () => {
    expect(tableLabels(0)).toEqual(['1', TAKEAWAY_LABEL])
    expect(tableLabels(-5)).toEqual(['1', TAKEAWAY_LABEL])
    expect(tableLabels(2.7)).toEqual(['1', '2', TAKEAWAY_LABEL])
    expect(tableLabels(9999)).toHaveLength(201)
  })
})

/* =========================================================
   การ persist ลง localStorage

   นี่คือกลไกเดียวที่กันใบสั่งหายเมื่อ iOS ตัดหน้าเว็บทิ้งตอนพนักงาน
   สลับไปเปิดแอปธนาคาร (ดู TABLE-ORDER-PLAN.md §12, §17)
   ถ้าเทสต์ชุดนี้แดง แปลว่าลำดับ flow ที่ตกลงไว้ไม่ปลอดภัยอีกต่อไป
   ========================================================= */

describe('ใบสั่งที่โต๊ะ — ดราฟต์ต้องถูกเซฟลงเครื่อง', () => {
  beforeEach(async () => {
    s().clear()
    await flush()
  })

  /**
   * zustand persist เขียนลง storage เป็น Promise (ไม่ใช่ซิงโครนัส)
   * จึงต้องปล่อยให้ microtask เดินก่อนอ่าน — ในแอปจริงช่วงนี้สั้นระดับไม่ถึงมิลลิวินาที
   * และเป็นกลไกเดียวกับที่ตะกร้าหน้าเคาน์เตอร์ใช้รอดการรีเฟรชอยู่แล้ว
   */
  const flush = () => Promise.resolve()

  const saved = () => {
    const raw = localStorage.getItem('pos-table-order')
    return raw ? (JSON.parse(raw).state as Record<string, unknown>) : null
  }

  it('เลือกโต๊ะแล้วเซฟทันที', async () => {
    s().start('5')
    await flush()
    expect(saved()?.tableLabel).toBe('5')
    expect(saved()?.ticketUid).toBe(s().ticketUid)
  })

  it('เพิ่มรายการแล้วเซฟทุกครั้ง ไม่ใช่เซฟตอนจบ', async () => {
    s().start('5')
    s().addProduct(product())
    await flush()
    expect((saved()?.items as unknown[]).length).toBe(1)

    s().addProduct(product({ id: 2, name: 'ชาเย็น', price: 25 }))
    await flush()
    expect((saved()?.items as unknown[]).length).toBe(2)
  })

  it('ล็อกยอดแล้วสถานะล็อกถูกเซฟด้วย (เปิดใหม่ต้องกลับมาที่หน้าสรุป)', async () => {
    s().start('5')
    s().addProduct(product())
    s().lock()
    await flush()
    expect(saved()?.locked).toBe(true)
  })

  it('ทิ้งใบสั่งแล้วของที่เซฟไว้ต้องหายด้วย', async () => {
    s().start('5')
    s().addProduct(product())
    s().clear()
    await flush()

    expect(saved()?.tableLabel).toBeUndefined()
    expect((saved()?.items as unknown[]).length).toBe(0)
  })
})

/* =========================================================
   โน้ตต่อบรรทัด — โน้ตเป็นส่วนหนึ่งของ "คีย์รวมบรรทัด"

   ถ้าแก้โน้ตแล้วไม่คำนวณคีย์ใหม่ สินค้าตัวเดิมที่กดเพิ่มทีหลังจะถูกรวมเข้า
   บรรทัดที่มีโน้ต แล้วครัวได้คำสั่งผิด (เช่นลูกค้าอีกคนได้ "ไม่ใส่ไข่" ไปด้วย)
   ========================================================= */

describe('ใบสั่งที่โต๊ะ — โน้ตต่อบรรทัด', () => {
  beforeEach(() => {
    s().clear()
  })

  it('ใส่โน้ตแล้วสินค้าตัวเดิมที่กดเพิ่มทีหลังต้องเป็นบรรทัดใหม่ ไม่ติดโน้ตไปด้วย', () => {
    s().start('5')
    s().addProduct(product())
    s().setNote(s().items[0].key, 'ไม่ใส่ไข่')

    s().addProduct(product()) // ลูกค้าอีกคนสั่งตัวเดิม แบบไม่มีโน้ต

    expect(s().items).toHaveLength(2)
    const notes = s().items.map((i) => i.note)
    expect(notes).toContain('ไม่ใส่ไข่')
    expect(notes).toContain(undefined)
  })

  it('ลบโน้ตออกจนเหมือนอีกบรรทัดเป๊ะ → รวมเป็นบรรทัดเดียว จำนวนรวมกัน', () => {
    s().start('5')
    s().addProduct(product(), { note: 'เผ็ดน้อย' })
    s().addProduct(product(), { qty: 2 })
    expect(s().items).toHaveLength(2)

    const noted = s().items.find((i) => i.note === 'เผ็ดน้อย')!
    s().setNote(noted.key, '   ') // ช่องว่างล้วน = ไม่มีโน้ต

    expect(s().items).toHaveLength(1)
    expect(s().items[0].qty).toBe(3)
    expect(s().items[0].note).toBeUndefined()
  })

  it('แก้โน้ตของบรรทัดที่ไม่มีอยู่ ไม่ทำให้รายการเปลี่ยน', () => {
    s().start('5')
    s().addProduct(product())
    s().setNote('ไม่มีคีย์นี้', 'อะไรก็ตาม')
    expect(s().items).toHaveLength(1)
    expect(s().items[0].note).toBeUndefined()
  })
})

/* =========================================================
   เขียนลงเครื่องไม่ได้กลางทาง (พื้นที่เต็ม / ผู้ใช้ปิดการเก็บข้อมูลเว็บ)

   กรณีนี้อันตรายกว่า "เขียนไม่ได้ตั้งแต่แรก" เพราะการตรวจตอนเปิดแอปผ่านไปแล้ว
   ถ้า error ทะลุออกจาก action จะเกิด 2 อย่าง:
     - ของในหน่วยความจำเปลี่ยนแต่ของบนเครื่องค้าง = เปิดใหม่ได้ใบสั่งบางส่วน (คิดเงินขาด)
     - บรรทัดถัดไปใน onClick ไม่ถูกรัน = หน้าเลือกโต๊ะค้าง / กล่องยืนยันไม่ปิด
   ========================================================= */

describe('ใบสั่งที่โต๊ะ — localStorage เขียนไม่ได้กลางทาง', () => {
  const original = globalThis.localStorage

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: original,
      configurable: true,
      writable: true,
    })
    vi.resetModules()
  })

  /** ที่เก็บที่ผ่านการตรวจ 1 ไบต์ได้ แต่ throw เมื่อเขียนดราฟต์จริง */
  function quotaFullAfterProbe(): Storage {
    const mem = new Map<string, string>()
    return {
      get length() {
        return mem.size
      },
      key: (i: number) => [...mem.keys()][i] ?? null,
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === '__pos_probe__') return void mem.set(k, v)
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    } as Storage
  }

  it('ไม่โยน error ออกจาก action และธงเตือนต้องพลิกเป็นเขียนไม่ได้', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: quotaFullAfterProbe(),
      configurable: true,
      writable: true,
    })
    vi.resetModules()
    const mod = await import('./tableOrderStore')

    // ผ่านการตรวจตอน import (เขียน 1 ไบต์ได้) → ตอนแรกยังเชื่อว่าเก็บได้
    expect(mod.draftPersistence.ok).toBe(true)

    let notified = false
    mod.draftPersistence.subscribe(() => {
      notified = true
    })

    // ทุก action ต้องไม่โยน error ออกมา ไม่งั้น UI ค้างกลางทาง
    expect(() => mod.useTableOrder.getState().start('5')).not.toThrow()
    expect(() => mod.useTableOrder.getState().addProduct(product())).not.toThrow()
    expect(() => mod.useTableOrder.getState().changeTable('9')).not.toThrow()
    expect(() => mod.useTableOrder.getState().clear()).not.toThrow()

    // และต้องประกาศให้ UI รู้ว่าเก็บลงเครื่องไม่ได้แล้ว
    expect(mod.draftPersistence.ok).toBe(false)
    expect(notified).toBe(true)
  })

  it('ยังใช้งานต่อได้ในหน่วยความจำ — รายการไม่หายกลางการรับออเดอร์', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: quotaFullAfterProbe(),
      configurable: true,
      writable: true,
    })
    vi.resetModules()
    const mod = await import('./tableOrderStore')
    const st = () => mod.useTableOrder.getState()

    st().start('7')
    st().addProduct(product())
    st().addProduct(product({ id: 2, name: 'ชาเย็น', price: 25 }))

    expect(st().tableLabel).toBe('7')
    expect(st().items).toHaveLength(2)
    expect(mod.draftPersistence.ok).toBe(false)
  })
})
