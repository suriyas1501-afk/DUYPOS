import { useState } from 'react'
import type { Product } from '../../db/types'
import { useCart } from '../../stores/cartStore'
import { baht, r2 } from '../../lib/format'
import { Button, Field, Modal, Textarea } from '../../components/ui'
import QtyStepper from './QtyStepper'

/** โมดัลเลือกตัวเลือกสินค้า (กลุ่มละ 1 ตัวเลือก) + จำนวน + โน้ต */
export default function OptionModal({
  product,
  onClose,
}: {
  product: Product
  onClose: () => void
}) {
  const groups = product.options ?? []
  const [sel, setSel] = useState<number[]>(() => groups.map(() => 0))
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')

  const priceDelta = r2(
    groups.reduce((s, g, i) => s + (g.choices[sel[i]]?.priceDelta ?? 0), 0),
  )
  const unitPrice = r2(product.price + priceDelta)

  const confirm = () => {
    const labels = groups
      .map((g, i) => g.choices[sel[i]]?.label ?? '')
      .filter((l) => l !== '')
    useCart.getState().addProduct(product, { options: labels, priceDelta, note, qty })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      footer={
        <>
          <div className="mr-auto self-center text-sm text-slate-500">
            ฿{baht(unitPrice)} / หน่วย × {qty}
          </div>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button icon="plus" onClick={confirm}>
            เพิ่มลงตะกร้า ฿{baht(r2(unitPrice * qty))}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {groups.map((g, gi) => (
          <div key={gi}>
            <div className="mb-1.5 text-sm font-semibold text-slate-600">{g.name}</div>
            <div className="flex flex-wrap gap-2">
              {g.choices.map((c, ci) => {
                const active = sel[gi] === ci
                return (
                  <button
                    key={ci}
                    type="button"
                    onClick={() => setSel((s) => s.map((v, i) => (i === gi ? ci : v)))}
                    className={`cursor-pointer rounded-xl border px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {c.label}
                    {c.priceDelta > 0 && (
                      <span className={`ml-1 text-xs ${active ? 'text-emerald-600' : 'text-slate-400'}`}>
                        +฿{baht(c.priceDelta)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-600">จำนวน</span>
          <QtyStepper value={qty} onChange={setQty} />
        </div>

        <Field label="โน้ต (ถ้ามี)">
          <Textarea
            rows={2}
            placeholder="เช่น ไม่ใส่น้ำแข็ง แยกซอส…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
