import { useMemo } from 'react'
import type { Expense, Sale } from '../../db/types'
import { useSettings } from '../../db/hooks'
import { Button, Card, EmptyState, Icon, Spinner, toast } from '../../components/ui'
import { baht, dayKey, fmtDate, money, r2 } from '../../lib/format'
import { downloadCsv } from '../../lib/csv'
import { calcFinance } from './shared'

/* =========================================================
   แท็บภาษี — เตรียมยื่น ภ.พ.30 (ภาษีขาย − ภาษีซื้อ)
   ========================================================= */

export default function TaxTab({
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
  const settings = useSettings()
  const fin = useMemo(() => calcFinance(sales ?? [], expenses ?? []), [sales, expenses])

  // ---- รายละเอียดรายบิล / รายรายการ (เรียงเก่า → ใหม่) ----
  const vatSales = useMemo(
    () =>
      (sales ?? []).filter((s) => s.vatAmount > 0).sort((a, b) => a.createdAt - b.createdAt),
    [sales],
  )
  const vatPurchases = useMemo(
    () =>
      (expenses ?? [])
        .filter((e) => e.hasVatInvoice)
        .sort((a, b) => a.date - b.date || a.createdAt - b.createdAt),
    [expenses],
  )

  function exportCsv() {
    if (vatSales.length === 0 && vatPurchases.length === 0) {
      toast.error('ไม่มีข้อมูลภาษีในช่วงเวลาที่เลือก')
      return
    }
    downloadCsv(`รายงานภาษี_${dayKey(lo)}_${dayKey(hi)}.csv`, [
      ['ประเภท', 'เลขที่ / รายละเอียด', 'วันที่', 'ยอดรวม', 'VAT'],
      ...vatSales.map((s) => [
        'ขาย',
        s.receiptNo,
        fmtDate(s.createdAt),
        r2(s.total),
        r2(s.vatAmount),
      ]),
      ...vatPurchases.map((e) => [
        'ซื้อ',
        e.description,
        fmtDate(e.date),
        r2(e.amount),
        r2(e.vatAmount),
      ]),
      [''],
      ['สรุป', 'ภาษีขาย', '', '', fin.salesVat],
      ['สรุป', 'ภาษีซื้อ', '', '', fin.purchaseVat],
      ['สรุป', 'ภาษีที่ต้องนำส่ง', '', '', fin.vatDue],
    ])
    toast.success('ส่งออกรายงานภาษีแล้ว')
  }

  if (sales === undefined || expenses === undefined) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    )
  }

  const overpaid = fin.vatDue < 0

  return (
    <div className="space-y-4">
      {/* ===== แจ้งเตือนกรณีไม่ได้เปิดใช้ VAT ===== */}
      {settings.vatRate === 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          <span>
            ระบบไม่ได้คิด VAT อยู่ — ตัวเลขภาษีขายจะเป็น 0 หากต้องการคิด VAT
            ตั้งค่าได้ที่หน้าตั้งค่า
          </span>
        </div>
      )}

      {/* ===== การ์ดสรุป 3 ใบ ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TaxCard
          label="ภาษีขาย"
          value={fin.salesVat}
          sub={`จากบิลขาย ${baht(fin.vatBillCount)} บิล`}
        />
        <TaxCard
          label="ภาษีซื้อ"
          value={fin.purchaseVat}
          sub={`จากรายจ่ายที่มีใบกำกับ ${baht(fin.vatExpenseCount)} รายการ`}
        />
        <div
          className={`rounded-2xl border p-5 shadow-sm ${
            overpaid
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-slate-200 bg-white ring-1 ring-emerald-100'
          }`}
        >
          <div className="text-xs text-slate-500">ภาษีที่ต้องนำส่ง (ภ.พ.30)</div>
          <div
            className={`mt-1 truncate text-2xl font-bold ${
              overpaid ? 'text-emerald-600' : 'text-slate-800'
            }`}
          >
            {baht(Math.abs(fin.vatDue))}{' '}
            <span className="text-sm font-normal text-slate-400">บาท</span>
          </div>
          <div className={`text-xs ${overpaid ? 'text-emerald-600' : 'text-slate-400'}`}>
            {overpaid ? 'ชำระเกิน (ขอคืน/ยกยอด)' : 'ภาษีขาย − ภาษีซื้อ'}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" icon="download" onClick={exportCsv}>
          ส่งออกรายงานภาษี CSV
        </Button>
      </div>

      {/* ===== ตารางรายละเอียด 2 ส่วน ===== */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title={`ภาษีขายรายบิล (${baht(vatSales.length)} บิล)`}
          padded={false}
        >
          {vatSales.length === 0 ? (
            <EmptyState icon="receipt" title="ไม่มีบิลขายที่มี VAT ในช่วงนี้" />
          ) : (
            <div className="max-h-96 overflow-x-auto overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">เลขที่</th>
                    <th className="px-4 py-3 font-medium">วันที่</th>
                    <th className="px-4 py-3 text-right font-medium">ยอด</th>
                    <th className="px-4 py-3 text-right font-medium">VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {vatSales.map((s) => (
                    <tr key={s.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{s.receiptNo}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {fmtDate(s.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{money(s.total)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                        {money(s.vatAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50 font-bold text-slate-800">
                    <td className="px-4 py-2.5" colSpan={3}>
                      รวมภาษีขาย
                    </td>
                    <td className="px-4 py-2.5 text-right">{money(fin.salesVat)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card
          title={`ภาษีซื้อรายรายการ (${baht(vatPurchases.length)} รายการ)`}
          padded={false}
        >
          {vatPurchases.length === 0 ? (
            <EmptyState
              icon="wallet"
              title="ไม่มีรายจ่ายที่มีใบกำกับภาษีในช่วงนี้"
              hint='บันทึกรายจ่ายพร้อมเปิด "มีใบกำกับภาษีเต็มรูป" เพื่อขอคืนภาษีซื้อ'
            />
          ) : (
            <div className="max-h-96 overflow-x-auto overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">วันที่</th>
                    <th className="px-4 py-3 font-medium">รายละเอียด</th>
                    <th className="px-4 py-3 text-right font-medium">ยอด</th>
                    <th className="px-4 py-3 text-right font-medium">VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {vatPurchases.map((e) => (
                    <tr key={e.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {fmtDate(e.date)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">{e.description}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{money(e.amount)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                        {money(e.vatAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50 font-bold text-slate-800">
                    <td className="px-4 py-2.5" colSpan={3}>
                      รวมภาษีซื้อ
                    </td>
                    <td className="px-4 py-2.5 text-right">{money(fin.purchaseVat)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/** การ์ดตัวเลขภาษี */
function TaxCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-2xl font-bold text-slate-800">
        {baht(value)} <span className="text-sm font-normal text-slate-400">บาท</span>
      </div>
      <div className="text-xs text-slate-400">{sub}</div>
    </div>
  )
}
