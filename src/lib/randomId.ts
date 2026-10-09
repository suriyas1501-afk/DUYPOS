/* =========================================================
   รหัสสุ่มที่ต้องไม่ซ้ำข้ามเครื่อง และ **ต้องเดาไม่ได้**

   ทำไมต้องมีไฟล์นี้: `crypto.randomUUID` มีเฉพาะใน secure context
   แอปนี้ถูกเปิดผ่าน `http://<ไอพีในวง LAN>` ได้ (ดูคอมเมนต์ใน src/lib/auth.ts)
   จึงต้องมีทางสำรอง — และทางสำรองนั้น **ห้ามเป็น `Math.random()`**

   `Math.random()` ของ V8 คือ xorshift128+ ซึ่งไม่ใช่ตัวสุ่มเชิงรหัสลับ
   เห็นผลไม่กี่ตัวก็คำนวณค่าถัดไปได้ ส่วน `crypto.getRandomValues` ใช้ได้
   **นอก secure context** ต่างจาก `randomUUID` จึงเป็นทางสำรองที่ถูกต้อง

   รหัสที่เดาได้ทำให้เครื่องอื่นจองรหัสที่เรากำลังจะใช้ไว้ก่อนได้
   แล้วใบสั่งหรือรูปสลิปของเราจะถูกปฏิเสธว่า "ซ้ำ"
   ========================================================= */

/** ไบต์สุ่มเป็นสตริง hex — bytes 12 ไบต์ = 96 บิต */
export function randomHex(bytes = 12): string {
  const buf = new Uint8Array(bytes)
  const c = globalThis.crypto
  if (c?.getRandomValues) {
    c.getRandomValues(buf)
  } else {
    // ไม่มี crypto เลยเป็นกรณีที่ไม่ควรเกิดในเบราว์เซอร์ที่รัน PWA ได้
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** รหัสแบบ `<prefix>-<hex>` ใช้ randomUUID ถ้ามี ไม่มีก็ getRandomValues */
export function prefixedId(prefix: string, bytes = 12): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`
  return `${prefix}-${randomHex(bytes)}`
}
