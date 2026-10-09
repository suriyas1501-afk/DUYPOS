import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import type { Product } from '../db/types'
import {
  CATALOG_SCHEMA_VERSION,
  applyCatalogSnapshot,
  buildCatalogSnapshot,
  canonicalJson,
  catalogRevOf,
  checkSnapshotShape,
  ensureCatalogId,
  type CatalogSnapshot,
} from './catalog'
import { addProduct, resetDb } from '../test/helpers'

/* =========================================================
   แคตตาล็อกที่แชร์ให้มือถือ

   ของที่พลาดแล้วเสียหายที่สุด: **ตัดสต็อกผิดตัวแบบเงียบ**
   `Product.id` เป็น auto-increment ของแต่ละเครื่อง ถ้ามือถือใช้คนละชุด
   ใบสั่งจะอ้างสินค้าผิดตัว โดยที่ด่านเทียบยอดเงินจับไม่ได้เลย
   (ดู TABLE-ORDER-PLAN.md §21 ข้อ 1)
   ========================================================= */

beforeEach(async () => {
  await resetDb({ tableOrderEnabled: true, vatRate: 0 })
})

describe('canonicalJson — ต้องได้สตริงเดิมแม้ลำดับคีย์ต่างกัน', () => {
  it('เรียงคีย์ให้เหมือนกัน', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })

  it('ตัดคีย์ที่เป็น undefined ออก — ของที่อ่านจาก Dexie กับที่ประกอบในหน่วยความจำต่างกันที่นี่', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
  })

  it('ค่าที่คิดไม่ได้ (NaN) ไม่ทำให้สตริงพัง', () => {
    expect(canonicalJson({ a: NaN })).toBe('{"a":null}')
  })

  it('ลำดับในอาเรย์มีความหมาย ห้ามเรียงใหม่', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })
})

describe('catalogRevOf — รุ่นต้องเปลี่ยนเมื่อสิ่งที่กระทบเงินเปลี่ยน', () => {
  const base = (over: Partial<Product> = {}): Product => ({
    id: 1,
    name: 'ข้าวผัด',
    price: 60,
    cost: 20,
    unit: 'จาน',
    trackStock: true,
    stock: 10,
    active: true,
    createdAt: 1,
    ...over,
  })

  const body = (products: Product[]) => ({
    settings: { shopName: 'ร้าน', vatRate: 0, vatIncluded: true },
    categories: [],
    products,
    promotions: [],
  })

  it('เนื้อหาเดิม = รุ่นเดิม', () => {
    expect(catalogRevOf(body([base()]))).toBe(catalogRevOf(body([base()])))
  })

  it('ราคาเปลี่ยน = รุ่นเปลี่ยน', () => {
    expect(catalogRevOf(body([base()]))).not.toBe(catalogRevOf(body([base({ price: 65 })])))
  })

  it('ชื่อเปลี่ยน = รุ่นเปลี่ยน (พนักงานอ่านชื่อนี้ตอนกดสั่ง)', () => {
    expect(catalogRevOf(body([base()]))).not.toBe(catalogRevOf(body([base({ name: 'ข้าวผัดกุ้ง' })])))
  })

  it('หมวดเปลี่ยน = รุ่นเปลี่ยน (โปรโมชันจับคู่ด้วย categoryId)', () => {
    expect(catalogRevOf(body([base()]))).not.toBe(catalogRevOf(body([base({ categoryId: 2 })])))
  })

  /* ถ้าเอา stock เข้าแฮช รุ่นจะเปลี่ยนทุกบิลที่ขาย แล้วคำใบ้ "แคตตาล็อกเก่า"
     จะขึ้นตลอดเวลาจนไม่มีความหมาย — สต็อกไม่ได้กระทบการคิดเงินที่มือถือ */
  it('สต็อกเปลี่ยน = รุ่น **ไม่** เปลี่ยน', () => {
    expect(catalogRevOf(body([base()]))).toBe(catalogRevOf(body([base({ stock: 3 })])))
  })

  it('ค่าตั้งที่กระทบเงิน (vatRate) เปลี่ยน = รุ่นเปลี่ยน', () => {
    const a = { ...body([base()]), settings: { shopName: 'ร้าน', vatRate: 0, vatIncluded: true } }
    const b = { ...body([base()]), settings: { shopName: 'ร้าน', vatRate: 7, vatIncluded: true } }
    expect(catalogRevOf(a)).not.toBe(catalogRevOf(b))
  })
})

describe('ensureCatalogId', () => {
  it('สร้างครั้งเดียว เรียกซ้ำได้ค่าเดิม', async () => {
    const first = await ensureCatalogId()
    expect(first).toMatch(/^cat-/)
    expect(await ensureCatalogId()).toBe(first)
    expect((await db.settings.get(1))?.catalogId).toBe(first)
  })
})

describe('buildCatalogSnapshot', () => {
  it('พกรหัสสินค้าไปด้วย (นั่นคือทั้งหมดของเรื่องนี้)', async () => {
    const id = await addProduct({ name: 'ข้าวผัด', price: 60, cost: 20, stock: 100 })
    const snap = await buildCatalogSnapshot()

    expect(snap.schemaVersion).toBe(CATALOG_SCHEMA_VERSION)
    expect(snap.products.map((p) => p.id)).toContain(id)
    expect(snap.catalogId).toMatch(/^cat-/)
  })

  it('บันทึกรุ่นที่เผยแพร่ลง settings ของเครื่องกลางเอง', async () => {
    await addProduct({ name: 'ข้าวผัด', price: 60, cost: 20, stock: 100 })
    const snap = await buildCatalogSnapshot()
    expect((await db.settings.get(1))?.catalogRev).toBe(snap.catalogRev)
  })

  /* รูปเก็บเป็น data URL ซึ่งบวม 33% จาก base64 · 500 รายการที่มีรูปละ 20KB
     = 10MB ต่อการส่งหนึ่งครั้ง ซึ่งเกินทั้งเพดาน RPC และโควตาฟรี */
  it('ไม่ส่งรูปสินค้าไปด้วย', async () => {
    const id = await addProduct({ name: 'ข้าวผัด', price: 60, cost: 20, stock: 100 })
    await db.products.update(id, { image: 'data:image/png;base64,AAAA' })

    const snap = await buildCatalogSnapshot()
    expect(snap.products.find((p) => p.id === id)?.image).toBeUndefined()
  })

  it('ไม่ส่งค่าตั้งที่เป็นของเครื่อง (ความกว้างใบเสร็จ / เวลาสำรองล่าสุด)', async () => {
    await db.settings.update(1, { receiptWidth: '80', lastBackupAt: 12345, staffEnabled: true })
    const snap = await buildCatalogSnapshot()

    expect('receiptWidth' in snap.settings).toBe(false)
    expect('lastBackupAt' in snap.settings).toBe(false)
    expect('staffEnabled' in snap.settings).toBe(false)
    expect(snap.settings.vatRate).toBe(0)
  })
})

describe('checkSnapshotShape', () => {
  const good = (): CatalogSnapshot => ({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogId: 'cat-1',
    catalogRev: 'r1',
    exportedAt: 1,
    settings: { vatRate: 0 },
    categories: [],
    products: [],
    promotions: [],
  })

  it('ก้อนที่ถูกต้องผ่าน', () => {
    expect(checkSnapshotShape(good()).ok).toBe(true)
  })

  it('รุ่นของรูปแบบไม่ตรง = ปฏิเสธ (ห้ามเดาว่าเข้ากันได้)', () => {
    const res = checkSnapshotShape({ ...good(), schemaVersion: 99 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/รุ่น/)
  })

  it('ไฟล์อะไรก็ไม่รู้ = ปฏิเสธ', () => {
    expect(checkSnapshotShape(null).ok).toBe(false)
    expect(checkSnapshotShape({ hello: 1 }).ok).toBe(false)
  })

  /* สินค้าที่ไม่มี id = จุดประสงค์ทั้งหมดของแคตตาล็อกหายไป เพราะ bulkAdd
     จะแจก id ใหม่ให้เอง แล้วมือถือกับเครื่องกลางจะใช้เลขคนละชุดเหมือนเดิม */
  it('สินค้าไม่มีรหัส = ปฏิเสธ', () => {
    const res = checkSnapshotShape({
      ...good(),
      products: [{ name: 'x', price: 1 }],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/รหัส/)
  })
})

describe('applyCatalogSnapshot', () => {
  it('ล้างของเดิมแล้วใส่ใหม่พร้อมรหัสเดิม — ห้าม merge', async () => {
    // จำลองมือถือที่มีสินค้าตัวอย่างกินรหัส 1 อยู่
    const sample = await addProduct({ name: 'สินค้าตัวอย่าง', price: 7, cost: 1, stock: 5 })
    // เลขที่ได้ขึ้นกับตัวนับของ IndexedDB — สาระคือมันถูกใช้อยู่แล้ว
    expect(typeof sample).toBe('number')

    const snap: CatalogSnapshot = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogId: 'cat-shop',
      catalogRev: 'rev-1',
      exportedAt: Date.now(),
      settings: { shopName: 'ร้านจริง', vatRate: 7, vatIncluded: true, tableCount: 12 },
      categories: [{ id: 9, name: 'อาหาร', sortOrder: 0 }],
      products: [
        {
          id: sample,
          name: 'ข้าวผัดของจริง',
          price: 60,
          cost: 20,
          unit: 'จาน',
          trackStock: true,
          stock: 100,
          active: true,
          createdAt: 1,
        },
      ],
      promotions: [],
    }

    const res = await applyCatalogSnapshot(snap)

    expect(res.products).toBe(1)
    expect(await db.products.count()).toBe(1)
    // รหัส 1 ต้องเป็นสินค้าของร้าน ไม่ใช่สินค้าตัวอย่างที่เคยกินรหัสนี้
    expect((await db.products.get(sample))?.name).toBe('ข้าวผัดของจริง')
    expect((await db.categories.get(9))?.name).toBe('อาหาร')

    const s = await db.settings.get(1)
    expect(s?.catalogId).toBe('cat-shop')
    expect(s?.catalogRev).toBe('rev-1')
    expect(s?.shopName).toBe('ร้านจริง')
    expect(s?.tableCount).toBe(12)
  })

  it('ไม่ทับค่าตั้งที่เป็นของเครื่อง', async () => {
    await db.settings.update(1, { receiptWidth: '80' })
    await applyCatalogSnapshot({
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogId: 'cat-shop',
      catalogRev: 'rev-1',
      exportedAt: 1,
      settings: { shopName: 'ร้านจริง' },
      categories: [],
      products: [],
      promotions: [],
    })
    expect((await db.settings.get(1))?.receiptWidth).toBe('80')
  })

  /* ล้างสินค้าทิ้งบนเครื่องที่ออกบิลแล้ว = ประวัติการขายอ่านชื่อสินค้าไม่ได้
     (SaleItem.productId ชี้ไปที่แถวที่หายไป) ⇒ ต้องถามก่อน */
  it('เครื่องที่มีบิลขายอยู่ = ปฏิเสธ จนกว่าจะยืนยัน', async () => {
    await db.sales.add({
      receiptNo: 'R1',
      items: [],
      subtotal: 0,
      itemDiscount: 0,
      billDiscount: 0,
      pointsDiscount: 0,
      total: 0,
      vatAmount: 0,
      paymentMethod: 'cash',
      createdAt: Date.now(),
      status: 'completed',
    } as never)

    const snap: CatalogSnapshot = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogId: 'cat-shop',
      catalogRev: 'rev-1',
      exportedAt: 1,
      settings: {},
      categories: [],
      products: [],
      promotions: [],
    }

    await expect(applyCatalogSnapshot(snap)).rejects.toThrow(/บิลขาย/)
    // ยืนยันแล้วทำได้
    const res = await applyCatalogSnapshot(snap, { force: true })
    expect(res.catalogId).toBe('cat-shop')
  })
})
