import { db, DEFAULT_SETTINGS } from '../db/db'
import type { CartItem } from '../stores/cartStore'
import type { Product, Settings } from '../db/types'
import { setActor } from '../lib/actor'

/* =========================================================
   ตัวช่วยสำหรับ characterization test ของเอนจินคิดเงิน
   ทุกเทสต์เริ่มจากฐานข้อมูลว่าง เพื่อให้ผลลัพธ์ไม่ขึ้นกับลำดับการรัน
   ========================================================= */

/** ล้างทุกตารางแล้วใส่ค่าตั้งค่าเริ่มต้น (เรียกใน beforeEach) */
export async function resetDb(settings?: Partial<Settings>): Promise<Settings> {
  if (!db.isOpen()) await db.open()
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear()
  })
  const s: Settings = { ...DEFAULT_SETTINGS, ...settings }
  await db.settings.put(s)
  setActor({})
  return s
}

/** สร้างสินค้าทดสอบ คืน id ที่ได้ */
export async function addProduct(p: Partial<Product> & { name: string }): Promise<number> {
  return db.products.add({
    price: 100,
    cost: 60,
    unit: 'ชิ้น',
    trackStock: true,
    stock: 100,
    active: true,
    createdAt: Date.now(),
    ...p,
  })
}

/** สร้างบรรทัดตะกร้าจากสินค้าที่มีอยู่ (ค่าเริ่มต้น = ขาย 1 หน่วยฐาน ไม่มีส่วนลด) */
export function cartLine(
  productId: number,
  over: Partial<CartItem> & { price: number; cost?: number },
): CartItem {
  return {
    key: `k${productId}-${over.unitName ?? ''}`,
    productId,
    name: over.name ?? `สินค้า ${productId}`,
    // price มาจาก ...over ท้ายสุดเสมอ (บังคับให้ระบุ) จึงไม่ต้องตั้งซ้ำตรงนี้
    listPrice: over.listPrice ?? over.price,
    cost: over.cost ?? 0,
    qty: 1,
    unitFactor: 1,
    allowDecimalQty: false,
    manualDiscount: 0,
    trackStock: true,
    stock: 100,
    ...over,
  }
}

/** อ่านสต็อกปัจจุบันของสินค้า */
export const stockOf = async (id: number) => (await db.products.get(id))?.stock ?? 0
