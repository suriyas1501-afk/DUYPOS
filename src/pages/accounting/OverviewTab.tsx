import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Expense, Sale } from '../../db/types'
import { Card, EmptyState, Spinner } from '../../components/ui'
import { addDays, baht, dayKey, dayLabel, money, r2, startOfDay } from '../../lib/format'
import {
  AXIS_STROKE,
  EXPENSE_COLOR,
  GRID_STROKE,
  INCOME_COLOR,
  TICK,
  TIP_CLS,
  PURCHASE_CATEGORY,
  RefundBanner,
  calcFinance,
  categoryColor,
  compact,
  saleRevenue,
  type TipProps,
} from './shared'

/* =========================================================
   Tooltip แบบ 2 series (รายรับ / รายจ่าย)
   ========================================================= */

function DuoTip({ active, payload, label }: TipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className={`${TIP_CLS} min-w-40`}>
      {label != null && <div className="mb-1 text-xs text-slate-500">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: p.color ?? '#64748b' }}
          />
          <span className="text-xs text-slate-500">{p.name}</span>
          <span className="ml-auto font-semibold text-slate-800">
            {baht(Number(p.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  )
}

/* =========================================================
   บรรทัดงบกำไรขาดทุน
   ========================================================= */

function PnlRow({
  label,
  value,
  deduct = false,
  indent = false,
  strong = false,
  divider = false,
  big = false,
}: {
  label: string
  value: number
  /** บรรทัด "หัก …" — แสดงวงเล็บสีแดงแบบงบบัญชี */
  deduct?: boolean
  indent?: boolean
  strong?: boolean
  divider?: boolean
  big?: boolean
}) {
  const negative = value < 0
  // บรรทัด "หัก …" ที่ค่าติดลบ = ได้กลับคืน (เช่น เอกสารคืนสินค้าคืนต้นทุน/คูปองกลับ)
  // แสดงเป็นเครดิตสีเขียวเพื่อไม่ให้อ่านสลับกับรายการที่หักออกจริง
  const numCls = deduct
    ? negative
      ? 'text-emerald-600'
      : 'text-rose-600'
    : negative
      ? 'text-rose-600'
      : big
        ? 'text-emerald-600'
        : 'text-slate-800'
  return (
    <div
      className={`flex items-center justify-between gap-4 py-1 ${
        divider ? 'mt-1 border-t border-slate-100 pt-2' : ''
      }`}
    >
      <span
        className={`${indent ? 'pl-4' : ''} ${
          strong ? 'font-bold text-slate-800' : 'text-slate-600'
        } ${big ? 'text-base' : ''}`}
      >
        {label}
      </span>
      <span
        className={`tabular-nums ${strong ? 'font-bold' : 'font-medium'} ${
          big ? 'text-lg' : ''
        } ${numCls}`}
      >
        {deduct
          ? negative
            ? `(-${money(Math.abs(value))})`
            : `(${money(value)})`
          : negative
            ? `-${money(Math.abs(value))}`
            : money(value)}
      </span>
    </div>
  )
}

/* =========================================================
   แท็บภาพรวม — งบกำไรขาดทุน + กราฟ
   ========================================================= */

const MONTH_FMT = new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit' })
const monthKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}`
}

export default function OverviewTab({
  sales,
  expenses,
  lo,
  hi,
}: {
  sales: Sale[] | undefined
  expenses: Expense[] | undefined
  lo: number
  hi: number
}) {
  const fin = useMemo(() => calcFinance(sales ?? [], expenses ?? []), [sales, expenses])
  /** หมวดรายจ่ายที่หักหลังกำไรขั้นต้น — ไม่รวมค่าซื้อสินค้าเข้าสต็อก (รับรู้เป็นต้นทุนขายแล้ว) */
  const opCategories = useMemo(
    () => fin.byCategory.filter((c) => c.name !== PURCHASE_CATEGORY),
    [fin.byCategory],
  )

  // ---- bucket รายรับ/รายจ่าย (ช่วง ≤ 31 วัน = รายวัน, ยาวกว่านั้น = รายเดือน) ----
  const dayCount = Math.round((startOfDay(hi) - startOfDay(lo)) / 86400000) + 1
  const dailyBucket = dayCount <= 31

  const buckets = useMemo(() => {
    const keyOf = dailyBucket ? dayKey : monthKey
    const income = new Map<string, number>()
    const expense = new Map<string, number>()
    for (const s of sales ?? []) {
      const k = keyOf(s.createdAt)
      // ใช้รายได้ไม่รวม VAT ที่บวกเพิ่ม — ค่าเดียวกับ fin.revenue ใน KPI/งบกำไรขาดทุน
      income.set(k, (income.get(k) ?? 0) + saleRevenue(s))
    }
    for (const e of expenses ?? []) {
      const k = keyOf(e.date)
      expense.set(k, (expense.get(k) ?? 0) + e.amount)
    }
    const out: { label: string; income: number; expense: number }[] = []
    if (dailyBucket) {
      for (let t = startOfDay(lo); t <= hi && out.length < 400; t = addDays(t, 1)) {
        const k = dayKey(t)
        out.push({
          label: dayLabel(t),
          income: r2(income.get(k) ?? 0),
          expense: r2(expense.get(k) ?? 0),
        })
      }
    } else {
      const first = new Date(lo)
      let d = new Date(first.getFullYear(), first.getMonth(), 1)
      while (d.getTime() <= hi && out.length < 120) {
        const k = monthKey(d.getTime())
        out.push({
          label: MONTH_FMT.format(d),
          income: r2(income.get(k) ?? 0),
          expense: r2(expense.get(k) ?? 0),
        })
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      }
    }
    return out
  }, [sales, expenses, lo, hi, dailyBucket])

  if (sales === undefined || expenses === undefined) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    )
  }

  if (sales.length === 0 && expenses.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="wallet"
          title="ไม่มีข้อมูลรายรับ-รายจ่ายในช่วงเวลาที่เลือก"
          hint="ลองเปลี่ยนช่วงเวลา หรือบันทึกรายจ่ายที่แท็บรายจ่าย"
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* ===== แจ้งเตือนเมื่อช่วงนี้มีเอกสารคืนสินค้า (ยอดหักกลบให้แล้ว) ===== */}
      <RefundBanner
        count={fin.refundCount}
        total={fin.refundTotal}
        note="หักออกจากรายได้ ต้นทุนขาย และกำไรในงบนี้แล้ว"
      />

      {/* ===== KPI 4 ใบ ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="รายได้"
          value={fin.revenue}
          dot={INCOME_COLOR}
          sub={fin.billCount > 0 ? `จาก ${fin.billCount.toLocaleString('th-TH')} บิล` : undefined}
        />
        <KpiCard
          label="รายจ่าย"
          value={fin.expenseTotal}
          dot={EXPENSE_COLOR}
          sub={
            fin.purchaseTotal > 0
              ? `รวมค่าซื้อสินค้าเข้าสต็อก ${baht(fin.purchaseTotal)} (ไม่หักซ้ำในกำไรสุทธิ)`
              : undefined
          }
        />
        <KpiCard label="กำไรขั้นต้น" value={fin.gross} redIfNegative />
        <KpiCard label="กำไรสุทธิ" value={fin.net} redIfNegative emphasize />
      </div>

      {/* ===== กราฟรายรับ vs รายจ่าย ===== */}
      <Card
        title={`รายรับ vs รายจ่าย (${dailyBucket ? 'รายวัน' : 'รายเดือน'})`}
        actions={
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: INCOME_COLOR }}
              />
              รายรับ
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: EXPENSE_COLOR }}
              />
              รายจ่าย
            </span>
          </div>
        }
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              <Tooltip content={<DuoTip />} cursor={{ fill: 'rgba(100,116,139,0.08)' }} />
              <Bar
                dataKey="income"
                name="รายรับ"
                fill={INCOME_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={18}
              />
              <Bar
                dataKey="expense"
                name="รายจ่าย"
                fill={EXPENSE_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={18}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ===== งบกำไรขาดทุน ===== */}
        <Card title="งบกำไรขาดทุน">
          <div className="text-sm">
            {fin.couponDiscount !== 0 ? (
              /* มีการใช้คูปองในช่วงนี้ — แยกให้เห็นว่าส่วนลดคูปองหักจากยอดขายไปเท่าไร */
              <>
                <PnlRow label="ยอดขายก่อนหักคูปอง" value={r2(fin.revenue + fin.couponDiscount)} />
                <PnlRow label="หัก ส่วนลดคูปอง" value={fin.couponDiscount} deduct indent />
                <PnlRow label="รายได้จากการขาย" value={fin.revenue} divider />
              </>
            ) : (
              <PnlRow label="รายได้จากการขาย" value={fin.revenue} />
            )}
            {fin.refundCount > 0 && (
              <div className="py-0.5 pl-4 text-xs text-rose-500">
                หักคืนสินค้า {fin.refundCount.toLocaleString('th-TH')} รายการ (-
                {money(fin.refundTotal)}) ไว้ในรายได้และต้นทุนขายแล้ว
              </div>
            )}
            <PnlRow label="หัก ต้นทุนขาย" value={fin.cogs} deduct />
            <PnlRow label="กำไรขั้นต้น" value={fin.gross} strong divider />
            {opCategories.map((c) => (
              <PnlRow key={c.name} label={`หัก ${c.name}`} value={c.value} deduct indent />
            ))}
            {opCategories.length === 0 && (
              <div className="py-1 pl-4 text-xs text-slate-400">
                — ไม่มีรายจ่ายดำเนินงานในช่วงนี้ —
              </div>
            )}
            <PnlRow label="กำไรสุทธิ" value={fin.net} strong divider big />
            {fin.purchaseTotal > 0 && (
              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                <b className="text-slate-600">บันทึกความจำ:</b> ซื้อสินค้าเข้าสต็อกในช่วงนี้{' '}
                {money(fin.purchaseTotal)} บาท — ไม่หักในกำไรสุทธิ เพราะต้นทุนก้อนนี้ถูกหักไปแล้วในรูป
                “ต้นทุนขาย” ตอนขายสินค้าออกไป (หักสองรอบจะทำให้กำไรต่ำกว่าความจริง)
              </div>
            )}
          </div>
        </Card>

        {/* ===== สัดส่วนรายจ่ายตามหมวด ===== */}
        <Card title="สัดส่วนรายจ่ายตามหมวด">
          {fin.byCategory.length === 0 ? (
            <EmptyState icon="wallet" title="ไม่มีรายจ่ายในช่วงเวลาที่เลือก" />
          ) : (
            <div className="space-y-4">
              {/* แถบสัดส่วน (เว้นช่อง 2px ระหว่าง segment) */}
              <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full">
                {fin.byCategory.map((c) => (
                  <div
                    key={c.name}
                    title={`${c.name} · ${baht(c.value)} บาท`}
                    style={{
                      backgroundColor: categoryColor(c.name),
                      width: `${fin.expenseTotal > 0 ? (c.value / fin.expenseTotal) * 100 : 0}%`,
                      minWidth: 4,
                    }}
                  />
                ))}
              </div>
              {/* คำอธิบายพร้อมตัวเลข (relief channel ของสีอ่อน) */}
              <div className="space-y-2.5">
                {fin.byCategory.map((c) => {
                  const pct =
                    fin.expenseTotal > 0
                      ? ((c.value / fin.expenseTotal) * 100).toFixed(1)
                      : '0.0'
                  return (
                    <div key={c.name} className="flex items-center gap-2.5 text-sm">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: categoryColor(c.name) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-600">{c.name}</span>
                      <span className="font-semibold text-slate-800">{baht(c.value)}</span>
                      <span className="w-12 text-right text-xs text-slate-400">{pct}%</span>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
                  <span className="font-bold text-slate-700">รายจ่ายรวม</span>
                  <span className="font-bold text-slate-800">{baht(fin.expenseTotal)} บาท</span>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/** การ์ด KPI ของแท็บภาพรวม (จุดสีผูกกับ series ในกราฟ) */
function KpiCard({
  label,
  value,
  dot,
  sub,
  redIfNegative = false,
  emphasize = false,
}: {
  label: string
  value: number
  dot?: string
  sub?: string
  redIfNegative?: boolean
  emphasize?: boolean
}) {
  const negative = redIfNegative && value < 0
  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        emphasize ? 'border-emerald-200 ring-1 ring-emerald-100' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {dot && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />}
        {label}
      </div>
      <div
        className={`mt-1 truncate text-2xl font-bold ${
          negative ? 'text-rose-600' : emphasize && value > 0 ? 'text-emerald-600' : 'text-slate-800'
        }`}
      >
        {value < 0 ? `-${baht(Math.abs(value))}` : baht(value)}{' '}
        <span className="text-sm font-normal text-slate-400">บาท</span>
      </div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  )
}
