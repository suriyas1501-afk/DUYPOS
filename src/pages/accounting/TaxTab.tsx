import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Expense, Sale } from '../../db/types'
import { useSettings } from '../../db/hooks'
import { Badge, Button, Card, EmptyState, Icon, Spinner, toast } from '../../components/ui'
import { baht, dayKey, fmtDate, money, r2 } from '../../lib/format'
import { downloadCsv } from '../../lib/csv'
import { RefundBanner, calcFinance, isRefundDoc, payMethodsLabel, saleMethods } from './shared'

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
  // รวมเอกสารคืนสินค้า (vatAmount ติดลบ) เพื่อให้ยอดภาษีขายหักกลบถูกต้องตามหลัก ภ.พ.30
  const vatSales = useMemo(
    () =>
      (sales ?? []).filter((s) => s.vatAmount !== 0).sort((a, b) => a.createdAt - b.createdAt),
    [sales],
  )
  const vatPurchases = useMemo(
    () =>
      (expenses ?? [])
        .filter((e) => e.hasVatInvoice)
        .sort((a, b) => a.date - b.date || a.createdAt - b.createdAt),
    [expenses],
  )

  // ---- ใบกำกับภาษีเต็มรูปที่ออกในช่วงเดียวกัน (ไม่รวมใบที่ยกเลิก) ----
  // ใช้กระทบยอดว่าภาษีขายส่วนไหนออกใบกำกับเต็มรูปแล้ว ส่วนไหนเป็นใบเสร็จอย่างย่อ
  const invoices = useLiveQuery(
    () =>
      db.taxInvoices
        .where('issuedAt')
        .between(lo, hi, true, true)
        .and((r) => r.cancelledAt == null)
        .toArray(),
    [lo, hi],
  )

  const issued = useMemo(() => {
    let vat = 0
    let invoiceCount = 0
    let creditCount = 0
    for (const r of invoices ?? []) {
      if (r.kind === 'creditNote') {
        creditCount += 1
        vat -= r.vatAmount
      } else {
        invoiceCount += 1
        vat += r.vatAmount
      }
    }
    return { vat: r2(vat), invoiceCount, creditCount }
  }, [invoices])

  // ผลต่าง = ภาษีขายที่ยังไม่มีใครขอใบกำกับเต็มรูป (ขายด้วยใบเสร็จอย่างย่อ)
  const shortDiff = r2(fin.salesVat - issued.vat)

  function exportCsv() {
    if (vatSales.length === 0 && vatPurchases.length === 0) {
      toast.error('ไม่มีข้อมูลภาษีในช่วงเวลาที่เลือก')
      return
    }
    downloadCsv(`รายงานภาษี_${dayKey(lo)}_${dayKey(hi)}.csv`, [
      ['ประเภท', 'เลขที่ / รายละเอียด', 'อ้างอิงบิล', 'วันที่', 'ยอดรวม', 'VAT'],
      ...vatSales.map((s) => [
        isRefundDoc(s) ? 'คืนสินค้า' : 'ขาย',
        s.receiptNo,
        s.refOriginalNo ?? '',
        fmtDate(s.createdAt),
        r2(s.total),
        r2(s.vatAmount),
      ]),
      ...vatPurchases.map((e) => [
        'ซื้อ',
        e.description,
        '',
        fmtDate(e.date),
        r2(e.amount),
        r2(e.vatAmount),
      ]),
      [''],
      ['สรุป', 'ภาษีขาย (สุทธิหลังหักเอกสารคืนสินค้า)', '', '', '', fin.salesVat],
      ['สรุป', 'ภาษีซื้อ', '', '', '', fin.purchaseVat],
      ['สรุป', 'ภาษีที่ต้องนำส่ง', '', '', '', fin.vatDue],
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

      {/* ===== แจ้งเตือนเมื่อช่วงนี้มีเอกสารคืนสินค้า (ภาษีขายหักกลบให้แล้ว) ===== */}
      <RefundBanner
        count={fin.refundCount}
        total={fin.refundTotal}
        note="ภาษีขายของเอกสารคืนติดลบ จึงหักกลบในยอดภาษีขายให้แล้ว"
      />

      {/* ===== การ์ดสรุป 3 ใบ ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TaxCard
          label="ภาษีขาย"
          value={fin.salesVat}
          sub={
            fin.vatRefundCount > 0
              ? `จากบิลขาย ${baht(fin.vatBillCount)} บิล หักคืนสินค้า ${baht(
                  fin.vatRefundCount,
                )} ใบ`
              : `จากบิลขาย ${baht(fin.vatBillCount)} บิล`
          }
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

      {/* ===== กระทบยอดภาษีขาย ↔ ใบกำกับภาษีเต็มรูปที่ออกไป ===== */}
      {invoices !== undefined && (
        <Card title="กระทบยอดภาษีขาย">
          <div className="space-y-1">
            <ReconRow
              label="ภาษีขายจากบิลทั้งหมด"
              value={fin.salesVat}
              sub="ทุกบิลในช่วงนี้ (หักเอกสารคืนสินค้าแล้ว)"
            />
            <ReconRow
              label="ภาษีขายที่ออกใบกำกับภาษีเต็มรูปแล้ว"
              value={issued.vat}
              sub={
                issued.creditCount > 0
                  ? `ใบกำกับภาษี ${baht(issued.invoiceCount)} ฉบับ หักใบลดหนี้ ${baht(
                      issued.creditCount,
                    )} ฉบับ`
                  : `ใบกำกับภาษี ${baht(issued.invoiceCount)} ฉบับ`
              }
            />
            <div className="border-t border-slate-100 pt-1">
              <ReconRow
                label="ผลต่าง — ขายด้วยใบเสร็จอย่างย่อ"
                value={shortDiff}
                sub="ส่วนที่ยังไม่มีลูกค้าขอใบกำกับภาษีเต็มรูป"
                strong
                valueCls={shortDiff < 0 ? 'text-rose-600' : 'text-slate-800'}
              />
            </div>
          </div>

          {shortDiff < 0 ? (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-relaxed text-rose-700">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              <span>
                ออกใบกำกับภาษีมากกว่าภาษีขายจากบิลในช่วงนี้ — อาจมีใบกำกับภาษีที่ออกผิดพลาด
                ออกซ้ำ หรือออกคร่อมช่วงเวลา (บิลอยู่เดือนก่อน แต่ออกใบเดือนนี้) ควรตรวจสอบที่แท็บ
                "ใบกำกับภาษี"
              </span>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              ผลต่างเป็นเรื่องปกติของร้านค้าปลีก เพราะลูกค้าทั่วไปรับใบเสร็จรับเงินอย่างย่อ
              ไม่ได้ขอใบกำกับภาษีเต็มรูปทุกคน — ภาษีขายที่ต้องยื่น ภ.พ.30 คิดจาก
              <span className="font-semibold text-slate-500">ยอดขายทั้งหมด</span>{' '}
              ไม่ใช่แค่ยอดที่ออกใบกำกับภาษีเต็มรูป
            </p>
          )}
        </Card>
      )}

      <div className="flex justify-end">
        <Button variant="secondary" icon="download" onClick={exportCsv}>
          ส่งออกรายงานภาษี CSV
        </Button>
      </div>

      {/* ===== ตารางรายละเอียด 2 ส่วน ===== */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title={
            fin.vatRefundCount > 0
              ? `ภาษีขายรายบิล (${baht(fin.vatBillCount)} บิล + คืนสินค้า ${baht(
                  fin.vatRefundCount,
                )} ใบ)`
              : `ภาษีขายรายบิล (${baht(vatSales.length)} บิล)`
          }
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
                  {vatSales.map((s) => {
                    const refund = isRefundDoc(s)
                    // บิลจ่ายผสมหลายช่องทาง — แสดงรายการก้อนที่จ่ายกำกับไว้
                    const mixed = saleMethods(s).length > 1
                    return (
                      <tr key={s.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-slate-800">{s.receiptNo}</span>
                            {refund && <Badge color="red">คืนสินค้า</Badge>}
                          </div>
                          {refund && s.refOriginalNo && (
                            <div className="text-xs text-slate-400">
                              อ้างอิงบิล {s.refOriginalNo}
                            </div>
                          )}
                          {mixed && (
                            <div className="text-xs text-slate-400">{payMethodsLabel(s)}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {fmtDate(s.createdAt)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right ${
                            refund ? 'text-rose-600' : 'text-slate-600'
                          }`}
                        >
                          {money(s.total)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold ${
                            refund ? 'text-rose-600' : 'text-slate-800'
                          }`}
                        >
                          {money(s.vatAmount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50 font-bold text-slate-800">
                    <td className="px-4 py-2.5" colSpan={3}>
                      รวมภาษีขาย {fin.vatRefundCount > 0 && '(สุทธิหลังหักคืนสินค้า)'}
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

/** 1 บรรทัดในตารางกระทบยอดภาษีขาย */
function ReconRow({
  label,
  value,
  sub,
  strong = false,
  valueCls = 'text-slate-800',
}: {
  label: string
  value: number
  sub?: string
  strong?: boolean
  valueCls?: string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
      <div className="min-w-0">
        <div className={`text-sm ${strong ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
          {label}
        </div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </div>
      <div
        className={`text-sm whitespace-nowrap ${
          strong ? 'font-bold' : 'font-semibold'
        } ${valueCls}`}
      >
        {money(value)} <span className="text-xs font-normal text-slate-400">บาท</span>
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
