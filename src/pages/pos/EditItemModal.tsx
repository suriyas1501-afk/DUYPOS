import { useState } from 'react'
import { effectivePrice, useCart, type CartItem } from '../../stores/cartStore'
import { usePermissions } from '../../db/hooks'
import { baht, r2 } from '../../lib/format'
import { Badge, Button, Field, Icon, Input, Modal, Textarea, toast } from '../../components/ui'
import PinApprovalModal from '../../components/auth/PinApprovalModal'
import QtyStepper from './QtyStepper'

const fmtQty = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 })

/** โมดัลแก้ไขรายการในตะกร้า: จำนวน (ทศนิยมได้) / ส่วนลดบรรทัด / โน้ต / ลบ */
export default function EditItemModal({
  item,
  onClose,
}: {
  item: CartItem
  onClose: () => void
}) {
  const decimal = item.allowDecimalQty
  const minQty = decimal ? 0.01 : 1

  const [qty, setQty] = useState(item.qty)
  const [discount, setDiscount] = useState(String(item.manualDiscount || ''))
  const [note, setNote] = useState(item.note ?? '')

  /* ส่วนลดบรรทัดต้องมีสิทธิ์ 'discount' — ไม่มีก็ให้ผู้จัดการใส่ PIN อนุมัติ (มีผลเฉพาะบิลใบนี้)
     สถานะอนุมัติเก็บในตะกร้าเหมือนส่วนลดท้ายบิล เพราะตัวเลขส่วนลดบรรทัดอยู่ในตะกร้า
     ที่ persist ลง localStorage/heldBills — ถ้าเก็บเป็น state ของโมดัลนี้ ปิดโมดัลปุ๊บก็หาย
     ทั้งที่ส่วนลดยังอยู่ กลายเป็นส่วนลดที่ไม่มีใครรับผิดชอบและตามกลับไม่ได้ว่าใครอนุมัติ */
  const { can } = usePermissions()
  const discountApprovedById = useCart((s) => s.discountApprovedById)
  const setDiscountApproval = useCart((s) => s.setDiscountApproval)
  const [askApproval, setAskApproval] = useState(false)
  const mayDiscount = can('discount') || discountApprovedById != null

  // ราคาต่อหน่วยอาจเปลี่ยนเป็นราคาส่งเมื่อจำนวนถึงขั้นต่ำ
  const unitPrice = effectivePrice(item, qty)
  const isWholesale = unitPrice < item.listPrice
  const lineSubtotal = r2(unitPrice * qty)
  const d = Number(discount) || 0

  const save = () => {
    useCart.getState().updateItem(item.key, {
      qty: Math.max(minQty, decimal ? r2(qty) : Math.round(qty)),
      // ไม่มีสิทธิ์/ยังไม่ได้รับอนุมัติ → คงส่วนลดเดิมไว้ ไม่ให้แก้ผ่านหน้านี้
      manualDiscount: mayDiscount ? Math.max(0, d) : item.manualDiscount,
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
        {(item.unitName || isWholesale) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {item.unitName && <Badge color="blue">หน่วย: {item.unitName}</Badge>}
            {isWholesale && (
              <Badge color="green">
                ราคาส่ง ฿{baht(unitPrice)} (ปกติ ฿{baht(item.listPrice)})
              </Badge>
            )}
          </div>
        )}

        {(item.options?.length ?? 0) > 0 && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            ตัวเลือก: {(item.options ?? []).join(', ')}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-600">จำนวน</div>
            <div className="text-xs text-slate-400">
              ฿{baht(unitPrice)} / {item.unitName ?? 'หน่วย'}
            </div>
            {decimal && (
              <div className="text-xs text-slate-400">กรอกทศนิยมได้ เช่น 0.5</div>
            )}
          </div>
          <QtyStepper
            value={qty}
            onChange={setQty}
            decimal={decimal}
            min={minQty}
            step={decimal ? 0.25 : 1}
          />
        </div>

        {decimal && (
          <div className="grid grid-cols-4 gap-2">
            {[0.25, 0.5, 1, 2].map((v) => (
              <Button key={v} variant="secondary" size="sm" onClick={() => setQty(v)}>
                {fmtQty(v)}
              </Button>
            ))}
          </div>
        )}

        {mayDiscount ? (
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
        ) : (
          <button
            type="button"
            onClick={() => setAskApproval(true)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm text-slate-500 transition-colors hover:border-slate-300"
          >
            <Icon name="lock" size={15} className="text-slate-400" />
            <span className="flex-1">
              ส่วนลดบรรทัด
              {item.manualDiscount > 0 && ` (ปัจจุบัน -฿${baht(item.manualDiscount)})`}
            </span>
            <span className="font-medium text-emerald-600">ขออนุมัติ</span>
          </button>
        )}

        <Field label="โน้ต">
          <Textarea
            rows={2}
            placeholder="เช่น ไม่ใส่ผัก เผ็ดน้อย…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

      <PinApprovalModal
        open={askApproval}
        perm="discount"
        title="ขออนุมัติให้ส่วนลด"
        description="อนุมัติแล้วจะให้ส่วนลดได้เฉพาะบิลใบนี้"
        onClose={() => setAskApproval(false)}
        onApprove={(approver) => {
          setDiscountApproval({ id: approver.id, name: approver.name })
          setAskApproval(false)
          toast.success(`${approver.name} อนุมัติส่วนลดของบิลนี้แล้ว`)
        }}
      />
    </Modal>
  )
}
