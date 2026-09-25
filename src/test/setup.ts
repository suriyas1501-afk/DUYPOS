// ให้ Dexie มี IndexedDB ใช้ตอนรันเทสต์ใน Node
import 'fake-indexeddb/auto'

/**
 * localStorage ปลอมสำหรับ Node
 *
 * zustand persist เก็บตะกร้าหน้าเคาน์เตอร์ ('pos-cart') และใบสั่งที่โต๊ะ
 * ('pos-table-order') ลง localStorage ซึ่ง Node ไม่มีให้ใช้จริง
 *
 * **ห้ามเช็คด้วย typeof** — Node รุ่นใหม่ประกาศ globalThis.localStorage ไว้แล้ว
 * แต่เป็น getter ที่ throw เมื่อเรียกใช้ (ต้องเปิด --experimental-webstorage)
 * ถ้าเช็คแค่ว่า "มีไหม" shim จะไม่ติด แล้ว zustand จะเตือนว่า storage
 * ใช้ไม่ได้ ซึ่งแปลว่าเทสต์ไม่ได้ทดสอบการ persist เลย
 * (การ persist คือสิ่งเดียวที่กันใบสั่งหายตอน iOS ตัดหน้าเว็บทิ้ง — ต้องทดสอบจริง)
 */
function localStorageWorks(): boolean {
  try {
    const ls = globalThis.localStorage
    if (!ls) return false
    ls.setItem('__probe__', '1')
    ls.removeItem('__probe__')
    return true
  } catch {
    return false
  }
}

if (!localStorageWorks()) {
  const mem = new Map<string, string>()
  const shim: Storage = {
    get length() {
      return mem.size
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  }
  // ใช้ defineProperty เพราะ globalThis.localStorage ของ Node เป็น accessor ที่กำหนดค่าตรงๆ ไม่ได้
  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    configurable: true,
    writable: true,
  })
}
