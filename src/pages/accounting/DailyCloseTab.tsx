import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { PaymentMethod } from '../../db/types'
import { useSettings } from '../../db/hooks'
import { Button, Card, Icon, Input, Spinner, type IconName } from '../../components/ui'
import { baht, dayKey, endOfDay, fmtDate, money, r2, startOfDay } from '../../lib/format'
import { PAY_LABEL } from '../../lib/receipt'
import { saleAmountByMethod } from '../../lib/checkout'
import { cashNetFormula, printDailyReport, type DailyCloseSummary } from '../../lib/dailyReport'
import { PAY_METHODS, isRefundDoc, parseDay, saleMethods } from './shared'

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
  // กะที่เปิดในวันนั้น — ใช้กระทบยอดเงินสดที่นับได้จริงกับยอดที่ระบบคำนวณ
  // และเป็นที่เก็บรายการนำเงินเข้า/ออกลิ้นชัก (cashMoves) ที่ต้องเข้าสูตรเงินสดสุทธิของวัน
  const dayShifts = useLiveQuery(
    () => db.shifts.where('openedAt').between(dayStart, dayEnd, true, true).toArray(),
    [dayStart, dayEnd],
  )

  const summary = useMemo<DailyCloseSummary | null>(() => {
    // รอให้ครบทั้ง 3 ชุด (รวมกะ) ก่อน ไม่งั้นยอดเงินสดสุทธิจะกระพริบเป็นค่าที่ยังไม่รวม cashMoves
    if (!daySales || !dayExpenses || !dayShifts) return null
    const byMethod: DailyCloseSummary['byMethod'] = {
      cash: { count: 0, total: 0 },
      transfer: { count: 0, total: 0 },
      card: { count: 0, total: 0 },
    }
    let salesTotal = 0
    let billCount = 0
    let voidedCount = 0
    let voidedTotal = 0
    let refundCount = 0
    let refundTotal = 0
    let mixedCount = 0
    for (const s of daySales) {
      if (s.status !== 'completed') {
        voidedCount += 1
        voidedTotal += s.total
        continue
      }
      // เอกสารคืนสินค้ามียอดติดลบทุกช่อง → Σ หักกลบเอง แต่ไม่นับเป็นจำนวนบิล
      const refund = isRefundDoc(s)
      if (refund) {
        refundCount += 1
        refundTotal += Math.abs(s.total)
      } else {
        billCount += 1
      }
      salesTotal += s.total

      // ยอดแยกช่องทาง: ใช้ saleAmountByMethod (หักเงินทอนจากเงินสด / รองรับบิลเก่า / คืนติดลบ)
      const methods = saleMethods(s)
      for (const k of PAY_METHODS) byMethod[k].total += saleAmountByMethod(s, k)
      if (!refund) {
        for (const k of methods) byMethod[k].count += 1
        if (methods.length > 1) mixedCount += 1
      }
    }
    let expenseTotal = 0
    let expenseCash = 0
    for (const e of dayExpenses) {
      expenseTotal += e.amount
      if (e.paymentMethod === 'cash') expenseCash += e.amount
    }
    // เงินนำเข้า/ออกลิ้นชักของทุกกะที่เปิดในวันนี้ (ร้านที่ปิดระบบกะจะไม่มีกะ → 0 ทั้งคู่)
    let cashIn = 0
    let cashOut = 0
    for (const m of dayShifts.flatMap((s) => s.cashMoves ?? [])) {
      if (m.type === 'in') cashIn += m.amount
      else cashOut += m.amount
    }
    for (const k of PAY_METHODS) {
      byMethod[k].total = r2(byMethod[k].total)
    }
    cashIn = r2(cashIn)
    cashOut = r2(cashOut)
    return {
      date: dayStart,
      billCount,
      salesTotal: r2(salesTotal),
      byMethod,
      voidedCount,
      voidedTotal: r2(voidedTotal),
      refundCount,
      refundTotal: r2(refundTotal),
      mixedCount,
      expenseCount: dayExpenses.length,
      expenseTotal: r2(expenseTotal),
      expenseCash: r2(expenseCash),
      cashIn,
      cashOut,
      // เงินสดรับสุทธิของ "ทั้งวัน" — ไม่รวมเงินทอนตั้งต้นของกะ (ต่างจาก expectedCash ของรายงานปิดกะ
      // ที่คิดต่อกะและรวมเงินทอนตั้งต้น เพราะต้องเอาไปเทียบกับเงินที่นับได้ในลิ้นชักจริง)
      cashNet: r2(byMethod.cash.total - r2(expenseCash) + cashIn - cashOut),
    }
  }, [daySales, dayExpenses, dayShifts, dayStart])

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
                    ยอดขาย{summary.refundCount > 0 ? 'สุทธิ' : 'รวม'}{' '}
                    <span className="text-xs text-slate-400">({summary.billCount} บิล)</span>
                  </span>
                  <span className="text-xl font-bold text-slate-800">
                    {money(summary.salesTotal)}
                  </span>
                </div>
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {PAY_METHODS.map((k) => (
                    <div key={k} className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        <Icon name={METHOD_ICONS[k]} size={15} />
                      </span>
                      <span className="text-slate-600">{PAY_LABEL[k]}</span>
                      <span className="text-xs text-slate-400">
                        {summary.byMethod[k].count} บิล
                      </span>
                      <span
                        className={`ml-auto font-semibold ${
                          summary.byMethod[k].total < 0 ? 'text-rose-600' : 'text-slate-800'
                        }`}
                      >
                        {money(summary.byMethod[k].total)}
                      </span>
                    </div>
                  ))}
                  <p className="text-xs text-slate-400">
                    ยอดแยกช่องทางนับตามก้อนที่จ่ายจริง (หักเงินทอนจากเงินสดแล้ว)
                    {summary.mixedCount > 0 &&
                      ` — มีบิลจ่ายผสม ${summary.mixedCount} บิล จึงนับซ้ำในทุกช่องทางที่ใช้`}
                  </p>
                </div>
                {summary.refundCount > 0 && (
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-rose-600">
                    <span className="flex items-center gap-1.5">
                      <Icon name="undo" size={15} />
                      คืนสินค้า {summary.refundCount} รายการ
                    </span>
                    <span className="font-medium">-{money(summary.refundTotal)}</span>
                  </div>
                )}
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

          {/* ===== เงินเข้า-ออกลิ้นชักระหว่างวัน (มีเฉพาะร้านที่ใช้ระบบกะ) ===== */}
          {(summary.cashIn > 0 || summary.cashOut > 0) && (
            <Card title="เงินเข้า-ออกลิ้นชัก">
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <Icon name="plus" size={15} />
                  </span>
                  <span className="text-slate-600">นำเงินเข้าลิ้นชัก</span>
                  <span className="ml-auto font-semibold text-emerald-600">
                    +{money(summary.cashIn)}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                    <Icon name="minus" size={15} />
                  </span>
                  <span className="text-slate-600">นำเงินออกจากลิ้นชัก</span>
                  <span className="ml-auto font-semibold text-rose-600">
                    -{money(summary.cashOut)}
                  </span>
                </div>
                <p className="border-t border-slate-100 pt-2 text-xs text-slate-400">
                  รวมรายการนำเงินเข้า/ออกของทุกกะที่เปิดในวันนี้ (เช่น เติมเงินทอน / ถอนไปฝากธนาคาร)
                  — คิดรวมในยอด “เงินสดสุทธิที่ควรมีในลิ้นชัก” ด้านล่างแล้ว
                </p>
              </div>
            </Card>
          )}

          {/* ===== กะของวันนั้น (ถ้าใช้ระบบกะ) — กระทบยอดเงินที่นับได้จริง ===== */}
          {settings.shiftEnabled && (dayShifts?.length ?? 0) > 0 && (
            <Card title="กะของวันนี้">
              <div className="space-y-2 text-sm">
                {(dayShifts ?? []).map((sh) => {
                  const diff = sh.summary?.diff ?? 0
                  const closed = sh.status === 'closed'
                  return (
                    <div key={sh.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-700">{sh.docNo}</span>
                      <span className="text-xs text-slate-400">
                        {fmtDate(sh.openedAt)}
                        {sh.openedByName ? ` · ${sh.openedByName}` : ''}
                      </span>
                      {closed ? (
                        <>
                          <span className="ml-auto text-slate-500">
                            ควรมี {money(sh.summary?.expectedCash ?? 0)} · นับได้{' '}
                            {money(sh.countedCash ?? 0)}
                          </span>
                          <span
                            className={`w-24 shrink-0 text-right font-semibold ${
                              Math.abs(diff) < 0.005
                                ? 'text-emerald-600'
                                : diff > 0
                                  ? 'text-sky-600'
                                  : 'text-rose-600'
                            }`}
                          >
                            {Math.abs(diff) < 0.005
                              ? 'ตรง'
                              : diff > 0
                                ? `เกิน ${money(diff)}`
                                : `ขาด ${money(Math.abs(diff))}`}
                          </span>
                        </>
                      ) : (
                        <span className="ml-auto font-medium text-amber-600">ยังเปิดอยู่</span>
                      )}
                    </div>
                  )
                })}
                <p className="text-xs text-slate-400">
                  ยอด “เงินสดสุทธิที่ควรมีในลิ้นชัก” ด้านล่างคิดรวมทั้งวัน
                  (รวมเงินเข้า-ออกลิ้นชักของทุกกะแล้ว) แต่ไม่รวมเงินทอนตั้งต้นของกะ ต่างจากรายงานปิดกะที่คิดต่อกะและรวมเงินทอนตั้งต้น
                  — ถ้าต้องการกระทบยอดต่อกะให้ดูรายงานปิดกะที่หน้า “กะ / ลิ้นชัก”
                </p>
              </div>
            </Card>
          )}

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
                {/* ใช้ข้อความชุดเดียวกับใบพิมพ์ เพื่อให้คำอธิบายตรงกับสูตรที่คิดจริงเสมอ */}
                <div>{cashNetFormula(summary)}</div>
                <div className="mt-0.5 text-xs text-emerald-200">
                  * ยอดเงินสดหักเงินทอนที่จ่ายลูกค้าแล้ว
                </div>
                <div className="text-xs text-emerald-200">
                  * เป็น “เงินสดรับสุทธิของทั้งวัน” จึงไม่รวมเงินทอนตั้งต้นของกะ
                  — ยอดที่ต้องมีในลิ้นชักจริงต่อกะ (รวมเงินทอนตั้งต้น) ดูที่รายงานปิดกะ
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
