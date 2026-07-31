import { useEffect, useRef, useState } from 'react'
import { db } from '../../db/db'
import type { PermissionKey, Staff, StaffRole } from '../../db/types'
import {
  Badge,
  Button,
  Field,
  Icon,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
  toast,
} from '../../components/ui'
import { PIN_MAX, PIN_MIN, hashPin, isWeakPin, validatePin } from '../../lib/auth'
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_HINT,
  ROLE_LABEL,
  ROLE_PERMS,
  effectivePerms,
  isRoleDefault,
} from '../../lib/permissions'
import { useAuth } from '../../stores/authStore'

/* =========================================================
   ตัวช่วยที่หน้าพนักงานใช้ร่วมกัน
   ========================================================= */

/**
 * ข้อผิดพลาดที่มีข้อความไทยพร้อมแสดงให้ผู้ใช้เห็นตรงๆ
 * แยกจาก error ของระบบ (Dexie/crypto) ที่ต้องแสดงข้อความกลางๆ แทน
 */
export class StaffRuleError extends Error {}

/**
 * ยังเหลือ "เจ้าของร้านที่เปิดใช้งาน" อยู่ไหม ถ้าไม่นับคน id = excludeId
 *
 * ต้องเรียกภายใน db.transaction เดียวกับที่เขียนข้อมูล — เชื่อ snapshot จาก useLiveQuery ไม่ได้
 * เพราะอีกแท็บ/อีกหน้าจออาจปิดใช้งานเจ้าของร้านคนสุดท้ายไปแล้วระหว่างที่หน้านี้ยังค้างอยู่
 */
export async function hasOtherActiveOwner(excludeId: number | undefined): Promise<boolean> {
  const owners = await db.staff.where('role').equals('owner').toArray()
  return owners.some((s) => s.active && s.id !== excludeId)
}

/**
 * แปลงสิทธิ์ที่ติ๊กไว้เป็นค่าที่จะเก็บลงฟิลด์ perms
 * เก็บเฉพาะข้อที่ "ต่างจากค่าเริ่มต้นของบทบาท" — ถ้าไม่ต่างเลยคืน undefined
 * เพื่อให้พนักงานคนนี้เลื่อนตามค่าเริ่มต้นของบทบาทอัตโนมัติหากมีการปรับสิทธิ์บทบาทในอนาคต
 */
function diffPerms(
  role: StaffRole,
  on: Set<PermissionKey>,
): Partial<Record<PermissionKey, boolean>> | undefined {
  // เจ้าของร้านมีทุกสิทธิ์ตายตัว (hasPerm คืน true เสมอ) จึงไม่ต้องเก็บ override ใดๆ
  if (role === 'owner') return undefined
  const out: Partial<Record<PermissionKey, boolean>> = {}
  let count = 0
  for (const k of ALL_PERMISSIONS) {
    const v = on.has(k)
    if (v !== isRoleDefault(role, k)) {
      out[k] = v
      count++
    }
  }
  return count > 0 ? out : undefined
}

const ROLES: StaffRole[] = ['owner', 'manager', 'cashier']

/** รับเฉพาะตัวเลขและตัดความยาวตามที่ระบบรองรับ (PIN เป็นตัวเลขเท่านั้น) */
const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, PIN_MAX)

/* =========================================================
   โมดัลเพิ่ม / แก้ไขพนักงาน
   ========================================================= */

export default function StaffModal({
  open,
  staff,
  onClose,
}: {
  open: boolean
  staff?: Staff
  onClose: () => void
}) {
  const editingId = staff?.id
  const currentStaffId = useAuth((s) => s.staffId)
  const isSelf = editingId != null && editingId === currentStaffId

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<StaffRole>('cashier')
  const [note, setNote] = useState('')
  const [active, setActive] = useState(true)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [perms, setPerms] = useState<Set<PermissionKey>>(() => new Set(ROLE_PERMS.cashier))
  /** บทบาทที่เพิ่งเปลี่ยนแล้วรีเซ็ตสิทธิ์ให้ (ใช้แสดงข้อความบอกผู้ใช้) */
  const [resetTo, setResetTo] = useState<StaffRole | null>(null)
  const [saving, setSaving] = useState(false)
  /** ล็อกแบบซิงโครนัส — state saving อัปเดตช้ากว่าการกดปุ่มรัวๆ */
  const savingRef = useRef(false)

  // ตั้งค่าฟอร์มใหม่ทุกครั้งที่เปิดโมดัล (คอมโพเนนต์นี้ไม่ถูก unmount ตอนปิด)
  // หน้าแม่ต้องถือ staff ไว้ใน state ให้ identity คงที่ ไม่ส่ง object ใหม่ทุกเฟรม
  useEffect(() => {
    if (!open) return
    setCode(staff?.code ?? '')
    setName(staff?.name ?? '')
    setRole(staff?.role ?? 'cashier')
    setNote(staff?.note ?? '')
    setActive(staff?.active ?? true)
    setPin('')
    setPin2('')
    setPerms(staff ? effectivePerms(staff) : new Set(ROLE_PERMS.cashier))
    setResetTo(null)
    setSaving(false)
    savingRef.current = false
  }, [open, staff])

  /** เปลี่ยนบทบาท = รีเซ็ตสิทธิ์กลับเป็นค่าเริ่มต้นของบทบาทใหม่ทั้งชุด */
  const onRoleChange = (next: StaffRole) => {
    setRole(next)
    setPerms(new Set(ROLE_PERMS[next]))
    setResetTo(next)
  }

  const togglePerm = (key: PermissionKey, on: boolean) => {
    setPerms((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
    setResetTo(null)
  }

  const isOwner = role === 'owner'
  const pinRequired = editingId == null
  const pinTouched = pin !== '' || pin2 !== ''
  const weak = pin !== '' && isWeakPin(pin)

  // จำนวนสิทธิ์ที่ปรับต่างจากค่าเริ่มต้นของบทบาท (เจ้าของร้านไม่นับ เพราะมีทุกสิทธิ์ตายตัว)
  const customCount = isOwner
    ? 0
    : ALL_PERMISSIONS.filter((k) => perms.has(k) !== isRoleDefault(role, k)).length

  const save = async () => {
    if (savingRef.current) return

    const c = code.trim().toUpperCase()
    if (!c) {
      toast.error('กรุณากรอกรหัสพนักงาน')
      return
    }
    const n = name.trim()
    if (!n) {
      toast.error('กรุณากรอกชื่อพนักงาน')
      return
    }

    // PIN: เพิ่มใหม่ = บังคับ / แก้ไข = เว้นว่างทั้งสองช่องไว้แปลว่าไม่เปลี่ยน
    if (pinRequired || pinTouched) {
      const err = validatePin(pin)
      if (err) {
        toast.error(err)
        return
      }
      if (pin !== pin2) {
        toast.error('ยืนยัน PIN ไม่ตรงกัน กรุณากรอกใหม่')
        return
      }
    }

    savingRef.current = true
    setSaving(true)
    try {
      // แฮช PIN ให้เสร็จ "ก่อน" เข้าทรานแซกชัน — crypto.subtle เป็น promise ภายนอก Dexie
      // ถ้า await ข้างในทรานแซกชันจะทำให้ทรานแซกชันปิดตัวเอง (TransactionInactiveError)
      const newHash = pinRequired || pinTouched ? await hashPin(pin) : ''
      const permsField = diffPerms(role, perms)
      const noteVal = note.trim()

      await db.transaction('rw', db.staff, async () => {
        // ตรวจรหัสซ้ำในทรานแซกชันเดียวกับที่เขียน (ตาราง staff มี index &code แบบไม่ซ้ำ)
        const dup = await db.staff.where('code').equals(c).first()
        if (dup && dup.id !== editingId)
          throw new StaffRuleError(`รหัส ${c} ถูกใช้กับพนักงาน “${dup.name}” อยู่แล้ว`)

        if (editingId == null) {
          const row: Staff = {
            code: c,
            name: n,
            role,
            pinHash: newHash,
            active,
            createdAt: Date.now(),
          }
          if (permsField) row.perms = permsField
          if (noteVal) row.note = noteVal
          await db.staff.add(row)
          return
        }

        const cur = await db.staff.get(editingId)
        if (!cur) throw new StaffRuleError('ไม่พบพนักงานคนนี้ในระบบ (อาจถูกลบไปแล้ว)')

        // ห้ามปิดใช้งานบัญชีตัวเอง — จะล็อกตัวเองออกจากระบบทันที
        if (!active && editingId === currentStaffId)
          throw new StaffRuleError('ปิดใช้งานบัญชีของตัวเองไม่ได้ — ให้เจ้าของร้านคนอื่นทำแทน')

        // ห้ามทำให้ไม่เหลือเจ้าของร้านที่เปิดใช้งานอยู่เลย (ทั้งเปลี่ยนบทบาทและปิดใช้งาน)
        const wasActiveOwner = cur.role === 'owner' && cur.active
        const willBeActiveOwner = role === 'owner' && active
        if (wasActiveOwner && !willBeActiveOwner && !(await hasOtherActiveOwner(editingId))) {
          throw new StaffRuleError(
            role !== 'owner'
              ? 'เปลี่ยนบทบาทไม่ได้ — ระบบต้องมีเจ้าของร้านที่เปิดใช้งานอยู่อย่างน้อย 1 คน กรุณาตั้งเจ้าของร้านคนใหม่ก่อน'
              : 'ปิดใช้งานไม่ได้ — ระบบต้องมีเจ้าของร้านที่เปิดใช้งานอยู่อย่างน้อย 1 คน',
          )
        }

        // ใช้ put เพื่อเขียนทับทั้งแถว — ทำให้ฟิลด์ perms หายไปได้จริงเมื่อไม่มีสิทธิ์ที่ปรับเอง
        const next: Staff = {
          id: editingId,
          code: c,
          name: n,
          role,
          pinHash: newHash || cur.pinHash,
          active,
          createdAt: cur.createdAt,
        }
        if (permsField) next.perms = permsField
        if (noteVal) next.note = noteVal
        if (cur.lastLoginAt != null) next.lastLoginAt = cur.lastLoginAt
        await db.staff.put(next)
      })

      toast.success(
        editingId == null ? `เพิ่มพนักงาน ${n} (${c}) แล้ว` : `บันทึกข้อมูลพนักงาน ${n} แล้ว`,
      )
      onClose()
    } catch (e) {
      const dupIndex =
        e instanceof Error && (e.name === 'ConstraintError' || /constraint/i.test(e.message))
      toast.error(
        e instanceof StaffRuleError
          ? e.message
          : dupIndex
            ? 'รหัสพนักงานนี้มีอยู่แล้ว กรุณาใช้รหัสอื่น'
            : 'บันทึกข้อมูลพนักงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      )
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingId == null ? 'เพิ่มพนักงาน' : `แก้ไขพนักงาน ${staff?.code ?? ''}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button icon="check" disabled={saving} onClick={() => void save()}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* ===== ข้อมูลพื้นฐาน ===== */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="รหัสพนักงาน *" hint="ใช้เลือกตัวเองตอนเข้าสู่ระบบ — ระบบเก็บเป็นตัวพิมพ์ใหญ่และห้ามซ้ำ">
            <Input
              autoFocus
              className="font-mono tracking-wide uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="เช่น E01"
            />
          </Field>
          <Field label="ชื่อพนักงาน *" hint="ชื่อนี้จะถูกบันทึกเป็นผู้ขายบนบิล">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
            />
          </Field>
        </div>

        <Field label="บทบาท" hint={ROLE_HINT[role]}>
          <Select value={role} onChange={(e) => onRoleChange(e.target.value as StaffRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>

        {resetTo != null && (
          <p className="flex items-start gap-1.5 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-700">
            <Icon name="refresh" size={13} className="mt-0.5" />
            รีเซ็ตสิทธิ์ให้เป็นค่าเริ่มต้นของ “{ROLE_LABEL[resetTo]}” แล้ว — ปรับเพิ่ม/ลดรายข้อได้ด้านล่าง
          </p>
        )}

        {/* ===== PIN ===== */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-700">
            <Icon name="lock" size={15} className="text-slate-400" />
            PIN เข้าสู่ระบบ
            {!pinRequired && <span className="font-normal text-slate-400">(เว้นว่าง = ไม่เปลี่ยน)</span>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={pinRequired ? 'PIN *' : 'PIN ใหม่'}>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                className="font-mono tracking-widest"
                value={pin}
                onChange={(e) => setPin(onlyDigits(e.target.value))}
                placeholder={`ตัวเลข ${PIN_MIN} - ${PIN_MAX} หลัก`}
              />
            </Field>
            <Field label={pinRequired ? 'ยืนยัน PIN *' : 'ยืนยัน PIN ใหม่'}>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                className="font-mono tracking-widest"
                value={pin2}
                onChange={(e) => setPin2(onlyDigits(e.target.value))}
                placeholder="กรอกซ้ำอีกครั้ง"
              />
            </Field>
          </div>
          {weak && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600">
              <Icon name="alert" size={13} className="mt-0.5" />
              PIN นี้เดาง่ายเกินไป แนะนำให้เปลี่ยนเป็นเลขที่คนอื่นเดาไม่ได้ (บันทึกต่อได้)
            </p>
          )}
          {pinTouched && pin !== '' && pin2 !== '' && pin !== pin2 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-rose-600">
              <Icon name="alert" size={13} className="mt-0.5" />
              PIN ทั้งสองช่องยังไม่ตรงกัน
            </p>
          )}
        </div>

        {/* ===== สิทธิ์การใช้งาน ===== */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
              <Icon name="shield" size={15} className="text-slate-400" />
              สิทธิ์การใช้งาน
            </div>
            {isOwner ? (
              <Badge color="green">เจ้าของร้านมีทุกสิทธิ์</Badge>
            ) : customCount > 0 ? (
              <Badge color="amber">ปรับเองจากค่าเริ่มต้น {customCount} ข้อ</Badge>
            ) : (
              <Badge color="slate">ตามค่าเริ่มต้นของบทบาท</Badge>
            )}
          </div>

          {isOwner && (
            <p className="mb-2 text-xs text-slate-500">
              บทบาทเจ้าของร้านมีสิทธิ์ทุกข้อตายตัว ปรับรายข้อไม่ได้ — เปลี่ยนบทบาทเป็นผู้จัดการหรือพนักงานขายก่อนหากต้องการจำกัดสิทธิ์
            </p>
          )}

          <div className="space-y-3">
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.title} className="overflow-hidden rounded-xl border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-500">
                  {g.title}
                </div>
                <div className="divide-y divide-slate-50">
                  {g.keys.map((k) => {
                    const on = isOwner || perms.has(k)
                    const changed = !isOwner && on !== isRoleDefault(role, k)
                    return (
                      <div key={k} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <span className="text-sm text-slate-700">{PERMISSION_LABELS[k]}</span>
                          {changed && (
                            <span
                              className="ml-2 text-[11px] font-medium text-amber-600"
                              title={`ค่าเริ่มต้นของ ${ROLE_LABEL[role]} คือ ${isRoleDefault(role, k) ? 'เปิด' : 'ปิด'}`}
                            >
                              {on ? '• เพิ่มให้เอง' : '• ปิดไว้เอง'}
                            </span>
                          )}
                        </div>
                        {/* Toggle ในชุด UI ไม่มี prop disabled — ล็อกด้วย pointer-events แทนตอนเป็นเจ้าของร้าน */}
                        <div
                          aria-disabled={isOwner}
                          className={isOwner ? 'pointer-events-none opacity-50' : ''}
                        >
                          <Toggle checked={on} onChange={(v) => togglePerm(k, v)} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ===== หมายเหตุ + สถานะ ===== */}
        <Field label="หมายเหตุ">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น พนักงานพาร์ตไทม์ เข้ากะเสาร์-อาทิตย์ (ไม่บังคับ)"
          />
        </Field>

        <div className="rounded-xl border border-slate-200 p-4">
          <Toggle checked={active} onChange={setActive} label="เปิดใช้งานบัญชีนี้" />
          <p className="mt-1.5 text-xs text-slate-400">
            ปิดใช้งานแล้วจะเข้าสู่ระบบไม่ได้และไม่มีสิทธิ์ใดๆ แต่ยังเก็บประวัติการขายไว้ทั้งหมด
          </p>
          {isSelf && !active && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-rose-600">
              <Icon name="alert" size={13} className="mt-0.5" />
              นี่คือบัญชีของคุณเอง — ปิดใช้งานบัญชีตัวเองไม่ได้
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
