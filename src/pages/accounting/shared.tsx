import type { ComponentProps } from 'react'
import { EXPENSE_CATEGORIES, type Expense, type PaymentMethod, type Sale } from '../../db/types'
import type { Badge } from '../../components/ui'
import { Icon, type IconName } from '../../components/ui'
import { baht, r2 } from '../../lib/format'
import { PAY_LABEL } from '../../lib/receipt'
import { saleCogs, saleRevenue } from '../../lib/checkout'

export { saleRevenue }

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

/** ช่องทางชำระเงินทั้งหมด (ลำดับคงที่ใช้ในทุกตาราง/กราฟ) */
export const PAY_METHODS = ['cash', 'transfer', 'card'] as const

/**
 * เอกสารคืนสินค้า — ยอดทุกช่องติดลบ (total / vatAmount / items[].qty,total)
 * ดังนั้น Σ ตามปกติจะหักกลบให้เองอัตโนมัติ ห้าม Math.abs และห้ามกรองทิ้ง
 * แต่ **ห้ามนับเป็นจำนวนบิล** ไม่งั้น "เฉลี่ยต่อบิล" จะผิด
 */
export const isRefundDoc = (s: Sale) => s.kind === 'refund'

/** ช่องทางที่ใช้จ่ายในบิล (รองรับจ่ายผสม + บิลเก่าที่ยังไม่มี payments[]) */
export function saleMethods(s: Sale): PaymentMethod[] {
  const src =
    s.payments && s.payments.length > 0 ? s.payments.map((p) => p.method) : [s.paymentMethod]
  return PAY_METHODS.filter((m) => src.includes(m))
}

/** ป้ายช่องทางชำระของบิล เช่น "เงินสด+โอน / QR" */
export const payMethodsLabel = (s: Sale) =>
  saleMethods(s)
    .map((m) => PAY_LABEL[m])
    .join('+')

/**
 * หมวดรายจ่าย "ซื้อสินค้าเข้าสต็อก" (หน้ารับของเข้าสร้างให้อัตโนมัติ)
 * เงินก้อนนี้คือการแปลงเงินเป็นสินค้าคงคลัง ไม่ใช่ค่าใช้จ่ายของงวด —
 * ต้นทุนจะถูกรับรู้เป็น "ต้นทุนขาย" ตอนขายสินค้าออกไป จึงห้ามหักซ้ำในกำไรสุทธิ
 */
export const PURCHASE_CATEGORY: string = EXPENSE_CATEGORIES[0]

export interface FinanceSummary {
  /** รายได้ (ยอดขายสุทธิ ไม่รวม VAT ที่บวกเพิ่ม หักเอกสารคืนสินค้าแล้ว) = Σ saleRevenue(s) */
  revenue: number
  /** ต้นทุนขาย = Σ it.cost × it.qty (เอกสารคืน qty ติดลบ → คืนต้นทุนกลับ) */
  cogs: number
  /** กำไรขั้นต้น = รายได้ − ต้นทุนขาย */
  gross: number
  /** รายจ่ายรวม = Σ e.amount (เงินที่จ่ายออกจริงทั้งหมด รวมค่าซื้อสินค้าเข้าสต็อก) */
  expenseTotal: number
  /** ค่าซื้อสินค้าเข้าสต็อก (หมวด PURCHASE_CATEGORY) — ไม่หักในกำไรสุทธิ เพราะรับรู้เป็นต้นทุนขายแล้ว */
  purchaseTotal: number
  /** รายจ่ายดำเนินงาน = รายจ่ายรวม − ค่าซื้อสินค้าเข้าสต็อก (ตัวที่หักจากกำไรขั้นต้น) */
  operatingExpense: number
  /** กำไรสุทธิ = กำไรขั้นต้น − รายจ่ายดำเนินงาน */
  net: number
  /** ภาษีขาย = Σ s.vatAmount (เอกสารคืนติดลบ → หักกลบตามหลัก ภ.พ.30) */
  salesVat: number
  /** จำนวนบิลขายที่มี VAT (ไม่นับเอกสารคืนสินค้า) */
  vatBillCount: number
  /** จำนวนเอกสารคืนสินค้าที่มี VAT */
  vatRefundCount: number
  /** ภาษีซื้อ = Σ e.vatAmount เฉพาะรายการที่มีใบกำกับ */
  purchaseVat: number
  /** จำนวนรายการรายจ่ายที่มีใบกำกับ */
  vatExpenseCount: number
  /** ภาษีที่ต้องนำส่ง = ภาษีขาย − ภาษีซื้อ */
  vatDue: number
  /** รายจ่ายแยกตามหมวด (เรียงตามลำดับหมวดมาตรฐาน) */
  byCategory: CategorySum[]
  /** จำนวนบิลขาย (ไม่นับเอกสารคืนสินค้า) */
  billCount: number
  /** จำนวนเอกสารคืนสินค้าในช่วง */
  refundCount: number
  /** ยอดคืนสินค้ารวม (ค่าบวก — ถูกหักออกจากรายได้แล้ว) */
  refundTotal: number
  /** ส่วนลดคูปองรวม (หักอยู่ในยอดสุทธิของบิลแล้ว — แสดงแยกให้เห็นในงบ) */
  couponDiscount: number
}

export function calcFinance(sales: Sale[], expenses: Expense[]): FinanceSummary {
  let revenue = 0
  let cogs = 0
  let salesVat = 0
  let vatBillCount = 0
  let vatRefundCount = 0
  let billCount = 0
  let refundCount = 0
  let refundTotal = 0
  let couponDiscount = 0
  for (const s of sales) {
    // เอกสารคืนสินค้ามียอดติดลบทุกช่อง → Σ หักกลบเอง แต่ไม่นับเป็นจำนวนบิล
    const refund = isRefundDoc(s)
    if (refund) {
      refundCount += 1
      refundTotal += Math.abs(s.total)
    } else {
      billCount += 1
    }
    revenue += saleRevenue(s)
    salesVat += s.vatAmount
    if (s.vatAmount !== 0) {
      if (refund) vatRefundCount += 1
      else vatBillCount += 1
    }
    couponDiscount += s.couponDiscount ?? 0
    cogs += saleCogs(s)
  }

  let expenseTotal = 0
  let purchaseTotal = 0
  let purchaseVat = 0
  let vatExpenseCount = 0
  const catSums = new Map<string, number>()
  for (const e of expenses) {
    expenseTotal += e.amount
    if (e.category === PURCHASE_CATEGORY) purchaseTotal += e.amount
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
  purchaseTotal = r2(purchaseTotal)
  salesVat = r2(salesVat)
  purchaseVat = r2(purchaseVat)
  const gross = r2(revenue - cogs)
  // หักเฉพาะรายจ่ายดำเนินงาน — ค่าซื้อสินค้าเข้าสต็อกถูกหักไปแล้วในรูป "ต้นทุนขาย" (กันหักซ้ำ)
  const operatingExpense = r2(expenseTotal - purchaseTotal)
  return {
    revenue,
    cogs,
    gross,
    expenseTotal,
    purchaseTotal,
    operatingExpense,
    net: r2(gross - operatingExpense),
    salesVat,
    vatBillCount,
    vatRefundCount,
    purchaseVat,
    vatExpenseCount,
    vatDue: r2(salesVat - purchaseVat),
    byCategory,
    billCount,
    refundCount,
    refundTotal: r2(refundTotal),
    couponDiscount: r2(couponDiscount),
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

/**
 * แถบแจ้งว่าช่วงเวลานี้มีเอกสารคืนสินค้า
 * (ยอดถูกหักกลบในทุกตัวเลขของหน้าแล้ว — บอกผู้ใช้ให้เห็นชัด ไม่ให้สงสัยว่ายอดหาย)
 */
export function RefundBanner({
  count,
  total,
  note = 'หักออกจากยอดขาย กำไร และภาษีขายในช่วงนี้แล้ว',
}: {
  count: number
  total: number
  note?: string
}) {
  if (count <= 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
      <Icon name="undo" size={16} />
      <span>
        คืนสินค้า <span className="font-bold">{baht(count)}</span> รายการ
      </span>
      <span className="font-bold">(-฿{baht(total)})</span>
      <span className="text-xs text-rose-500">· {note}</span>
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
