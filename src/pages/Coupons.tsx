import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Coupon } from '../db/types'
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
  Select,
  Spinner,
  Toggle,
  toast,
} from '../components/ui'
import { fmtDate, r2 } from '../lib/format'
import { describeCoupon, normalizeCode } from '../lib/coupons'

/* ===== ป้ายประเภทคูปอง ===== */

const TYPE_META: Record<Coupon['type'], { label: string; color: 'green' | 'blue' }> = {
  percent: { label: 'ลด %', color: 'green' },
  amount: { label: 'ลดเงิน', color: 'blue' },
}

/* ===== แปลงเวลา <-> ค่า input type="datetime-local" ===== */

const pad2 = (n: number) => String(n).padStart(2, '0')

const toLocalInput = (t?: number) => {
  if (t == null) return ''
  const d = new Date(t)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const fromLocalInput = (v: string): number | undefined => {
  if (!v) return undefined
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? undefined : t
}

/* ===== สุ่มโค้ด 8 ตัวอักษร (A-Z, 0-9) ===== */

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const randomCode = (len = 8) => {
  const buf = new Uint32Array(len)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 0xffffffff)
  }
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length]
  return out
}

/* ===== ตัวกรองสถานะ ===== */

type StatusFilter = 'all' | 'usable' | 'closed' | 'used'

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'usable', label: 'ใช้ได้' },
  { key: 'closed', label: 'หมดอายุ/ปิด' },
  { key: 'used', label: 'ใช้ครบแล้ว' },
]

interface CouponState {
  exhausted: boolean
  expired: boolean
  notStarted: boolean
  usable: boolean
}

const stateOf = (c: Coupon, now: number): CouponState => {
  const exhausted = c.usageLimit != null && c.usageLimit > 0 && c.usedCount >= c.usageLimit
  const expired = c.endsAt != null && c.endsAt < now
  const notStarted = c.startsAt != null && c.startsAt > now
  return { exhausted, expired, notStarted, usable: c.active && !expired && !exhausted }
}

const matchStatus = (c: Coupon, st: CouponState, filter: StatusFilter) => {
  if (filter === 'all') return true
  if (filter === 'usable') return st.usable
  if (filter === 'closed') return !c.active || st.expired
  return st.exhausted
}

const periodText = (c: Coupon): string => {
  if (c.startsAt != null && c.endsAt != null) return `${fmtDate(c.startsAt)} – ${fmtDate(c.endsAt)}`
  if (c.startsAt != null) return `เริ่ม ${fmtDate(c.startsAt)}`
  if (c.endsAt != null) return `ถึง ${fmtDate(c.endsAt)}`
  return 'ใช้ได้ตลอด (ไม่กำหนดช่วงเวลา)'
}

/* ===== สถานะฟอร์ม ===== */

interface CouponForm {
  code: string
  name: string
  type: Coupon['type']
  value: string
  maxDiscount: string
  minSubtotal: string
  usageLimit: string
  startsAt: string
  endsAt: string
  active: boolean
}

const EMPTY_FORM: CouponForm = {
  code: '',
  name: '',
  type: 'percent',
  value: '',
  maxDiscount: '',
  minSubtotal: '',
  usageLimit: '',
  startsAt: '',
  endsAt: '',
  active: true,
}

export default function Coupons() {
  const coupons = useLiveQuery(() => db.coupons.toArray(), [])

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [copied, setCopied] = useState<string | null>(null)

  /* ----- โมดัลสร้าง/แก้ไข ----- */
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingUsed, setEditingUsed] = useState(0)
  const [form, setForm] = useState<CouponForm>(EMPTY_FORM)
  const [deleting, setDeleting] = useState<Coupon | null>(null)

  const set = <K extends keyof CouponForm>(key: K, value: CouponForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const now = Date.now()

  const openAdd = () => {
    setEditingId(null)
    setEditingUsed(0)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEdit = (c: Coupon) => {
    setEditingId(c.id ?? null)
    setEditingUsed(c.usedCount)
    setForm({
      code: c.code,
      name: c.name,
      type: c.type,
      value: String(c.value),
      maxDiscount: c.maxDiscount != null ? String(c.maxDiscount) : '',
      minSubtotal: c.minSubtotal != null ? String(c.minSubtotal) : '',
      usageLimit: c.usageLimit != null ? String(c.usageLimit) : '',
      startsAt: toLocalInput(c.startsAt),
      endsAt: toLocalInput(c.endsAt),
      active: c.active,
    })
    setModalOpen(true)
  }

  /* ----- สุ่มโค้ดที่ยังไม่ถูกใช้ ----- */
  const genCode = () => {
    const taken = new Set((coupons ?? []).map((c) => c.code))
    let code = randomCode()
    for (let i = 0; i < 20 && taken.has(code); i++) code = randomCode()
    set('code', code)
  }

  /* ----- คัดลอกโค้ด ----- */
  const copyCode = async (code: string) => {
    try {
      // บางบริบท (http บนเครือข่ายภายใน) จะไม่มี Clipboard API ให้ใช้
      const clip: Clipboard | undefined = navigator.clipboard
      if (clip) {
        await clip.writeText(code)
      } else {
        // วิธีสำรอง: สร้าง textarea ชั่วคราวแล้วสั่งคัดลอก
        const ta = document.createElement('textarea')
        ta.value = code
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('copy failed')
      }
      setCopied(code)
      setTimeout(() => setCopied((v) => (v === code ? null : v)), 1500)
      toast.success(`คัดลอกโค้ด ${code} แล้ว`)
    } catch {
      toast.error('คัดลอกโค้ดไม่สำเร็จ — กดค้างที่โค้ดเพื่อคัดลอกเองได้')
    }
  }

  /* ----- บันทึก ----- */
  const save = async () => {
    const code = normalizeCode(form.code)
    if (!code) {
      toast.error('กรุณากรอกโค้ดคูปอง')
      return
    }
    if (code.length < 3) {
      toast.error('โค้ดคูปองต้องมีอย่างน้อย 3 ตัวอักษร')
      return
    }
    if (!/^[A-Z0-9_-]+$/.test(code)) {
      toast.error('โค้ดใช้ได้เฉพาะตัวอักษร A-Z ตัวเลข 0-9 และเครื่องหมาย - _')
      return
    }

    const name = form.name.trim()
    if (!name) {
      toast.error('กรุณากรอกชื่อคูปอง')
      return
    }

    const value = Number(form.value)
    if (form.type === 'percent') {
      if (!Number.isFinite(value) || value < 1 || value > 100) {
        toast.error('ส่วนลดเปอร์เซ็นต์ต้องอยู่ระหว่าง 1 - 100')
        return
      }
    } else if (!Number.isFinite(value) || value <= 0) {
      toast.error('จำนวนเงินส่วนลดต้องมากกว่า 0')
      return
    }

    let maxDiscount: number | undefined
    if (form.type === 'percent' && form.maxDiscount.trim() !== '') {
      maxDiscount = Number(form.maxDiscount)
      if (!Number.isFinite(maxDiscount) || maxDiscount <= 0) {
        toast.error('เพดานส่วนลดต้องเป็นตัวเลขมากกว่า 0 (เว้นว่างหากไม่จำกัด)')
        return
      }
    }

    let minSubtotal: number | undefined
    if (form.minSubtotal.trim() !== '') {
      minSubtotal = Number(form.minSubtotal)
      if (!Number.isFinite(minSubtotal) || minSubtotal <= 0) {
        toast.error('ยอดบิลขั้นต่ำต้องเป็นตัวเลขมากกว่า 0 (เว้นว่างหากไม่มีขั้นต่ำ)')
        return
      }
    }

    let usageLimit: number | undefined
    if (form.usageLimit.trim() !== '') {
      const n = Number(form.usageLimit)
      if (!Number.isFinite(n) || n < 1) {
        toast.error('จำนวนครั้งที่ใช้ได้ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป (เว้นว่าง = ไม่จำกัด)')
        return
      }
      usageLimit = Math.floor(n)
    }

    const startsAt = fromLocalInput(form.startsAt)
    const endsAt = fromLocalInput(form.endsAt)
    if (startsAt != null && endsAt != null && startsAt > endsAt) {
      toast.error('ช่วงเวลาไม่ถูกต้อง: เวลาเริ่มต้องมาก่อนเวลาสิ้นสุด')
      return
    }

    // ดึงข้อมูลล่าสุดจากฐานข้อมูล — กันกรณีมีการใช้คูปองระหว่างที่เปิดโมดัลอยู่
    const current = editingId != null ? await db.coupons.get(editingId) : undefined
    if (editingId != null && !current) {
      toast.error('ไม่พบคูปองนี้ในระบบ (อาจถูกลบไปแล้ว)')
      setModalOpen(false)
      return
    }
    const usedCount = current?.usedCount ?? 0
    if (usageLimit != null && usageLimit < usedCount) {
      toast.error(`ตั้งจำนวนครั้งต่ำกว่าที่ใช้ไปแล้วไม่ได้ — คูปองนี้ถูกใช้ไปแล้ว ${usedCount} ครั้ง`)
      return
    }

    // เช็คโค้ดซ้ำก่อนบันทึก (ตาราง coupons มี index unique ที่ code)
    const dup = await db.coupons.where('code').equals(code).first()
    if (dup && dup.id !== editingId) {
      toast.error('โค้ดนี้มีอยู่แล้ว')
      return
    }

    const data: Coupon = {
      code,
      name,
      type: form.type,
      value: r2(value),
      usedCount,
      active: form.active,
      createdAt: current?.createdAt ?? Date.now(),
    }
    if (maxDiscount != null) data.maxDiscount = r2(maxDiscount)
    if (minSubtotal != null) data.minSubtotal = r2(minSubtotal)
    if (usageLimit != null) data.usageLimit = usageLimit
    if (startsAt != null) data.startsAt = startsAt
    if (endsAt != null) data.endsAt = endsAt

    try {
      if (editingId != null) await db.coupons.put({ ...data, id: editingId })
      else await db.coupons.add(data)
      toast.success(editingId != null ? 'บันทึกคูปองแล้ว' : `สร้างคูปอง ${code} แล้ว`)
      setModalOpen(false)
    } catch (e) {
      const isDup =
        e instanceof Error && (e.name === 'ConstraintError' || /constraint/i.test(e.message))
      toast.error(isDup ? 'โค้ดนี้มีอยู่แล้ว' : 'บันทึกคูปองไม่สำเร็จ')
    }
  }

  const remove = async (c: Coupon) => {
    if (c.id == null) return
    await db.coupons.delete(c.id)
    toast.success(`ลบคูปอง ${c.code} แล้ว`)
  }

  const setActive = (c: Coupon, active: boolean) => {
    if (c.id == null) return
    void db.coupons.update(c.id, { active })
  }

  /* ----- รายการที่แสดง ----- */
  const all = useMemo(
    () =>
      [...(coupons ?? [])].sort(
        (a, b) => b.createdAt - a.createdAt || (b.id ?? 0) - (a.id ?? 0),
      ),
    [coupons],
  )

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: all.length, usable: 0, closed: 0, used: 0 }
    for (const cp of all) {
      const st = stateOf(cp, now)
      if (st.usable) c.usable++
      if (!cp.active || st.expired) c.closed++
      if (st.exhausted) c.used++
    }
    return c
  }, [all, now])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter((c) => {
      if (q && !c.code.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q)) return false
      return matchStatus(c, stateOf(c, now), status)
    })
  }, [all, search, status, now])

  /* ----- ตัวอย่างเงื่อนไขในโมดัล ----- */
  const previewText = useMemo(() => {
    const v = Number(form.value)
    if (form.value.trim() === '' || !Number.isFinite(v) || v <= 0)
      return 'กรอกมูลค่าส่วนลดเพื่อดูตัวอย่างเงื่อนไข'
    const md = Number(form.maxDiscount)
    const ms = Number(form.minSubtotal)
    const ul = Number(form.usageLimit)
    const p: Coupon = {
      code: form.code,
      name: form.name,
      type: form.type,
      value: v,
      usedCount: editingUsed,
      active: form.active,
      createdAt: 0,
    }
    if (form.type === 'percent' && Number.isFinite(md) && md > 0) p.maxDiscount = md
    if (Number.isFinite(ms) && ms > 0) p.minSubtotal = ms
    if (Number.isFinite(ul) && ul >= 1) p.usageLimit = Math.floor(ul)
    return describeCoupon(p)
  }, [form, editingUsed])

  if (coupons === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="คูปอง"
          subtitle="โค้ดส่วนลดที่ลูกค้ากรอกที่หน้าขาย"
          actions={
            <Button icon="plus" onClick={openAdd}>
              สร้างคูปอง
            </Button>
          }
        />

        {/* ===== แถวค้นหา + กรองสถานะ ===== */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <Input
              className="pl-9"
              placeholder="ค้นหาโค้ด หรือชื่อคูปอง…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap rounded-xl border border-slate-200 bg-white p-1">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatus(t.key)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  status === t.key
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
                <span className={status === t.key ? 'text-emerald-100' : 'text-slate-400'}>
                  {' '}
                  {counts[t.key]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ===== รายการคูปอง ===== */}
        {all.length === 0 ? (
          <Card>
            <EmptyState
              icon="ticket"
              title="ยังไม่มีคูปอง"
              hint="กด “สร้างคูปอง” เพื่อออกโค้ดส่วนลดใบแรกของร้าน"
            />
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon="search"
              title="ไม่พบคูปองตามเงื่อนไข"
              hint="ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ"
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((c) => {
              const meta = TYPE_META[c.type]
              const st = stateOf(c, now)
              const limit = c.usageLimit
              const pct =
                limit != null && limit > 0 ? Math.min(100, (c.usedCount / limit) * 100) : 0
              const barCls =
                pct >= 100 ? 'bg-amber-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'
              return (
                <Card key={c.id} padded={false}>
                  <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                    <div className="min-w-0 flex-1">
                      {/* โค้ด + ป้ายสถานะ */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-lg font-bold tracking-wide text-slate-800">
                          {c.code}
                        </span>
                        <button
                          type="button"
                          title="คัดลอกโค้ด"
                          onClick={() => void copyCode(c.code)}
                          className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        >
                          <Icon
                            name={copied === c.code ? 'check' : 'clipboard'}
                            size={15}
                            className={copied === c.code ? 'text-emerald-600' : ''}
                          />
                        </button>
                        <Badge color={meta.color}>{meta.label}</Badge>
                        {st.exhausted && <Badge color="amber">ใช้ครบแล้ว</Badge>}
                        {st.expired && <Badge color="slate">หมดเขต</Badge>}
                        {st.notStarted && !st.expired && <Badge color="blue">ยังไม่เริ่ม</Badge>}
                        {!c.active && <Badge color="slate">ปิดใช้งาน</Badge>}
                      </div>

                      {/* ชื่อ + เงื่อนไข */}
                      <p className="mt-1 text-sm font-medium text-slate-700">{c.name}</p>
                      <p className="mt-0.5 text-sm text-slate-600">{describeCoupon(c)}</p>

                      {/* แถบความคืบหน้าการใช้ */}
                      <div className="mt-3 max-w-xs">
                        {limit != null && limit > 0 ? (
                          <>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full transition-all ${barCls}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              ใช้แล้ว {c.usedCount.toLocaleString('th-TH')}/
                              {limit.toLocaleString('th-TH')} ครั้ง
                              {!st.exhausted &&
                                ` · เหลือ ${(limit - c.usedCount).toLocaleString('th-TH')} ครั้ง`}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-slate-500">
                            ใช้แล้ว {c.usedCount.toLocaleString('th-TH')} ครั้ง · ไม่จำกัด
                          </p>
                        )}
                      </div>

                      {/* ช่วงเวลา */}
                      <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-400">
                        <Icon name="clock" size={13} />
                        {periodText(c)}
                      </p>
                    </div>

                    {/* ปุ่มจัดการ */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Toggle checked={c.active} onChange={(v) => setActive(c, v)} />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="pencil"
                        title="แก้ไข"
                        onClick={() => openEdit(c)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        title="ลบ"
                        className="text-rose-500 hover:bg-rose-50"
                        onClick={() => setDeleting(c)}
                      />
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {/* ===== หมายเหตุท้ายหน้า ===== */}
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
          <Icon name="ticket" size={14} className="mt-0.5 text-slate-400" />
          <p className="text-xs leading-relaxed text-slate-500">
            คูปองใช้ได้ 1 ใบต่อบิล และคิดส่วนลดหลังโปรโมชันอัตโนมัติ — ยกเลิกบิลแล้วสิทธิ์คูปองจะคืนให้เอง
          </p>
        </div>
      </div>

      {/* ===== โมดัลสร้าง/แก้ไข ===== */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId != null ? 'แก้ไขคูปอง' : 'สร้างคูปอง'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={() => void save()}>บันทึก</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="โค้ดคูปอง *" hint="ลูกค้าจะกรอกโค้ดนี้ที่หน้าขาย (ระบบเก็บเป็นตัวพิมพ์ใหญ่เสมอ)">
            <div className="flex gap-2">
              <Input
                autoFocus
                className="font-mono tracking-wide"
                value={form.code}
                onChange={(e) => set('code', normalizeCode(e.target.value))}
                placeholder="เช่น WELCOME50"
              />
              <Button
                variant="secondary"
                icon="refresh"
                className="shrink-0"
                onClick={genCode}
                title="สุ่มโค้ด 8 ตัวอักษร"
              >
                สุ่มโค้ด
              </Button>
            </div>
          </Field>

          <Field label="ชื่อ / คำอธิบายภายใน *" hint="ใช้ดูในหน้านี้และรายงาน ลูกค้าไม่เห็น">
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="เช่น ส่วนลดต้อนรับลูกค้าใหม่"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="ประเภท">
              <Select
                value={form.type}
                onChange={(e) => set('type', e.target.value as Coupon['type'])}
              >
                <option value="percent">ลดเปอร์เซ็นต์</option>
                <option value="amount">ลดจำนวนเงิน</option>
              </Select>
            </Field>
            {form.type === 'percent' ? (
              <Field label="ส่วนลด (%) *" hint="ระบุ 1 - 100">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={form.value}
                  onChange={(e) => set('value', e.target.value)}
                  placeholder="เช่น 10"
                />
              </Field>
            ) : (
              <Field label="ส่วนลด (บาท) *" hint="หักจากยอดบิลหลังโปรโมชัน">
                <Input
                  type="number"
                  min={0}
                  step="0.25"
                  value={form.value}
                  onChange={(e) => set('value', e.target.value)}
                  placeholder="เช่น 50"
                />
              </Field>
            )}
          </div>

          {form.type === 'percent' && (
            <Field
              label="เพดานส่วนลด (บาท)"
              hint={`ลด ${form.value || 'X'}% แต่ไม่เกินจำนวนนี้ — เว้นว่าง = ไม่จำกัด`}
            >
              <Input
                type="number"
                min={0}
                value={form.maxDiscount}
                onChange={(e) => set('maxDiscount', e.target.value)}
                placeholder="เช่น 100"
              />
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="ยอดบิลขั้นต่ำ (บาท)" hint="ไม่บังคับ — เว้นว่างหากไม่มีขั้นต่ำ">
              <Input
                type="number"
                min={0}
                value={form.minSubtotal}
                onChange={(e) => set('minSubtotal', e.target.value)}
                placeholder="เช่น 300"
              />
            </Field>
            <Field
              label="จำนวนครั้งที่ใช้ได้ทั้งหมด"
              hint={
                editingId != null
                  ? `เว้นว่าง = ไม่จำกัด · ใช้ไปแล้ว ${editingUsed.toLocaleString('th-TH')} ครั้ง`
                  : 'เว้นว่าง = ไม่จำกัด'
              }
            >
              <Input
                type="number"
                min={1}
                step={1}
                value={form.usageLimit}
                onChange={(e) => set('usageLimit', e.target.value)}
                placeholder="เช่น 100"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="เริ่มใช้" hint="ไม่บังคับ">
              <Input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => set('startsAt', e.target.value)}
              />
            </Field>
            <Field label="สิ้นสุด" hint="ไม่บังคับ">
              <Input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => set('endsAt', e.target.value)}
              />
            </Field>
          </div>

          <Toggle
            checked={form.active}
            onChange={(v) => set('active', v)}
            label="เปิดใช้งานคูปองนี้"
          />

          {/* ตัวอย่างที่พนักงานจะเห็นตอนกรอกโค้ด */}
          <div className="rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-100">
            <p className="font-mono text-lg font-bold tracking-wide text-emerald-800">
              {form.code || '— — — —'}
            </p>
            <p className="mt-0.5 text-xs text-emerald-700">{previewText}</p>
          </div>
        </div>
      </Modal>

      {/* ===== ยืนยันการลบ ===== */}
      <ConfirmDialog
        open={deleting != null}
        title="ลบคูปอง"
        message={
          <>
            ต้องการลบคูปอง{' '}
            <span className="font-mono font-semibold tracking-wide">{deleting?.code}</span>{' '}
            <span className="font-semibold">“{deleting?.name}”</span> ใช่ไหม? บิลที่ใช้โค้ดนี้ไปแล้วจะไม่เปลี่ยนแปลง
            แต่ลูกค้าจะใช้โค้ดนี้ต่อไม่ได้
            {deleting != null && deleting.usedCount > 0 && (
              <span className="mt-2 block rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                คูปองนี้ถูกใช้ไปแล้ว {deleting.usedCount.toLocaleString('th-TH')} ครั้ง —
                ถ้ายกเลิกบิลเก่าที่ใช้โค้ดนี้ ระบบจะคืนสิทธิ์ให้ไม่ได้ (แนะนำให้ปิดใช้งานแทนการลบ)
              </span>
            )}
          </>
        }
        confirmLabel="ลบคูปอง"
        danger
        onConfirm={() => {
          if (deleting) void remove(deleting)
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
