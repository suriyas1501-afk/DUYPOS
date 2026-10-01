import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product, Settings } from '../db/types'
import { DEFAULT_SETTINGS } from '../db/db'
import { computeTotals } from '../lib/totals'
import { TAKEAWAY_LABEL, draftPayStage, tableLabels, useTableOrder } from './tableOrderStore'

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
    s().lock(60)
    expect(s().locked).toBe(false)
  })

  it('ล็อกแล้วแก้รายการไม่ได้ทุกทาง จนกดย้อนกลับ', () => {
    s().start('5')
    s().addProduct(product())
    const key = s().items[0].key
    s().lock(60)
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
    s().lock(60)
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

/* =========================================================
   ขั้นที่ 4 — หน้ารับเงินและหลักฐานการจ่าย

   กติกาที่ต้องตรึง: มีหลักฐานการจ่ายแล้ว **ห้ามย้อนไปแก้ยอดเงียบๆ**
   เพราะยอดที่แก้จะไม่ตรงกับเงินที่รับไปจริง (และ QR ที่กางไปแล้วฝังยอดเก่า)
   ========================================================= */

describe('ใบสั่งที่โต๊ะ — ขั้นที่ 4 รับเงินและแนบสลิป', () => {
  beforeEach(() => {
    s().clear()
    s().start('5')
    s().addProduct(product())
  })

  it('เข้าหน้ารับเงินได้เฉพาะเมื่อล็อกยอดแล้ว', () => {
    s().startPay()
    expect(s().payStarted).toBe(false) // ยังไม่ล็อก = เข้าไม่ได้

    s().lock(60)
    s().startPay()
    expect(s().payStarted).toBe(true)
  })

  it('ยังไม่มีสลิป → ย้อนกลับหน้าสรุปและกลับไปแก้รายการได้', () => {
    s().lock(60)
    s().startPay()

    s().backToSummary()
    expect(s().payStarted).toBe(false)

    s().unlock()
    expect(s().locked).toBe(false)
  })

  it('แนบสลิปแล้ว → ย้อนกลับไม่ได้ทั้งสองทาง (กันยอดไม่ตรงเงินที่รับไปจริง)', () => {
    s().lock(60)
    s().startPay()
    s().attachSlip('s-abc')

    s().backToSummary()
    expect(s().payStarted).toBe(true) // ยังอยู่หน้ารับเงิน

    s().unlock()
    expect(s().locked).toBe(true) // ยังล็อกยอดอยู่

    // ถอนหลักฐานออกก่อน (การกดที่ตั้งใจ) จึงย้อนได้
    s().clearSlip()
    s().backToSummary()
    expect(s().payStarted).toBe(false)
    s().unlock()
    expect(s().locked).toBe(false)
  })

  it('ระบุว่าไม่มีสลิป = ถอนสลิปออก และสองอย่างนี้อยู่ด้วยกันไม่ได้', () => {
    s().lock(60)
    s().startPay()
    s().attachSlip('s-abc')

    s().setSlipMissing('ลูกค้าจ่ายเงินสด')
    expect(s().slipId).toBeUndefined()
    expect(s().slipMissingReason).toBe('ลูกค้าจ่ายเงินสด')

    // แนบรูปทีหลัง = ล้างเหตุผลทิ้ง
    s().attachSlip('s-xyz')
    expect(s().slipMissingReason).toBeUndefined()
    expect(s().slipId).toBe('s-xyz')
  })

  it('ล้างเหตุผลทิ้ง ต้องไม่ไปลบสลิปที่แนบอยู่', () => {
    s().lock(60)
    s().startPay()
    s().attachSlip('s-keep')

    s().setSlipMissing('   ') // ช่องว่างล้วน = ล้างเหตุผล
    expect(s().slipMissingReason).toBeUndefined()
    expect(s().slipId).toBe('s-keep') // ห้ามหาย
  })

  it('เริ่มออเดอร์โต๊ะใหม่ = ล้างสถานะขั้นที่ 4 ทั้งหมด', () => {
    s().lock(60)
    s().startPay()
    s().attachSlip('s-abc')
    s().setSlipMissing('')

    s().start('9')

    expect(s().tableLabel).toBe('9')
    expect(s().locked).toBe(false)
    expect(s().payStarted).toBe(false)
    expect(s().slipId).toBeUndefined()
    expect(s().slipMissingReason).toBeUndefined()
    expect(s().items).toEqual([])
  })
})

/* =========================================================
   สถานะการรับเงินของดราฟต์

   ใช้ตัดสินว่า UI จะเสนอปุ่ม "ทิ้งใบสั่ง" ลอยๆ ได้ไหม
   เคยพลาด: กล่อง "มีใบสั่งค้างอยู่" เด้งทับหน้ารับเงินทุกครั้งที่เปิดแอปใหม่
   พร้อมปุ่มทิ้งที่ไม่บอกว่าบิลนี้รับเงินไปแล้ว → พนักงานกดทิ้ง
   = เงินเข้าบัญชีแล้วแต่ไม่มีบิล ไม่มีรูป ไม่มีเลขโต๊ะเหลืออยู่ที่ไหน
   ========================================================= */

describe('draftPayStage — ดราฟต์ไปถึงขั้นรับเงินแล้วหรือยัง', () => {
  it('ยังไม่เข้าหน้ารับเงิน = none', () => {
    expect(draftPayStage({ payStarted: false, payMethod: 'transfer' })).toBe('none')
  })

  it('เข้าหน้ารับเงินแล้วแต่ยังไม่มีหลักฐาน = paying (ทิ้งได้ตามปกติ)', () => {
    expect(draftPayStage({ payStarted: true, payMethod: 'transfer' })).toBe('paying')
  })

  it('มีรูปสลิปแนบ = paid', () => {
    expect(draftPayStage({ payStarted: true, slipId: 's-1', payMethod: 'transfer' })).toBe('paid')
  })

  it('ระบุเหตุผลว่าไม่มีสลิป ก็ถือว่ารับเงินแล้ว = paid', () => {
    expect(draftPayStage({ payStarted: true, slipMissingReason: 'ลูกค้าจ่ายเงินสด', payMethod: 'transfer' })).toBe('paid')
  })

  it('เหตุผลเป็นช่องว่างล้วน ไม่นับเป็นหลักฐาน', () => {
    expect(draftPayStage({ payStarted: true, slipMissingReason: '   ', payMethod: 'transfer' })).toBe('paying')
  })

  it('มีหลักฐานแต่ payStarted หลุดหาย ยังต้องเป็น paid (หลักฐานสำคัญกว่าธง)', () => {
    expect(draftPayStage({ payStarted: false, slipId: 's-1', payMethod: 'transfer' })).toBe('paid')
  })
})

describe('ทิ้งใบสั่ง — ต้องไม่ลบร่องรอยการรับเงิน', () => {
  beforeEach(() => {
    s().clear()
  })

  it('clear() ไม่แตะตาราง slipQueue เลย (ร่องรอยต้องรอดแม้ใบสั่งหาย)', async () => {
    const { saveSlip } = await import('../lib/slipPhoto')
    const { db } = await import('../db/db')
    await db.slipQueue.clear()

    s().start('5')
    s().addProduct(product())
    s().lock(60)
    s().startPay()
    const slipId = await saveSlip({
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      tableLabel: '5',
      amount: 650,
    })
    s().attachSlip(slipId)

    s().clear()

    // ดราฟต์หายแล้ว แต่แถวที่บอกว่ารับเงินโต๊ะไหนไปเท่าไร ต้องยังอยู่
    expect(s().tableLabel).toBeUndefined()
    const row = await db.slipQueue.get(slipId)
    expect(row).toBeDefined()
    expect(row?.tableLabel).toBe('5')
    expect(row?.amount).toBe(650)
  })
})

/* =========================================================
   ยอดที่ล็อกไว้ตอนขั้นที่ 3

   เคยพัง: ล็อกแต่ "รายการ" ไม่ได้ล็อก "ยอด" แล้วตอนกดส่งไปคิดยอดใหม่สดๆ
   โปรโมชันกรองตามเวลาจริง (promotions.ts ใช้ Date.now()) ใบสั่งที่ค้าง
   ข้ามช่วงโปรฯ จะได้ยอดใหม่ที่ไม่ตรงกับเงินที่ลูกค้าโอนมาแล้ว
   ========================================================= */

describe('ยอดที่ล็อกไว้ (lockedPayable)', () => {
  beforeEach(() => {
    s().clear()
    s().start('5')
    s().addProduct(product())
  })

  it('กดสรุปรายการแล้วยอดถูกเก็บไว้', () => {
    s().lock(123.45)
    expect(s().locked).toBe(true)
    expect(s().lockedPayable).toBe(123.45)
  })

  it('กลับไปแก้รายการ = ล้างยอดที่ล็อกไว้ (ต้องล็อกใหม่ จะได้ QR ใหม่)', () => {
    s().lock(100)
    s().unlock()
    expect(s().locked).toBe(false)
    expect(s().lockedPayable).toBeUndefined()
  })

  it('ยอดเพี้ยน (NaN / ติดลบ) ล็อกไม่ได้', () => {
    s().lock(Number.NaN)
    expect(s().locked).toBe(false)
    s().lock(-5)
    expect(s().locked).toBe(false)
    expect(s().lockedPayable).toBeUndefined()
  })

  it('ใบสั่งเปล่าล็อกไม่ได้ และไม่เก็บยอด', () => {
    s().clear()
    s().start('5')
    s().lock(50)
    expect(s().locked).toBe(false)
    expect(s().lockedPayable).toBeUndefined()
  })

  it('เริ่มโต๊ะใหม่ = ล้างยอดที่ล็อกไว้', () => {
    s().lock(100)
    s().start('9')
    expect(s().lockedPayable).toBeUndefined()
  })
})

describe('จ่ายเงินสด = ถือว่าตรวจแล้วในตัว', () => {
  beforeEach(() => {
    s().clear()
    s().start('5')
    s().addProduct(product())
    s().lock(60)
    s().startPay()
  })

  it('เลือกเงินสด → ส่งได้เลยไม่ต้องมีสลิป (กติกาเดียวกับ quickService)', () => {
    s().setPayMethod('cash')
    expect(draftPayStage(s())).toBe('paid')
  })

  it('เลือกโอน → ต้องมีสลิปหรือเหตุผลก่อน', () => {
    s().setPayMethod('transfer')
    expect(draftPayStage(s())).toBe('paying')

    s().attachSlip('s-1')
    expect(draftPayStage(s())).toBe('paid')
  })
})
