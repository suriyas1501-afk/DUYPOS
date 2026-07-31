import type { PermissionKey, Staff, StaffRole } from '../db/types'

/* =========================================================
   สิทธิ์การใช้งาน — ป้ายไทย, สิทธิ์ตามบทบาท, การตรวจสิทธิ์
   ========================================================= */

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  sell: 'ขายหน้าร้าน',
  discount: 'ให้ส่วนลด / ใช้คูปอง / แลกแต้ม',
  void: 'ยกเลิกบิล',
  refund: 'คืนสินค้า / คืนเงิน',
  products: 'จัดการสินค้า + หมวดหมู่',
  stock: 'รับของเข้า / ปรับสต็อก / นับสต็อก',
  promotions: 'จัดการโปรโมชัน + คูปอง',
  members: 'จัดการสมาชิก',
  reports: 'ดูหน้าหลัก + รายงาน',
  accounting: 'บัญชี / รายจ่าย / ภาษี',
  shift: 'เปิด-ปิดกะ + นับเงินลิ้นชัก',
  taxInvoice: 'ออก / ยกเลิกใบกำกับภาษี',
  settings: 'ตั้งค่าระบบ + สำรองข้อมูล',
  staff: 'จัดการพนักงาน',
}

/** จัดกลุ่มเพื่อแสดงในหน้าแก้ไขพนักงาน */
export const PERMISSION_GROUPS: { title: string; keys: PermissionKey[] }[] = [
  { title: 'การขาย', keys: ['sell', 'discount', 'void', 'refund'] },
  { title: 'สินค้า / สต็อก', keys: ['products', 'stock'] },
  { title: 'ลูกค้า / การตลาด', keys: ['promotions', 'members'] },
  { title: 'เงิน / เอกสาร', keys: ['shift', 'reports', 'accounting', 'taxInvoice'] },
  { title: 'ระบบ', keys: ['settings', 'staff'] },
]

export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_GROUPS.flatMap((g) => g.keys)

export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'เจ้าของร้าน',
  manager: 'ผู้จัดการ',
  cashier: 'พนักงานขาย',
}

export const ROLE_HINT: Record<StaffRole, string> = {
  owner: 'ทำได้ทุกอย่าง รวมตั้งค่าระบบและจัดการพนักงาน',
  manager: 'ดูแลหน้าร้านได้ทั้งหมด ยกเว้นตั้งค่าระบบและจัดการพนักงาน',
  cashier: 'ขายและเปิด-ปิดกะได้ ส่วนลด/ยกเลิกบิล/คืนสินค้า ต้องให้ผู้จัดการอนุมัติ',
}

/** สิทธิ์เริ่มต้นของแต่ละบทบาท (แก้รายคนได้ผ่าน staff.perms) */
export const ROLE_PERMS: Record<StaffRole, PermissionKey[]> = {
  owner: ALL_PERMISSIONS,
  manager: [
    'sell',
    'discount',
    'void',
    'refund',
    'products',
    'stock',
    'promotions',
    'members',
    'reports',
    'accounting',
    'shift',
    'taxInvoice',
  ],
  cashier: ['sell', 'members', 'shift'],
}

/** สิทธิ์ที่ใช้จริงของพนักงานคนนี้ = สิทธิ์ตามบทบาท + ที่ปรับรายคน */
export function effectivePerms(staff: Staff): Set<PermissionKey> {
  const set = new Set<PermissionKey>(ROLE_PERMS[staff.role] ?? [])
  if (staff.perms) {
    for (const k of Object.keys(staff.perms) as PermissionKey[]) {
      if (staff.perms[k] === true) set.add(k)
      else if (staff.perms[k] === false) set.delete(k)
    }
  }
  return set
}

/** พนักงานคนนี้มีสิทธิ์นี้ไหม (พนักงานที่ถูกปิดใช้งาน = ไม่มีสิทธิ์ใดๆ) */
export function hasPerm(staff: Staff | null | undefined, perm: PermissionKey): boolean {
  if (!staff || !staff.active) return false
  if (staff.role === 'owner') return true
  return effectivePerms(staff).has(perm)
}

/** สิทธิ์นี้เป็นค่าเริ่มต้นของบทบาทหรือไม่ (ใช้แสดงจุดที่ถูกปรับเอง) */
export const isRoleDefault = (role: StaffRole, perm: PermissionKey) =>
  (ROLE_PERMS[role] ?? []).includes(perm)
