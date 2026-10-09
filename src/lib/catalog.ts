import { db } from '../db/db'
import type { Category, Product, Promotion, Settings } from '../db/types'
import { prefixedId } from './randomId'

/* =========================================================
   แคตตาล็อกของร้าน — ส่งจากเครื่องกลางไปมือถือ

   **ปัญหาที่ไฟล์นี้แก้** (TABLE-ORDER-PLAN.md §21 ข้อ 1)

   `Product.id` เป็น auto-increment ของ IndexedDB **ของแต่ละเครื่อง**
   มือถือที่เพิ่งเปิดแอปจะได้สินค้าตัวอย่างจาก seed.ts ซึ่งกิน id 1..16
   ชุดเดียวกับที่สินค้าจริงของร้านใช้อยู่บนเครื่องกลาง

   ถ้าปล่อยไว้ มือถือส่งใบสั่งที่อ้าง `productId: 3` มา แล้ว:
     * `finalizeSale` ตัดสต็อกด้วย id นั้น ⇒ **ตัดสต็อกผิดตัวแบบเงียบ**
       `validateTicket` จับไม่ได้เพราะตรวจแต่ยอดเงิน และยอดก็ตรง
       เพราะ `items` พกราคาของตัวเองมาเป็น snapshot
     * `promotions.ts` จับคู่ด้วย `productId`/`categoryId` ⇒ ได้ส่วนลดคนละตัว

   **วิธีกัน: แยกเป็นสองค่า อย่าใช้ค่าเดียว**

   1. `catalogId` — รหัสของ "ชุด id" ของร้านนี้ สร้างครั้งเดียวและ
      **ไม่เปลี่ยนเมื่อแก้ราคา** · ใช้เป็น **ด่านแข็ง**: ถ้าไม่ตรง ห้ามออกบิล
      ด่านนี้จึงไม่มีทางปฏิเสธใบสั่งที่ถูกต้องเพียงเพราะราคาเพิ่งเปลี่ยน
   2. `catalogRev` — แฮชของเนื้อหา เปลี่ยนเมื่อราคา/โปรโมชัน/รายการเปลี่ยน
      ใช้เป็น **สัญญาณอ่อน** เท่านั้น: เอาไปอธิบายว่าทำไมยอดไม่ตรง และบอก
      มือถือว่าควรดึงแคตตาล็อกใหม่ · **ห้ามใช้เป็นด่าน** ไม่งั้นการแก้ราคา
      หนึ่งครั้งจะทำให้ใบสั่งที่ลูกค้าจ่ายเงินแล้วถูกปฏิเสธทั้งกะ

   ทั้งสองค่าเก็บใน `Settings` (ไม่ใช่ `appState`) เพราะเป็นค่า **ของร้าน**
   ต้องติดไปกับไฟล์สำรอง — ถ้าเก็บใน appState แล้วกู้เครื่องกลางจากไฟล์สำรอง
   `catalogId` จะหาย เครื่องจะสร้างใหม่ แล้วมือถือทุกเครื่องจะถูกปฏิเสธ
   ========================================================= */

/** รูปแบบของก้อนแคตตาล็อก — เครื่องกลางกับมือถือต้องเป็นเลขเดียวกัน */
export const CATALOG_SCHEMA_VERSION = 1

/**
 * ฟิลด์ของ `Settings` ที่เป็น "ค่าของร้าน" และมือถือต้องมีเพื่อรับออเดอร์ได้
 *
 * **ห้ามใส่ค่าที่เป็นของเครื่อง** เช่น `receiptWidth`, `lastBackupAt`,
 * `staffEnabled`, `shiftEnabled` — การนำเข้าแคตตาล็อกจะทับค่าพวกนี้ที่มือถือทิ้ง
 * (ต่างจาก importBackup ที่ทับ settings ทั้งแถว ซึ่งเป็นเหตุผลที่ไม่ใช้ตัวนั้น)
 */
export const CATALOG_SETTINGS_KEYS = [
  'shopName',
  'mode',
  'vatRate',
  'vatIncluded',
  'promptpayId',
  'tableOrderEnabled',
  'tableCount',
  'tableCashEnabled',
  'slipKeepDays',
] as const

/**
 * เป็น Partial โดยเจตนา — ก้อนที่ส่งออกจากแอปรุ่นเก่าจะไม่มีคีย์ที่เพิ่งเพิ่ม
 * คีย์ที่ไม่มีมาต้อง **คงค่าเดิมของเครื่องนั้นไว้** ไม่ใช่ทับด้วย undefined
 */
export type CatalogSettings = Partial<Pick<Settings, (typeof CATALOG_SETTINGS_KEYS)[number]>>

/** เนื้อของแคตตาล็อก — ส่วนที่เอาไปคิดแฮช */
export interface CatalogBody {
  settings: CatalogSettings
  categories: Category[]
  products: Product[]
  promotions: Promotion[]
}

export interface CatalogSnapshot extends CatalogBody {
  schemaVersion: number
  catalogId: string
  catalogRev: string
  exportedAt: number
}

/** สร้าง catalogId ใหม่ — ต้องไม่ซ้ำข้ามร้าน เพราะเป็นด่านแข็ง */
export const newCatalogId = () => prefixedId('cat')

/* ---------------------------------------------------------
   แฮชเนื้อหา
   --------------------------------------------------------- */

/**
 * แปลงเป็น JSON แบบ **เรียงคีย์** เพื่อให้ได้สตริงเดิมทุกครั้ง
 *
 * `JSON.stringify` ปกติเรียงคีย์ตามลำดับที่ object ถูกสร้าง ซึ่งต่างกันได้
 * ระหว่างแถวที่อ่านจาก Dexie กับแถวที่เพิ่งประกอบในหน่วยความจำ
 * ถ้าไม่เรียงคีย์ แฮชจะเปลี่ยนทั้งที่เนื้อหาเหมือนเดิม
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
  return JSON.stringify(value) ?? 'null'
}

/**
 * แฮช 64 บิตแบบ FNV-1a สองสาย — **เป็นตัวตรวจจับการเปลี่ยนแปลง ไม่ใช่ของเชิงรหัสลับ**
 *
 * ถ้าชนกัน ผลเสียคือ "ไม่ได้ขึ้นคำใบ้ว่าแคตตาล็อกเก่า" เท่านั้น
 * ด่านที่กันของเสียหายจริงคือ `catalogId` ซึ่งเป็นค่าสุ่มจาก crypto
 */
export function hash64(s: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/**
 * ฟิลด์ของสินค้าที่ **ไม่** เอาเข้าแฮช
 *
 * `stock` เปลี่ยนทุกครั้งที่ขาย ถ้าเอาเข้าแฮช รุ่นจะเปลี่ยนทุกบิล
 * แล้วคำใบ้ "แคตตาล็อกเก่า" จะขึ้นตลอดเวลาจนไม่มีความหมาย
 * `image` ไม่อยู่ในก้อนที่ส่งอยู่แล้ว (ดู stripProduct)
 */
const UNHASHED_PRODUCT_FIELDS = ['stock', 'image'] as const

function hashableProduct(p: Product): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p }
  for (const k of UNHASHED_PRODUCT_FIELDS) delete out[k]
  return out
}

/** รุ่นของแคตตาล็อก — ฟังก์ชันบริสุทธิ์ ทดสอบได้ ไม่ต้องมีฐานข้อมูล */
export function catalogRevOf(body: CatalogBody): string {
  return hash64(
    canonicalJson({
      v: CATALOG_SCHEMA_VERSION,
      settings: body.settings,
      categories: body.categories,
      products: body.products.map(hashableProduct),
      promotions: body.promotions,
    }),
  )
}

/* ---------------------------------------------------------
   ประกอบ / ใช้งาน
   --------------------------------------------------------- */

export function pickCatalogSettings(s: CatalogSettings): CatalogSettings {
  const out = {} as Record<string, unknown>
  for (const k of CATALOG_SETTINGS_KEYS) {
    if (s[k] !== undefined) out[k] = s[k]
  }
  return out as CatalogSettings
}

/**
 * ตัดรูปสินค้าออกจากก้อนที่ส่ง
 *
 * รูปเก็บเป็น data URL ซึ่งบวมขึ้น ~33% จาก base64 · ร้าน 500 รายการที่มีรูป
 * ละ 20KB = 10MB ต่อการส่งหนึ่งครั้ง ซึ่งเกินทั้งเพดานของ RPC และโควตาฟรี
 * มือถืออ่านชื่อกับราคาก็สั่งได้ รูปเป็นของประกอบ
 */
function stripProduct(p: Product): Product {
  const { image: _image, ...rest } = p
  return rest
}

/**
 * ให้แน่ใจว่าร้านนี้มี `catalogId` แล้ว — สร้างให้ถ้ายังไม่มี
 *
 * อยู่ในทรานแซกชันเพราะถ้าสองที่เรียกพร้อมกันแล้วได้สองค่า ค่าที่เขียนทีหลัง
 * จะทับค่าที่มือถือเพิ่งรับไป แล้วมือถือจะถูกปฏิเสธทั้งที่เพิ่งซิงก์มา
 */
export async function ensureCatalogId(): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const s = await db.settings.get(1)
    if (!s) throw new Error('ยังไม่มีการตั้งค่าร้าน — เปิดแอปใหม่อีกครั้ง')
    if (s.catalogId) return s.catalogId
    const id = newCatalogId()
    await db.settings.update(1, { catalogId: id })
    return id
  })
}

/**
 * ประกอบก้อนแคตตาล็อกจากข้อมูลในเครื่องนี้ (ทำที่ **เครื่องกลาง**)
 *
 * บันทึก `catalogRev` ที่เผยแพร่ลง settings ของตัวเองด้วย เพื่อให้เทียบกับ
 * รุ่นที่มือถือส่งมาได้ · ถ้าเจ้าของร้านแก้ราคาแล้วไม่ส่งใหม่ รุ่นทั้งสองฝั่งจะ
 * ยังตรงกันอยู่ แต่ด่านเทียบยอดเงินจะจับได้เองว่ายอดไม่ตรง
 */
export async function buildCatalogSnapshot(): Promise<CatalogSnapshot> {
  const catalogId = await ensureCatalogId()
  const s = await db.settings.get(1)
  if (!s) throw new Error('ยังไม่มีการตั้งค่าร้าน — เปิดแอปใหม่อีกครั้ง')

  const [categories, products, promotions] = await Promise.all([
    db.categories.toArray(),
    db.products.toArray(),
    db.promotions.toArray(),
  ])

  const body: CatalogBody = {
    settings: pickCatalogSettings(s),
    categories,
    products: products.map(stripProduct),
    promotions,
  }
  const rev = catalogRevOf(body)
  await db.settings.update(1, { catalogRev: rev })

  return { schemaVersion: CATALOG_SCHEMA_VERSION, catalogId, catalogRev: rev, exportedAt: Date.now(), ...body }
}

/** ตรวจรูปร่างของก้อนที่รับมา — คนละเรื่องกับการตรวจเนื้อหา */
export function checkSnapshotShape(snap: unknown): { ok: true } | { ok: false; reason: string } {
  if (snap == null || typeof snap !== 'object') return { ok: false, reason: 'ไฟล์แคตตาล็อกไม่ถูกต้อง' }
  const s = snap as Partial<CatalogSnapshot>
  if (s.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `ไฟล์แคตตาล็อกเป็นรุ่น v${String(s.schemaVersion)} แต่เครื่องนี้รับ v${CATALOG_SCHEMA_VERSION} — อัปเดตแอปทั้งสองเครื่องให้เป็นรุ่นเดียวกันก่อน`,
    }
  }
  if (!s.catalogId || !s.catalogRev) return { ok: false, reason: 'ไฟล์แคตตาล็อกไม่มีรหัสชุดสินค้า' }
  if (!Array.isArray(s.products) || !Array.isArray(s.categories) || !Array.isArray(s.promotions)) {
    return { ok: false, reason: 'ไฟล์แคตตาล็อกไม่มีรายการสินค้า' }
  }
  if (s.settings == null || typeof s.settings !== 'object') {
    return { ok: false, reason: 'ไฟล์แคตตาล็อกไม่มีค่าตั้งของร้าน' }
  }
  if (s.products.some((p) => typeof p?.id !== 'number')) {
    return {
      ok: false,
      reason: 'ไฟล์แคตตาล็อกมีสินค้าที่ไม่มีรหัส — รหัสสินค้าคือสิ่งที่ต้องตรงกันทั้งสองเครื่อง',
    }
  }
  return { ok: true }
}

export interface ApplyResult {
  products: number
  categories: number
  promotions: number
  catalogId: string
  catalogRev: string
}

/**
 * เอาก้อนแคตตาล็อกมาใช้ (ทำที่ **มือถือ**)
 *
 * **ล้างแล้วใส่ใหม่ ไม่ใช่ merge** — ของเดิมบนมือถือคือสินค้าตัวอย่างจาก seed
 * ที่กิน id ชุดเดียวกับสินค้าจริง ถ้า merge จะเหลือสินค้าตัวอย่างที่มี id ชน
 * กับของจริง ซึ่งคือปัญหาที่ไฟล์นี้มีไว้แก้
 *
 * ด้วยเหตุนี้จึง **ปฏิเสธถ้าเครื่องนี้มีบิลขายหรือบิลพักอยู่** นอกจากจะยืนยัน
 * (`force`) — เครื่องที่ออกบิลแล้วมี `SaleItem.productId` ชี้ไปที่สินค้าเดิม
 * การล้างสินค้าทิ้งจะทำให้ประวัติการขายอ่านชื่อสินค้าไม่ได้
 */
export async function applyCatalogSnapshot(
  snap: CatalogSnapshot,
  opts: { force?: boolean } = {},
): Promise<ApplyResult> {
  const shape = checkSnapshotShape(snap)
  if (!shape.ok) throw new Error(shape.reason)

  if (!opts.force) {
    const [sales, held] = await Promise.all([db.sales.count(), db.heldBills.count()])
    if (sales > 0 || held > 0) {
      throw new Error(
        `เครื่องนี้มีบิลขาย ${sales} ใบ และบิลพัก ${held} ใบอยู่แล้ว — การนำเข้าแคตตาล็อกจะล้างรายการสินค้าเดิมทิ้ง ทำให้ประวัติการขายอ่านชื่อสินค้าไม่ได้ · ถ้านี่คือมือถือรับออเดอร์ที่ไม่ได้ออกบิล ให้ยืนยันอีกครั้ง`,
      )
    }
  }

  return db.transaction(
    'rw',
    [db.settings, db.categories, db.products, db.promotions],
    async () => {
      const cur = await db.settings.get(1)
      if (!cur) throw new Error('ยังไม่มีการตั้งค่าร้าน — เปิดแอปใหม่อีกครั้ง')

      await db.categories.clear()
      await db.products.clear()
      await db.promotions.clear()

      if (snap.categories.length > 0) await db.categories.bulkAdd(snap.categories)
      if (snap.products.length > 0) await db.products.bulkAdd(snap.products)
      if (snap.promotions.length > 0) await db.promotions.bulkAdd(snap.promotions)

      await db.settings.put({
        ...cur,
        ...pickCatalogSettings(snap.settings),
        catalogId: snap.catalogId,
        catalogRev: snap.catalogRev,
      })

      return {
        products: snap.products.length,
        categories: snap.categories.length,
        promotions: snap.promotions.length,
        catalogId: snap.catalogId,
        catalogRev: snap.catalogRev,
      }
    },
  )
}

/** ชื่อไฟล์ของก้อนแคตตาล็อก — มีรุ่นติดอยู่เพื่อให้รู้ว่าเอาอันไหนไปใส่ */
export const catalogFileName = (snap: CatalogSnapshot) =>
  `pos-catalog-${snap.catalogRev}.json`

/**
 * เหตุที่ทำให้นำเข้าแคตตาล็อกทับไม่ได้โดยไม่ยืนยัน
 *
 * แยกออกมาเพื่อให้หน้าจอถามผู้ใช้ได้ตรงประเด็น ไม่ต้องไปจับคู่ข้อความ error
 */
export async function catalogApplyBlockers(): Promise<{ sales: number; held: number }> {
  const [sales, held] = await Promise.all([db.sales.count(), db.heldBills.count()])
  return { sales, held }
}

/** โหลดไฟล์แคตตาล็อกเป็นก้อน — โยน error ภาษาไทยถ้าไฟล์ไม่ใช่ */
export async function readCatalogFile(file: File): Promise<CatalogSnapshot> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์แคตตาล็อกที่ส่งออกจากเครื่องกลาง')
  }
  const shape = checkSnapshotShape(parsed)
  if (!shape.ok) throw new Error(shape.reason)
  return parsed as CatalogSnapshot
}

/** ดาวน์โหลดก้อนแคตตาล็อกเป็นไฟล์ (ส่งให้มือถือทาง AirDrop / แชต / USB) */
export function downloadCatalogFile(snap: CatalogSnapshot): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(snap)], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = catalogFileName(snap)
  // บางเบราว์เซอร์ไม่ทำงานถ้าลิงก์ไม่ได้อยู่ในเอกสาร
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
