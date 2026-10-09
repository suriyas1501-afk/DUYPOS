import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { ensureOwnerStaff, initDb, resetInitDbOnce } from './seed'

/* =========================================================
   การเริ่มระบบตอนเปิดแอป

   จุดที่พลาดแล้วเสียหายที่สุด: **แอปค้างที่ "กำลังเตรียมระบบ…" แล้วเปิดร้านไม่ได้เลย**

   `staff.code` เป็น unique index · ถ้า ensureOwnerStaff อ่านจำนวนแล้วเพิ่มแถว
   แบบไม่ล็อก สองที่ที่เรียกพร้อมกันจะเห็น 0 ทั้งคู่แล้วเพิ่ม 'E01' ทั้งคู่
   ตัวที่สองชน ConstraintError ซึ่งโยนทะลุออกจาก initDb() ทำให้
   `setReady(true)` ใน App.tsx ไม่เคยทำงาน

   เกิดได้จริงสองทาง: React StrictMode เรียก effect สองรอบในโหมดพัฒนา
   และการเปิดแอปสองแท็บพร้อมกันบนเครื่องที่ข้อมูลยังว่าง
   ========================================================= */

beforeEach(async () => {
  resetInitDbOnce()
  await db.delete()
  await db.open()
})

describe('ensureOwnerStaff', () => {
  it('สร้างเจ้าของร้านให้ตอนยังไม่มีพนักงานเลย', async () => {
    await ensureOwnerStaff()
    const rows = await db.staff.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.code).toBe('E01')
    expect(rows[0]?.role).toBe('owner')
    // ห้ามเก็บ PIN ตรงๆ
    expect(rows[0]?.pinHash).toMatch(/^sha256\$/)
  })

  it('เรียกซ้ำไม่เพิ่มคนที่สอง', async () => {
    await ensureOwnerStaff()
    await ensureOwnerStaff()
    expect(await db.staff.count()).toBe(1)
  })

  /* นี่คือเทสต์ที่สำคัญที่สุดของไฟล์นี้ — ถ้าไม่มีทรานแซกชัน ตัวนี้จะโยน
     ConstraintError แล้วแอปจะค้างที่หน้า "กำลังเตรียมระบบ…" ตลอดไป */
  it('เรียกพร้อมกันสองรอบ ต้องไม่โยน error และต้องได้เจ้าของร้านคนเดียว', async () => {
    await expect(
      Promise.all([ensureOwnerStaff(), ensureOwnerStaff()]),
    ).resolves.toBeDefined()
    expect(await db.staff.count()).toBe(1)
  })

  it('เรียกพร้อมกันสี่รอบก็ยังได้คนเดียว', async () => {
    await Promise.all([
      ensureOwnerStaff(),
      ensureOwnerStaff(),
      ensureOwnerStaff(),
      ensureOwnerStaff(),
    ])
    expect(await db.staff.count()).toBe(1)
  })
})

describe('initDb', () => {
  it('ตั้งค่าเริ่มต้นและใส่ข้อมูลตัวอย่างในการเปิดครั้งแรก', async () => {
    await initDb()
    expect(await db.settings.get(1)).toBeDefined()
    expect(await db.products.count()).toBeGreaterThan(0)
    expect(await db.staff.count()).toBe(1)
  })

  it('เรียกพร้อมกัน (StrictMode เรียก effect สองรอบ) ต้องไม่โยน error', async () => {
    await expect(Promise.all([initDb(), initDb()])).resolves.toBeDefined()
    expect(await db.staff.count()).toBe(1)
    expect(await db.coupons.count()).toBe(2)
  })

  it('เปิดซ้ำไม่ทับข้อมูลร้านที่แก้ไว้แล้ว', async () => {
    await initDb()
    await db.settings.update(1, { shopName: 'ร้านของจริง' })
    await db.products.clear()

    resetInitDbOnce()
    await initDb()

    expect((await db.settings.get(1))?.shopName).toBe('ร้านของจริง')
    // มี settings อยู่แล้ว = ไม่ใส่ข้อมูลตัวอย่างซ้ำ (ร้านที่ลบสินค้าทิ้งต้องว่างอยู่)
    expect(await db.products.count()).toBe(0)
  })
})
