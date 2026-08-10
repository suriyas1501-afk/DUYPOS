import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { OrderStatus, Sale } from '../db/types'
import { usePermissions, useSettings } from '../db/hooks'
import { fmtTime, startOfDay } from '../lib/format'
import { printKitchenSlip } from '../lib/receipt'
import {
  ORDER_LABEL,
  isOrderLate,
  minutesSinceSent,
  openOrders,
  setOrderStatus,
} from '../lib/quickService'
import OrderCard, { minutesText, qtyText } from './kitchen/OrderCard'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  Spinner,
  toast,
} from '../components/ui'

/* =========================================================
   จอครัว / คิวออเดอร์

   จอนี้เปิดค้างทั้งวันหน้าเตา จึงออกแบบรอบเวลาไว้แน่นอน:
   - ข้อมูลออเดอร์อ่านผ่าน useLiveQuery → Dexie ยิงใหม่เองเมื่อตาราง sales เปลี่ยน
     (บิลถูกยกเลิกภายหลัง → openOrders() กรอง status !== 'completed' ออก การ์ดหายทันที)
   - "เวลาที่ผ่านไป" มาจาก state `now` ที่เดินด้วย setInterval แยกต่างหาก
     **ห้ามเอา Date.now() ไปใส่ deps ของ useLiveQuery** เพราะ deps จะเปลี่ยนทุกเรนเดอร์
     → subscribe/unsubscribe ไม่จบ (คิวรีวนไม่หยุด กิน CPU ทั้งวัน)
   ========================================================= */

/** คอลัมน์บนกระดาน (served ไม่อยู่บนกระดาน — ไปอยู่ในประวัติวันนี้) */
const BOARD = ['new', 'preparing', 'ready'] as const
type BoardStatus = (typeof BOARD)[number]

/** ความถี่ที่นาฬิกาบนการ์ดเดิน — 20 วิ พอสำหรับตัวเลขหน่วย "นาที" และไม่กิน CPU */
const TICK_MS = 20000

/** สีหัวคอลัมน์ */
const COL_STYLE: Record<BoardStatus, string> = {
  new: 'bg-sky-600',
  preparing: 'bg-amber-500',
  ready: 'bg-emerald-600',
}

/**
 * เวลาปัจจุบันที่เดินเองทุก TICK_MS
 * แยกออกมาเป็นฮุกเพื่อให้จุดเคลียร์ interval อยู่ที่เดียว (จอเปิดค้างทั้งวัน ห้ามรั่ว)
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])
  return now
}

/* ---------------------------------------------------------
   แถบสรุปด้านบน
   --------------------------------------------------------- */

function StatChip({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: string
  tone: string
  icon: 'clock' | 'coffee' | 'check' | 'alert'
}) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-white ${tone}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <div className="text-xs opacity-90">{label}</div>
        <div className="text-2xl leading-tight font-black tabular-nums">{value}</div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------
   ประวัติที่เสิร์ฟแล้ววันนี้ (พับเก็บได้)
   --------------------------------------------------------- */

/** เวลาที่ใช้ทำ = orderReadyAt − orderSentAt (นาที) — null ถ้าข้อมูลไม่ครบ (บิลเก่า/ข้ามสถานะ) */
function cookMinutes(s: Sale): number | null {
  if (s.orderSentAt == null || s.orderReadyAt == null) return null
  return Math.max(0, Math.round((s.orderReadyAt - s.orderSentAt) / 60000))
}

function TodayHistory({ dayStart }: { dayStart: number }) {
  const [open, setOpen] = useState(false)

  // dayStart เป็นตัวเลขคงที่ตลอดวัน → deps ไม่เปลี่ยนทุกเรนเดอร์ (เปลี่ยนแค่ตอนข้ามเที่ยงคืน)
  // จำกัดด้วยช่วงเวลาก่อน แล้วค่อยกรองสถานะใน JS — ถ้า where('orderStatus') จะดึงออเดอร์
  // ที่เคยเสิร์ฟ "ตั้งแต่เปิดร้าน" ทุกครั้งที่คิวรีรันใหม่ (ยิงใหม่ทุกครั้งที่กดส่งลูกค้า)
  // ร้านที่ขายมาเป็นปีจะช้าขึ้นเรื่อยๆ ทั้งที่จอครัวต้องการแค่ของวันนี้
  const served = useLiveQuery(async () => {
    const rows = await db.sales.where('createdAt').aboveOrEqual(dayStart).toArray()
    return rows
      .filter((s) => s.orderStatus === 'served' && s.status === 'completed')
      .sort((a, b) => (b.orderServedAt ?? 0) - (a.orderServedAt ?? 0))
  }, [dayStart])

  // เวลาทำเฉลี่ยของวันนี้ — นับเฉพาะใบที่มีข้อมูลครบ
  const avg = useMemo(() => {
    const mins = (served ?? []).map(cookMinutes).filter((m): m is number => m != null)
    if (mins.length === 0) return null
    return Math.round(mins.reduce((a, b) => a + b, 0) / mins.length)
  }, [served])

  const count = served?.length ?? 0

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>ประวัติวันนี้ (ส่งลูกค้าแล้ว {count} ออเดอร์)</span>
          {avg != null && <Badge color="slate">เวลาทำเฉลี่ย {minutesText(avg)}</Badge>}
        </span>
      }
      actions={
        <Button
          variant="secondary"
          size="sm"
          icon={open ? 'x' : 'eye'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'ซ่อน' : 'ดูประวัติ'}
        </Button>
      }
      padded={false}
    >
      {!open ? null : served == null ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : served.length === 0 ? (
        <EmptyState
          icon="history"
          title="วันนี้ยังไม่มีออเดอร์ที่ส่งลูกค้าแล้ว"
          hint="ออเดอร์ที่กด “ส่งลูกค้าแล้ว” จะย้ายลงมาที่นี่พร้อมเวลาที่ใช้ทำ"
        />
      ) : (
        <div className="max-h-[22rem] divide-y divide-slate-50 overflow-y-auto">
          {served.map((s) => {
            const cook = cookMinutes(s)
            const itemCount = s.items.reduce((n, it) => n + Math.abs(it.qty), 0)
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                <span className="w-16 shrink-0 text-lg font-black text-slate-800 tabular-nums">
                  {s.queueNo != null ? `#${s.queueNo}` : '—'}
                </span>
                <span className="w-32 shrink-0 text-slate-500">{s.receiptNo}</span>
                <span className="shrink-0 text-slate-500">
                  เข้าครัว {s.orderSentAt != null ? fmtTime(s.orderSentAt) : '—'} · ส่ง{' '}
                  {s.orderServedAt != null ? fmtTime(s.orderServedAt) : '—'}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-600">
                  {qtyText(itemCount)} รายการ
                  {s.staffName?.trim() ? ` · ${s.staffName.trim()}` : ''}
                </span>
                <span className="shrink-0">
                  {cook == null ? (
                    <Badge color="slate">ไม่มีข้อมูลเวลา</Badge>
                  ) : (
                    <Badge color={cook >= 15 ? 'amber' : 'green'}>ทำ {minutesText(cook)}</Badge>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/* ---------------------------------------------------------
   หน้าหลัก
   --------------------------------------------------------- */

export default function Kitchen() {
  const settings = useSettings()
  const { can } = usePermissions()
  const canDo = can('kitchen')
  const now = useNow()
  // เปลี่ยนค่าเฉพาะตอนข้ามวัน — ใช้เป็น deps ของคิวรีประวัติได้อย่างปลอดภัย
  const dayStart = startOfDay(now)

  // ออเดอร์ที่ยังไม่เสิร์ฟ (openOrders กรองบิลที่ถูกยกเลิกออกให้แล้ว และเรียงเข้าก่อนได้ก่อน)
  const orders = useLiveQuery(() => openOrders(), [])

  /**
   * กันกดซ้ำ: ref ล็อกทันทีในจังหวะเดียวกับที่กด (state ยังไม่ทันอัปเดต)
   * ส่วน state ใช้แค่ทำให้ปุ่มเป็นสีจาง/ขึ้นข้อความ "กำลังบันทึก…"
   */
  const busyRef = useRef<Set<number>>(new Set())
  const [busyIds, setBusyIds] = useState<number[]>([])

  const move = useCallback(
    async (sale: Sale, to: OrderStatus) => {
      const id = sale.id
      if (id == null) return
      // ซ่อนปุ่มไม่ใช่การกันสิทธิ์ — ต้องเช็คซ้ำตรงจุดที่เขียนลงฐานข้อมูล
      if (!can('kitchen')) {
        toast.error('ไม่มีสิทธิ์จัดการคิวครัว — ติดต่อผู้จัดการหรือเจ้าของร้าน')
        return
      }
      if (busyRef.current.has(id)) return
      busyRef.current.add(id)
      setBusyIds((v) => [...v, id])
      try {
        await setOrderStatus(id, to)
        toast.success(`${sale.queueNo != null ? `คิว ${sale.queueNo}` : sale.receiptNo} → ${ORDER_LABEL[to]}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'เปลี่ยนสถานะออเดอร์ไม่สำเร็จ')
      } finally {
        busyRef.current.delete(id)
        setBusyIds((v) => v.filter((x) => x !== id))
      }
    },
    [can],
  )

  const print = useCallback(
    (sale: Sale) => {
      try {
        printKitchenSlip(sale, settings)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'พิมพ์สลิปครัวไม่สำเร็จ')
      }
    },
    [settings],
  )

  // จัดกลุ่มตามสถานะให้เป็น 3 คอลัมน์ (คงลำดับ "เข้าก่อนได้ก่อน" จาก openOrders)
  const groups = useMemo(() => {
    const g: Record<BoardStatus, Sale[]> = { new: [], preparing: [], ready: [] }
    for (const s of orders ?? []) {
      if (s.orderStatus === 'new' || s.orderStatus === 'preparing' || s.orderStatus === 'ready') {
        g[s.orderStatus].push(s)
      }
    }
    return g
  }, [orders])

  // สรุปด้านบน — คิดใหม่ทุกครั้งที่นาฬิกาเดิน (now) หรือออเดอร์เปลี่ยน
  const stats = useMemo(() => {
    const list = orders ?? []
    let oldest = 0
    let lateCount = 0
    for (const s of list) {
      oldest = Math.max(oldest, minutesSinceSent(s, now))
      if (isOrderLate(s, settings, now)) lateCount++
    }
    return { oldest, lateCount, total: list.length }
  }, [orders, now, settings])

  const limit = settings.kitchenAlertMinutes ?? 10

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <PageHeader
        title="จอครัว / คิว"
        subtitle={
          limit > 0
            ? `ออเดอร์ที่ค้างเกิน ${limit} นาทีจะเปลี่ยนเป็นสีแดงเตือน — ปรับได้ที่ ตั้งค่า › บริการด่วน`
            : 'ปิดการเตือนออเดอร์ค้างไว้ — เปิดได้ที่ ตั้งค่า › บริการด่วน'
        }
        actions={
          <Badge color={stats.total > 0 ? 'green' : 'slate'}>
            <Icon name="refresh" size={12} />
            อัปเดตอัตโนมัติ
          </Badge>
        }
      />

      {/* ===== โหมดบริการด่วนยังปิดอยู่ ===== */}
      {!settings.quickServiceEnabled && (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          <span>
            <b>โหมดบริการด่วนยังปิดอยู่</b> — เปิดได้ที่ ตั้งค่า › บริการด่วน
            (เปิดแล้วจะส่งออเดอร์เข้าครัวจากหน้าขายได้ หลังตรวจการชำระเงินแล้ว)
            ระหว่างนี้ยังดูออเดอร์ที่ค้างอยู่และเดินสถานะต่อได้ตามปกติ
          </span>
        </div>
      )}

      {/* ===== สรุปด้านบน ===== */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatChip label={ORDER_LABEL.new} value={`${groups.new.length}`} icon="clock" tone="bg-sky-600" />
        <StatChip
          label={ORDER_LABEL.preparing}
          value={`${groups.preparing.length}`}
          icon="coffee"
          tone="bg-amber-500"
        />
        <StatChip
          label={ORDER_LABEL.ready}
          value={`${groups.ready.length}`}
          icon="check"
          tone="bg-emerald-600"
        />
        <StatChip
          label={stats.lateCount > 0 ? `ค้างนานสุด · เกินเวลา ${stats.lateCount} ใบ` : 'ค้างนานสุด'}
          value={stats.total === 0 ? '—' : minutesText(stats.oldest)}
          icon={stats.lateCount > 0 ? 'alert' : 'clock'}
          tone={stats.lateCount > 0 ? 'bg-rose-600' : 'bg-slate-600'}
        />
      </div>

      {/* ===== กระดานออเดอร์ ===== */}
      {orders == null ? (
        <Card>
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        </Card>
      ) : orders.length === 0 ? (
        <Card>
          <EmptyState
            icon="coffee"
            title="ยังไม่มีออเดอร์เข้าครัว"
            hint="เมื่อแคชเชียร์ตรวจการชำระเงินแล้วกด “ส่งเข้าครัว” ออเดอร์จะขึ้นที่นี่เองทันที"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {BOARD.map((st) => {
            const list = groups[st]
            return (
              <section key={st} className="flex min-w-0 flex-col gap-3">
                <div
                  className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-white ${COL_STYLE[st]}`}
                >
                  <span className="text-base font-bold">{ORDER_LABEL[st]}</span>
                  <span className="rounded-lg bg-white/20 px-2.5 py-0.5 text-lg font-black tabular-nums">
                    {list.length}
                  </span>
                </div>

                {list.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
                    ไม่มีออเดอร์ในขั้นนี้
                  </div>
                ) : (
                  list.map((s) => (
                    <OrderCard
                      key={s.id}
                      sale={s}
                      status={st}
                      settings={settings}
                      now={now}
                      busy={s.id != null && busyIds.includes(s.id)}
                      canDo={canDo}
                      onMove={move}
                      onPrint={print}
                    />
                  ))
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* ===== ประวัติวันนี้ ===== */}
      <div className="mt-4">
        <TodayHistory dayStart={dayStart} />
      </div>
    </div>
  )
}
