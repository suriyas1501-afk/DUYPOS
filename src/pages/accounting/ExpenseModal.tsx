import { useState } from 'react'
import { db } from '../../db/db'
import { EXPENSE_CATEGORIES, type Expense, type PaymentMethod } from '../../db/types'
import {
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
  toast,
} from '../../components/ui'
import { dayKey, r2 } from '../../lib/format'
import { PAY_LABEL } from '../../lib/receipt'
import { useSettings } from '../../db/hooks'
import { getActor } from '../../lib/actor'
import { getOpenShift } from '../../lib/shift'
import { parseDay } from './shared'

/** ภาษีซื้ออัตโนมัติจากยอดรวม (ราคารวม VAT แล้ว) = amount × rate / (100 + rate) */
const autoVat = (amountStr: string, rate: number): string => {
  const a = Number(amountStr)
  return Number.isFinite(a) && a > 0 && rate > 0 ? String(r2((a * rate) / (100 + rate))) : ''
}

/** โมดัลเพิ่ม/แก้ไขรายจ่าย — mount ใหม่ทุกครั้งที่เปิด (state เริ่มจาก initial) */
export default function ExpenseModal({
  initial,
  onClose,
}: {
  initial: Expense | null
  onClose: () => void
}) {
  // วันที่: แปลงเป็น YYYY-MM-DD แบบ local (ห้ามใช้ toISOString — จะเพี้ยน timezone)
  const [dateStr, setDateStr] = useState(() => dayKey(initial?.date ?? Date.now()))
  const [category, setCategory] = useState<string>(initial?.category ?? EXPENSE_CATEGORIES[0])
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amountStr, setAmountStr] = useState(initial ? String(initial.amount) : '')
  const [hasVat, setHasVat] = useState(initial?.hasVatInvoice ?? false)
  const [vatStr, setVatStr] = useState(
    initial?.hasVatInvoice ? String(initial.vatAmount) : '',
  )
  /** ผู้ใช้แก้ช่องภาษีซื้อเองแล้ว — หยุด auto-คำนวณตามยอดเงิน */
  const [vatTouched, setVatTouched] = useState(initial?.hasVatInvoice ?? false)
  const [payment, setPayment] = useState<PaymentMethod>(initial?.paymentMethod ?? 'cash')
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)

  // อัตรา VAT ตามการตั้งค่าร้าน (ค่าเริ่มต้น 7) — ใช้คำนวณภาษีซื้ออัตโนมัติ
  const vatRate = useSettings().vatRate

  const onAmountChange = (v: string) => {
    setAmountStr(v)
    if (hasVat && !vatTouched) setVatStr(autoVat(v, vatRate))
  }

  const onToggleVat = (v: boolean) => {
    setHasVat(v)
    if (v) {
      setVatStr(autoVat(amountStr, vatRate))
      setVatTouched(false)
    }
  }

  const save = async () => {
    const date = parseDay(dateStr)
    if (date == null) {
      toast.error('กรุณาเลือกวันที่ของรายจ่าย')
      return
    }
    const desc = description.trim()
    if (!desc) {
      toast.error('กรุณากรอกรายละเอียดรายจ่าย')
      return
    }
    const amount = Number(amountStr)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('กรุณากรอกจำนวนเงินให้ถูกต้อง (มากกว่า 0)')
      return
    }
    let vat = 0
    if (hasVat) {
      vat = Number(vatStr)
      if (!Number.isFinite(vat) || vat < 0) {
        toast.error('กรุณากรอกภาษีซื้อให้ถูกต้อง')
        return
      }
      if (vat > amount) {
        toast.error('ภาษีซื้อต้องไม่เกินจำนวนเงิน')
        return
      }
    }

    setSaving(true)
    try {
      const data = {
        date,
        category,
        description: desc,
        amount: r2(amount),
        hasVatInvoice: hasVat,
        vatAmount: hasVat ? r2(vat) : 0,
        paymentMethod: payment,
        note: note.trim() || undefined,
      }
      if (initial?.id != null) {
        // แก้ไข: ไม่แตะผู้บันทึก/กะเดิม (เอกสารต้องคงว่าใครบันทึกไว้ตอนแรก)
        await db.expenses.update(initial.id, data)
        toast.success('แก้ไขรายจ่ายแล้ว')
      } else {
        // บันทึกใหม่: ผูกผู้บันทึกและกะที่เปิดอยู่ เพื่อให้เงินสดที่ควรมีในลิ้นชักของกะนั้นถูกต้อง
        const actor = getActor()
        const shift = await getOpenShift()
        await db.expenses.add({
          ...data,
          staffId: actor.id,
          staffName: actor.name,
          shiftId: shift?.id,
          createdAt: Date.now(),
        })
        toast.success('บันทึกรายจ่ายแล้ว')
      }
      onClose()
    } catch {
      toast.error('บันทึกรายจ่ายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'แก้ไขรายจ่าย' : 'บันทึกรายจ่าย'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button icon="check" disabled={saving} onClick={() => void save()}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="วันที่">
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="หมวด">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="รายละเอียด *">
          <Input
            autoFocus
            placeholder="เช่น ซื้อเมล็ดกาแฟ 5 กก."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field label="จำนวนเงิน (บาท) *">
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            placeholder="0.00"
            value={amountStr}
            onChange={(e) => onAmountChange(e.target.value)}
          />
        </Field>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <Toggle checked={hasVat} onChange={onToggleVat} label="มีใบกำกับภาษีเต็มรูป" />
          {hasVat && (
            <div className="mt-3">
              <Field
                label="ภาษีซื้อ (บาท)"
                hint={`คำนวณอัตโนมัติจากยอดรวม × ${vatRate}/${100 + vatRate} — แก้ไขเองได้ตามใบกำกับ`}
              >
                <Input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={vatStr}
                  onChange={(e) => {
                    setVatStr(e.target.value)
                    setVatTouched(true)
                  }}
                />
              </Field>
            </div>
          )}
        </div>

        <Field label="ช่องทางจ่าย">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            {(['cash', 'transfer', 'card'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPayment(k)}
                className={`flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  payment === k ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {PAY_LABEL[k]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="โน้ต">
          <Textarea
            rows={2}
            placeholder="บันทึกเพิ่มเติม (ไม่บังคับ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
