import { useState } from 'react'
import { Icon } from '../../components/ui'
import { r2 } from '../../lib/format'

const BTN =
  'flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100'

const NUM =
  'w-16 rounded-xl border border-slate-300 bg-white py-1 text-center text-lg font-bold text-slate-800 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

/**
 * ตัวปรับจำนวน -/+ (พิมพ์ตัวเลขเองได้) ใช้ในโมดัลตัวเลือกและแก้ไขรายการ
 * รองรับสินค้าชั่งน้ำหนัก: decimal = true → พิมพ์ทศนิยมได้ (ละเอียด 0.01) ไม่ปัดทิ้ง
 */
export default function QtyStepper({
  value,
  onChange,
  min = 1,
  step = 1,
  decimal = false,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  /** ก้าวของปุ่ม - / + */
  step?: number
  /** อนุญาตจำนวนทศนิยม */
  decimal?: boolean
}) {
  // ค่าที่กำลังพิมพ์ (null = ไม่ได้พิมพ์ ใช้ค่าจริงจาก prop)
  const [draft, setDraft] = useState<string | null>(null)

  const norm = (v: number) => (decimal ? Math.max(0, r2(v)) : Math.max(0, Math.round(v)))
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(min, norm(v)) : min)

  const bump = (delta: number) => {
    setDraft(null)
    onChange(clamp(value + delta))
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" className={BTN} onClick={() => bump(-step)}>
        <Icon name="minus" size={16} />
      </button>
      <input
        type="number"
        inputMode={decimal ? 'decimal' : 'numeric'}
        min={min}
        step={decimal ? 0.01 : 1}
        className={NUM}
        value={draft ?? String(value)}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          const n = Number(raw)
          if (raw !== '' && Number.isFinite(n)) onChange(norm(n))
        }}
        onBlur={() => {
          setDraft(null)
          onChange(clamp(value))
        }}
      />
      <button type="button" className={BTN} onClick={() => bump(step)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}
