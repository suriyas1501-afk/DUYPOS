import { defineConfig } from 'vitest/config'

/**
 * เทสต์ของโปรเจกต์นี้เป็น "characterization test" ของเอนจินคิดเงิน
 * คือจับพฤติกรรมปัจจุบันที่ทดสอบด้วยมือแล้วว่าถูกต้อง มาตรึงไว้เป็นตาข่าย
 * ก่อนจะไปผ่าตัดโครงสร้างข้อมูลในเฟสถัดไป (ดู SYNC-PLAN.md)
 *
 * Dexie ต้องการ IndexedDB ซึ่ง Node ไม่มี → ใช้ fake-indexeddb ใน setup
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    // เทสต์แต่ละไฟล์ใช้ฐานข้อมูลชื่อเดียวกัน จึงต้องแยกโปรเซสกัน ไม่ให้ชนกัน
    fileParallelism: false,
  },
})
