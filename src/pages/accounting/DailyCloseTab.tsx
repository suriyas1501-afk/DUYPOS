import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { PaymentMethod } from '../../db/types'
import { useSettings } from '../../db/hooks'
import { Button, Card, Icon, Input, Spinner, type IconName } from '../../components/ui'
import { baht, dayKey, endOfDay, fmtDate, money, r2, startOfDay } from '../../lib/format'
import { PAY_LABEL } from '../../lib/receipt'
import { printDailyReport, type DailyCloseSummary } from '../../lib/dailyReport'
import { parseDay } from './shared'

const METHOD_ICONS: Record<PaymentMethod, IconName> = {
  cash: 'cash',
  transfer: 'qr',
  card: 'card',
}

/* =========================================================
   แท็บปิดยอดรายวัน — สรุปยอดของวันที่เลือก + พิมพ์
   ========================================================= */

export default function DailyCloseTab() {
  const settings = useSettings()
  // วันที่เลือก (YYYY-MM-DD แบบ local — default วันนี้)
  const [dateStr, setDateStr] = useState(() => dayKey(Date.now()))

  const dayStart = parseDay(dateStr) ?? startOfDay(Date.now())
  const dayEnd = endOfDay(dayStart)

  // ---- ข้อมูลของวันนั้น (reactive — รวมบิลยกเลิกด้วย) ----
  const daySales = useLiveQuery(
    () => db.sales.where('createdAt').between(dayStart, dayEnd, true, true).toArray(),
    [dayStart, dayEnd],
  )
  const dayExpenses = useLiveQuery(
    () => db.expenses.where('date').between(dayStart, dayEnd, true, true).toArray(),
    [dayStart, dayEnd],
  )

  const summary = useMemo<DailyCloseSummary | null>(() => {
    if (!daySales || !dayExpenses) return null
    const byMethod: DailyCloseSummary['byMethod'] = {
      cash: { count: 0, total: 0 },
      transfer: { count: 0, total: 0 },
      card: { count: 0, total: 0 },
    }
    let salesTotal = 0
    let billCount = 0
    let voidedCount = 0
    let voidedTotal = 0
    for (const s of daySales) {
      if (s.status === 'completed') {
        billCount += 1
        salesTotal += s.total
        byMethod[s.paymentMethod].count += 1
        byMethod[s.paymentMethod].total += s.total
      } else {
        voidedCount += 1
        voidedTotal += s.total
      }
    }
    let expenseTotal = 0
    let expenseCash = 0
    for (const e of dayExpenses) {
      expenseTotal += e.amount
      if (e.paymentMethod === 'cash') expenseCash += e.amount
    }
    for (const k of ['cash', 'transfer', 'card'] as const) {
      byMethod[k].total = r2(byMethod[k].total)
    }
    return {
      date: dayStart,
      billCount,
      salesTotal: r2(salesTotal),
      byMethod,
      voidedCount,
      voidedTotal: r2(voidedTotal),
      expenseCount: dayExpenses.length,
      expenseTotal: r2(expenseTotal),
      expenseCash: r2(expenseCash),
      cashNet: r2(byMethod.cash.total - r2(expenseCash)),
    }
  }, [daySales, dayExpenses, dayStart])

  return (
    <div className="space-y-4">
      {/* ===== เลือกวัน + พิมพ์ ===== */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-44">
          <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </div>
        <span className="text-sm text-slate-400">สรุปประจำวันที่ {fmtDate(dayStart)}</span>
        <Button
          variant="secondary"
          icon="printer"
          className="ml-auto"
          disabled={!summary}
          onClick={() => {
            if (summary) printDailyReport(summary, settings)
          }}
        >
          พิมพ์สรุปปิดยอด
        </Button>
      </div>

      {!summary ? (
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* ===== ยอดขายของวัน ===== */}
            <Card title="ยอดขาย">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">
                    ยอดขายรวม{' '}
                    <span className="text-xs text-slate-400">({summary.billCount} บิล)</span>
                  </span>
                  <span className="text-xl font-bold text-slate-800">
                    {money(summary.salesTotal)}
                  </span>
                </div>
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {(['cash', 'transfer', 'card'] as const).map((k) => (
                    <div key={k} className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        <Icon name={METHOD_ICONS[k]} size={15} />
                      </span>
                      <span className="text-slate-600">{PAY_LABEL[k]}</span>
                      <span className="text-xs text-slate-400">
                        {summary.byMethod[k].count} บิล
                      </span>
                      <span className="ml-auto font-semibold text-slate-800">
                        {money(summary.byMethod[k].total)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-rose-600">
                  <span className="flex items-center gap-1.5">
                    <Icon name="x" size={15} />
                    บิลยกเลิก {summary.voidedCount} บิล
                  </span>
                  <span className="font-medium">{money(summary.voidedTotal)}</span>
                </div>
              </div>
            </Card>

            {/* ===== รายจ่ายของวัน ===== */}
            <Card title="รายจ่าย">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">
                    รายจ่ายรวม{' '}
                    <span className="text-xs text-slate-400">
                      ({summary.expenseCount} รายการ)
                    </span>
                  </span>
                  <span className="text-xl font-bold text-slate-800">
                    {money(summary.expenseTotal)}
                  </span>
                </div>
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Icon name="cash" size={15} />
                    </span>
                    <span className="text-slate-600">จ่ายเงินสด</span>
                    <span className="ml-auto font-semibold text-slate-800">
                      {money(summary.expenseCash)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Icon name="card" size={15} />
                    </span>
                    <span className="text-slate-600">จ่ายโอน / บัตร</span>
                    <span className="ml-auto font-semibold text-slate-800">
                      {money(r2(summary.expenseTotal - summary.expenseCash))}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* ===== เงินสดสุทธิที่ควรมีในลิ้นชัก ===== */}
          <div className="rounded-2xl bg-emerald-600 p-5 text-white shadow-sm">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
                <Icon name="cash" size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-emerald-100">เงินสดสุทธิที่ควรมีในลิ้นชัก</div>
                <div className="text-3xl font-bold">฿{baht(summary.cashNet)}</div>
              </div>
              <div className="text-right text-sm text-emerald-100">
                <div>
                  ขายเงินสด {money(summary.byMethod.cash.total)} − รายจ่ายเงินสด{' '}
                  {money(summary.expenseCash)}
                </div>
                <div className="mt-0.5 text-xs text-emerald-200">
                  * ไม่รวมเงินทอนตั้งต้นในลิ้นชัก
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
