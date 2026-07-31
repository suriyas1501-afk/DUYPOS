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
import type { PaymentMethod, Sale } from '../db/types'
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
import { saleAmountByMethod, saleCogs, saleRevenue } from '../lib/checkout'

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

/** ช่องทางชำระเงินตามลำดับคงที่ */
const PAY_METHODS = ['cash', 'transfer', 'card'] as const

const GRID_STROKE = '#e2e8f0' // เส้นกริด hairline (slate-200)
const AXIS_STROKE = '#cbd5e1' // เส้นแกน (slate-300)
const TICK = { fontSize: 12, fill: '#64748b' } // ตัวอักษรแกน (slate-500)

const COMPACT_FMT = new Intl.NumberFormat('th-TH', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const compact = (v: number) => COMPACT_FMT.format(v)

/** จำนวนสินค้า — อาจเป็นทศนิยม (เช่น 0.5 กก.) ห้ามปัดทิ้ง */
const qtyText = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 })

/** เอกสารคืนสินค้า: ยอดทุกช่องติดลบ → Σ หักกลบเอง แต่ห้ามนับเป็นจำนวนบิล */
const isRefundDoc = (s: Sale) => s.kind === 'refund'

/** ช่องทางที่ใช้จ่ายในบิล (รองรับจ่ายผสม + บิลเก่าที่ยังไม่มี payments[]) */
function saleMethods(s: Sale): PaymentMethod[] {
  const src =
    s.payments && s.payments.length > 0 ? s.payments.map((p) => p.method) : [s.paymentMethod]
  return PAY_METHODS.filter((m) => src.includes(m))
}

/** ป้ายช่องทางชำระของบิล เช่น "เงินสด+โอน / QR" */
const payMethodsLabel = (s: Sale) =>
  saleMethods(s)
    .map((m) => PAY_LABEL[m])
    .join('+')

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
      <div className="text-xs text-slate-500">{qtyText(d.qty ?? 0)} ชิ้น (สุทธิหลังคืนสินค้า)</div>
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
  note,
}: {
  title: string
  data: ShareDatum[]
  centerLabel: string
  /** คำอธิบายวิธีนับใต้กราฟ (เช่น การนับบิลของบิลจ่ายผสม) */
  note?: string
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
            {note && <p className="pt-1 text-xs text-slate-400">{note}</p>}
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
    let revenue = 0
    let cogs = 0
    let bills = 0
    let refundCount = 0
    let refundTotal = 0
    let couponTotal = 0
    for (const s of sales ?? []) {
      // เอกสารคืนสินค้ามียอดติดลบทุกช่อง → Σ หักกลบเองอัตโนมัติ
      // แต่ต้องไม่นับเป็นจำนวนบิล ไม่งั้น "เฉลี่ยต่อบิล" จะผิด
      if (isRefundDoc(s)) {
        refundCount += 1
        refundTotal += Math.abs(s.total)
      } else {
        bills += 1
      }
      salesTotal += s.total
      couponTotal += s.couponDiscount ?? 0
      // กำไรขั้นต้น = รายได้ − ต้นทุนขาย (สูตร/ลำดับการปัดเศษเดียวกับ accounting/calcFinance)
      // ส่วนลดทุกชนิดถูกหักอยู่ใน s.total แล้ว จึงห้ามหักย้อนกลับจาก Σ it.total อีก
      revenue += saleRevenue(s)
      cogs += saleCogs(s)
    }
    return {
      salesTotal: r2(salesTotal),
      profit: r2(r2(revenue) - r2(cogs)),
      bills,
      avg: bills > 0 ? r2(salesTotal / bills) : 0,
      refundCount,
      refundTotal: r2(refundTotal),
      couponTotal: r2(couponTotal),
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
      // รวมรายการของเอกสารคืนสินค้าด้วย (qty/total ติดลบ) เพื่อให้ยอดสุทธิถูก
      for (const it of s.items) {
        const g = m.get(it.name) ?? { name: it.name, value: 0, qty: 0 }
        g.value += it.total
        g.qty += it.qty
        m.set(it.name, g)
      }
    }
    return [...m.values()]
      .map((g) => ({ ...g, value: r2(g.value), qty: r2(g.qty) }))
      // สินค้าที่ถูกคืนจนยอดสุทธิ ≤ 0 ตัดออก — แท่งติดลบทำให้อ่านกราฟผิด
      .filter((g) => g.value > 0)
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
      // รวมรายการของเอกสารคืนสินค้าด้วย (total ติดลบ) เพื่อให้ยอดสุทธิของหมวดถูก
      for (const it of s.items) {
        // สินค้าโดนลบ / รายการกำหนดเอง (productId = 0) / ไม่มีหมวด → "อื่นๆ"
        const cid = prodCat.get(it.productId)
        const name = cid != null ? (catName.get(cid) ?? 'อื่นๆ') : 'อื่นๆ'
        sums.set(name, (sums.get(name) ?? 0) + it.total)
      }
    }
    // โดนัทวาดสัดส่วนติดลบไม่ได้ — หมวดที่ยอดสุทธิ ≤ 0 (ถูกคืนหมด) ตัดออกก่อน
    const positive = [...sums.entries()]
      .map(([name, value]) => ({ name, value: r2(value) }))
      .filter((x) => x.value > 0)
    const main = positive
      .filter((x) => x.name !== 'อื่นๆ')
      .sort((a, b) => b.value - a.value)
    let other = positive.find((x) => x.name === 'อื่นๆ')?.value ?? 0
    for (const x of main.slice(5)) other += x.value

    const out: ShareDatum[] = main.slice(0, 5).map((x, i) => ({
      name: x.name,
      value: r2(x.value),
      color: CAT_COLORS[i] ?? OTHER_COLOR,
    }))
    if (other > 0) out.push({ name: 'อื่นๆ', value: r2(other), color: OTHER_COLOR })
    return out
  }, [sales, products, categories])

  // ---- ช่องทางชำระเงิน (รองรับบิลจ่ายผสม) ----
  const payShare = useMemo<ShareDatum[]>(() => {
    const sums: Record<PaymentMethod, { value: number; count: number }> = {
      cash: { value: 0, count: 0 },
      transfer: { value: 0, count: 0 },
      card: { value: 0, count: 0 },
    }
    for (const s of sales ?? []) {
      // ยอดต่อช่องทางจาก saleAmountByMethod: หักเงินทอนจากเงินสด รองรับบิลเก่า
      // และเอกสารคืนสินค้า (ก้อนติดลบ) หักออกให้เองอัตโนมัติ
      for (const k of PAY_METHODS) sums[k].value += saleAmountByMethod(s, k)
      // จำนวนบิลนับตามก้อนที่จ่าย — บิลจ่ายผสมนับในทุกช่องทางที่ใช้, เอกสารคืนไม่นับ
      if (!isRefundDoc(s)) for (const k of saleMethods(s)) sums[k].count += 1
    }
    return PAY_METHODS.map((k) => ({ k, ...sums[k] }))
      // สัดส่วนติดลบวาดในโดนัทไม่ได้ — ช่องทางที่ยอดสุทธิ ≤ 0 ตัดออก
      .filter((x) => r2(x.value) > 0)
      .map((x) => ({
        name: PAY_LABEL[x.k],
        value: r2(x.value),
        sub: `${x.count} บิล`,
        color: PAY_COLORS[x.k],
      }))
  }, [sales])

  // ---- ยอดขายแยกตามพนักงาน (เฉพาะเมื่อเปิดระบบพนักงาน / มีบิลที่บันทึกชื่อผู้ขายไว้) ----
  const byStaff = useMemo(() => {
    const m = new Map<string, { name: string; total: number; bills: number; refunds: number }>()
    for (const s of sales ?? []) {
      // บิลก่อนเปิดระบบพนักงานไม่มีชื่อผู้ขาย → รวมเป็น "ไม่ระบุพนักงาน"
      const name = s.staffName?.trim() || 'ไม่ระบุพนักงาน'
      const g = m.get(name) ?? { name, total: 0, bills: 0, refunds: 0 }
      g.total += s.total
      if (isRefundDoc(s)) g.refunds += 1
      else g.bills += 1
      m.set(name, g)
    }
    return [...m.values()]
      .map((g) => ({ ...g, total: r2(g.total) }))
      .sort((a, b) => b.total - a.total)
  }, [sales])

  /** มีบิลที่ระบุพนักงานจริงหรือไม่ — ถ้าไม่มีเลยก็ไม่ต้องโชว์การ์ดนี้ให้เกะกะ */
  const hasStaffData = byStaff.some((g) => g.name !== 'ไม่ระบุพนักงาน')

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
      [
        'เลขที่',
        'ประเภท',
        'วันที่',
        'สมาชิก',
        'จำนวนรายการ',
        'ยอดรวม',
        'ส่วนลดรวม',
        'ส่วนลดคูปอง',
        'โค้ดคูปอง',
        'ยอดสุทธิ',
        'ช่องทาง',
        'อ้างอิงบิล',
        'สถานะ',
      ],
      ...rows.map((s) => [
        s.receiptNo,
        isRefundDoc(s) ? 'คืนสินค้า' : 'บิลขาย',
        fmtDateTime(s.createdAt),
        s.memberName ?? '-',
        s.items.length,
        r2(s.subtotal),
        r2(
          s.itemDiscount +
            s.promoDiscount +
            s.billDiscount +
            (s.couponDiscount ?? 0) +
            s.pointDiscount,
        ),
        r2(s.couponDiscount ?? 0),
        s.couponCode ?? '',
        r2(s.total),
        payMethodsLabel(s),
        s.refOriginalNo ?? '',
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
      // เอกสารคืนสินค้ารวมอยู่ด้วย (จำนวน/ยอดติดลบ) → Σ ในไฟล์หักกลบเองถูกต้อง
      for (const it of s.items) {
        body.push([
          s.receiptNo,
          isRefundDoc(s) ? 'คืนสินค้า' : 'บิลขาย',
          fmtDateTime(s.createdAt),
          it.name,
          it.unitName ?? '',
          (it.options ?? []).join(', '),
          it.qty,
          r2(it.price),
          r2(it.manualDiscount + it.promoDiscount),
          r2(it.total),
        ])
      }
    }
    downloadCsv(`รายการสินค้า_${dayKey(lo)}_${dayKey(hi)}.csv`, [
      [
        'เลขที่บิล',
        'ประเภท',
        'วันที่',
        'สินค้า',
        'หน่วย',
        'ตัวเลือก',
        'จำนวน',
        'ราคา/หน่วย',
        'ส่วนลด',
        'ยอดสุทธิ',
      ],
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
          {/* ===== แถบสรุปคืนสินค้า / คูปอง (แสดงเมื่อมีจริงในช่วงนั้น) ===== */}
          {(kpi.refundCount > 0 || kpi.couponTotal !== 0) && (
            <div className="flex flex-wrap gap-3">
              {kpi.refundCount > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                  <Icon name="undo" size={16} />
                  <span>
                    คืนสินค้า <span className="font-bold">{baht(kpi.refundCount)}</span> รายการ
                  </span>
                  <span className="font-bold">(-฿{baht(kpi.refundTotal)})</span>
                  <span className="text-xs text-rose-500">
                    · หักออกจากยอดขาย กำไร และทุกกราฟในหน้านี้แล้ว (ไม่นับเป็นจำนวนบิล)
                  </span>
                </div>
              )}
              {kpi.couponTotal !== 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-700">
                  <Icon name="ticket" size={16} />
                  <span>ส่วนลดคูปอง</span>
                  <span className="font-bold">฿{baht(kpi.couponTotal)}</span>
                  <span className="text-xs text-violet-500">· หักจากกำไรขั้นต้นแล้ว</span>
                </div>
              )}
            </div>
          )}

          {/* ===== KPI 4 ใบ ===== */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon="cash"
              tone="bg-emerald-50 text-emerald-600"
              label={kpi.refundCount > 0 ? 'ยอดขายสุทธิ' : 'ยอดขาย'}
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
            {/* หมายเหตุ: จำนวนบิลไม่นับเอกสารคืนสินค้า จึงทำให้เฉลี่ยต่อบิลไม่เพี้ยน */}
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
          <Card
            title={`สินค้าขายดี 10 อันดับ (ตามยอดขาย${kpi.refundCount > 0 ? 'สุทธิ' : ''})`}
          >
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
                        formatter={(v: unknown) => `${qtyText(Number(v ?? 0))} ชิ้น`}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* ===== ยอดขายแยกตามพนักงาน ===== */}
          {hasStaffData && (
            <Card title={`ยอดขายแยกตามพนักงาน${kpi.refundCount > 0 ? ' (สุทธิ)' : ''}`}>
              <div className="space-y-2 text-sm">
                {byStaff.map((g) => {
                  const share = kpi.salesTotal > 0 ? (g.total / kpi.salesTotal) * 100 : 0
                  return (
                    <div key={g.name} className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-xs font-bold text-emerald-700">
                        {Array.from(g.name.trim())[0] ?? '?'}
                      </span>
                      <span className="w-32 shrink-0 truncate font-medium text-slate-700">
                        {g.name}
                      </span>
                      <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
                        {g.bills} บิล
                        {g.refunds > 0 && ` · คืน ${g.refunds}`}
                      </span>
                      {/* แถบสัดส่วน — ยอดติดลบ (คืนมากกว่าขาย) ไม่วาดแถบ */}
                      <span className="hidden h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 sm:block">
                        <span
                          className="block h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
                        />
                      </span>
                      <span
                        className={`ml-auto shrink-0 font-semibold ${
                          g.total < 0 ? 'text-rose-600' : 'text-slate-800'
                        }`}
                      >
                        ฿{baht(g.total)}
                      </span>
                      <span className="w-12 shrink-0 text-right text-xs text-slate-400">
                        {share > 0 ? `${share.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* ===== สัดส่วน 2 โดนัท ===== */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DonutCard
              title="สัดส่วนยอดขายตามหมวดหมู่"
              data={catShare}
              centerLabel="ยอดขายรวม"
              note={
                kpi.refundCount > 0
                  ? 'ยอดสุทธิหลังหักคืนสินค้าแล้ว — หมวดที่ถูกคืนจนเหลือ 0 หรือติดลบจะไม่แสดง'
                  : undefined
              }
            />
            <DonutCard
              title="ช่องทางชำระเงิน"
              data={payShare}
              centerLabel="ยอดชำระรวม"
              note="ยอดคิดตามก้อนที่จ่ายจริง (หักเงินทอนจากเงินสดและหักคืนเงินแล้ว) — บิลจ่ายผสมจะถูกนับจำนวนบิลในทุกช่องทางที่ใช้"
            />
          </div>
        </div>
      )}
    </div>
  )
}
