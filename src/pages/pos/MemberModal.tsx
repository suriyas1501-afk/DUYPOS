import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { useCart } from '../../stores/cartStore'
import { baht } from '../../lib/format'
import { findPhoneDup } from '../../lib/members'
import { Badge, Button, EmptyState, Icon, Input, Modal, toast } from '../../components/ui'

/** โมดัลเลือกสมาชิก: ค้นหาชื่อ/เบอร์ + สมัครด่วน */
export default function MemberModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setQ('')
      setName('')
      setPhone('')
      setSaving(false)
    }
  }, [open])

  const members = useLiveQuery(async () => {
    const all = await db.members.toArray()
    const s = q.trim().toLowerCase()
    const list = s
      ? all.filter(
          (m) =>
            m.name.toLowerCase().includes(s) ||
            m.phone.includes(s) ||
            m.code.toLowerCase().includes(s),
        )
      : all
    return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
  }, [q])

  const select = (id: number, memberName: string) => {
    useCart.getState().setMember(id)
    toast.success(`เลือกสมาชิก ${memberName} แล้ว`)
    onClose()
  }

  const register = async () => {
    const n = name.trim()
    const p = phone.trim()
    if (!n || saving) return
    setSaving(true)
    try {
      // เบอร์โทรต้องไม่ซ้ำกับสมาชิกคนอื่น (กติกาเดียวกับหน้าสมาชิก)
      const dup = await findPhoneDup(p)
      if (dup) {
        toast.error(`มีเบอร์นี้แล้ว — ${dup.name} (${dup.code})`)
        setSaving(false)
        return
      }
      // สร้างรหัส M#### รันต่อจาก id ล่าสุด
      const last = await db.members.orderBy('id').last()
      const code = `M${String((last?.id ?? 0) + 1).padStart(4, '0')}`
      const id = await db.members.add({
        code,
        name: n,
        phone: p,
        points: 0,
        totalSpent: 0,
        visits: 0,
        createdAt: Date.now(),
      })
      select(id, n)
    } catch {
      toast.error('สมัครสมาชิกไม่สำเร็จ')
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="เลือกสมาชิก">
      <div className="space-y-4">
        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <Input
            autoFocus
            className="pl-9"
            placeholder="ค้นหาชื่อ เบอร์โทร หรือรหัสสมาชิก…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100">
          {!members || members.length === 0 ? (
            <EmptyState icon="users" title="ไม่พบสมาชิก" hint="สมัครสมาชิกใหม่ได้ที่ฟอร์มด้านล่าง" />
          ) : (
            <div className="divide-y divide-slate-50">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => select(m.id!, m.name)}
                  className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-emerald-50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                    {m.name.trim().charAt(0) || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-700">{m.name}</div>
                    <div className="text-xs text-slate-400">
                      {m.code}
                      {m.phone ? ` · ${m.phone}` : ''}
                    </div>
                  </div>
                  <Badge color="green">{baht(m.points)} แต้ม</Badge>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ===== สมัครด่วน ===== */}
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="mb-2 text-sm font-semibold text-slate-600">สมัครสมาชิกใหม่ (ด่วน)</div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-32 flex-1"
              placeholder="ชื่อ"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              className="min-w-32 flex-1"
              placeholder="เบอร์โทร"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void register()
              }}
            />
            <Button
              icon="plus"
              disabled={!name.trim() || saving}
              onClick={() => void register()}
            >
              {saving ? 'กำลังบันทึก…' : 'สมัครและเลือก'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
