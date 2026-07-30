import type { ComponentProps } from 'react'
import { EXPENSE_CATEGORIES, type Expense, type Sale } from '../../db/types'
import type { Badge } from '../../components/ui'
import { Icon, type IconName } from '../../components/ui'
import { r2 } from '../../lib/format'

/* =========================================================
   ค่าคงที่ของกราฟ (พาเลตชุดเดียวกับหน้ารายงาน — ผ่าน validator CVD/contrast แล้ว)
   ========================================================= */

/** สีประจำ series รายรับ (ผูกกับ entity คงที่ — คู่ income/expense ผ่าน all-pairs) */
export const INCOME_COLOR = '#1baf7a'
/** สีประจำ series รายจ่าย */
export const EXPENSE_COLOR = '#eb6834'
/** สีหมวดรายจ่ายตามลำดับ slot คงที่ (ตรวจ adjacent-pair แล้ว) */
export const CAT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
/** "อื่นๆ" ใช้สีเทา de-emphasis เสมอ */
export const OTHER_COLOR = '#94a3b8'

export const GRID_STROKE = '#e2e8f0' // เส้นกริด hairline (slate-200)
export const AXIS_STROKE = '#cbd5e1' // เส้นแกน (slate-300)
export const TICK = { fontSize: 12, fill: '#64748b' } // ตัวอักษรแกน (slate-500)

const COMPACT_FMT = new Intl.NumberFormat('th-TH', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
export const compact = (v: number) => COMPACT_FMT.format(v)

/** สีประจำหมวดรายจ่าย — ผูกกับหมวด (entity) ไม่ใช่อันดับ */
const CAT_COLOR_MAP = new Map<string, string>()
EXPENSE_CATEGORIES.forEach((name, i) => {
  CAT_COLOR_MAP.set(name, name === 'อื่นๆ' ? OTHER_COLOR : (CAT_COLORS[i] ?? OTHER_COLOR))
})
export const categoryColor = (name: string) => CAT_COLOR_MAP.get(name) ?? OTHER_COLOR

/** สี Badge ประจำหมวดรายจ่าย (ตกแต่งตาราง — ผูกกับหมวดคงที่) */
export type BadgeColor = NonNullable<ComponentProps<typeof Badge>['color']>
const CATEGORY_BADGE: Record<string, BadgeColor> = {
  'ค่าสินค้า / วัตถุดิบ': 'blue',
  'ค่าเช่า': 'amber',
  'เงินเดือน / ค่าแรง': 'green',
  'ค่าน้ำ / ค่าไฟ / เน็ต': 'blue',
  'ค่าการตลาด': 'amber',
  'ค่าอุปกรณ์ / ซ่อมบำรุง': 'green',
  'อื่นๆ': 'slate',
}
export const categoryBadge = (name: string): BadgeColor => CATEGORY_BADGE[name] ?? 'slate'

/* =========================================================
   Tooltip (recharts ส่ง active/payload/label เข้ามาให้เอง)
   ========================================================= */

export interface TipItem {
  name?: string | number
  value?: string | number
  color?: string
  payload?: Record<string, unknown>
}

export interface TipProps {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<TipItem>
}

export const TIP_CLS = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg'

/* =========================================================
   ตัวช่วยวันที่ของ input type="date"
   ========================================================= */

/** แปลงค่าจาก input type="date" (YYYY-MM-DD) เป็น timestamp เที่ยงคืน local */
export function parseDay(s: string): number | null {
  if (!s) return null
  const t = new Date(`${s}T00:00:00`).getTime()
  return Number.isNaN(t) ? null : t
}

/* =========================================================
   สูตรกลางของโมดูลบัญชี (บิลสำเร็จเท่านั้น — ช่วง [start, end] inclusive)
   ========================================================= */

export interface CategorySum {
  name: string
  value: number
}

/**
 * รายได้ของบิล (ไม่รวม VAT ที่บวกเพิ่ม) — s.total คือยอดที่ลูกค้าจ่ายจริง (payable)
 * เมื่อร้านตั้งค่า VAT แบบบวกเพิ่ม (vatIncluded=false) payable = net + vatAmount
 * จึงต้องหัก vatAmount ออกเพื่อให้ตรงกับสูตรกำไรของหน้า Reports/Dashboard
 * (Σ it.total − cost·qty − ส่วนลดระดับบิล = net − cogs)
 */
export const saleRevenue = (s: Sale) => (s.vatIncluded ? s.total : r2(s.total - s.vatAmount))

export interface FinanceSummary {
  /** รายได้ (ยอดขายสุทธิ ไม่รวม VAT ที่บวกเพิ่ม) = Σ saleRevenue(s) */
  revenue: number
  /** ต้นทุนขาย = Σ it.cost × it.qty */
  cogs: number
  /** กำไรขั้นต้น = รายได้ − ต้นทุนขาย */
  gross: number
  /** รายจ่ายรวม = Σ e.amount */
  expenseTotal: number
  /** กำไรสุทธิ = กำไรขั้นต้น − รายจ่ายรวม */
  net: number
  /** ภาษีขาย = Σ s.vatAmount */
  salesVat: number
  /** จำนวนบิลที่มี VAT */
  vatBillCount: number
  /** ภาษีซื้อ = Σ e.vatAmount เฉพาะรายการที่มีใบกำกับ */
  purchaseVat: number
  /** จำนวนรายการรายจ่ายที่มีใบกำกับ */
  vatExpenseCount: number
  /** ภาษีที่ต้องนำส่ง = ภาษีขาย − ภาษีซื้อ */
  vatDue: number
  /** รายจ่ายแยกตามหมวด (เรียงตามลำดับหมวดมาตรฐาน) */
  byCategory: CategorySum[]
}

export function calcFinance(sales: Sale[], expenses: Expense[]): FinanceSummary {
  let revenue = 0
  let cogs = 0
  let salesVat = 0
  let vatBillCount = 0
  for (const s of sales) {
    revenue += saleRevenue(s)
    salesVat += s.vatAmount
    if (s.vatAmount > 0) vatBillCount += 1
    for (const it of s.items) cogs += it.cost * it.qty
  }

  let expenseTotal = 0
  let purchaseVat = 0
  let vatExpenseCount = 0
  const catSums = new Map<string, number>()
  for (const e of expenses) {
    expenseTotal += e.amount
    catSums.set(e.category, (catSums.get(e.category) ?? 0) + e.amount)
    if (e.hasVatInvoice) {
      purchaseVat += e.vatAmount
      vatExpenseCount += 1
    }
  }

  // หมวดมาตรฐานตามลำดับคงที่ก่อน แล้วต่อท้ายหมวดอื่นที่ไม่รู้จัก (มาก → น้อย)
  const byCategory: CategorySum[] = []
  for (const name of EXPENSE_CATEGORIES) {
    const v = catSums.get(name)
    if (v != null && v > 0) {
      byCategory.push({ name, value: r2(v) })
      catSums.delete(name)
    }
  }
  const rest = [...catSums.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  for (const [name, v] of rest) byCategory.push({ name, value: r2(v) })

  revenue = r2(revenue)
  cogs = r2(cogs)
  expenseTotal = r2(expenseTotal)
  salesVat = r2(salesVat)
  purchaseVat = r2(purchaseVat)
  const gross = r2(revenue - cogs)
  return {
    revenue,
    cogs,
    gross,
    expenseTotal,
    net: r2(gross - expenseTotal),
    salesVat,
    vatBillCount,
    purchaseVat,
    vatExpenseCount,
    vatDue: r2(salesVat - purchaseVat),
    byCategory,
  }
}

/* =========================================================
   ชิ้นส่วน UI ที่ใช้ร่วมกันในโมดูลบัญชี
   ========================================================= */

/** การ์ด KPI (สไตล์เดียวกับหน้ารายงาน) */
export function StatCard({
  icon,
  tone,
  label,
  value,
  unit,
  sub,
  valueCls = 'text-slate-800',
}: {
  icon: IconName
  tone: string
  label: string
  value: string
  unit: string
  sub?: string
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
          {sub && <div className="text-xs text-slate-400">{sub}</div>}
        </div>
      </div>
    </div>
  )
}

/** ชิปสรุปเหนือตาราง (สไตล์เดียวกับหน้าประวัติการขาย) */
export function SummaryChip({
  icon,
  label,
  value,
  unit,
}: {
  icon: IconName
  label: string
  value: string
  unit: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
        <Icon name={icon} size={16} />
      </span>
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-bold text-slate-800">
        {value} <span className="font-normal text-slate-400">{unit}</span>
      </span>
    </div>
  )
}
