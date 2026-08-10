import type { OrderStatus, Sale, SaleItem, Settings } from '../../db/types'
import {
  NEXT_LABEL,
  isOrderLate,
  minutesSinceSent,
  nextStatus,
  prevStatus,
  remainingItems,
} from '../../lib/quickService'
import { fmtTime } from '../../lib/format'
import { Badge, Button, Icon, type IconName } from '../../components/ui'

/* =========================================================
   การ์ดออเดอร์บนจอครัว

   ออกแบบให้ "อ่านจากอีกฝั่งของเตา" ได้ — เลขคิวใหญ่มาก ชื่อสินค้าตัวหนา
   ตัวเลือก/โน้ต (หวานน้อย, ไม่ใส่ผัก) เน้นพื้นสีอำพันเพราะเป็นจุดที่ทำผิดบ่อยที่สุด

   กติกา: **ห้ามแสดงราคาใดๆ บนจอครัว** — ครัวไม่ต้องเห็นเงิน (และไม่ควรเห็น)
   ========================================================= */

/** แปลงจำนวนนาทีเป็นข้อความไทย เช่น 75 → "1 ชม. 15 นาที" */
export function minutesText(mins: number): string {
  if (mins < 1) return 'ไม่ถึง 1 นาที'
  if (mins < 60) return `${mins} นาที`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`
}

/** จำนวนแบบอ่านง่าย — สินค้าชั่งน้ำหนักมีทศนิยม ตัดศูนย์ท้ายทิ้ง */
export function qtyText(n: number): string {
  const v = Math.abs(n)
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)))
}

/** สีประจำสถานะ — ให้กวาดตาแล้วรู้ทันทีว่าคอลัมน์ไหนคืออะไร */
const STATUS_STYLE: Record<OrderStatus, { border: string; chip: string }> = {
  new: { border: 'border-sky-300', chip: 'bg-sky-600 text-white' },
  preparing: { border: 'border-amber-300', chip: 'bg-amber-500 text-white' },
  ready: { border: 'border-emerald-300', chip: 'bg-emerald-600 text-white' },
  served: { border: 'border-slate-200', chip: 'bg-slate-500 text-white' },
}

/** ไอคอนของปุ่มเดินหน้า ตามสถานะปลายทาง */
const NEXT_ICON: Record<OrderStatus, IconName> = {
  new: 'clock',
  preparing: 'coffee',
  ready: 'check',
  served: 'check',
}

/* ---------------------------------------------------------
   1 บรรทัดสินค้า
   --------------------------------------------------------- */

function ItemRow({ item, qty }: { item: SaleItem; qty: number }) {
  // ตัวเลือกและโน้ตคือสิ่งที่ครัวพลาดบ่อยสุด — รวมเป็นบรรทัดเดียวแล้วเน้นสี
  const extra = [...(item.options ?? []), item.note?.trim()].filter(Boolean).join(' · ')
  // ลูกค้าคืนบางส่วนหลังส่งเข้าครัว — ต้องโชว์จำนวนที่เหลือจริง ไม่งั้นครัวทำเกินแล้วของทิ้ง
  const refunded = Math.abs(item.qty) - qty
  return (
    <li>
      <div className="flex items-baseline gap-2.5">
        <span className="min-w-[3rem] shrink-0 rounded-lg bg-slate-800 px-2 py-0.5 text-center text-lg font-black text-white tabular-nums">
          {qtyText(qty)}
        </span>
        <span className="min-w-0 flex-1 text-xl leading-snug font-bold break-words text-slate-900">
          {item.name}
          {item.unitName ? (
            <span className="ml-1 text-base font-medium text-slate-500">({item.unitName})</span>
          ) : null}
        </span>
      </div>
      {extra && (
        <div className="mt-1 ml-[3.6rem] rounded-lg bg-amber-100 px-2.5 py-1 text-lg leading-snug font-bold text-amber-900">
          {extra}
        </div>
      )}
      {refunded > 0.0001 && (
        <div className="mt-1 ml-[3.6rem] text-sm font-bold text-rose-600">
          ลูกค้าคืนไปแล้ว {qtyText(refunded)} — ทำแค่ {qtyText(qty)}
        </div>
      )}
    </li>
  )
}

/* ---------------------------------------------------------
   การ์ดออเดอร์
   --------------------------------------------------------- */

export default function OrderCard({
  sale,
  status,
  settings,
  now,
  busy,
  canDo,
  onMove,
  onPrint,
}: {
  sale: Sale
  /** สถานะปัจจุบัน — ส่งมาจากคอลัมน์ที่จัดกลุ่มไว้แล้ว (Sale.orderStatus เป็น optional) */
  status: OrderStatus
  settings: Settings
  /** เวลา ณ ตอนนี้จากตัวจับเวลาของหน้าจอ (ไม่ใช่ Date.now() ในแต่ละการ์ด จะได้เดินพร้อมกัน) */
  now: number
  busy: boolean
  canDo: boolean
  onMove: (sale: Sale, to: OrderStatus) => void
  onPrint: (sale: Sale) => void
}) {
  const late = isOrderLate(sale, settings, now)
  const mins = minutesSinceSent(sale, now)
  const nx = nextStatus(status)
  const pv = prevStatus(status)
  const style = STATUS_STYLE[status]

  // นับเฉพาะของที่ยังต้องทำจริง (หักที่ลูกค้าคืนไปแล้ว)
  const left = remainingItems(sale)
  const itemCount = left.reduce((s, x) => s + x.qty, 0)
  const hasRefund = left.some((x) => x.qty < Math.abs(x.item.qty) - 0.0001)

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 shadow-sm transition-colors ${
        late ? 'border-rose-500 bg-rose-50' : `${style.border} bg-white`
      }`}
    >
      {/* ===== หัวการ์ด: เลขคิวตัวใหญ่ + นาฬิกานับเวลา ===== */}
      <div className="flex items-start gap-3">
        <div
          className={`flex min-w-[5rem] flex-col items-center justify-center rounded-xl px-3 py-2 ${
            late ? 'bg-rose-600 text-white' : style.chip
          }`}
        >
          <span className="text-[11px] font-medium opacity-80">
            {sale.queueNo != null ? 'คิวที่' : 'บิล'}
          </span>
          {sale.queueNo != null ? (
            <span className="text-6xl leading-none font-black tabular-nums">{sale.queueNo}</span>
          ) : (
            <span className="text-lg leading-tight font-bold break-all">{sale.receiptNo}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className={`flex items-center gap-1.5 text-3xl leading-none font-black tabular-nums ${
              late ? 'text-rose-700' : 'text-slate-800'
            }`}
          >
            <Icon name="clock" size={24} />
            {minutesText(mins)}
          </div>
          <div className="mt-1.5 text-sm text-slate-500">
            เข้าครัว {fmtTime(sale.orderSentAt ?? sale.createdAt)} · {qtyText(itemCount)} รายการ
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {late && (
              <Badge color="red">
                <Icon name="alert" size={12} />
                ค้างนาน
              </Badge>
            )}
            {hasRefund && (
              <Badge color="red">
                <Icon name="undo" size={12} />
                มีรายการถูกคืน
              </Badge>
            )}
            {sale.memberName && (
              <Badge color="blue">
                <Icon name="user" size={12} />
                {sale.memberName}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ===== รายการสินค้า (ไม่มีราคา, เฉพาะจำนวนที่ยังไม่ถูกคืน) ===== */}
      <ul className="space-y-2 border-t border-slate-200 pt-3">
        {left.map((x, i) => (
          <ItemRow key={`${x.item.productId}-${i}`} item={x.item} qty={x.qty} />
        ))}
      </ul>

      {/* ===== ผู้ขาย (ร้านที่ปิดระบบพนักงานไม่มีชื่อ — ซ่อนทั้งบรรทัดไปเลย) ===== */}
      {sale.staffName?.trim() && (
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Icon name="user" size={13} />
          ผู้ขาย {sale.staffName.trim()}
        </div>
      )}

      {/* ===== ปุ่มเดินสถานะ ===== */}
      <div className="mt-auto space-y-2">
        {nx && (
          <Button
            size="lg"
            icon={NEXT_ICON[nx]}
            className="w-full py-4 text-lg"
            disabled={busy || !canDo}
            title={canDo ? undefined : 'ไม่มีสิทธิ์จัดการคิวครัว'}
            onClick={() => onMove(sale, nx)}
          >
            {busy ? 'กำลังบันทึก…' : NEXT_LABEL[status]}
          </Button>
        )}
        <div className="flex gap-2">
          {pv && (
            <Button
              variant="ghost"
              size="sm"
              icon="undo"
              className="flex-1"
              disabled={busy || !canDo}
              title={`ย้อนกลับไปสถานะก่อนหน้า (กดผิด)`}
              onClick={() => onMove(sale, pv)}
            >
              ย้อนกลับ
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon="printer"
            className="flex-1"
            title="พิมพ์สลิปครัวใบนี้ซ้ำ"
            onClick={() => onPrint(sale)}
          >
            พิมพ์สลิป
          </Button>
        </div>
      </div>
    </div>
  )
}
