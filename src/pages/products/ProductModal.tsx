import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Product, ProductOption, ProductUnit } from '../../db/types'
import {
  Button,
  ConfirmDialog,
  Field,
  Icon,
  Input,
  Modal,
  Select,
  Toggle,
  toast,
} from '../../components/ui'
import { resizeImage } from '../../lib/image'
import { usePermissions } from '../../db/hooks'
import { baht, r2 } from '../../lib/format'

/* ---------- ร่างข้อมูลในฟอร์ม (เก็บตัวเลขเป็น string เพื่อให้เว้นว่างได้) ---------- */

interface ChoiceDraft {
  label: string
  priceDelta: string
}

interface OptionDraft {
  name: string
  choices: ChoiceDraft[]
}

/** ร่างหน่วยขายเพิ่มเติม (แพ็ค/ลัง) */
interface UnitDraft {
  name: string
  barcode: string
  factor: string
  price: string
}

interface FormState {
  name: string
  barcode: string
  categoryId: string // '' = ไม่ระบุ
  price: string
  cost: string
  unit: string
  trackStock: boolean
  stock: string
  lowStockAt: string
  image?: string
  options: OptionDraft[]
  active: boolean
  allowDecimalQty: boolean
  wholesalePrice: string
  wholesaleMinQty: string
  units: UnitDraft[]
}

const emptyForm = (): FormState => ({
  name: '',
  barcode: '',
  categoryId: '',
  price: '',
  cost: '',
  unit: 'ชิ้น',
  trackStock: false,
  stock: '0',
  lowStockAt: '5',
  image: undefined,
  options: [],
  active: true,
  allowDecimalQty: false,
  wholesalePrice: '',
  wholesaleMinQty: '',
  units: [],
})

const toForm = (p: Product): FormState => ({
  name: p.name,
  barcode: p.barcode ?? '',
  categoryId: p.categoryId != null ? String(p.categoryId) : '',
  price: String(p.price),
  cost: String(p.cost),
  unit: p.unit,
  trackStock: p.trackStock,
  stock: String(p.stock),
  lowStockAt: p.lowStockAt != null ? String(p.lowStockAt) : '',
  image: p.image,
  options: (p.options ?? []).map((g) => ({
    name: g.name,
    choices: g.choices.map((c) => ({ label: c.label, priceDelta: String(c.priceDelta) })),
  })),
  active: p.active,
  allowDecimalQty: p.allowDecimalQty ?? false,
  wholesalePrice: p.wholesalePrice != null ? String(p.wholesalePrice) : '',
  wholesaleMinQty: p.wholesaleMinQty != null ? String(p.wholesaleMinQty) : '',
  units: (p.units ?? []).map((u) => ({
    name: u.name,
    barcode: u.barcode ?? '',
    factor: String(u.factor),
    price: String(u.price),
  })),
})

/** แปลงร่างกลุ่มตัวเลือกเป็นข้อมูลจริง (ตัดกลุ่ม/ตัวเลือกที่ว่างทิ้ง) */
const cleanOptions = (drafts: OptionDraft[]): ProductOption[] =>
  drafts
    .map((g) => ({
      name: g.name.trim(),
      choices: g.choices
        .filter((c) => c.label.trim() !== '')
        .map((c) => ({ label: c.label.trim(), priceDelta: r2(Number(c.priceDelta) || 0) })),
    }))
    .filter((g) => g.name !== '' && g.choices.length > 0)

/** แถวหน่วยที่ผู้ใช้เริ่มกรอกแล้ว (แถวว่างล้วนถือว่าไม่ได้ใช้) */
const usedUnitRows = (drafts: UnitDraft[]) =>
  drafts.filter(
    (u) =>
      u.name.trim() !== '' ||
      u.barcode.trim() !== '' ||
      u.factor.trim() !== '' ||
      u.price.trim() !== '',
  )

/* ---------- โมดัลเพิ่ม/แก้ไขสินค้า ---------- */

export default function ProductModal({
  open,
  product,
  onClose,
}: {
  open: boolean
  product: Product | null // null = เพิ่มใหม่
  onClose: () => void
}) {
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), [])
  // ใช้ตรวจบาร์โค้ดซ้ำกับสินค้าอื่น (รวมบาร์โค้ดของหน่วยเพิ่มเติม)
  const allProducts = useLiveQuery(() => db.products.toArray(), [])

  const [form, setForm] = useState<FormState>(emptyForm)
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [catBusy, setCatBusy] = useState(false)
  /** กันกดปุ่มซ้ำ (ดับเบิลคลิกบนจอสัมผัส) — state ยังไม่ทันอัปเดตในเฟรมเดียวกัน */
  const savingRef = useRef(false)
  const catBusyRef = useRef(false)

  const isEdit = product?.id != null
  /** สิทธิ์แตะสต็อก — ใช้กับช่อง "สต็อกเริ่มต้น" ตอนสร้างสินค้าใหม่ (ดูเหตุผลในฟังก์ชัน save) */
  const canStock = usePermissions().can('stock')

  useEffect(() => {
    if (!open) return
    setForm(product ? toForm(product) : emptyForm())
    setShowNewCat(false)
    setNewCatName('')
    setConfirmDelete(false)
    setSaving(false)
    setCatBusy(false)
    savingRef.current = false
    catBusyRef.current = false
  }, [open, product])

  /* ----- หมวดหมู่ใหม่แบบกรอกในฟอร์มได้เลย ----- */
  const addNewCategory = async () => {
    if (catBusyRef.current) return
    const name = newCatName.trim()
    if (!name) {
      toast.error('กรุณากรอกชื่อหมวดหมู่')
      return
    }
    catBusyRef.current = true
    setCatBusy(true)
    try {
      // ตรวจชื่อซ้ำจากข้อมูลสดในทรานแซกชันเดียวกับการเพิ่ม (กันกดซ้ำได้หมวดชื่อเดียวกัน 2 หมวด)
      const id = await db.transaction('rw', db.categories, async () => {
        const rows = await db.categories.toArray()
        const same = rows.find((c) => c.name.trim().toLowerCase() === name.toLowerCase())
        if (same?.id != null) return same.id
        const maxOrder = rows.reduce((m, c) => Math.max(m, c.sortOrder), 0)
        return db.categories.add({ name, sortOrder: maxOrder + 1 })
      })
      setForm((f) => ({ ...f, categoryId: String(id) }))
      setNewCatName('')
      setShowNewCat(false)
      toast.success(`เพิ่มหมวดหมู่ “${name}” แล้ว`)
    } catch {
      toast.error('เพิ่มหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      catBusyRef.current = false
      setCatBusy(false)
    }
  }

  /* ----- รูปสินค้า ----- */
  const onPickImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const dataUrl = await resizeImage(file)
      setForm((f) => ({ ...f, image: dataUrl }))
    } catch {
      toast.error('อ่านไฟล์รูปไม่สำเร็จ')
    }
  }

  /* ----- ตัวแก้ไขกลุ่มตัวเลือก ----- */
  const addGroup = () =>
    setForm((f) => ({
      ...f,
      options: [...f.options, { name: '', choices: [{ label: '', priceDelta: '' }] }],
    }))

  const removeGroup = (gi: number) =>
    setForm((f) => ({ ...f, options: f.options.filter((_, i) => i !== gi) }))

  const setGroupName = (gi: number, name: string) =>
    setForm((f) => ({
      ...f,
      options: f.options.map((g, i) => (i === gi ? { ...g, name } : g)),
    }))

  const addChoice = (gi: number) =>
    setForm((f) => ({
      ...f,
      options: f.options.map((g, i) =>
        i === gi ? { ...g, choices: [...g.choices, { label: '', priceDelta: '' }] } : g,
      ),
    }))

  const removeChoice = (gi: number, ci: number) =>
    setForm((f) => ({
      ...f,
      options: f.options.map((g, i) =>
        i === gi ? { ...g, choices: g.choices.filter((_, j) => j !== ci) } : g,
      ),
    }))

  const setChoice = (gi: number, ci: number, patch: Partial<ChoiceDraft>) =>
    setForm((f) => ({
      ...f,
      options: f.options.map((g, i) =>
        i === gi
          ? { ...g, choices: g.choices.map((c, j) => (j === ci ? { ...c, ...patch } : c)) }
          : g,
      ),
    }))

  /* ----- ตัวแก้ไขหน่วยขายเพิ่มเติม ----- */
  const addUnit = () =>
    setForm((f) => ({
      ...f,
      units: [...f.units, { name: '', barcode: '', factor: '', price: '' }],
    }))

  const removeUnit = (ui: number) =>
    setForm((f) => ({ ...f, units: f.units.filter((_, i) => i !== ui) }))

  const setUnit = (ui: number, patch: Partial<UnitDraft>) =>
    setForm((f) => ({
      ...f,
      units: f.units.map((u, i) => (i === ui ? { ...u, ...patch } : u)),
    }))

  /* ----- บันทึก ----- */
  const save = async () => {
    if (savingRef.current) return
    const name = form.name.trim()
    if (!name) {
      toast.error('กรุณากรอกชื่อสินค้า')
      return
    }
    const price = Number(form.price)
    if (form.price.trim() === '' || Number.isNaN(price) || price < 0) {
      toast.error('ราคาขายต้องเป็นตัวเลขและไม่ติดลบ')
      return
    }
    const cost = Number(form.cost) || 0
    if (cost < 0) {
      toast.error('ต้นทุนต้องไม่ติดลบ')
      return
    }
    /* สต็อกเริ่มต้นตอนสร้างสินค้าใหม่ = การนำของเข้าสต็อกจริง (เขียน stockMoves ด้วย)
       จึงต้องมีสิทธิ์ 'stock' เหมือนหน้ารับของเข้า/ปรับสต็อก ไม่ใช่แค่สิทธิ์ 'products'
       ไม่งั้นพนักงานที่แก้ได้แค่ชื่อ/ราคา จะเสกสต็อกได้ด้วยการ "สร้างสินค้าใหม่พร้อมสต็อก 999" */
    const initStock = Number(form.stock) || 0
    if (!isEdit && form.trackStock && initStock < 0) {
      toast.error('สต็อกเริ่มต้นต้องไม่ติดลบ')
      return
    }
    if (!isEdit && form.trackStock && initStock > 0 && !canStock) {
      toast.error('ไม่มีสิทธิ์ตั้งสต็อกเริ่มต้น — ต้องมีสิทธิ์ "รับของเข้า / ปรับสต็อก / นับสต็อก"')
      return
    }
    const lowRaw = Number(form.lowStockAt)
    const lowStockAt =
      form.trackStock && form.lowStockAt.trim() !== '' && !Number.isNaN(lowRaw) && lowRaw >= 0
        ? lowRaw
        : undefined
    const options = cleanOptions(form.options)

    /* ----- ราคาขายส่ง: กรอกอย่างใดอย่างหนึ่ง = ต้องกรอกทั้งคู่ ----- */
    const wpRaw = form.wholesalePrice.trim()
    const wqRaw = form.wholesaleMinQty.trim()
    let wholesalePrice: number | undefined
    let wholesaleMinQty: number | undefined
    if (wpRaw !== '' || wqRaw !== '') {
      if (wpRaw === '' || wqRaw === '') {
        toast.error('ราคาขายส่ง: ต้องกรอกทั้งราคาและจำนวนขั้นต่ำ (หรือเว้นว่างทั้งคู่)')
        return
      }
      const wp = Number(wpRaw)
      const wq = Number(wqRaw)
      if (!Number.isFinite(wp) || wp <= 0) {
        toast.error('ราคาขายส่งต้องเป็นตัวเลขมากกว่า 0')
        return
      }
      if (!Number.isFinite(wq) || wq <= 0) {
        toast.error('จำนวนขั้นต่ำของราคาขายส่งต้องมากกว่า 0')
        return
      }
      wholesalePrice = r2(wp)
      wholesaleMinQty = r2(wq)
    }

    /* ----- หน่วยขายเพิ่มเติม ----- */
    const unitRows = usedUnitRows(form.units)
    const units: ProductUnit[] = []
    for (let i = 0; i < unitRows.length; i++) {
      const u = unitRows[i]
      const label = `หน่วยเพิ่มเติมแถวที่ ${i + 1}`
      const uname = u.name.trim()
      if (!uname) {
        toast.error(`${label}: กรุณากรอกชื่อหน่วย`)
        return
      }
      const factor = Number(u.factor)
      if (!Number.isInteger(factor) || factor < 2) {
        toast.error(`${label}: จำนวนต่อหน่วยต้องเป็นจำนวนเต็มตั้งแต่ 2 ขึ้นไป`)
        return
      }
      const uprice = Number(u.price)
      if (!Number.isFinite(uprice) || uprice <= 0) {
        toast.error(`${label}: ราคาต้องเป็นตัวเลขมากกว่า 0`)
        return
      }
      units.push({
        name: uname,
        barcode: u.barcode.trim() || undefined,
        factor,
        price: r2(uprice),
      })
    }
    if (units.some((u) => u.name === form.unit.trim())) {
      toast.error('ชื่อหน่วยเพิ่มเติมต้องไม่ซ้ำกับหน่วยฐาน')
      return
    }
    const unitNames = units.map((u) => u.name)
    const dupUnitName = unitNames.find((n, i) => unitNames.indexOf(n) !== i)
    if (dupUnitName) {
      toast.error(`ชื่อหน่วย “${dupUnitName}” ซ้ำกัน`)
      return
    }

    /* ----- บาร์โค้ดต้องไม่ซ้ำ (ทั้งในสินค้านี้เองและกับสินค้าอื่น) ----- */
    const mainBarcode = form.barcode.trim()
    const codes = [mainBarcode, ...units.map((u) => u.barcode ?? '')].filter((c) => c !== '')
    const dupCode = codes.find((c, i) => codes.indexOf(c) !== i)
    if (dupCode) {
      toast.error(`บาร์โค้ด ${dupCode} ซ้ำกันเองในสินค้านี้`)
      return
    }
    const others = (allProducts ?? []).filter((p) => p.id !== product?.id)
    for (const c of codes) {
      const clash = others.find(
        (p) => (p.barcode ?? '').trim() === c || (p.units ?? []).some((u) => (u.barcode ?? '').trim() === c),
      )
      if (clash) {
        toast.error(`บาร์โค้ด ${c} ถูกใช้กับสินค้า “${clash.name}” อยู่แล้ว`)
        return
      }
    }

    const data: Product = {
      name,
      barcode: mainBarcode || undefined,
      categoryId: form.categoryId !== '' ? Number(form.categoryId) : undefined,
      price: r2(price),
      cost: r2(cost),
      unit: form.unit.trim() || 'ชิ้น',
      trackStock: form.trackStock,
      // เพิ่มใหม่: ใช้สต็อกเริ่มต้น / แก้ไข: ไม่เขียน field นี้ (ดูตอนบันทึกด้านล่าง)
      stock: !isEdit && form.trackStock ? r2(initStock) : 0,
      lowStockAt,
      options: options.length > 0 ? options : undefined,
      image: form.image,
      active: form.active,
      createdAt: product?.createdAt ?? Date.now(),
      allowDecimalQty: form.allowDecimalQty,
      units: units.length > 0 ? units : undefined,
      wholesalePrice,
      wholesaleMinQty,
    }

    savingRef.current = true
    setSaving(true)
    try {
      // ตรวจบาร์โค้ดซ้ำอีกครั้งจากข้อมูลสดในทรานแซกชันเดียวกับการเขียน —
      // allProducts มาจาก useLiveQuery ซึ่งยังไม่เห็นแถวที่เพิ่งเพิ่ม (กดซ้ำเร็วๆ จะได้สินค้าซ้ำ)
      const clashName = await db.transaction('rw', db.products, db.stockMoves, async () => {
        const fresh = await db.products.toArray()
        for (const c of codes) {
          const clash = fresh.find(
            (p) =>
              p.id !== product?.id &&
              ((p.barcode ?? '').trim() === c ||
                (p.units ?? []).some((u) => (u.barcode ?? '').trim() === c)),
          )
          if (clash) return `บาร์โค้ด ${c} ถูกใช้กับสินค้า “${clash.name}” อยู่แล้ว`
        }
        if (isEdit && product?.id != null) {
          // อัปเดตเฉพาะฟิลด์จากฟอร์ม ไม่ส่ง stock (ปรับผ่านโมดัลปรับสต็อกเท่านั้น)
          // กันเขียนทับสต็อกที่ถูกตัดจากการขายระหว่างเปิดโมดัลอยู่
          const { stock: _stock, ...fields } = data
          await db.products.update(product.id, fields)
        } else {
          const id = await db.products.add(data)
          if (data.trackStock && data.stock > 0) {
            await db.stockMoves.add({
              productId: id,
              type: 'receive',
              qty: data.stock,
              note: 'สต็อกเริ่มต้น',
              createdAt: Date.now(),
            })
          }
        }
        return ''
      })
      if (clashName) {
        toast.error(clashName)
        return
      }
      toast.success(isEdit ? 'บันทึกสินค้าแล้ว' : 'เพิ่มสินค้าแล้ว')
      onClose()
    } catch {
      toast.error('บันทึกสินค้าไม่สำเร็จ ข้อมูลไม่ถูกแก้ไข กรุณาลองใหม่')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  /* ----- ลบสินค้า ----- */
  const remove = async () => {
    if (product?.id == null) return
    await db.products.delete(product.id)
    toast.success(`ลบสินค้า “${product.name}” แล้ว`)
    onClose()
  }

  const baseUnitLabel = form.unit.trim() || 'ชิ้น'
  const retailPrice = Number(form.price)
  const wholesaleNum = Number(form.wholesalePrice)
  const wholesaleTooHigh =
    form.wholesalePrice.trim() !== '' &&
    Number.isFinite(wholesaleNum) &&
    Number.isFinite(retailPrice) &&
    form.price.trim() !== '' &&
    wholesaleNum > retailPrice

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEdit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}
        size="lg"
        footer={
          <>
            {isEdit && (
              <Button
                variant="danger"
                icon="trash"
                className="mr-auto"
                onClick={() => setConfirmDelete(true)}
              >
                ลบสินค้า
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              ยกเลิก
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? 'กำลังบันทึก…' : isEdit ? 'บันทึก' : 'เพิ่มสินค้า'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="ชื่อสินค้า *">
            <Input
              autoFocus
              placeholder="เช่น ลาเต้เย็น"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">หมวดหมู่</span>
                <button
                  type="button"
                  className="cursor-pointer text-xs font-medium text-emerald-600 hover:underline"
                  onClick={() => setShowNewCat((s) => !s)}
                >
                  + หมวดใหม่
                </button>
              </div>
              <Select
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">— ไม่ระบุ —</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {showNewCat && (
                <div className="mt-2 flex gap-2">
                  <Input
                    autoFocus
                    placeholder="ชื่อหมวดหมู่ใหม่"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.repeat) void addNewCategory()
                    }}
                  />
                  <Button variant="secondary" disabled={catBusy} onClick={() => void addNewCategory()}>
                    {catBusy ? '…' : 'เพิ่ม'}
                  </Button>
                </div>
              )}
            </div>
            <Field label="บาร์โค้ด">
              <Input
                placeholder="สแกนหรือพิมพ์บาร์โค้ด"
                value={form.barcode}
                onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="ราคาขาย (บาท) *">
              <Input
                type="number"
                min={0}
                step="any"
                placeholder="0"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </Field>
            <Field label="ต้นทุน (บาท)">
              <Input
                type="number"
                min={0}
                step="any"
                placeholder="0"
                value={form.cost}
                onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
              />
            </Field>
            <Field label="หน่วย">
              <Input
                placeholder="ชิ้น"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              />
            </Field>
          </div>

          {/* ----- ขายเป็นทศนิยม (สินค้าชั่งน้ำหนัก) ----- */}
          <div className="rounded-xl border border-slate-200 p-4">
            <Toggle
              checked={form.allowDecimalQty}
              onChange={(v) => setForm((f) => ({ ...f, allowDecimalQty: v }))}
              label="ขายเป็นทศนิยม (ชั่งน้ำหนัก)"
            />
            <p className="mt-1.5 text-xs text-slate-400">เช่น ผัก ผลไม้ ขาย 0.5 กก.</p>
          </div>

          {/* ----- ราคาขายส่ง ----- */}
          <div className="rounded-xl border border-slate-200 p-4">
            <span className="mb-1 block text-sm font-medium text-slate-600">ราคาขายส่ง</span>
            <p className="mb-3 text-xs text-slate-400">
              ซื้อครบกี่หน่วยขึ้นไปได้ราคานี้ — เว้นว่าง = ไม่ใช้
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ราคาขายส่ง (บาท)">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="เช่น 6"
                  value={form.wholesalePrice}
                  onChange={(e) => setForm((f) => ({ ...f, wholesalePrice: e.target.value }))}
                />
              </Field>
              <Field label={`ซื้อขั้นต่ำ (${baseUnitLabel})`}>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="เช่น 12"
                  value={form.wholesaleMinQty}
                  onChange={(e) => setForm((f) => ({ ...f, wholesaleMinQty: e.target.value }))}
                />
              </Field>
            </div>
            {wholesaleTooHigh && (
              <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-600">
                <Icon name="alert" size={14} className="mt-px" />
                ราคาขายส่ง ({baht(wholesaleNum)}) สูงกว่าราคาปลีก ({baht(retailPrice)}) — ตรวจสอบอีกครั้ง
              </p>
            )}
            {form.wholesalePrice.trim() !== '' &&
              form.wholesaleMinQty.trim() !== '' &&
              !wholesaleTooHigh && (
                <p className="mt-2 text-xs text-slate-500">
                  ซื้อครบ {form.wholesaleMinQty} {baseUnitLabel} ขึ้นไป ใช้ราคา{' '}
                  {baht(wholesaleNum || 0)} บาท/{baseUnitLabel} อัตโนมัติ
                </p>
              )}
          </div>

          {/* ----- หน่วยขายเพิ่มเติม (แพ็ค/ลัง) ----- */}
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">
                หน่วยขายเพิ่มเติม (แพ็ค/ลัง)
              </span>
              <Button variant="secondary" size="sm" icon="plus" onClick={addUnit}>
                เพิ่มหน่วย
              </Button>
            </div>
            <p className="mb-3 text-xs text-slate-400">
              ตั้งราคาขายยกแพ็ค/ยกลังได้ เช่น 1 แพ็ค = 6 {baseUnitLabel} จะตัดสต็อก 6{' '}
              {baseUnitLabel} (ยิงบาร์โค้ดของแพ็คที่หน้าขายได้เลย)
            </p>
            {form.units.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
                ยังไม่มีหน่วยเพิ่มเติม — ขายเป็น {baseUnitLabel} เท่านั้น
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="pb-1.5 font-medium">ชื่อหน่วย *</th>
                      <th className="pb-1.5 font-medium">บาร์โค้ด</th>
                      <th className="w-28 pb-1.5 font-medium">จำนวนต่อหน่วย *</th>
                      <th className="w-28 pb-1.5 font-medium">ราคา *</th>
                      <th className="w-9 pb-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.units.map((u, ui) => (
                      <tr key={ui}>
                        <td className="py-1 pr-2">
                          <Input
                            placeholder="เช่น แพ็ค 6 ขวด"
                            value={u.name}
                            onChange={(e) => setUnit(ui, { name: e.target.value })}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <Input
                            placeholder="ไม่บังคับ"
                            value={u.barcode}
                            onChange={(e) => setUnit(ui, { barcode: e.target.value })}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <Input
                            type="number"
                            min={2}
                            step={1}
                            placeholder="6"
                            title={`1 หน่วยนี้ = กี่ ${baseUnitLabel}`}
                            value={u.factor}
                            onChange={(e) => setUnit(ui, { factor: e.target.value })}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            placeholder="0"
                            value={u.price}
                            onChange={(e) => setUnit(ui, { price: e.target.value })}
                          />
                        </td>
                        <td className="py-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="trash"
                            title="ลบหน่วยนี้"
                            className="text-rose-500 hover:bg-rose-50"
                            onClick={() => removeUnit(ui)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ----- สต็อก ----- */}
          <div className="rounded-xl border border-slate-200 p-4">
            <Toggle
              checked={form.trackStock}
              onChange={(v) => setForm((f) => ({ ...f, trackStock: v }))}
              label="นับสต็อกสินค้านี้"
            />
            {form.trackStock && (
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {isEdit ? (
                  <Field label="สต็อกปัจจุบัน" hint="ปรับได้จากปุ่ม “ปรับสต็อก” ในตารางสินค้า">
                    <Input value={`${product?.stock ?? 0}`} disabled />
                  </Field>
                ) : (
                  <Field
                    label="สต็อกเริ่มต้น"
                    hint={
                      canStock
                        ? undefined
                        : 'ต้องมีสิทธิ์ “รับของเข้า / ปรับสต็อก / นับสต็อก” — สร้างสินค้าไว้ก่อนได้ แล้วให้ผู้มีสิทธิ์รับของเข้า'
                    }
                  >
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="0"
                      disabled={!canStock}
                      value={canStock ? form.stock : ''}
                      onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                    />
                  </Field>
                )}
                <Field label="จุดแจ้งเตือนใกล้หมด" hint="แสดงป้าย “ใกล้หมด” เมื่อสต็อกเหลือเท่านี้">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="เช่น 5"
                    value={form.lowStockAt}
                    onChange={(e) => setForm((f) => ({ ...f, lowStockAt: e.target.value }))}
                  />
                </Field>
              </div>
            )}
          </div>

          {/* ----- รูปสินค้า ----- */}
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-600">รูปสินค้า</span>
            <div className="flex items-center gap-3">
              {form.image ? (
                <div className="relative">
                  <img
                    src={form.image}
                    alt="รูปสินค้า"
                    className="h-20 w-20 rounded-xl border border-slate-200 object-cover"
                  />
                  <button
                    type="button"
                    title="ลบรูป"
                    className="absolute -top-2 -right-2 cursor-pointer rounded-full bg-rose-600 p-1 text-white shadow hover:bg-rose-700"
                    onClick={() => setForm((f) => ({ ...f, image: undefined }))}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ) : (
                <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-emerald-400 hover:text-emerald-500">
                  <Icon name="upload" size={20} />
                  <span className="text-[11px]">อัปโหลด</span>
                  <input type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                </label>
              )}
              <p className="text-xs text-slate-400">
                รูปจะถูกย่อเป็นสี่เหลี่ยมจัตุรัสอัตโนมัติ
                <br />
                เพื่อประหยัดพื้นที่จัดเก็บในเครื่อง
              </p>
            </div>
          </div>

          {/* ----- กลุ่มตัวเลือก ----- */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">กลุ่มตัวเลือกสินค้า</span>
              <Button variant="secondary" size="sm" icon="plus" onClick={addGroup}>
                เพิ่มกลุ่ม
              </Button>
            </div>
            <p className="mb-2 text-xs text-slate-400">
              สำหรับร้านกาแฟ เช่น ความหวาน / เพิ่มช็อต (ลูกค้าเลือกได้ 1 ตัวเลือกต่อกลุ่ม)
            </p>
            {form.options.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
                ยังไม่มีกลุ่มตัวเลือก
              </div>
            ) : (
              <div className="space-y-3">
                {form.options.map((g, gi) => (
                  <div key={gi} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Input
                        placeholder="ชื่อกลุ่ม เช่น ความหวาน"
                        value={g.name}
                        onChange={(e) => setGroupName(gi, e.target.value)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        title="ลบกลุ่มนี้"
                        onClick={() => removeGroup(gi)}
                      />
                    </div>
                    <div className="space-y-2">
                      {g.choices.map((c, ci) => (
                        <div key={ci} className="flex items-center gap-2">
                          <div className="flex-1">
                            <Input
                              placeholder="ตัวเลือก เช่น หวานน้อย"
                              value={c.label}
                              onChange={(e) => setChoice(gi, ci, { label: e.target.value })}
                            />
                          </div>
                          <div className="w-28">
                            <Input
                              type="number"
                              step="any"
                              placeholder="+บาท"
                              title="ราคาบวกเพิ่ม (บาท)"
                              value={c.priceDelta}
                              onChange={(e) => setChoice(gi, ci, { priceDelta: e.target.value })}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="x"
                            title="ลบตัวเลือกนี้"
                            onClick={() => removeChoice(gi, ci)}
                          />
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="plus"
                      className="mt-2 text-emerald-600"
                      onClick={() => addChoice(gi)}
                    >
                      เพิ่มตัวเลือก
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ----- สถานะขาย ----- */}
          <div className="rounded-xl border border-slate-200 p-4">
            <Toggle
              checked={form.active}
              onChange={(v) => setForm((f) => ({ ...f, active: v }))}
              label="เปิดขายสินค้านี้"
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="ลบสินค้า"
        message={
          <>
            ต้องการลบ <b>“{product?.name}”</b> ออกจากระบบถาวรใช่ไหม?
            <br />
            บิลขายเก่าจะยังแสดงชื่อสินค้านี้ตามเดิม
          </>
        }
        confirmLabel="ลบสินค้า"
        danger
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}
