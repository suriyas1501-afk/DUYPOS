import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { resetDb } from '../test/helpers'
import { clearAllData } from './backup'
import { isPrintHost, isUsableJob, setPrintHost } from './printBridge'

/* =========================================================
   สะพานพิมพ์ในวง LAN

   สะพานไม่มีรหัสผ่าน ใครอยู่ในวง Wi-Fi เดียวกันก็ยิงงานพิมพ์เข้ามาได้
   ด่าน isUsableJob จึงเป็นตัวกันของที่ประกอบใบเสร็จไม่ได้ ไม่ให้หลุดไปถึง builder
   แล้วทำให้ลูปรอรับงานของเครื่องเคาน์เตอร์ตายทั้งตัว = ทั้งร้านพิมพ์ไม่ได้อีกเลย

   (ส่วนการกันสคริปต์ไม่ได้อยู่ที่นี่ — อยู่ที่การส่ง "ข้อมูลบิล" ไม่ใช่ HTML
   แล้วให้เครื่องเคาน์เตอร์ประกอบเองด้วย builder ที่ esc() ทุกข้อความ)
   ========================================================= */

const okJob = () => ({
  id: 'job-1',
  kind: 'receipt' as const,
  payload: { sale: { receiptNo: 'R20261104-0001', items: [{ name: 'กาแฟ' }], total: 55 } },
  createdAt: Date.now(),
})

describe('isUsableJob', () => {
  it('งานที่ครบถ้วนผ่าน', () => {
    expect(isUsableJob(okJob())).toBe(true)
  })

  it('สลิปครัวก็ผ่าน', () => {
    expect(isUsableJob({ ...okJob(), kind: 'kitchen' })).toBe(true)
  })

  it.each([
    ['ไม่ใช่อ็อบเจกต์', 'เอาอะไรมาก็ไม่รู้'],
    ['ค่าว่าง', null],
    ['ไม่มี id', { ...okJob(), id: undefined }],
    ['id ว่าง', { ...okJob(), id: '' }],
    ['ชนิดงานที่ไม่รู้จัก', { ...okJob(), kind: 'ยิงมามั่ว' }],
    ['ไม่มี payload', { ...okJob(), payload: undefined }],
    ['ไม่มีบิล', { ...okJob(), payload: {} }],
    ['ไม่มีเลขที่บิล', { ...okJob(), payload: { sale: { items: [{ name: 'a' }], total: 1 } } }],
    [
      'ไม่มีรายการสินค้า',
      { ...okJob(), payload: { sale: { receiptNo: 'R1', items: [], total: 1 } } },
    ],
    [
      'items ไม่ใช่อาเรย์',
      { ...okJob(), payload: { sale: { receiptNo: 'R1', items: 'a', total: 1 } } },
    ],
    [
      'ยอดเป็น NaN',
      { ...okJob(), payload: { sale: { receiptNo: 'R1', items: [{ name: 'a' }], total: NaN } } },
    ],
    [
      'ไม่มียอด',
      { ...okJob(), payload: { sale: { receiptNo: 'R1', items: [{ name: 'a' }] } } },
    ],
  ])('ตกด่าน: %s', (_label, job) => {
    expect(isUsableJob(job)).toBe(false)
  })
})

describe('เครื่องพิมพ์ของร้าน', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('ค่าเริ่มต้นคือไม่ใช่เครื่องพิมพ์ (ทุกเครื่องเปิดมาแล้วต้องไม่แย่งกันรับงาน)', async () => {
    expect(await isPrintHost()).toBe(false)
  })

  it('เปิดแล้วอ่านกลับได้ ปิดแล้วกลับเป็นเดิม', async () => {
    await setPrintHost(true)
    expect(await isPrintHost()).toBe(true)
    await setPrintHost(false)
    expect(await isPrintHost()).toBe(false)
  })

  /* ตารางที่เก็บค่านี้ต้องอยู่นอกไฟล์สำรอง ไม่งั้นกู้ไฟล์สำรองของเครื่องเคาน์เตอร์
     ลงมือถือ มือถือจะนึกว่าตัวเองเป็นเครื่องพิมพ์ แล้วใบเสร็จจะไปรอพิมพ์ที่มือถือ
     ซึ่งต่อเครื่องพิมพ์ไม่ได้ ⇒ ทั้งร้านไม่มีใครพิมพ์เลย */
  it('เก็บไว้ในตารางที่อยู่นอกชุดสำรอง/ล้างข้อมูล', async () => {
    await setPrintHost(true)
    await db.products.add({
      name: 'ของทดสอบ',
      price: 1,
      cost: 1,
      unit: 'ชิ้น',
      trackStock: false,
      stock: 0,
      active: true,
      createdAt: Date.now(),
    })

    // clearAllData() เดินตามรายชื่อตารางชุดเดียวกับที่ใส่ลงไฟล์สำรอง
    await clearAllData(true)

    expect(await db.products.count()).toBe(0)
    expect(await isPrintHost()).toBe(true)
  })
})
