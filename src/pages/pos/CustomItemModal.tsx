import { useEffect, useState } from 'react'
import { useCart } from '../../stores/cartStore'
import { Button, Field, Input, Modal, toast } from '../../components/ui'
import QtyStepper from './QtyStepper'

/** โมดัลเพิ่มรายการกำหนดเอง (ชื่อ + ราคา + จำนวน) */
export default function CustomItemModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState(1)

  useEffect(() => {
    if (open) {
      setName('')
      setPrice('')
      setQty(1)
    }
  }, [open])

  const p = Number(price)
  const valid = name.trim() !== '' && Number.isFinite(p) && p >= 0

  const confirm = () => {
    if (!valid) return
    useCart.getState().addCustomItem(name, p, qty)
    toast.success('เพิ่มรายการกำหนดเองแล้ว')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="เพิ่มรายการกำหนดเอง"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button icon="plus" disabled={!valid} onClick={confirm}>
            เพิ่มลงตะกร้า
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="ชื่อรายการ">
          <Input
            autoFocus
            placeholder="เช่น ค่าบริการ, สินค้าไม่มีในระบบ…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="ราคาต่อหน่วย (บาท)">
          <Input
            type="number"
            min={0}
            step="any"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm()
            }}
          />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-600">จำนวน</span>
          <QtyStepper value={qty} onChange={setQty} />
        </div>
      </div>
    </Modal>
  )
}
