import { useEffect, useState, type ChangeEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Product, ProductOption } from '../../db/types'
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
import { r2 } from '../../lib/format'

/* ---------- ร่างข้อมูลในฟอร์ม (เก็บตัวเลขเป็น string เพื่อให้เว้นว่างได้) ---------- */

interface ChoiceDraft {
  label: string
  priceDelta: string
}

interface OptionDraft {
  name: string
  choices: ChoiceDraft[]
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

  const [form, setForm] = useState<FormState>(emptyForm)
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isEdit = product?.id != null

  useEffect(() => {
    if (!open) return
    setForm(product ? toForm(product) : emptyForm())
    setShowNewCat(false)
    setNewCatName('')
    setConfirmDelete(false)
  }, [open, product])

  /* ----- หมวดหมู่ใหม่แบบกรอกในฟอร์มได้เลย ----- */
  const addNewCategory = async () => {
    const name = newCatName.trim()
    if (!name) {
      toast.error('กรุณากรอกชื่อหมวดหมู่')
      return
    }
    const maxOrder = (categories ?? []).reduce((m, c) => Math.max(m, c.sortOrder), 0)
    const id = await db.categories.add({ name, sortOrder: maxOrder + 1 })
    setForm((f) => ({ ...f, categoryId: String(id) }))
    setNewCatName('')
    setShowNewCat(false)
    toast.success(`เพิ่มหมวดหมู่ “${name}” แล้ว`)
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

  /* ----- บันทึก ----- */
  const save = async () => {
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
    const initStock = Number(form.stock) || 0
    if (!isEdit && form.trackStock && initStock < 0) {
      toast.error('สต็อกเริ่มต้นต้องไม่ติดลบ')
      return
    }
    const lowRaw = Number(form.lowStockAt)
    const lowStockAt =
      form.trackStock && form.lowStockAt.trim() !== '' && !Number.isNaN(lowRaw) && lowRaw >= 0
        ? lowRaw
        : undefined
    const options = cleanOptions(form.options)

    const data: Product = {
      name,
      barcode: form.barcode.trim() || undefined,
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
    }

    if (isEdit && product?.id != null) {
      // อัปเดตเฉพาะฟิลด์จากฟอร์ม ไม่ส่ง stock (ปรับผ่านโมดัลปรับสต็อกเท่านั้น)
      // กันเขียนทับสต็อกที่ถูกตัดจากการขายระหว่างเปิดโมดัลอยู่
      const { stock: _stock, ...fields } = data
      await db.products.update(product.id, fields)
      toast.success('บันทึกสินค้าแล้ว')
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
      toast.success('เพิ่มสินค้าแล้ว')
    }
    onClose()
  }

  /* ----- ลบสินค้า ----- */
  const remove = async () => {
    if (product?.id == null) return
    await db.products.delete(product.id)
    toast.success(`ลบสินค้า “${product.name}” แล้ว`)
    onClose()
  }

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
            <Button variant="secondary" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button onClick={save}>{isEdit ? 'บันทึก' : 'เพิ่มสินค้า'}</Button>
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
                      if (e.key === 'Enter') void addNewCategory()
                    }}
                  />
                  <Button variant="secondary" onClick={addNewCategory}>
                    เพิ่ม
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
                  <Field label="สต็อกเริ่มต้น">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="0"
                      value={form.stock}
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
