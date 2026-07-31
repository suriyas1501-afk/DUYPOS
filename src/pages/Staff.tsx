import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { PermissionKey, Staff as StaffRow, StaffRole } from '../db/types'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  PageHeader,
  Spinner,
  toast,
  type IconName,
} from '../components/ui'
import { fmtDateTime } from '../lib/format'
import { PIN_MAX, PIN_MIN, hashPin, isWeakPin, validatePin, verifyPin } from '../lib/auth'
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_LABEL,
  effectivePerms,
  isRoleDefault,
} from '../lib/permissions'
import { useSettings } from '../db/hooks'
import { useAuth } from '../stores/authStore'
import StaffModal, { StaffRuleError, hasOtherActiveOwner } from './staff/StaffModal'

/* =========================================================
   ตัวช่วยแสดงผล
   ========================================================= */

const ROLE_BADGE: Record<StaffRole, 'green' | 'blue' | 'slate'> = {
  owner: 'green',
  manager: 'blue',
  cashier: 'slate',
}

/** เรียงเจ้าของร้านขึ้นก่อน แล้วไล่ตามรหัสพนักงาน */
const ROLE_ORDER: Record<StaffRole, number> = { owner: 0, manager: 1, cashier: 2 }

/** PIN เริ่มต้นที่มาจากข้อมูลตัวอย่าง — ต้องเตือนให้เปลี่ยน */
const DEFAULT_PIN = '1234'

/** สิทธิ์ที่ถูกปรับต่างจากค่าเริ่มต้นของบทบาท (เจ้าของร้านมีทุกสิทธิ์ตายตัว จึงไม่นับ) */
function customPermKeys(s: StaffRow): PermissionKey[] {
  const p = s.perms
  if (s.role === 'owner' || !p) return []
  return (Object.keys(p) as PermissionKey[]).filter(
    (k) => p[k] !== undefined && p[k] !== isRoleDefault(s.role, k),
  )
}

/** แถบแจ้งเตือนสีอำพัน — ใช้หน้าตาแบบการ์ด แต่เปลี่ยนสีพื้น/ขอบเอง (Card ตรึง bg-white ไว้) */
function WarnBanner({ icon = 'alert', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
      <Icon name={icon} size={17} className="mt-0.5 text-amber-600" />
      <div className="text-sm leading-relaxed text-amber-800">{children}</div>
    </div>
  )
}

/** รับเฉพาะตัวเลขและตัดความยาวตามที่ระบบรองรับ */
const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, PIN_MAX)

/* =========================================================
   โมดัลเปลี่ยน PIN
   ========================================================= */

function ChangePinModal({ target, onClose }: { target: StaffRow | null; onClose: () => void }) {
  const currentStaffId = useAuth((s) => s.staffId)
  const [oldPin, setOldPin] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    if (!target) return
    setOldPin('')
    setPin('')
    setPin2('')
    setSaving(false)
    savingRef.current = false
  }, [target])

  const id = target?.id
  if (!target || id == null) return null

  // เปลี่ยน PIN ของตัวเอง ต้องยืนยัน PIN เดิมก่อน (กันคนอื่นมาแอบเปลี่ยนตอนลุกจากเครื่อง)
  const isSelf = id === currentStaffId
  const weak = pin !== '' && isWeakPin(pin)

  const save = async () => {
    if (savingRef.current) return

    const err = validatePin(pin)
    if (err) {
      toast.error(err)
      return
    }
    if (pin !== pin2) {
      toast.error('ยืนยัน PIN ใหม่ไม่ตรงกัน กรุณากรอกใหม่')
      return
    }
    if (isSelf && oldPin === '') {
      toast.error('กรุณากรอก PIN เดิมของคุณก่อนเปลี่ยน')
      return
    }

    savingRef.current = true
    setSaving(true)
    try {
      // ตรวจ PIN เดิม + แฮช PIN ใหม่ "นอก" ทรานแซกชัน เพราะ crypto.subtle เป็น promise ภายนอก Dexie
      // (await promise ภายนอกในทรานแซกชันจะทำให้ทรานแซกชันปิดตัวเอง)
      const before = await db.staff.get(id)
      if (!before) throw new StaffRuleError('ไม่พบพนักงานคนนี้ในระบบ (อาจถูกลบไปแล้ว)')
      if (isSelf && !(await verifyPin(oldPin, before.pinHash)))
        throw new StaffRuleError('PIN เดิมไม่ถูกต้อง')
      const pinHash = await hashPin(pin)

      await db.transaction('rw', db.staff, async () => {
        const row = await db.staff.get(id)
        if (!row) throw new StaffRuleError('ไม่พบพนักงานคนนี้ในระบบ (อาจถูกลบไปแล้ว)')
        // ค่าที่เพิ่งตรวจต้องยังไม่ถูกเปลี่ยนจากที่อื่น — กันเขียนทับ PIN ใหม่ของอีกแท็บ
        if (row.pinHash !== before.pinHash)
          throw new StaffRuleError('PIN ของพนักงานคนนี้ถูกเปลี่ยนไปแล้วจากที่อื่น กรุณาลองใหม่')
        await db.staff.update(id, { pinHash })
      })

      toast.success(`เปลี่ยน PIN ของ ${before.name} แล้ว`)
      onClose()
    } catch (e) {
      toast.error(
        e instanceof StaffRuleError ? e.message : 'เปลี่ยน PIN ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      )
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`เปลี่ยน PIN — ${target.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button icon="check" disabled={saving} onClick={() => void save()}>
            {saving ? 'กำลังบันทึก…' : 'เปลี่ยน PIN'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {isSelf && (
          <Field label="PIN เดิมของคุณ *" hint="ต้องยืนยันตัวตนก่อนเปลี่ยน PIN ของบัญชีตัวเอง">
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              className="font-mono tracking-widest"
              value={oldPin}
              onChange={(e) => setOldPin(onlyDigits(e.target.value))}
              placeholder="PIN ที่ใช้อยู่"
            />
          </Field>
        )}
        <Field label="PIN ใหม่ *" hint={`ตัวเลข ${PIN_MIN} - ${PIN_MAX} หลัก`}>
          <Input
            autoFocus={!isSelf}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            className="font-mono tracking-widest"
            value={pin}
            onChange={(e) => setPin(onlyDigits(e.target.value))}
            placeholder="PIN ใหม่"
          />
        </Field>
        <Field label="ยืนยัน PIN ใหม่ *">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            className="font-mono tracking-widest"
            value={pin2}
            onChange={(e) => setPin2(onlyDigits(e.target.value))}
            placeholder="กรอกซ้ำอีกครั้ง"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
          />
        </Field>
        {weak && (
          <p className="flex items-start gap-1.5 text-xs text-amber-600">
            <Icon name="alert" size={13} className="mt-0.5" />
            PIN นี้เดาง่ายเกินไป แนะนำให้เปลี่ยนเป็นเลขที่คนอื่นเดาไม่ได้ (บันทึกต่อได้)
          </p>
        )}
      </div>
    </Modal>
  )
}

/* =========================================================
   หน้าจัดการพนักงาน
   ========================================================= */

export default function Staff() {
  const settings = useSettings()
  const currentStaffId = useAuth((s) => s.staffId)
  const list = useLiveQuery(() => db.staff.toArray(), [])

  const [modalOpen, setModalOpen] = useState(false)
  /** ถือ object ไว้ใน state ให้ identity คงที่ — โมดัลรีเซ็ตฟอร์มตาม prop นี้ */
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [pinTarget, setPinTarget] = useState<StaffRow | null>(null)
  const [deleting, setDeleting] = useState<StaffRow | null>(null)

  /** ล็อกแบบซิงโครนัส + id ที่กำลังทำงาน — กันกดปุ่มรัวในแถวเดียวหรือหลายแถวพร้อมกัน */
  const busyRef = useRef(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  /** id ของพนักงานที่ยังใช้ PIN เริ่มต้น 1234 (ตรวจแบบ async จึงเก็บผลไว้ใน state) */
  const [defaultPinIds, setDefaultPinIds] = useState<number[]>([])

  useEffect(() => {
    if (!list) return
    // ยกเลิกผลลัพธ์ของรอบเก่าเมื่อรายชื่อเปลี่ยน — ไม่ให้ผลที่ค้างอยู่มาเขียนทับรอบใหม่
    let cancelled = false
    const scan = async () => {
      const hits: number[] = []
      for (const s of list) {
        if (s.id == null) continue
        const isDefault = await verifyPin(DEFAULT_PIN, s.pinHash)
        if (cancelled) return
        if (isDefault) hits.push(s.id)
      }
      setDefaultPinIds(hits)
    }
    void scan()
    return () => {
      cancelled = true
    }
  }, [list])

  const sorted = useMemo(
    () =>
      [...(list ?? [])].sort(
        (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.code.localeCompare(b.code, 'th'),
      ),
    [list],
  )

  const defaultPinNames = useMemo(
    () => sorted.filter((s) => s.id != null && defaultPinIds.includes(s.id)).map((s) => s.name),
    [sorted, defaultPinIds],
  )

  const openAdd = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (s: StaffRow) => {
    setEditing(s)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
  }

  /* ----- เปิด/ปิดใช้งาน ----- */
  const setActive = async (row: StaffRow, active: boolean) => {
    const id = row.id
    if (id == null || busyRef.current) return
    busyRef.current = true
    setBusyId(id)
    try {
      await db.transaction('rw', db.staff, async () => {
        const cur = await db.staff.get(id)
        if (!cur) throw new StaffRuleError('ไม่พบพนักงานคนนี้ในระบบ (อาจถูกลบไปแล้ว)')
        if (cur.active === active) return
        if (!active) {
          // ห้ามปิดใช้งานบัญชีตัวเอง — จะล็อกตัวเองออกจากระบบทันที
          if (id === currentStaffId)
            throw new StaffRuleError('ปิดใช้งานบัญชีของตัวเองไม่ได้ — ให้เจ้าของร้านคนอื่นทำแทน')
          // ห้ามเหลือระบบไว้โดยไม่มีเจ้าของร้านที่เปิดใช้งาน
          if (cur.role === 'owner' && !(await hasOtherActiveOwner(id)))
            throw new StaffRuleError(
              'ปิดใช้งานไม่ได้ — ระบบต้องมีเจ้าของร้านที่เปิดใช้งานอยู่อย่างน้อย 1 คน',
            )
        }
        await db.staff.update(id, { active })
      })
      toast.success(active ? `เปิดใช้งาน ${row.name} แล้ว` : `ปิดใช้งาน ${row.name} แล้ว`)
    } catch (e) {
      toast.error(
        e instanceof StaffRuleError ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      )
    } finally {
      busyRef.current = false
      setBusyId(null)
    }
  }

  /* ----- ลบพนักงาน ----- */
  const remove = async (row: StaffRow) => {
    const id = row.id
    if (id == null || busyRef.current) return
    busyRef.current = true
    setBusyId(id)
    try {
      await db.transaction('rw', db.staff, async () => {
        const cur = await db.staff.get(id)
        if (!cur) throw new StaffRuleError('ไม่พบพนักงานคนนี้ในระบบ (อาจถูกลบไปแล้ว)')
        if (id === currentStaffId)
          throw new StaffRuleError('ลบบัญชีของตัวเองไม่ได้ — ให้เจ้าของร้านคนอื่นทำแทน')
        if (cur.role === 'owner' && cur.active && !(await hasOtherActiveOwner(id)))
          throw new StaffRuleError(
            'ลบไม่ได้ — ระบบต้องมีเจ้าของร้านที่เปิดใช้งานอยู่อย่างน้อย 1 คน กรุณาตั้งเจ้าของร้านคนใหม่ก่อน',
          )
        await db.staff.delete(id)
      })
      toast.success(`ลบพนักงาน ${row.name} แล้ว`)
    } catch (e) {
      toast.error(e instanceof StaffRuleError ? e.message : 'ลบพนักงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      busyRef.current = false
      setBusyId(null)
    }
  }

  const activeCount = sorted.filter((s) => s.active).length

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="พนักงาน"
        subtitle={
          list
            ? `ทั้งหมด ${sorted.length} คน · เปิดใช้งาน ${activeCount} คน — กำหนดบทบาท สิทธิ์ และ PIN เข้าสู่ระบบ`
            : undefined
        }
        actions={
          <Button icon="plus" onClick={openAdd}>
            เพิ่มพนักงาน
          </Button>
        }
      />

      {/* ===== เตือน: ระบบพนักงานยังปิดอยู่ ===== */}
      {!settings.staffEnabled && (
        <WarnBanner icon="alert">
          <span className="font-semibold">ระบบพนักงานยังปิดอยู่</span> — รายชื่อและสิทธิ์ในหน้านี้จะยังไม่มีผล
          ทุกคนที่ใช้เครื่องนี้ยังทำได้ทุกอย่างเหมือนเดิม เปิดใช้ได้ที่หน้า{' '}
          <span className="font-semibold">ตั้งค่า › พนักงาน</span>
        </WarnBanner>
      )}

      {/* ===== เตือน: ยังใช้ PIN เริ่มต้น 1234 ===== */}
      {defaultPinNames.length > 0 && (
        <WarnBanner icon="lock">
          <span className="font-semibold">
            มีพนักงาน {defaultPinNames.length} คนยังใช้ PIN เริ่มต้น {DEFAULT_PIN}
          </span>{' '}
          ({defaultPinNames.join(', ')}) — ใครก็เดาได้ กด{' '}
          <span className="font-semibold">“เปลี่ยน PIN”</span> ในตารางเพื่อตั้ง PIN ใหม่
        </WarnBanner>
      )}

      {/* ===== ตารางพนักงาน ===== */}
      <Card padded={false}>
        {!list ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon="users"
            title="ยังไม่มีพนักงาน"
            hint="กดปุ่ม “เพิ่มพนักงาน” เพื่อสร้างบัญชีแรก — แนะนำให้ตั้งเป็นเจ้าของร้าน 1 คนก่อน"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">รหัส</th>
                  <th className="px-4 py-3 font-medium">ชื่อ</th>
                  <th className="px-4 py-3 font-medium">บทบาท</th>
                  <th className="px-4 py-3 font-medium">สิทธิ์</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                  <th className="px-4 py-3 font-medium">เข้าใช้ล่าสุด</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => {
                  const isSelf = s.id != null && s.id === currentStaffId
                  const busy = busyId != null && busyId === s.id
                  const usesDefaultPin = s.id != null && defaultPinIds.includes(s.id)
                  // เจ้าของร้านมีทุกสิทธิ์ตายตัว (hasPerm คืน true เสมอ) จึงนับเต็มจำนวน
                  const permCount =
                    s.role === 'owner' ? ALL_PERMISSIONS.length : effectivePerms(s).size
                  const custom = customPermKeys(s)
                  const customTitle =
                    custom.length > 0
                      ? custom
                          .map(
                            (k) =>
                              `${s.perms?.[k] ? 'เพิ่มให้เอง' : 'ปิดไว้เอง'}: ${PERMISSION_LABELS[k]}`,
                          )
                          .join('\n')
                      : 'สิทธิ์ทั้งหมดตามค่าเริ่มต้นของบทบาท'
                  return (
                    <tr
                      key={s.id}
                      className={`border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50 ${
                        s.active ? '' : 'opacity-60'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                          {s.code}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                            {s.name.trim().charAt(0) || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate font-medium text-slate-800">{s.name}</span>
                              {isSelf && <Badge color="green">คุณ</Badge>}
                              {usesDefaultPin && <Badge color="amber">PIN เริ่มต้น</Badge>}
                            </div>
                            {s.note && (
                              <div className="max-w-52 truncate text-xs text-slate-400">
                                {s.note}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge color={ROLE_BADGE[s.role]}>{ROLE_LABEL[s.role]}</Badge>
                      </td>
                      <td className="px-4 py-2.5" title={customTitle}>
                        <div className="font-medium text-slate-700">{permCount} สิทธิ์</div>
                        <div
                          className={`text-xs ${custom.length > 0 ? 'text-amber-600' : 'text-slate-400'}`}
                        >
                          {custom.length > 0 ? `ปรับเอง ${custom.length} ข้อ` : 'ตามบทบาท'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {s.active ? (
                          <Badge color="green">ใช้งาน</Badge>
                        ) : (
                          <Badge color="slate">ปิดใช้งาน</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {s.lastLoginAt != null ? (
                          fmtDateTime(s.lastLoginAt)
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="pencil"
                            title="แก้ไขข้อมูลและสิทธิ์"
                            disabled={busy}
                            onClick={() => openEdit(s)}
                          >
                            แก้ไข
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="lock"
                            title="เปลี่ยน PIN เข้าสู่ระบบ"
                            disabled={busy}
                            onClick={() => setPinTarget(s)}
                          >
                            PIN
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={s.active ? 'x' : 'check'}
                            title={s.active ? 'ปิดใช้งานบัญชีนี้' : 'เปิดใช้งานบัญชีนี้'}
                            disabled={busy}
                            onClick={() => void setActive(s, !s.active)}
                          >
                            {s.active ? 'ปิด' : 'เปิด'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="trash"
                            title="ลบพนักงาน"
                            className="text-rose-500 hover:bg-rose-50"
                            disabled={busy}
                            onClick={() => setDeleting(s)}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ===== หมายเหตุท้ายหน้า ===== */}
      <div className="mt-4 flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
        <Icon name="shield" size={14} className="mt-0.5 text-slate-400" />
        <p className="text-xs leading-relaxed text-slate-500">
          ระบบเก็บเฉพาะ PIN ที่เข้ารหัสแล้ว ดู PIN เดิมของพนักงานไม่ได้ — ถ้าพนักงานลืม PIN ให้ตั้งใหม่ผ่านปุ่ม “PIN”
          · ระบบต้องมีเจ้าของร้านที่เปิดใช้งานอยู่อย่างน้อย 1 คนเสมอ
        </p>
      </div>

      {/* ===== โมดัล ===== */}
      <StaffModal open={modalOpen} staff={editing ?? undefined} onClose={closeModal} />
      <ChangePinModal target={pinTarget} onClose={() => setPinTarget(null)} />

      <ConfirmDialog
        open={deleting != null}
        title="ลบพนักงาน"
        message={
          <>
            ต้องการลบพนักงาน <span className="font-semibold">“{deleting?.name}”</span> (
            {deleting?.code}) ใช่หรือไม่? บัญชีนี้จะเข้าสู่ระบบไม่ได้อีก
            <span className="mt-2 block rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              บิลเก่ายังเก็บ<span className="font-semibold">ชื่อผู้ขายไว้ตามเดิม</span>{' '}
              (บันทึกเป็นสำเนาไว้ในบิลแล้ว) รายงานยอดขายรายคนจึงไม่หาย
              — หากต้องการเก็บประวัติให้ครบ แนะนำให้ปิดใช้งานแทนการลบ
            </span>
          </>
        }
        confirmLabel="ลบพนักงาน"
        danger
        onConfirm={() => {
          if (deleting) void remove(deleting)
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
