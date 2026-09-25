import { TAKEAWAY_LABEL, tableLabels } from '../../stores/tableOrderStore'
import { Button, Icon } from '../../components/ui'

/* =========================================================
   ขั้นที่ 1 — เลือกเลขโต๊ะเพื่อเริ่มออเดอร์

   ออกแบบให้กดด้วยนิ้วโป้งมือเดียวบนมือถือ: ปุ่มสูง 64px เรียง 3 คอลัมน์
   (ที่ความกว้าง 326px ซึ่งเป็นพื้นที่ที่เหลือบน iPhone หลังหักแถบเมนู
   จะได้ปุ่มกว้างราว 98px — ใหญ่กว่าเกณฑ์ 44px ของ Apple อยู่มาก)
   ========================================================= */

export default function TablePicker({
  tableCount,
  movingFrom,
  onPick,
  onCancel,
}: {
  tableCount: number | undefined
  /** กำลังย้ายใบสั่งจากโต๊ะนี้ (ไม่ระบุ = เริ่มออเดอร์ใหม่) */
  movingFrom?: string
  onPick: (tableLabel: string) => void
  onCancel?: () => void
}) {
  const labels = tableLabels(tableCount)
  const moving = movingFrom != null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-slate-800">
            {moving ? `ย้ายใบสั่งจากโต๊ะ ${movingFrom}` : 'เลือกโต๊ะเพื่อเริ่มรับออเดอร์'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {moving ? 'รายการที่สั่งไว้จะย้ายไปด้วย ไม่หาย' : 'แตะเลขโต๊ะที่ลูกค้านั่งอยู่'}
          </p>
        </div>
        {onCancel && (
          <Button variant="secondary" size="sm" icon="x" className="shrink-0" onClick={onCancel}>
            ยกเลิก
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        {labels.map((label) => {
          const takeaway = label === TAKEAWAY_LABEL
          return (
            <button
              key={label}
              type="button"
              disabled={moving && label === movingFrom}
              onClick={() => onPick(label)}
              className={`flex h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl border-2 font-bold transition-colors active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
                takeaway
                  ? 'col-span-3 border-slate-300 bg-white text-slate-600 hover:border-slate-400 sm:col-span-4 lg:col-span-6'
                  : 'border-emerald-200 bg-white text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50'
              }`}
            >
              {takeaway ? (
                <span className="flex items-center gap-2 text-base">
                  <Icon name="truck" size={18} />
                  {TAKEAWAY_LABEL} / ไม่ระบุโต๊ะ
                </span>
              ) : (
                <>
                  <span className="text-[10px] font-medium text-slate-400">โต๊ะ</span>
                  <span className="text-2xl leading-none tabular-nums">{label}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
