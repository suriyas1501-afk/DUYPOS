import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { addProduct, resetDb } from '../test/helpers'
import { backupShareSupported, shareBackupFile } from './backup'
import { dayKey } from './format'

/* =========================================================
   ส่งไฟล์สำรองผ่านแผงแชร์ของระบบ — ทางเดียวที่ iPad มี

   iPad ไม่มี showDirectoryPicker ⇒ สำรองอัตโนมัติลงโฟลเดอร์ไม่ได้
   ถ้าทางนี้พังหรือโกหกว่าสำเร็จ เครื่องนั้นจะไม่มีไฟล์สำรองเลย
   ซึ่งเป็นทางกู้คืนทางเดียวของร้าน

   จุดที่พลาดแล้วเสียหายที่สุด: **บันทึกว่า "สำรองแล้ว" ทั้งที่ไฟล์ไม่ได้ออกไปจริง**
   แถบเตือนจะหายไป แล้วเจ้าของร้านจะเชื่อว่ามีไฟล์สำรองอยู่
   ========================================================= */

type NavShare = {
  share?: (data: unknown) => Promise<void>
  canShare?: (data: unknown) => boolean
}

const nav = () => navigator as unknown as NavShare

/** ใส่/ถอด navigator.share + canShare ปลอม (Node ไม่มีให้ตั้งแต่ต้น) */
function setNavShare(v: NavShare) {
  for (const k of ['share', 'canShare'] as const) {
    Object.defineProperty(navigator, k, { value: v[k], configurable: true, writable: true })
  }
}

function clearNavShare() {
  for (const k of ['share', 'canShare'] as const) {
    Object.defineProperty(navigator, k, { value: undefined, configurable: true, writable: true })
  }
}

beforeEach(async () => {
  await resetDb()
  clearNavShare()
})

afterEach(() => {
  clearNavShare()
})

describe('backupShareSupported', () => {
  it('เครื่องที่ไม่มี navigator.share เลย = ไม่รองรับ', () => {
    expect(backupShareSupported()).toBe(false)
  })

  it('มี share แต่ไม่มี canShare = ไม่รองรับ (แชร์ได้แต่ไฟล์อาจแชร์ไม่ได้)', () => {
    setNavShare({ share: async () => {} })
    expect(backupShareSupported()).toBe(false)
  })

  it('canShare ตอบว่าแชร์ไฟล์ไม่ได้ = ไม่รองรับ', () => {
    setNavShare({ share: async () => {}, canShare: () => false })
    expect(backupShareSupported()).toBe(false)
  })

  it('canShare ตอบว่าแชร์ไฟล์ได้ = รองรับ', () => {
    setNavShare({ share: async () => {}, canShare: () => true })
    expect(backupShareSupported()).toBe(true)
  })

  it('canShare โยน error = ไม่รองรับ (ต้องไม่ทำให้หน้าตั้งค่าพัง)', () => {
    setNavShare({
      share: async () => {},
      canShare: () => {
        throw new Error('boom')
      },
    })
    expect(backupShareSupported()).toBe(false)
  })
})

describe('shareBackupFile', () => {
  it('ส่งไฟล์ JSON ที่มีข้อมูลจริง และตั้งชื่อตามวันที่', async () => {
    const pid = await addProduct({ name: 'กาแฟเย็น', price: 55 })
    let sent: { files?: File[] } | undefined
    setNavShare({
      canShare: () => true,
      share: async (d) => {
        sent = d as { files?: File[] }
      },
    })

    expect(await shareBackupFile()).toBe('shared')

    const file = sent?.files?.[0]
    expect(file).toBeInstanceOf(File)
    expect(file?.name).toBe(`pos-backup-${dayKey(Date.now())}.json`)
    expect(file?.type).toBe('application/json')

    const parsed = JSON.parse(await file!.text())
    expect(parsed.app).toBe('pos-system')
    // ต้องมีข้อมูลจริงอยู่ในไฟล์ ไม่ใช่โครงเปล่า
    expect(parsed.data.products).toHaveLength(1)
    expect(parsed.data.products[0].id).toBe(pid)
    expect(parsed.data.settings).toHaveLength(1)
  })

  /* เทสต์ที่สำคัญที่สุดของไฟล์นี้ — บน iOS มีรายงานว่า promise ของ navigator.share
     ไม่ resolve ตามสเปกในบางกรณี ถ้าเชื่อผลของมันแล้วบันทึกเวลาสำรองเอง
     แถบเตือน "ยังไม่เคยสำรอง" จะหายไปทั้งที่ยังไม่มีไฟล์จริง
     ⇒ หน้าที่บันทึกเวลาต้องอยู่ที่ผู้เรียก หลังผู้ใช้ยืนยันว่าเห็นไฟล์แล้วเท่านั้น */
  it('ต้องไม่บันทึกเวลาสำรองล่าสุดเอง', async () => {
    setNavShare({ canShare: () => true, share: async () => {} })
    await shareBackupFile()
    expect((await db.settings.get(1))?.lastBackupAt).toBeUndefined()
  })

  it('ผู้ใช้ปิดแผงแชร์ทิ้ง = คืน cancelled ไม่โยน error', async () => {
    setNavShare({
      canShare: () => true,
      share: async () => {
        throw new DOMException('cancelled', 'AbortError')
      },
    })
    expect(await shareBackupFile()).toBe('cancelled')
    expect((await db.settings.get(1))?.lastBackupAt).toBeUndefined()
  })

  it('แชร์ล้มด้วยสาเหตุอื่น = โยนต่อ ให้หน้าจอแจ้งเตือนได้', async () => {
    setNavShare({
      canShare: () => true,
      share: async () => {
        throw new Error('ส่งไม่ออก')
      },
    })
    await expect(shareBackupFile()).rejects.toThrow('ส่งไม่ออก')
  })

  it('เครื่องที่แชร์ไฟล์ไม่ได้ = โยน error ที่บอกให้ไปใช้ปุ่มดาวน์โหลด', async () => {
    const share = vi.fn()
    setNavShare({ canShare: () => false, share })
    await expect(shareBackupFile()).rejects.toThrow(/ดาวน์โหลด/)
    // ห้ามเรียก share เมื่อ canShare บอกว่าไม่ได้ — บางเครื่องจะค้างหรือโยน error คนละแบบ
    expect(share).not.toHaveBeenCalled()
  })
})
