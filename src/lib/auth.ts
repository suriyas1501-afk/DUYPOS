// ===== PIN ของพนักงาน: แฮช + ตรวจสอบ (ไม่เก็บ PIN ตรงๆ ลงฐานข้อมูล) =====

export const PIN_MIN = 4
export const PIN_MAX = 8

/** สุ่ม salt แบบ hex (ใช้ crypto ถ้ามี ไม่มีก็ Math.random) */
export function randomSalt(bytes = 8): string {
  const buf = new Uint8Array(bytes)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

const toHex = (bytes: Uint8Array | ArrayBuffer) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')

/* =========================================================
   SHA-256 แบบ JS ล้วน (ใช้เมื่อเบราว์เซอร์ไม่มี crypto.subtle)

   crypto.subtle มีเฉพาะใน secure context — เปิดแอปผ่าน http://<ไอพีในวง LAN>
   (รูปแบบปกติของ POS หลายเครื่องในร้าน) จะไม่มี subtle เลย
   ถ้าใช้อัลกอริทึมคนละตัวกับตอนตั้ง PIN จะกลายเป็น "PIN ผิดทุกอัน" และเข้าระบบไม่ได้ทั้งร้าน
   จึงต้องได้ผลลัพธ์เดียวกันเสมอไม่ว่าจะมี subtle หรือไม่
   ========================================================= */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0

function sha256Hex(input: string): string {
  const msg = new TextEncoder().encode(input)
  const len = msg.length
  // เติม padding: 0x80 แล้วศูนย์ จนเหลือที่ 8 ไบต์ท้ายไว้ใส่ความยาวเป็นบิต (big-endian)
  const total = ((len + 9 + 63) >> 6) << 6
  const buf = new Uint8Array(total)
  buf.set(msg)
  buf[len] = 0x80
  const view = new DataView(buf.buffer)
  const bits = len * 8
  view.setUint32(total - 8, Math.floor(bits / 0x100000000))
  view.setUint32(total - 4, bits >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]
      const y = w[i - 2]
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h[0]
    let b = h[1]
    let c = h[2]
    let d = h[3]
    let e = h[4]
    let f = h[5]
    let g = h[6]
    let hh = h[7]
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }

  let out = ''
  for (const v of h) out += v.toString(16).padStart(8, '0')
  return out
}

/** SHA-256 ของข้อความ — ใช้ WebCrypto ถ้ามี (เร็วกว่า) ไม่มีก็ใช้ JS ล้วน ผลลัพธ์เหมือนกัน */
async function digestHex(material: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      return toHex(await subtle.digest('SHA-256', new TextEncoder().encode(material)))
    } catch {
      // บางเบราว์เซอร์มี subtle แต่เรียกไม่ผ่านใน context นั้น — ตกลงมาใช้ JS ล้วน
    }
  }
  return sha256Hex(material)
}

/**
 * แฮชสำรองรุ่นเก่า (algo 'fnv') — คงไว้เพื่อให้ PIN ที่ตั้งไว้ด้วยเวอร์ชันก่อนยังเข้าได้
 * PIN ที่ตั้งใหม่ทั้งหมดจะเป็น sha256 เสมอ
 */
function legacyFnvHash(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let round = 0; round < 5000; round++) {
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i) + round
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
      h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
      h2 = (h2 ^ (h2 >>> 13)) >>> 0
    }
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/** แฮช PIN → '<algo>$<salt>$<hex>' (เก็บ salt ไว้ในสตริงเดียวกัน) */
export async function hashPin(pin: string, salt: string = randomSalt()): Promise<string> {
  return `sha256$${salt}$${await digestHex(`pos-pin:${salt}:${pin}`)}`
}

/** เทียบสตริงแบบเวลาคงที่ (กัน timing attack เล็กน้อย) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * ตรวจ PIN กับค่าที่เก็บไว้
 * ใช้ได้ทุกที่ไม่ว่าเครื่องจะมี crypto.subtle หรือไม่ (มี SHA-256 แบบ JS ล้วนสำรอง)
 * ยังรองรับแฮชรุ่นเก่า algo 'fnv' เพื่อไม่ให้ PIN ที่ตั้งไว้ก่อนหน้าใช้ไม่ได้
 */
export async function verifyPin(pin: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 3) return false
  const [algo, salt] = parts
  const material = `pos-pin:${salt}:${pin}`
  if (algo === 'sha256') return safeEqual(parts[2], await digestHex(material))
  if (algo === 'fnv') return safeEqual(parts[2], legacyFnvHash(material))
  return false
}

/** แฮชนี้ควรตั้งใหม่ไหม (แฮชรุ่นเก่า) — ใช้อัปเกรดให้เงียบๆ ตอนผู้ใช้เข้าสู่ระบบสำเร็จ */
export const isLegacyHash = (stored: string | undefined) => !!stored && stored.startsWith('fnv$')

/** PIN ที่ง่ายเกินไป — เตือนแต่ไม่บล็อก (ร้านเล็กมักอยากใช้เลขจำง่าย) */
const WEAK_PINS = ['1234', '0000', '1111', '2222', '4321', '1212', '123456', '000000']

export const isWeakPin = (pin: string) => WEAK_PINS.includes(pin)

/** ตรวจรูปแบบ PIN — คืนข้อความผิดพลาดภาษาไทย (undefined = ผ่าน) */
export function validatePin(pin: string): string | undefined {
  if (!/^\d*$/.test(pin)) return 'PIN ต้องเป็นตัวเลขเท่านั้น'
  if (pin.length < PIN_MIN) return `PIN ต้องมีอย่างน้อย ${PIN_MIN} หลัก`
  if (pin.length > PIN_MAX) return `PIN ต้องไม่เกิน ${PIN_MAX} หลัก`
  return undefined
}
