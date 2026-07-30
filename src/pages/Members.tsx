import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Member } from '../db/types'
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
  Textarea,
  toast,
} from '../components/ui'
import { baht, fmtDate, fmtDateTime, r2 } from '../lib/format'
import { findPhoneDup } from '../lib/members'

/* =========================================================
   ตัวช่วย
   ========================================================= */

/** สร้างรหัสสมาชิก M#### รันต่อจากเลขมากสุด (ธรรมเนียมเดียวกับสมัครด่วนหน้าขาย) */
async function nextMemberCode(): Promise<string> {
  const last = await db.members.orderBy('id').last()
  return `M${String((last?.id ?? 0) + 1).padStart(4, '0')}`
}

/* =========================================================
   โมดัลเพิ่มสมาชิก
   ========================================================= */

function AddMemberModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setPhone('')
      setNote('')
      setSaving(false)
    }
  }, [open])

  const canSave = name.trim() !== '' && phone.trim() !== '' && !saving

  const save = async () => {
    const n = name.trim()
    const p = phone.trim()
    if (!n || !p || saving) return
    setSaving(true)
    try {
      const dup = await findPhoneDup(p)
      if (dup) {
        toast.error(`มีเบอร์นี้แล้ว — ${dup.name} (${dup.code})`)
        setSaving(false)
        return
      }
      const code = await nextMemberCode()
      await db.members.add({
        code,
        name: n,
        phone: p,
        points: 0,
        totalSpent: 0,
        visits: 0,
        note: note.trim(),
        createdAt: Date.now(),
      })
      toast.success(`เพิ่มสมาชิก ${n} (${code}) แล้ว`)
      onClose()
    } catch {
      toast.error('บันทึกไม่สำเร็จ')
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="เพิ่มสมาชิก"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button disabled={!canSave} onClick={() => void save()}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ชื่อสมาชิก *">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น สมชาย ใจดี"
          />
        </Field>
        <Field label="เบอร์โทร *" hint="ใช้ค้นหาสมาชิกที่หน้าขาย — เบอร์ซ้ำกับคนอื่นไม่ได้">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="เช่น 0812345678"
            inputMode="tel"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) void save()
            }}
          />
        </Field>
        <Field label="โน้ต">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น แพ้นมวัว / ลูกค้าประจำร้านสาขาหลัก"
          />
        </Field>
        <p className="text-xs text-slate-400">
          รหัสสมาชิกจะถูกสร้างให้อัตโนมัติ (M0001, M0002, …) และเริ่มต้นด้วยแต้มสะสม 0
        </p>
      </div>
    </Modal>
  )
}

/* =========================================================
   โมดัลแก้ไขสมาชิก (+ ปรับแต้ม + ลบ)
   ========================================================= */

function EditMemberModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [pointsStr, setPointsStr] = useState('0')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (member) {
      setName(member.name)
      setPhone(member.phone)
      setNote(member.note ?? '')
      setPointsStr(String(member.points))
      setSaving(false)
      setConfirmDelete(false)
    }
  }, [member])

  if (!member) return null

  const pointsNum = Number(pointsStr)
  const pointsValid = pointsStr.trim() !== '' && Number.isFinite(pointsNum) && pointsNum >= 0
  const canSave = name.trim() !== '' && pointsValid && !saving

  const save = async () => {
    if (member.id == null || !canSave) return
    const n = name.trim()
    const p = phone.trim()
    setSaving(true)
    try {
      const dup = await findPhoneDup(p, member.id)
      if (dup) {
        toast.error(`มีเบอร์นี้แล้ว — ${dup.name} (${dup.code})`)
        setSaving(false)
        return
      }
      await db.members.update(member.id, {
        name: n,
        phone: p,
        note: note.trim(),
        points: Math.round(pointsNum),
      })
      toast.success('บันทึกข้อมูลสมาชิกแล้ว')
      onClose()
    } catch {
      toast.error('บันทึกไม่สำเร็จ')
      setSaving(false)
    }
  }

  const remove = async () => {
    if (member.id == null) return
    try {
      await db.members.delete(member.id)
      toast.success(`ลบสมาชิก ${member.name} แล้ว`)
      onClose()
    } catch {
      toast.error('ลบไม่สำเร็จ')
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`แก้ไขสมาชิก ${member.code}`}
        footer={
          <>
            <Button
              variant="ghost"
              icon="trash"
              className="mr-auto text-rose-600 hover:bg-rose-50"
              onClick={() => setConfirmDelete(true)}
            >
              ลบสมาชิก
            </Button>
            <Button variant="secondary" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button disabled={!canSave} onClick={() => void save()}>
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="ชื่อสมาชิก *">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="เบอร์โทร" hint="ถ้ากรอก ต้องไม่ซ้ำกับสมาชิกคนอื่น">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </Field>
          <Field label="โน้ต">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {/* ===== ปรับแต้มสะสม ===== */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700">ปรับแต้มสะสม</span>
              <span className="text-sm text-slate-500">
                ปัจจุบัน <span className="font-bold text-emerald-700">{baht(member.points)}</span>{' '}
                แต้ม
              </span>
            </div>
            <Field label="ตั้งค่าแต้มใหม่">
              <Input
                type="number"
                min={0}
                step={1}
                value={pointsStr}
                onChange={(e) => setPointsStr(e.target.value)}
              />
            </Field>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
              <Icon name="alert" size={13} />
              ปรับด้วยตนเอง — ไม่เกี่ยวกับการสะสม/แลกแต้มจากการขาย โปรดตรวจสอบให้ถูกต้อง
            </p>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="ลบสมาชิก"
        message={
          <>
            ต้องการลบสมาชิก <span className="font-semibold">“{member.name}”</span> ({member.code})
            ใช่หรือไม่? แต้มสะสมจะหายไปทั้งหมด
            <span className="mt-1.5 block text-xs text-slate-400">
              บิลเก่าที่เคยผูกกับสมาชิกคนนี้จะยังเก็บชื่อไว้ตามเดิม ไม่ได้รับผลกระทบ
            </span>
          </>
        }
        confirmLabel="ลบสมาชิก"
        danger
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}

/* =========================================================
   โมดัลดูรายละเอียดสมาชิก
   ========================================================= */

function StatBox({
  label,
  value,
  unit,
  valueCls = 'text-slate-800',
}: {
  label: string
  value: string
  unit: string
  valueCls?: string
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate text-lg font-bold ${valueCls}`}>{value}</div>
      <div className="text-[11px] text-slate-400">{unit}</div>
    </div>
  )
}

function ViewMemberModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const memberId = member?.id

  // 10 บิลล่าสุดของสมาชิกคนนี้ (ใหม่ → เก่า)
  const recentSales = useLiveQuery(async () => {
    if (memberId == null) return []
    const rows = await db.sales.where('memberId').equals(memberId).toArray()
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
  }, [memberId])

  if (!member) return null

  const avgPerVisit = member.visits > 0 ? r2(member.totalSpent / member.visits) : 0

  return (
    <Modal open onClose={onClose} size="lg" title={`ข้อมูลสมาชิก ${member.code}`}>
      <div className="space-y-5">
        {/* ===== ข้อมูลติดต่อ ===== */}
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700">
            {member.name.trim().charAt(0) || '?'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-slate-800">{member.name}</span>
              <Badge color="green">{member.code}</Badge>
            </div>
            <div className="mt-0.5 text-sm text-slate-600">
              โทร. {member.phone || <span className="text-slate-300">—</span>}
              <span className="mx-2 text-slate-300">·</span>
              <span className="text-slate-500">สมัครเมื่อ {fmtDate(member.createdAt)}</span>
            </div>
            {member.note && (
              <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                โน้ต: {member.note}
              </p>
            )}
          </div>
        </div>

        {/* ===== สถิติ 4 ช่อง ===== */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox
            label="แต้มคงเหลือ"
            value={baht(member.points)}
            unit="แต้ม"
            valueCls="text-emerald-700"
          />
          <StatBox label="ยอดซื้อสะสม" value={baht(member.totalSpent)} unit="บาท" />
          <StatBox label="จำนวนครั้ง" value={baht(member.visits)} unit="ครั้ง" />
          <StatBox label="เฉลี่ย/ครั้ง" value={baht(avgPerVisit)} unit="บาท" />
        </div>

        {/* ===== ประวัติ 10 บิลล่าสุด ===== */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
            <Icon name="history" size={15} className="text-slate-400" />
            ประวัติการซื้อล่าสุด (สูงสุด 10 บิล)
          </div>
          {!recentSales ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : recentSales.length === 0 ? (
            <div className="rounded-xl border border-slate-100">
              <EmptyState
                icon="receipt"
                title="ยังไม่มีประวัติการซื้อ"
                hint="บิลที่ผูกกับสมาชิกคนนี้จะแสดงที่นี่"
              />
            </div>
          ) : (
            <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-100">
              {recentSales.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-700">{s.receiptNo}</div>
                    <div className="text-xs text-slate-400">{fmtDateTime(s.createdAt)}</div>
                  </div>
                  <div
                    className={`text-right font-semibold ${
                      s.status === 'voided' ? 'text-slate-400 line-through' : 'text-slate-800'
                    }`}
                  >
                    ฿{baht(s.total)}
                  </div>
                  {s.status === 'completed' ? (
                    <Badge color="green">สำเร็จ</Badge>
                  ) : (
                    <Badge color="red">ยกเลิก</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* =========================================================
   หน้าสมาชิก
   ========================================================= */

export default function Members() {
  const members = useLiveQuery(() => db.members.toArray(), [])

  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [viewId, setViewId] = useState<number | null>(null)

  // สมาชิกที่กำลังดู — ผูกกับ live query เพื่อให้ตัวเลขอัปเดตทันทีเมื่อข้อมูลเปลี่ยน
  const viewMember = useMemo(
    () => (viewId != null ? (members?.find((m) => m.id === viewId) ?? null) : null),
    [members, viewId],
  )

  const filtered = useMemo(() => {
    if (!members) return []
    const q = search.trim().toLowerCase()
    return members
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.phone.includes(q) ||
          m.code.toLowerCase().includes(q),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [members, search])

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="สมาชิก"
        subtitle={members ? `จำนวนสมาชิกทั้งหมด ${members.length} คน` : undefined}
        actions={
          <Button icon="plus" onClick={() => setAddOpen(true)}>
            เพิ่มสมาชิก
          </Button>
        }
      />

      {/* ===== ช่องค้นหา ===== */}
      <div className="mb-4 max-w-md">
        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <Input
            className="pl-9"
            placeholder="ค้นหาชื่อ เบอร์โทร หรือรหัสสมาชิก…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ===== ตารางสมาชิก ===== */}
      <Card padded={false}>
        {!members ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            icon="users"
            title="ยังไม่มีสมาชิก"
            hint="กดปุ่ม “เพิ่มสมาชิก” หรือสมัครด่วนได้จากหน้าขาย"
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon="search" title="ไม่พบสมาชิกตามคำค้นหา" hint="ลองเปลี่ยนคำค้นหา" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">รหัส</th>
                  <th className="px-4 py-3 font-medium">ชื่อ</th>
                  <th className="px-4 py-3 font-medium">เบอร์โทร</th>
                  <th className="px-4 py-3 text-right font-medium">แต้มสะสม</th>
                  <th className="px-4 py-3 text-right font-medium">ยอดซื้อสะสม</th>
                  <th className="px-4 py-3 text-right font-medium">จำนวนครั้ง</th>
                  <th className="px-4 py-3 font-medium">สมัครเมื่อ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5">
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                        {m.code}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                          {m.name.trim().charAt(0) || '?'}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{m.name}</div>
                          {m.note && (
                            <div className="max-w-52 truncate text-xs text-slate-400">{m.note}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {m.phone || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-emerald-700">
                      {baht(m.points)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">฿{baht(m.totalSpent)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{m.visits}</td>
                    <td className="px-4 py-2.5 text-slate-500">{fmtDate(m.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="eye"
                          title="ดูรายละเอียด"
                          onClick={() => {
                            if (m.id != null) setViewId(m.id)
                          }}
                        >
                          ดู
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="pencil"
                          title="แก้ไข"
                          onClick={() => setEditing(m)}
                        >
                          แก้ไข
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ===== โมดัล ===== */}
      <AddMemberModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EditMemberModal member={editing} onClose={() => setEditing(null)} />
      <ViewMemberModal member={viewMember} onClose={() => setViewId(null)} />
    </div>
  )
}
