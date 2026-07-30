import { useState } from 'react'
import { useCart, type CartItem } from '../../stores/cartStore'
import { baht, r2 } from '../../lib/format'
import { Button, Field, Input, Modal, Textarea } from '../../components/ui'
import QtyStepper from './QtyStepper'

/** โมดัลแก้ไขรายการในตะกร้า: จำนวน / ส่วนลดบรรทัด / โน้ต / ลบ */
export default function EditItemModal({
  item,
  onClose,
}: {
  item: CartItem
  onClose: () => void
}) {
  const [qty, setQty] = useState(item.qty)
  const [discount, setDiscount] = useState(String(item.manualDiscount || ''))
  const [note, setNote] = useState(item.note ?? '')

  const lineSubtotal = r2(item.price * qty)
  const d = Number(discount) || 0

  const save = () => {
    useCart.getState().updateItem(item.key, {
      qty: Math.max(1, Math.floor(qty)),
      manualDiscount: Math.max(0, d),
      note: note.trim() || undefined,
    })
    onClose()
  }

  const remove = () => {
    useCart.getState().removeItem(item.key)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={item.name}
      size="sm"
      footer={
        <>
          <Button variant="danger" icon="trash" className="mr-auto" onClick={remove}>
            ลบรายการ
          </Button>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button icon="check" onClick={save}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {(item.options?.length ?? 0) > 0 && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            ตัวเลือก: {(item.options ?? []).join(', ')}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-600">จำนวน</div>
            <div className="text-xs text-slate-400">฿{baht(item.price)} / หน่วย</div>
          </div>
          <QtyStepper value={qty} onChange={setQty} />
        </div>

        <Field
          label="ส่วนลดบรรทัด (บาท)"
          hint={`ยอดบรรทัดนี้ ${baht(lineSubtotal)} บาท — หลังหักส่วนลดเหลือ ${baht(Math.max(0, r2(lineSubtotal - d)))} บาท`}
        >
          <Input
            type="number"
            min={0}
            step="any"
            placeholder="0"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>

        <Field label="โน้ต">
          <Textarea
            rows={2}
            placeholder="เช่น ไม่ใส่ผัก เผ็ดน้อย…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
