import { useEffect, useRef, useState } from 'react'
import type { CashMoveType } from '../../db/types'
import { addCashMove } from '../../lib/shift'
import { baht, r2 } from '../../lib/format'
import { Button, Field, Icon, Input, Modal, toast } from '../../components/ui'

/* =========================================================
   โมดัลนำเงินเข้า / ออกลิ้นชักระหว่างกะ

   เงินก้อนนี้ไม่ใช่ยอดขายและไม่ใช่รายจ่าย — เป็นการย้ายเงินเข้า/ออกลิ้นชักเฉยๆ
   แต่มีผลกับ "เงินสดที่ควรมี" ตรงๆ (+ นำเข้า / − นำออก ในสูตรของ computeShiftSummary)
   การนำออกเกินเงินที่ควรมี addCashMove() จะ throw ให้เอง → แสดงข้อความนั้นในโมดัล
   ========================================================= */

const PRESET_REASONS: Record<CashMoveType, string[]> = {
  in: ['เติมเงินทอน', 'เจ้าของเติมเงิน'],
  out: ['นำฝากธนาคาร', 'จ่ายซัพพลายเออร์'],
}

interface Props {
  open: boolean
  shiftId: number
  type: CashMoveType
  onClose: () => void
}

export default function CashMoveModal({ open, shiftId, type, onClose }: Props) {
  const isIn = type === 'in'
  const [amountStr, setAmountStr] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  /** ล็อกกันกดซ้ำแบบทันที (state busy อัปเดตช้ากว่าการกดรัว) */
  const lock = useRef(false)

  // เปิดโมดัลใหม่ / สลับประเภท → ล้างฟอร์ม
  useEffect(() => {
    if (!open) return
    setAmountStr('')
    setReason('')
    setErr('')
  }, [open, type])

  const amount = Number(amountStr)
  const valid = Number.isFinite(amount) && amount > 0 && reason.trim().length > 0

  const confirm = async () => {
    if (lock.current) return
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr('กรุณากรอกจำนวนเงินมากกว่า 0')
      return
    }
    if (!reason.trim()) {
      setErr('กรุณาระบุเหตุผล')
      return
    }
    lock.current = true
    setBusy(true)
    setErr('')
    try {
      // addCashMove บันทึกชื่อผู้ทำรายการเองจาก actor และกันนำออกเกินเงินในลิ้นชัก
      await addCashMove(shiftId, { type, amount: r2(amount), reason: reason.trim() })
      toast.success(`${isIn ? 'นำเงินเข้า' : 'นำเงินออก'}ลิ้นชัก ฿${baht(r2(amount))} แล้ว`)
      onClose()
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : `${isIn ? 'นำเงินเข้า' : 'นำเงินออก'}ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง`,
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const handleClose = () => {
    if (busy) return // กำลังบันทึกอยู่ — กัน Esc / คลิกฉากหลังปิดกลางคัน
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="sm"
      title={isIn ? 'นำเงินเข้าลิ้นชัก' : 'นำเงินออกจากลิ้นชัก'}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            icon={isIn ? 'plus' : 'minus'}
            variant={isIn ? 'primary' : 'danger'}
            disabled={busy || !valid}
            onClick={() => void confirm()}
          >
            {busy ? 'กำลังบันทึก…' : isIn ? 'ยืนยันนำเงินเข้า' : 'ยืนยันนำเงินออก'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ${
            isIn ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          <Icon name={isIn ? 'wallet' : 'download'} size={17} className="mt-0.5" />
          <span>
            {isIn
              ? 'ใช้เมื่อเติมเงินทอนหรือใส่เงินเพิ่มเข้าลิ้นชัก — ยอด “เงินสดที่ควรมี” จะเพิ่มขึ้นตามจำนวนนี้'
              : 'ใช้เมื่อถอนเงินออกจากลิ้นชัก (เช่น นำฝากธนาคาร) — ยอด “เงินสดที่ควรมี” จะลดลงตามจำนวนนี้'}
          </span>
        </div>

        <Field label="จำนวนเงิน (บาท)">
          <Input
            autoFocus
            type="number"
            min={0}
            step={1}
            inputMode="decimal"
            placeholder="0"
            className="text-right text-lg font-bold"
            value={amountStr}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setAmountStr(e.target.value)}
          />
        </Field>

        <Field label="เหตุผล" hint="จำเป็นต้องระบุ — จะแสดงในรายงานกะ">
          <Input
            placeholder={isIn ? 'เช่น เติมเงินทอน' : 'เช่น นำฝากธนาคาร'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          {PRESET_REASONS[type].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setReason(p)}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                reason === p
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {err && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
            <Icon name="alert" size={16} className="mt-0.5" />
            {err}
          </div>
        )}
      </div>
    </Modal>
  )
}
