import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS } from './db'
import type { PermissionKey, Settings, Shift, Staff } from './types'
import { useAuth } from '../stores/authStore'
import { hasPerm } from '../lib/permissions'

/** อ่านการตั้งค่าแบบ reactive (คืนค่า default ระหว่างโหลด) */
export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get(1), [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS
}

/** สถานะการเชื่อมต่ออินเทอร์เน็ต */
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/**
 * พนักงานที่เข้าสู่ระบบอยู่ — อ่านสดจาก DB ทุกครั้ง
 * (แก้สิทธิ์/ปิดใช้งานพนักงานแล้วมีผลทันที ไม่ต้องออกจากระบบ)
 * loading = true ระหว่างอ่านแถวพนักงาน เพื่อไม่ให้หน้าจอกระพริบไปหน้าเข้าสู่ระบบ
 */
export function useCurrentStaff(): { staff: Staff | null; loading: boolean } {
  const staffId = useAuth((s) => s.staffId)
  // ผลลัพธ์พก staffId ที่ใช้คิวรีมาด้วยเสมอ — useLiveQuery จะคืน "ค่าของคิวรีก่อนหน้า"
  // ต่อไปอีกชั่วขณะหลัง deps เปลี่ยน (ไม่ได้กลับเป็น undefined) ถ้าเชื่อค่านั้นตรงๆ
  // ทันทีที่เข้าสู่ระบบจะเห็น staff = null ของรอบก่อน แล้ว App.tsx จะเตะออกจากระบบทันที
  const row = useLiveQuery<{ id: number | null; staff: Staff | null }>(
    async () => ({
      id: staffId,
      staff: staffId == null ? null : ((await db.staff.get(staffId)) ?? null),
    }),
    [staffId],
  )
  if (staffId == null) return { staff: null, loading: false }
  if (!row || row.id !== staffId) return { staff: null, loading: true }
  return { staff: row.staff, loading: false }
}

/**
 * ตัวช่วยเช็คสิทธิ์ในหน้าจอ
 * ปิดระบบพนักงาน (staffEnabled = false) → ทำได้ทุกอย่างเหมือนเดิม (ร้านเจ้าของขายคนเดียว)
 */
export function usePermissions(): {
  enabled: boolean
  staff: Staff | null
  can: (perm: PermissionKey) => boolean
} {
  const settings = useSettings()
  const { staff } = useCurrentStaff()
  const enabled = !!settings.staffEnabled
  const can = useCallback(
    (perm: PermissionKey) => (enabled ? hasPerm(staff, perm) : true),
    [enabled, staff],
  )
  return { enabled, staff, can }
}

/** กะที่เปิดอยู่ (มีได้ทีละกะเดียว) — loading = true ระหว่างอ่าน */
export function useCurrentShift(): { shift: Shift | null; loading: boolean } {
  const row = useLiveQuery<Shift | null>(
    async () => (await db.shifts.where('status').equals('open').first()) ?? null,
    [],
  )
  return { shift: row ?? null, loading: row === undefined }
}
