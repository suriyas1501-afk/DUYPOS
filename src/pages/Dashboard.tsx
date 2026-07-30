import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { db } from '../db/db'
import { useSettings } from '../db/hooks'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  Spinner,
  type IconName,
} from '../components/ui'
import {
  addDays,
  baht,
  dayKey,
  dayLabel,
  endOfDay,
  fmtDate,
  fmtTime,
  r2,
  startOfDay,
} from '../lib/format'

/* =========================================================
   ค่าคงที่ของกราฟ
   ชุดสีเน้นแท่ง "วันนี้" เป็นคู่ sequential ของ hue เดียว
   (ตรวจแล้ว: ทั้งคู่คอนทราสต์ ≥ 3:1 บนพื้นขาว, ΔE ปกติ 16.9,
   ΔE CVD ≥ 16.5, ความสว่างไล่ระดับทางเดียว — ตัวชี้ "วันนี้"
   ยังถูกย้ำด้วยตำแหน่งแกน + ข้อความใน tooltip ไม่พึ่งสีอย่างเดียว)
   ========================================================= */

/** สีแท่งวันก่อนหน้า (emerald-600, 3.77:1 บนพื้นขาว) */
const BAR_PAST = '#059669'
/** สีแท่งวันนี้ — เข้มกว่า (emerald-800) */
const BAR_TODAY = '#065f46'

const GRID_STROKE = '#e2e8f0' // เส้นกริด hairline (slate-200)
const AXIS_STROKE = '#cbd5e1' // เส้นแกน (slate-300)
const TICK = { fontSize: 12, fill: '#64748b' } // ตัวอักษรแกน (slate-500)

const COMPACT_FMT = new Intl.NumberFormat('th-TH', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const compact = (v: number) => COMPACT_FMT.format(v)

/* =========================================================
   Tooltip กราฟยอดขาย (recharts ส่ง active/payload/label ให้เอง)
   ========================================================= */

interface TipProps {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{ value?: string | number; payload?: Record<string, unknown> }>
}

function SalesTip({ active, payload, label }: TipProps) {
  const p = payload?.[0]
  if (!active || !p) return null
  const isToday = Boolean((p.payload as { isToday?: boolean } | undefined)?.isToday)
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg">
      <div className="mb-0.5 text-xs text-slate-500">
        {label}
        {isToday && <span className="font-medium text-emerald-600"> · วันนี้</span>}
      </div>
      <div className="font-semibold text-slate-800">{baht(Number(p.value ?? 0))} บาท</div>
    </div>
  )
}

/* =========================================================
   การ์ดสถิติ
   ========================================================= */

function StatCard({
  icon,
  tone,
  label,
  value,
  unit,
  valueCls = 'text-slate-800',
}: {
  icon: IconName
  tone: string
  label: string
  value: string
  unit: string
  valueCls?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
          <Icon name={icon} size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-slate-500">{label}</div>
          <div className={`truncate text-2xl font-bold ${valueCls}`}>
            {value} <span className="text-sm font-normal text-slate-400">{unit}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   หน้าหลัก
   ========================================================= */

export default function Dashboard() {
  const settings = useSettings()

  // จุดอ้างอิงเวลา — อัปเดตเมื่อข้ามวัน (เผื่อจอเปิดค้างข้ามเที่ยงคืน)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () =>
      setNow((prev) => (dayKey(prev) === dayKey(Date.now()) ? prev : Date.now()))
    const t = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  const todayLo = startOfDay(now)
  const hi = endOfDay(now)
  const lo7 = startOfDay(addDays(now, -6))

  // ---- ข้อมูล (reactive) ----
  /** บิลสำเร็จย้อนหลัง 7 วัน (รวมวันนี้) — ใช้ทั้งกราฟ สถิติวันนี้ และสินค้าขายดี */
  const sales7 = useLiveQuery(
    () =>
      db.sales
        .where('createdAt')
        .between(lo7, hi, true, true)
        .and((s) => s.status === 'completed')
        .toArray(),
    [lo7, hi],
  )
  /** บิลวันนี้ทุกสถานะ — ใช้แสดงรายการบิลล่าสุด */
  const todayAll = useLiveQuery(
    () => db.sales.where('createdAt').between(todayLo, hi, true, true).toArray(),
    [todayLo, hi],
  )
  const products = useLiveQuery(() => db.products.toArray(), [])

  // ---- สถิติวันนี้ (เฉพาะบิล completed) ----
  const kpi = useMemo(() => {
    let total = 0
    let profit = 0
    let bills = 0
    for (const s of sales7 ?? []) {
      if (s.createdAt < todayLo) continue
      bills += 1
      total += s.total
      // it.total หักเฉพาะส่วนลดรายบรรทัด — ต้องหักส่วนลดระดับบิลด้วย
      // (โปรระดับบิล = promoDiscount รวม − โปรรายบรรทัด, ส่วนลดท้ายบิล, แลกแต้ม)
      let linePromo = 0
      for (const it of s.items) {
        profit += it.total - it.cost * it.qty
        linePromo += it.promoDiscount
      }
      profit -= s.promoDiscount - linePromo + s.billDiscount + s.pointDiscount
    }
    return {
      total: r2(total),
      profit: r2(profit),
      bills,
      avg: bills > 0 ? r2(total / bills) : 0,
    }
  }, [sales7, todayLo])

  // ---- ยอดขายรายวัน 7 วัน (bucket ครบทุกวัน วันไม่มียอด = 0) ----
  const chart = useMemo(() => {
    const sums = new Map<string, number>()
    for (const s of sales7 ?? []) {
      const k = dayKey(s.createdAt)
      sums.set(k, (sums.get(k) ?? 0) + s.total)
    }
    const todayK = dayKey(now)
    const out: { key: string; label: string; total: number; isToday: boolean }[] = []
    for (let t = lo7; t <= hi; t = addDays(t, 1)) {
      const k = dayKey(t)
      out.push({ key: k, label: dayLabel(t), total: r2(sums.get(k) ?? 0), isToday: k === todayK })
    }
    return out
  }, [sales7, lo7, hi, now])

  // ---- สินค้าขายดี Top 5 ใน 7 วัน (รวมกลุ่มตามชื่อ เรียงตามยอดขาย) ----
  const top = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; total: number }>()
    for (const s of sales7 ?? []) {
      for (const it of s.items) {
        const g = m.get(it.name) ?? { name: it.name, qty: 0, total: 0 }
        g.qty += it.qty
        g.total += it.total
        m.set(it.name, g)
      }
    }
    return [...m.values()]
      .map((g) => ({ ...g, total: r2(g.total) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [sales7])

  // ---- สินค้าใกล้หมด (นับสต็อกและเหลือ ≤ จุดสั่งซื้อ) ----
  const lowStock = useMemo(
    () =>
      (products ?? [])
        .filter((p) => p.active && p.trackStock && p.stock <= (p.lowStockAt ?? 0))
        .sort((a, b) => a.stock - b.stock)
        .slice(0, 8),
    [products],
  )

  // ---- 5 บิลล่าสุดวันนี้ (ทุกสถานะ) ----
  const recent = useMemo(
    () => [...(todayAll ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [todayAll],
  )

  if (!sales7 || !todayAll || !products) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title={`สวัสดี 👋 ${settings.shopName}`}
        subtitle={fmtDate(now)}
        actions={
          <Link to="/pos">
            <Button size="lg" icon="cart">
              เริ่มขาย
            </Button>
          </Link>
        }
      />

      <div className="space-y-4">
        {/* ===== การ์ดสถิติวันนี้ 4 ใบ ===== */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon="cash"
            tone="bg-emerald-50 text-emerald-600"
            label="ยอดขายวันนี้"
            value={baht(kpi.total)}
            unit="บาท"
          />
          <StatCard
            icon="receipt"
            tone="bg-violet-50 text-violet-600"
            label="จำนวนบิล"
            value={baht(kpi.bills)}
            unit="บิล"
          />
          <StatCard
            icon="cart"
            tone="bg-amber-50 text-amber-600"
            label="เฉลี่ยต่อบิล"
            value={baht(kpi.avg)}
            unit="บาท"
          />
          <StatCard
            icon="chart"
            tone="bg-sky-50 text-sky-600"
            label="กำไรขั้นต้น"
            value={baht(kpi.profit)}
            unit="บาท"
            valueCls={kpi.profit < 0 ? 'text-rose-600' : 'text-slate-800'}
          />
        </div>

        {/* ===== กราฟยอดขาย 7 วันล่าสุด ===== */}
        <Card title="ยอดขาย 7 วันล่าสุด">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={TICK}
                  tickLine={false}
                  axisLine={{ stroke: AXIS_STROKE }}
                />
                <YAxis
                  width={48}
                  tick={TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={compact}
                />
                <Tooltip content={<SalesTip />} cursor={{ fill: 'rgba(100,116,139,0.08)' }} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={36}>
                  {chart.map((d) => (
                    <Cell key={d.key} fill={d.isToday ? BAR_TODAY : BAR_PAST} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* ===== สินค้าขายดี (7 วัน) ===== */}
          <Card title="สินค้าขายดี (7 วัน)" padded={false}>
            {top.length === 0 ? (
              <EmptyState icon="box" title="ยังไม่มีการขายในช่วง 7 วัน" />
            ) : (
              <div className="divide-y divide-slate-50">
                {top.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-xs font-bold text-emerald-700">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-700">{p.name}</div>
                      <div className="text-xs text-slate-400">{baht(p.qty)} ชิ้น</div>
                    </div>
                    <div className="text-sm font-semibold text-slate-800">฿{baht(p.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ===== สินค้าใกล้หมด ===== */}
          <Card
            title="สินค้าใกล้หมด"
            padded={false}
            actions={
              <Link to="/products">
                <Button variant="ghost" size="sm" icon="box">
                  จัดการสินค้า
                </Button>
              </Link>
            }
          >
            {lowStock.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-emerald-600">
                <div className="rounded-2xl bg-emerald-50 p-3">
                  <Icon name="check" size={24} />
                </div>
                <span className="text-sm font-medium">สต็อกปกติทุกรายการ</span>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {lowStock.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                      {p.name}
                    </div>
                    <Badge color="red">เหลือ {baht(p.stock)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ===== บิลล่าสุดวันนี้ ===== */}
          <Card
            title="บิลล่าสุด"
            padded={false}
            actions={
              <Link to="/sales">
                <Button variant="ghost" size="sm" icon="history">
                  ดูทั้งหมด
                </Button>
              </Link>
            }
          >
            {recent.length === 0 ? (
              <EmptyState icon="receipt" title="ยังไม่มีบิลวันนี้" />
            ) : (
              <div className="divide-y divide-slate-50">
                {recent.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-700">
                        {s.receiptNo}
                      </div>
                      <div className="text-xs text-slate-400">{fmtTime(s.createdAt)}</div>
                    </div>
                    {s.status === 'completed' ? (
                      <Badge color="green">สำเร็จ</Badge>
                    ) : (
                      <Badge color="red">ยกเลิก</Badge>
                    )}
                    <div
                      className={`text-sm font-semibold ${
                        s.status === 'voided' ? 'text-slate-400 line-through' : 'text-slate-800'
                      }`}
                    >
                      ฿{baht(s.total)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
