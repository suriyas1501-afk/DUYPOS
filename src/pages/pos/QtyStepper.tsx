import { Icon } from '../../components/ui'

const BTN =
  'flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100'

/** ตัวปรับจำนวน -/+ ใช้ในโมดัลตัวเลือกและแก้ไขรายการ */
export default function QtyStepper({
  value,
  onChange,
  min = 1,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" className={BTN} onClick={() => onChange(Math.max(min, value - 1))}>
        <Icon name="minus" size={16} />
      </button>
      <span className="w-12 text-center text-lg font-bold text-slate-800">{value}</span>
      <button type="button" className={BTN} onClick={() => onChange(value + 1)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}
