import { useEffect, useRef, useState } from 'react'
import type { Shift } from '../../db/types'
import { useSettings } from '../../db/hooks'
import { openShift } from '../../lib/shift'
import { baht, r2 } from '../../lib/format'
import { Button, Field, Icon, Input, Modal, Textarea, toast } from '../../components/ui'

/* =========================================================
   โมดัลเปิดกะ — กรอกเงินทอนตั้งต้นที่ใส่ไว้ในลิ้นชัก

   เงินทอนตั้งต้นเป็น "ฐาน" ของสูตรเงินสดที่ควรมีทั้งกะ
   (ควรมี = ตั้งต้น + ขายเงินสด − รายจ่ายเงินสด + นำเข้า − นำออก — คิดใน computeShiftSummary)
   จึงต้องกรอกให้ตรงกับเงินจริงในลิ้นชักตอนเริ่มกะ
   ========================================================= */

/** ยอดเงินทอนตั้งต้นที่ร้านมักใช้ (กดเลือกเร็ว) */
const PRESETS = [500, 1000, 2000]

interface Props {
  open: boolean
  onClose: () => void
  /** เรียกเมื่อเปิดกะสำเร็จ (ส่งกะที่เพิ่งเปิดกลับไป) */
  onOpened?: (shift: Shift) => void
}

export default function OpenShiftModal({ open, onClose, onOpened }: Props) {
  const settings = useSettings()
  const defaultCash = settings.defaultOpeningCash ?? 1000

  const [cashStr, setCashStr] = useState(String(defaultCash))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  /** ล็อกกันกดซ้ำแบบทันที (state busy อัปเดตช้ากว่าการกดรัว) */
  const lock = useRef(false)

  // เปิดโมดัลใหม่ทุกครั้ง → รีเซ็ตฟอร์มเป็นค่าเริ่มต้นจากการตั้งค่า
  useEffect(() => {
    if (!open) return
    setCashStr(String(defaultCash))
    setNote('')
    setErr('')
  }, [open, defaultCash])

  const amount = Number(cashStr)
  const valid = Number.isFinite(amount) && amount >= 0

  const confirm = async () => {
    if (lock.current) return
    if (!valid) {
      setErr('กรุณากรอกเงินทอนตั้งต้นเป็นตัวเลขไม่ติดลบ')
      return
    }
    lock.current = true
    setBusy(true)
    setErr('')
    try {
      // openShift บันทึกชื่อผู้เปิดกะเองจาก actor + กันเปิดซ้อนกะที่ยังเปิดอยู่ (throw)
      const shift = await openShift({ openingCash: r2(amount), note })
      toast.success(`เปิดกะ ${shift.docNo} แล้ว — เงินทอนตั้งต้น ฿${baht(shift.openingCash)}`)
      onOpened?.(shift)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'เปิดกะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
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
      title="เปิดกะ"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button icon="unlock" disabled={busy || !valid} onClick={() => void confirm()}>
            {busy ? 'กำลังเปิดกะ…' : 'ยืนยันเปิดกะ'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Icon name="cash" size={17} className="mt-0.5" />
          <span>
            นับเงินในลิ้นชักตอนนี้แล้วกรอกเป็น <b>เงินทอนตั้งต้น</b> — ระบบจะใช้ยอดนี้เป็นฐานคำนวณ
            “เงินสดที่ควรมีในลิ้นชัก” ตลอดกะ
          </span>
        </div>

        <Field label="เงินทอนตั้งต้น (บาท)" hint="กรอก 0 ได้ถ้าเริ่มกะโดยไม่มีเงินในลิ้นชัก">
          <Input
            autoFocus
            type="number"
            min={0}
            step={1}
            inputMode="decimal"
            className="text-right text-lg font-bold"
            value={cashStr}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setCashStr(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setCashStr(String(p))}
              className={`cursor-pointer rounded-full border px-3.5 py-1 text-xs font-medium transition-colors ${
                Number(cashStr) === p
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              ฿{baht(p)}
            </button>
          ))}
        </div>

        <Field label="หมายเหตุ (ถ้ามี)">
          <Textarea
            rows={2}
            placeholder="เช่น รับกะต่อจากกะเช้า / เจ้าของเติมเงินทอนให้"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

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
