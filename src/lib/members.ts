import { db } from '../db/db'
import type { Member } from '../db/types'

/** หาสมาชิกที่ใช้เบอร์นี้อยู่แล้ว (ยกเว้น id ที่ระบุ เช่น ตอนแก้ไขตัวเอง) */
export async function findPhoneDup(
  phone: string,
  excludeId?: number,
): Promise<Member | undefined> {
  if (!phone) return undefined
  return db.members
    .where('phone')
    .equals(phone)
    .filter((m) => m.id !== excludeId)
    .first()
}
