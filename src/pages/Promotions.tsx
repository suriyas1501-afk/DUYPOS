import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Promotion, PromoScope, PromoType } from '../db/types'
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
import { baht, fmtDate } from '../lib/format'

/* ===== ป้ายประเภทโปรโมชัน ===== */

const TYPE_META: Record<PromoType, { label: string; color: 'green' | 'blue' | 'amber' }> = {
  percent: { label: 'ลด %', color: 'green' },
  amount: { label: 'ลดเงิน', color: 'blue' },
  buyxgety: { label: 'ซื้อ X แถม Y', color: 'amber' },
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

/* ===== สถานะฟอร์ม ===== */

interface PromoForm {
  name: string
  type: PromoType
  scope: PromoScope
  value: string
  buyQty: string
  freeQty: string
  productIds: number[]
  categoryId: string
  minSubtotal: string
  startsAt: string
  endsAt: string
  active: boolean
}

const EMPTY_FORM: PromoForm = {
  name: '',
  type: 'percent',
  scope: 'bill',
  value: '',
  buyQty: '2',
  freeQty: '1',
  productIds: [],
  categoryId: '',
  minSubtotal: '',
  startsAt: '',
  endsAt: '',
  active: true,
}

export default function Promotions() {
  const promos = useLiveQuery(() => db.promotions.toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), [])

  const productName = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of products ?? []) if (p.id != null) m.set(p.id, p.name)
    return m
  }, [products])

  const categoryName = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of categories ?? []) if (c.id != null) m.set(c.id, c.name)
    return m
  }, [categories])

  const activeProducts = useMemo(
    () => (products ?? []).filter((p) => p.active),
    [products],
  )

  /* ----- โมดัลเพิ่ม/แก้ไข ----- */
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<PromoForm>(EMPTY_FORM)
  const [productQuery, setProductQuery] = useState('')
  const [deleting, setDeleting] = useState<Promotion | null>(null)

  const set = <K extends keyof PromoForm>(key: K, value: PromoForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const openAdd = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setProductQuery('')
    setModalOpen(true)
  }

  const openEdit = (p: Promotion) => {
    setEditingId(p.id ?? null)
    setForm({
      name: p.name,
      type: p.type,
      scope: p.scope,
      value: p.type === 'buyxgety' ? '' : String(p.value),
      buyQty: String(p.buyQty ?? 2),
      freeQty: String(p.freeQty ?? 1),
      productIds: [...(p.productIds ?? [])],
      categoryId: p.categoryId != null ? String(p.categoryId) : '',
      minSubtotal: p.minSubtotal != null ? String(p.minSubtotal) : '',
      startsAt: toLocalInput(p.startsAt),
      endsAt: toLocalInput(p.endsAt),
      active: p.active,
    })
    setProductQuery('')
    setModalOpen(true)
  }

  const onTypeChange = (t: PromoType) =>
    setForm((f) => ({ ...f, type: t, scope: t === 'buyxgety' ? 'products' : f.scope }))

  const toggleProduct = (id: number) =>
    setForm((f) => ({
      ...f,
      productIds: f.productIds.includes(id)
        ? f.productIds.filter((x) => x !== id)
        : [...f.productIds, id],
    }))

  /* ----- คำอธิบายเงื่อนไขที่อ่านรู้เรื่อง ----- */
  const describe = (p: Promotion): string => {
    let target = ''
    if (p.scope === 'products') {
      const ids = p.productIds ?? []
      const names = ids.map((id) => productName.get(id) ?? `สินค้า #${id}`)
      target =
        names.length > 3
          ? `${names.slice(0, 3).join(', ')} และอีก ${names.length - 3} รายการ`
          : names.join(', ')
    } else if (p.scope === 'category') {
      target = `หมวด${p.categoryId != null ? (categoryName.get(p.categoryId) ?? 'ไม่ระบุ') : 'ไม่ระบุ'}`
    }

    if (p.type === 'buyxgety') {
      return `${target || 'สินค้าที่เลือก'}: ซื้อ ${p.buyQty ?? 0} แถม ${p.freeQty ?? 0}`
    }

    const cut = p.type === 'percent' ? `ลด ${baht(p.value)}%` : `ลด ${baht(p.value)}.-`
    if (p.scope === 'bill') {
      const min = p.minSubtotal ? ` เมื่อซื้อครบ ${baht(p.minSubtotal)}.-` : ''
      return `${cut} ทั้งบิล${min}`
    }
    const perUnit = p.type === 'amount' ? ' ต่อชิ้น' : ''
    return `${target}: ${cut}${perUnit}`
  }

  const periodText = (p: Promotion): string => {
    if (p.startsAt != null && p.endsAt != null)
      return `${fmtDate(p.startsAt)} – ${fmtDate(p.endsAt)}`
    if (p.startsAt != null) return `เริ่ม ${fmtDate(p.startsAt)}`
    if (p.endsAt != null) return `ถึง ${fmtDate(p.endsAt)}`
    return ''
  }

  /* ----- บันทึก ----- */
  const save = async () => {
    const name = form.name.trim()
    if (!name) {
      toast.error('กรุณากรอกชื่อโปรโมชัน')
      return
    }

    let value = 0
    if (form.type === 'percent') {
      value = Number(form.value)
      if (!Number.isFinite(value) || value < 1 || value > 100) {
        toast.error('ส่วนลดเปอร์เซ็นต์ต้องอยู่ระหว่าง 1 - 100')
        return
      }
    } else if (form.type === 'amount') {
      value = Number(form.value)
      if (!Number.isFinite(value) || value <= 0) {
        toast.error('จำนวนเงินส่วนลดต้องมากกว่า 0')
        return
      }
    }

    let buyQty = 0
    let freeQty = 0
    if (form.type === 'buyxgety') {
      buyQty = Math.floor(Number(form.buyQty))
      freeQty = Math.floor(Number(form.freeQty))
      if (!Number.isFinite(buyQty) || buyQty < 1 || !Number.isFinite(freeQty) || freeQty < 1) {
        toast.error('ซื้อครบแถม: จำนวนที่ซื้อและจำนวนที่แถมต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป')
        return
      }
    }

    if (form.scope === 'products' && form.productIds.length === 0) {
      toast.error('กรุณาเลือกสินค้าที่ร่วมรายการอย่างน้อย 1 รายการ')
      return
    }
    if (form.scope === 'category' && !form.categoryId) {
      toast.error('กรุณาเลือกหมวดหมู่')
      return
    }

    let minSubtotal: number | undefined
    if (form.scope === 'bill' && form.minSubtotal.trim() !== '') {
      minSubtotal = Number(form.minSubtotal)
      if (!Number.isFinite(minSubtotal) || minSubtotal <= 0) {
        toast.error('ยอดซื้อขั้นต่ำต้องเป็นตัวเลขมากกว่า 0')
        return
      }
    }

    const startsAt = fromLocalInput(form.startsAt)
    const endsAt = fromLocalInput(form.endsAt)
    if (startsAt != null && endsAt != null && startsAt > endsAt) {
      toast.error('ช่วงเวลาไม่ถูกต้อง: เวลาเริ่มต้องมาก่อนเวลาสิ้นสุด')
      return
    }

    const data: Promotion = {
      name,
      type: form.type,
      scope: form.scope,
      value,
      active: form.active,
    }
    if (form.type === 'buyxgety') {
      data.buyQty = buyQty
      data.freeQty = freeQty
    }
    if (form.scope === 'products') data.productIds = [...form.productIds]
    if (form.scope === 'category') data.categoryId = Number(form.categoryId)
    if (minSubtotal != null) data.minSubtotal = minSubtotal
    if (startsAt != null) data.startsAt = startsAt
    if (endsAt != null) data.endsAt = endsAt
    if (editingId != null) data.id = editingId

    await db.promotions.put(data)
    toast.success(editingId != null ? 'บันทึกโปรโมชันแล้ว' : 'เพิ่มโปรโมชันแล้ว')
    setModalOpen(false)
  }

  const remove = async (p: Promotion) => {
    if (p.id == null) return
    await db.promotions.delete(p.id)
    toast.success(`ลบโปรโมชัน "${p.name}" แล้ว`)
  }

  const setActive = (p: Promotion, active: boolean) => {
    if (p.id == null) return
    void db.promotions.update(p.id, { active })
  }

  /* ----- รายการสินค้าในกล่องเลือก (กรองตามคำค้น) ----- */
  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase()
    if (!q) return activeProducts
    return activeProducts.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q),
    )
  }, [activeProducts, productQuery])

  const now = Date.now()
  const sorted = useMemo(
    () => [...(promos ?? [])].sort((a, b) => (b.id ?? 0) - (a.id ?? 0)),
    [promos],
  )

  if (promos === undefined) {
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
          title="โปรโมชัน"
          subtitle="ส่วนลดอัตโนมัติที่ระบบใช้ให้ตอนคิดเงิน"
          actions={
            <Button icon="plus" onClick={openAdd}>
              เพิ่มโปรโมชัน
            </Button>
          }
        />

        {sorted.length === 0 ? (
          <Card>
            <EmptyState
              icon="tag"
              title="ยังไม่มีโปรโมชัน"
              hint="กด “เพิ่มโปรโมชัน” เพื่อสร้างส่วนลดอัตโนมัติตัวแรกของร้าน"
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {sorted.map((p) => {
              const meta = TYPE_META[p.type]
              const expired = p.endsAt != null && p.endsAt < now
              const period = periodText(p)
              return (
                <Card key={p.id} padded={false}>
                  <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-800">{p.name}</span>
                        <Badge color={meta.color}>{meta.label}</Badge>
                        {expired && <Badge color="slate">หมดเขต</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{describe(p)}</p>
                      {period && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                          <Icon name="clock" size={13} />
                          {period}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Toggle checked={p.active} onChange={(v) => setActive(p, v)} />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="pencil"
                        title="แก้ไข"
                        onClick={() => openEdit(p)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        title="ลบ"
                        className="text-rose-500 hover:bg-rose-50"
                        onClick={() => setDeleting(p)}
                      />
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* ===== โมดัลเพิ่ม/แก้ไข ===== */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId != null ? 'แก้ไขโปรโมชัน' : 'เพิ่มโปรโมชัน'}
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
          <Field label="ชื่อโปรโมชัน *">
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="เช่น ลด 10% ทั้งบิล / น้ำดื่มซื้อ 2 แถม 1"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="ประเภท">
              <Select
                value={form.type}
                onChange={(e) => onTypeChange(e.target.value as PromoType)}
              >
                <option value="percent">ลดเปอร์เซ็นต์</option>
                <option value="amount">ลดจำนวนเงิน</option>
                <option value="buyxgety">ซื้อครบแถม</option>
              </Select>
            </Field>
            <Field
              label="ขอบเขต"
              hint={form.type === 'buyxgety' ? 'ซื้อครบแถมใช้ได้กับสินค้าที่เลือกเท่านั้น' : undefined}
            >
              <Select
                value={form.scope}
                disabled={form.type === 'buyxgety'}
                onChange={(e) => set('scope', e.target.value as PromoScope)}
              >
                {form.type === 'buyxgety' ? (
                  <option value="products">สินค้าที่เลือก</option>
                ) : (
                  <>
                    <option value="bill">ทั้งบิล</option>
                    <option value="products">สินค้าที่เลือก</option>
                    <option value="category">ทั้งหมวด</option>
                  </>
                )}
              </Select>
            </Field>
          </div>

          {form.type === 'percent' && (
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
          )}

          {form.type === 'amount' && (
            <Field
              label="ส่วนลด (บาท) *"
              hint={
                form.scope === 'bill'
                  ? 'หักจากยอดรวมท้ายบิล'
                  : 'ลดต่อชิ้นของสินค้าที่เข้าเงื่อนไข'
              }
            >
              <Input
                type="number"
                min={0}
                step="0.25"
                value={form.value}
                onChange={(e) => set('value', e.target.value)}
                placeholder="เช่น 5"
              />
            </Field>
          )}

          {form.type === 'buyxgety' && (
            <div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="ซื้อครบ (ชิ้น) *">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={form.buyQty}
                    onChange={(e) => set('buyQty', e.target.value)}
                  />
                </Field>
                <Field label="แถมฟรี (ชิ้น) *">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={form.freeQty}
                    onChange={(e) => set('freeQty', e.target.value)}
                  />
                </Field>
              </div>
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ลูกค้าซื้อครบ {form.buyQty || 'X'} ชิ้น แถมฟรี {form.freeQty || 'Y'} ชิ้น
                (สินค้าเดียวกัน)
              </p>
            </div>
          )}

          {form.scope === 'products' && (
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-600">
                สินค้าที่ร่วมรายการ *
              </span>
              {form.productIds.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {form.productIds.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
                    >
                      {productName.get(id) ?? `สินค้า #${id}`}
                      <button
                        type="button"
                        className="cursor-pointer text-emerald-500 hover:text-emerald-800"
                        onClick={() => toggleProduct(id)}
                        title="เอาออก"
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="ค้นหาสินค้า (ชื่อ / บาร์โค้ด)..."
              />
              <div className="mt-2 max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {filteredProducts.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">
                    {activeProducts.length === 0
                      ? 'ยังไม่มีสินค้าที่เปิดขาย — เพิ่มสินค้าก่อนที่หน้า “สินค้า”'
                      : 'ไม่พบสินค้าที่ค้นหา'}
                  </div>
                ) : (
                  filteredProducts.map((pr) => (
                    <label
                      key={pr.id}
                      className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-emerald-600"
                        checked={pr.id != null && form.productIds.includes(pr.id)}
                        onChange={() => pr.id != null && toggleProduct(pr.id)}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                        {pr.name}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">{baht(pr.price)}.-</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {form.scope === 'category' && (
            <Field label="หมวดหมู่ *">
              <Select
                value={form.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
              >
                <option value="">— เลือกหมวดหมู่ —</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {form.scope === 'bill' && (
            <Field label="ยอดซื้อขั้นต่ำ (บาท)" hint="ไม่บังคับ — เว้นว่างหากไม่มีขั้นต่ำ">
              <Input
                type="number"
                min={0}
                value={form.minSubtotal}
                onChange={(e) => set('minSubtotal', e.target.value)}
                placeholder="เช่น 500"
              />
            </Field>
          )}

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
            label="เปิดใช้งานโปรโมชันนี้"
          />

          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            หมายเหตุ: โปรระดับบิลจะเลือกใช้ตัวที่ลดมากที่สุดเพียงตัวเดียวโดยอัตโนมัติ
            ส่วนโปรระดับสินค้า/หมวดจะใช้ทุกตัวที่เข้าเงื่อนไข
          </p>
        </div>
      </Modal>

      {/* ===== ยืนยันการลบ ===== */}
      <ConfirmDialog
        open={deleting != null}
        title="ลบโปรโมชัน"
        message={
          <>
            ต้องการลบโปรโมชัน <span className="font-semibold">“{deleting?.name}”</span> ใช่ไหม?
            การลบไม่มีผลกับบิลที่ขายไปแล้ว
          </>
        }
        confirmLabel="ลบโปรโมชัน"
        danger
        onConfirm={() => {
          if (deleting) void remove(deleting)
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
