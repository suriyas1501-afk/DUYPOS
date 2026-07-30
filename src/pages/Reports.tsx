import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { db } from '../db/db'
import type { PaymentMethod } from '../db/types'
import {
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  PageHeader,
  Spinner,
  toast,
  type IconName,
} from '../components/ui'
import {
  addDays,
  baht,
  dayKey,
  dayLabel,
  endOfDay,
  fmtDate,
  fmtDateTime,
  r2,
  startOfDay,
} from '../lib/format'
import { downloadCsv } from '../lib/csv'
import { PAY_LABEL } from '../lib/receipt'

/* =========================================================
   ค่าคงที่ของกราฟ (พาเลตผ่านการตรวจ CVD/contrast บนพื้นขาวแล้ว)
   ========================================================= */

/** สีหลักของแบรนด์ — ใช้กับกราฟชุดข้อมูลเดียว (emerald-600, 3.77:1 บนพื้นขาว) */
const BRAND = '#059669'
/** สีหมวดหมู่ตามลำดับ slot (ตรวจ adjacent-pair แล้ว) */
const CAT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
/** "อื่นๆ" ใช้สีเทา de-emphasis เสมอ */
const OTHER_COLOR = '#94a3b8'
/** สีประจำช่องทางชำระเงิน (ผูกกับ entity คงที่ — 3 slot แรกผ่าน all-pairs) */
const PAY_COLORS: Record<PaymentMethod, string> = {
  cash: '#2a78d6',
  transfer: '#1baf7a',
  card: '#eb6834',
}

const GRID_STROKE = '#e2e8f0' // เส้นกริด hairline (slate-200)
const AXIS_STROKE = '#cbd5e1' // เส้นแกน (slate-300)
const TICK = { fontSize: 12, fill: '#64748b' } // ตัวอักษรแกน (slate-500)

const COMPACT_FMT = new Intl.NumberFormat('th-TH', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const compact = (v: number) => COMPACT_FMT.format(v)

/* =========================================================
   ตัวเลือกช่วงเวลา
   ========================================================= */

type RangeKey = 'today' | 'd7' | 'd30' | 'month' | 'custom'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'วันนี้' },
  { key: 'd7', label: '7 วัน' },
  { key: 'd30', label: '30 วัน' },
  { key: 'month', label: 'เดือนนี้' },
  { key: 'custom', label: 'กำหนดเอง' },
]

/** แปลงค่าจาก input type="date" (YYYY-MM-DD) เป็น timestamp เที่ยงคืน local */
function parseDay(s: string): number | null {
  if (!s) return null
  const t = new Date(`${s}T00:00:00`).getTime()
  return Number.isNaN(t) ? null : t
}

/* =========================================================
   Tooltip (recharts ส่ง active/payload/label เข้ามาให้เอง)
   ========================================================= */

interface TipItem {
  name?: string | number
  value?: string | number
  payload?: Record<string, unknown>
}

interface TipProps {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<TipItem>
}

const TIP_CLS = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg'

/** Tooltip เงินบาทแบบทั่วไป (กราฟยอดขายรายวัน) */
function MoneyTip({ active, payload, label }: TipProps) {
  const p = payload?.[0]
  if (!active || !p) return null
  return (
    <div className={TIP_CLS}>
      {label != null && <div className="mb-0.5 text-xs text-slate-500">{label}</div>}
      <div className="font-semibold text-slate-800">{baht(Number(p.value ?? 0))} บาท</div>
    </div>
  )
}

/** Tooltip สินค้าขายดี — แสดงทั้งยอดขายและจำนวนชิ้น */
function TopTip({ active, payload }: TipProps) {
  const p = payload?.[0]
  if (!active || !p) return null
  const d = (p.payload ?? {}) as { name?: string; value?: number; qty?: number }
  return (
    <div className={TIP_CLS}>
      <div className="mb-0.5 text-xs text-slate-500">{d.name}</div>
      <div className="font-semibold text-slate-800">{baht(d.value ?? 0)} บาท</div>
      <div className="text-xs text-slate-500">{baht(d.qty ?? 0)} ชิ้น</div>
    </div>
  )
}

/** Tooltip สัดส่วน (โดนัท) — แสดงค่าและเปอร์เซ็นต์ */
function ShareTip({ active, payload, total }: TipProps & { total: number }) {
  const p = payload?.[0]
  if (!active || !p) return null
  const v = Number(p.value ?? 0)
  const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0'
  return (
    <div className={TIP_CLS}>
      <div className="mb-0.5 text-xs text-slate-500">{p.name}</div>
      <div className="font-semibold text-slate-800">
        {baht(v)} บาท <span className="font-normal text-slate-400">· {pct}%</span>
      </div>
    </div>
  )
}

/* =========================================================
   การ์ด KPI
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
   การ์ดโดนัท + คำอธิบายพร้อมตัวเลข (relief channel ของสีอ่อน)
   ========================================================= */

interface ShareDatum {
  name: string
  value: number
  color: string
  sub?: string
}

function DonutCard({
  title,
  data,
  centerLabel,
}: {
  title: string
  data: ShareDatum[]
  centerLabel: string
}) {
  const total = r2(data.reduce((s, d) => s + d.value, 0))
  return (
    <Card title={title}>
      {data.length === 0 ? (
        <EmptyState icon="tag" title="ไม่มีข้อมูล" />
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <div className="relative h-52 w-52 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={88}
                  paddingAngle={data.length > 1 ? 2 : 0}
                  startAngle={90}
                  endAngle={-270}
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} stroke="#ffffff" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<ShareTip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xs text-slate-400">{centerLabel}</span>
              <span className="text-lg font-bold text-slate-800">{baht(total)}</span>
            </div>
          </div>
          <div className="w-full min-w-0 flex-1 space-y-2.5">
            {data.map((d) => {
              const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0.0'
              return (
                <div key={d.name} className="flex items-center gap-2.5 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-slate-600">
                    {d.name}
                    {d.sub && <span className="text-xs text-slate-400"> · {d.sub}</span>}
                  </span>
                  <span className="font-semibold text-slate-800">{baht(d.value)}</span>
                  <span className="w-12 text-right text-xs text-slate-400">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

/* =========================================================
   หน้ารายงาน
   ========================================================= */

export default function Reports() {
  const [range, setRange] = useState<RangeKey>('d7')
  const [customFrom, setCustomFrom] = useState(() => dayKey(Date.now()))
  const [customTo, setCustomTo] = useState(() => dayKey(Date.now()))

  // ---- ช่วงเวลา [lo, hi] ----
  const { lo, hi } = useMemo(() => {
    const now = Date.now()
    switch (range) {
      case 'today':
        return { lo: startOfDay(now), hi: endOfDay(now) }
      case 'd7':
        return { lo: startOfDay(addDays(now, -6)), hi: endOfDay(now) }
      case 'd30':
        return { lo: startOfDay(addDays(now, -29)), hi: endOfDay(now) }
      case 'month': {
        const d = new Date(now)
        return { lo: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), hi: endOfDay(now) }
      }
      case 'custom': {
        const f = parseDay(customFrom) ?? startOfDay(now)
        const t = parseDay(customTo) ?? startOfDay(now)
        return { lo: startOfDay(Math.min(f, t)), hi: endOfDay(Math.max(f, t)) }
      }
    }
  }, [range, customFrom, customTo])

  // ---- ข้อมูล (reactive) ----
  const sales = useLiveQuery(
    () =>
      db.sales
        .where('createdAt')
        .between(lo, hi, true, true)
        .and((s) => s.status === 'completed')
        .toArray(),
    [lo, hi],
  )
  const products = useLiveQuery(() => db.products.toArray(), [])
  const categories = useLiveQuery(() => db.categories.toArray(), [])

  // ---- KPI ----
  const kpi = useMemo(() => {
    let salesTotal = 0
    let profit = 0
    for (const s of sales ?? []) {
      salesTotal += s.total
      // it.total หักเฉพาะส่วนลดรายบรรทัด — ต้องหักส่วนลดระดับบิลด้วย
      // (โปรบิล = promoDiscount รวม − โปรรายบรรทัด, ส่วนลดท้ายบิล, แลกแต้ม)
      let linePromo = 0
      for (const it of s.items) {
        profit += it.total - it.cost * it.qty
        linePromo += it.promoDiscount
      }
      profit -= s.promoDiscount - linePromo + s.billDiscount + s.pointDiscount
    }
    const bills = sales?.length ?? 0
    return {
      salesTotal: r2(salesTotal),
      profit: r2(profit),
      bills,
      avg: bills > 0 ? r2(salesTotal / bills) : 0,
    }
  }, [sales])

  // ---- ยอดขายรายวัน (bucket ครบทุกวัน วันไม่มียอด = 0) ----
  const daily = useMemo(() => {
    const sums = new Map<string, number>()
    for (const s of sales ?? []) {
      const k = dayKey(s.createdAt)
      sums.set(k, (sums.get(k) ?? 0) + s.total)
    }
    const out: { label: string; total: number }[] = []
    for (let t = startOfDay(lo); t <= hi && out.length < 400; t = addDays(t, 1)) {
      out.push({ label: dayLabel(t), total: r2(sums.get(dayKey(t)) ?? 0) })
    }
    return out
  }, [sales, lo, hi])

  // ---- สินค้าขายดี Top 10 (รวมกลุ่มตามชื่อ) ----
  const top = useMemo(() => {
    const m = new Map<string, { name: string; value: number; qty: number }>()
    for (const s of sales ?? []) {
      for (const it of s.items) {
        const g = m.get(it.name) ?? { name: it.name, value: 0, qty: 0 }
        g.value += it.total
        g.qty += it.qty
        m.set(it.name, g)
      }
    }
    return [...m.values()]
      .map((g) => ({ ...g, value: r2(g.value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [sales])

  // ---- สัดส่วนตามหมวดหมู่ (top 5 + รวมที่เหลือเป็น "อื่นๆ") ----
  const catShare = useMemo<ShareDatum[]>(() => {
    if (!products || !categories) return []
    const prodCat = new Map<number, number | undefined>()
    for (const p of products) if (p.id != null) prodCat.set(p.id, p.categoryId)
    const catName = new Map<number, string>()
    for (const c of categories) if (c.id != null) catName.set(c.id, c.name)

    const sums = new Map<string, number>()
    for (const s of sales ?? []) {
      for (const it of s.items) {
        // สินค้าโดนลบ / รายการกำหนดเอง (productId = 0) / ไม่มีหมวด → "อื่นๆ"
        const cid = prodCat.get(it.productId)
        const name = cid != null ? (catName.get(cid) ?? 'อื่นๆ') : 'อื่นๆ'
        sums.set(name, (sums.get(name) ?? 0) + it.total)
      }
    }
    const main = [...sums.entries()]
      .filter(([name]) => name !== 'อื่นๆ')
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
    let other = sums.get('อื่นๆ') ?? 0
    for (const x of main.slice(5)) other += x.value

    const out: ShareDatum[] = main.slice(0, 5).map((x, i) => ({
      name: x.name,
      value: r2(x.value),
      color: CAT_COLORS[i] ?? OTHER_COLOR,
    }))
    if (other > 0) out.push({ name: 'อื่นๆ', value: r2(other), color: OTHER_COLOR })
    return out
  }, [sales, products, categories])

  // ---- ช่องทางชำระเงิน ----
  const payShare = useMemo<ShareDatum[]>(() => {
    const sums: Record<PaymentMethod, { value: number; count: number }> = {
      cash: { value: 0, count: 0 },
      transfer: { value: 0, count: 0 },
      card: { value: 0, count: 0 },
    }
    for (const s of sales ?? []) {
      sums[s.paymentMethod].value += s.total
      sums[s.paymentMethod].count += 1
    }
    return (['cash', 'transfer', 'card'] as const)
      .filter((k) => sums[k].count > 0)
      .map((k) => ({
        name: PAY_LABEL[k],
        value: r2(sums[k].value),
        sub: `${sums[k].count} บิล`,
        color: PAY_COLORS[k],
      }))
  }, [sales])

  /* ---- ส่งออก CSV ---- */

  async function exportBills() {
    // บิลรวมทุกสถานะในช่วง (มีคอลัมน์สถานะกำกับ)
    const rows = await db.sales.where('createdAt').between(lo, hi, true, true).toArray()
    if (rows.length === 0) {
      toast.error('ไม่มีข้อมูลบิลในช่วงเวลาที่เลือก')
      return
    }
    rows.sort((a, b) => a.createdAt - b.createdAt)
    downloadCsv(`บิล_${dayKey(lo)}_${dayKey(hi)}.csv`, [
      ['เลขที่', 'วันที่', 'สมาชิก', 'จำนวนรายการ', 'ยอดรวม', 'ส่วนลดรวม', 'ยอดสุทธิ', 'ช่องทาง', 'สถานะ'],
      ...rows.map((s) => [
        s.receiptNo,
        fmtDateTime(s.createdAt),
        s.memberName ?? '-',
        s.items.length,
        r2(s.subtotal),
        r2(s.itemDiscount + s.promoDiscount + s.billDiscount + s.pointDiscount),
        r2(s.total),
        PAY_LABEL[s.paymentMethod],
        s.status === 'completed' ? 'สำเร็จ' : 'ยกเลิก',
      ]),
    ])
    toast.success(`ส่งออกบิล ${rows.length} รายการแล้ว`)
  }

  function exportItems() {
    if (!sales || sales.length === 0) {
      toast.error('ไม่มีข้อมูลการขายในช่วงเวลาที่เลือก')
      return
    }
    const body: (string | number)[][] = []
    for (const s of [...sales].sort((a, b) => a.createdAt - b.createdAt)) {
      for (const it of s.items) {
        body.push([
          s.receiptNo,
          fmtDateTime(s.createdAt),
          it.name,
          (it.options ?? []).join(', '),
          it.qty,
          r2(it.price),
          r2(it.manualDiscount + it.promoDiscount),
          r2(it.total),
        ])
      }
    }
    downloadCsv(`รายการสินค้า_${dayKey(lo)}_${dayKey(hi)}.csv`, [
      ['เลขที่บิล', 'วันที่', 'สินค้า', 'ตัวเลือก', 'จำนวน', 'ราคา/หน่วย', 'ส่วนลด', 'ยอดสุทธิ'],
      ...body,
    ])
    toast.success(`ส่งออกรายการสินค้า ${body.length} รายการแล้ว`)
  }

  const useBars = daily.length <= 31

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="รายงาน"
        subtitle="สรุปยอดขายและกราฟวิเคราะห์ตามช่วงเวลา"
        actions={
          <>
            <Button variant="secondary" icon="download" onClick={() => void exportBills()}>
              ส่งออกบิล CSV
            </Button>
            <Button variant="secondary" icon="download" onClick={exportItems}>
              ส่งออกรายการสินค้า CSV
            </Button>
          </>
        }
      />

      {/* ===== แถวเลือกช่วงเวลา (คุมทุกกราฟด้านล่าง) ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                range === r.key
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-40"
            />
            <span className="text-sm text-slate-400">ถึง</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-40"
            />
          </div>
        )}
        <span className="text-sm text-slate-400">
          {fmtDate(lo)} – {fmtDate(hi)}
        </span>
      </div>

      {sales === undefined ? (
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      ) : sales.length === 0 ? (
        <Card>
          <EmptyState
            icon="chart"
            title="ไม่มีข้อมูลการขายในช่วงเวลาที่เลือก"
            hint="ลองเปลี่ยนช่วงเวลา หรือเริ่มขายที่หน้าขายหน้าร้าน"
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {/* ===== KPI 4 ใบ ===== */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon="cash"
              tone="bg-emerald-50 text-emerald-600"
              label="ยอดขาย"
              value={baht(kpi.salesTotal)}
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
          </div>

          {/* ===== ยอดขายรายวัน ===== */}
          <Card title="ยอดขายรายวัน">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                {useBars ? (
                  <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                    <XAxis
                      dataKey="label"
                      tick={TICK}
                      tickLine={false}
                      axisLine={{ stroke: AXIS_STROKE }}
                      minTickGap={16}
                    />
                    <YAxis
                      width={48}
                      tick={TICK}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={compact}
                    />
                    <Tooltip
                      content={<MoneyTip />}
                      cursor={{ fill: 'rgba(100,116,139,0.08)' }}
                    />
                    <Bar dataKey="total" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </BarChart>
                ) : (
                  <LineChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                    <XAxis
                      dataKey="label"
                      tick={TICK}
                      tickLine={false}
                      axisLine={{ stroke: AXIS_STROKE }}
                      minTickGap={24}
                    />
                    <YAxis
                      width={48}
                      tick={TICK}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={compact}
                    />
                    <Tooltip
                      content={<MoneyTip />}
                      cursor={{ stroke: AXIS_STROKE, strokeWidth: 1 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke={BRAND}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
                    />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ===== สินค้าขายดี Top 10 ===== */}
          <Card title="สินค้าขายดี 10 อันดับ (ตามยอดขาย)">
            {top.length === 0 ? (
              <EmptyState icon="box" title="ไม่มีข้อมูลสินค้า" />
            ) : (
              <div style={{ height: top.length * 44 + 36 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={top}
                    layout="vertical"
                    margin={{ top: 0, right: 72, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
                    <XAxis
                      type="number"
                      tick={TICK}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={compact}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={132}
                      tick={TICK}
                      tickLine={false}
                      axisLine={{ stroke: AXIS_STROKE }}
                      tickFormatter={(v: string) => (v.length > 11 ? `${v.slice(0, 11)}…` : v)}
                    />
                    <Tooltip content={<TopTip />} cursor={{ fill: 'rgba(100,116,139,0.08)' }} />
                    <Bar dataKey="value" fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={22}>
                      <LabelList
                        dataKey="qty"
                        position="right"
                        fill="#64748b"
                        fontSize={11}
                        formatter={(v: unknown) => `${String(v)} ชิ้น`}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* ===== สัดส่วน 2 โดนัท ===== */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DonutCard title="สัดส่วนยอดขายตามหมวดหมู่" data={catShare} centerLabel="ยอดขายรวม" />
            <DonutCard title="ช่องทางชำระเงิน" data={payShare} centerLabel="ยอดชำระรวม" />
          </div>
        </div>
      )}
    </div>
  )
}
