import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { Icon, Input, PageHeader, type IconName } from '../components/ui'
import { addDays, dayKey, endOfDay, fmtDate, startOfDay } from '../lib/format'
import { parseDay } from './accounting/shared'
import OverviewTab from './accounting/OverviewTab'
import ExpensesTab from './accounting/ExpensesTab'
import TaxTab from './accounting/TaxTab'
import DailyCloseTab from './accounting/DailyCloseTab'

/* =========================================================
   หน้าบัญชี — ภาพรวม / รายจ่าย / ภาษี / ปิดยอดรายวัน
   ========================================================= */

type TabKey = 'overview' | 'expenses' | 'tax' | 'daily'

const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'overview', label: 'ภาพรวม', icon: 'chart' },
  { key: 'expenses', label: 'รายจ่าย', icon: 'wallet' },
  { key: 'tax', label: 'ภาษี', icon: 'receipt' },
  { key: 'daily', label: 'ปิดยอดรายวัน', icon: 'cash' },
]

type RangeKey = 'month' | 'prevMonth' | 'd30' | 'year' | 'custom'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'month', label: 'เดือนนี้' },
  { key: 'prevMonth', label: 'เดือนก่อน' },
  { key: 'd30', label: '30 วัน' },
  { key: 'year', label: 'ปีนี้' },
  { key: 'custom', label: 'กำหนดเอง' },
]

export default function Accounting() {
  const [tab, setTab] = useState<TabKey>('overview')
  const [range, setRange] = useState<RangeKey>('month')
  const [customFrom, setCustomFrom] = useState(() => dayKey(Date.now()))
  const [customTo, setCustomTo] = useState(() => dayKey(Date.now()))

  // ---- ช่วงเวลา [lo, hi] inclusive (ใช้ร่วมกันในแท็บ ภาพรวม/รายจ่าย/ภาษี) ----
  const { lo, hi } = useMemo(() => {
    const now = Date.now()
    const d = new Date(now)
    switch (range) {
      case 'month':
        return { lo: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), hi: endOfDay(now) }
      case 'prevMonth':
        return {
          lo: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(),
          hi: endOfDay(new Date(d.getFullYear(), d.getMonth(), 0).getTime()),
        }
      case 'd30':
        return { lo: startOfDay(addDays(now, -29)), hi: endOfDay(now) }
      case 'year':
        return { lo: new Date(d.getFullYear(), 0, 1).getTime(), hi: endOfDay(now) }
      case 'custom': {
        const f = parseDay(customFrom) ?? startOfDay(now)
        const t = parseDay(customTo) ?? startOfDay(now)
        return { lo: startOfDay(Math.min(f, t)), hi: endOfDay(Math.max(f, t)) }
      }
    }
  }, [range, customFrom, customTo])

  // ---- ข้อมูลในช่วง (reactive) — บิลสำเร็จเท่านั้น + รายจ่ายทั้งหมด ----
  const sales = useLiveQuery(
    () =>
      db.sales
        .where('createdAt')
        .between(lo, hi, true, true)
        .and((s) => s.status === 'completed')
        .toArray(),
    [lo, hi],
  )
  const expenses = useLiveQuery(
    () => db.expenses.where('date').between(lo, hi, true, true).toArray(),
    [lo, hi],
  )

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader title="บัญชี" subtitle="งบกำไรขาดทุน รายจ่าย ภาษี และปิดยอดรายวัน" />

      {/* ===== แท็บ segmented 4 แท็บ ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== แถวเลือกช่วงเวลา (แท็บ ภาพรวม/รายจ่าย/ภาษี) ===== */}
      {tab !== 'daily' && (
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
      )}

      {tab === 'overview' && <OverviewTab sales={sales} expenses={expenses} lo={lo} hi={hi} />}
      {tab === 'expenses' && <ExpensesTab expenses={expenses} lo={lo} hi={hi} />}
      {tab === 'tax' && <TaxTab sales={sales} expenses={expenses} lo={lo} hi={hi} />}
      {tab === 'daily' && <DailyCloseTab />}
    </div>
  )
}
