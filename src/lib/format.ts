// ===== ตัวช่วยจัดรูปแบบตัวเลข / วันที่ (ภาษาไทย) =====

/** ปัดเศษ 2 ตำแหน่ง (กันปัญหา floating point) */
export const r2 = (n: number) => Math.round(n * 100) / 100

/** แสดงจำนวนเงินแบบกระชับ เช่น 1,234 หรือ 12.50 */
export const baht = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** แสดงจำนวนเงินทศนิยม 2 ตำแหน่งเสมอ (ใช้ในใบเสร็จ) */
export const money = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtDate = (t: number) =>
  new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(t)

export const fmtDateTime = (t: number) =>
  new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'short' }).format(t)

export const fmtTime = (t: number) =>
  new Intl.DateTimeFormat('th-TH', { timeStyle: 'short' }).format(t)

export const startOfDay = (t: number = Date.now()) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const endOfDay = (t: number = Date.now()) => {
  const d = new Date(t)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export const addDays = (t: number, days: number) => t + days * 86400000

/** คีย์วันแบบ local เช่น 2026-07-24 */
export const dayKey = (t: number) => {
  const d = new Date(t)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** ป้ายวันสั้นๆ เช่น 24 ก.ค. */
export const dayLabel = (t: number) =>
  new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(t)
