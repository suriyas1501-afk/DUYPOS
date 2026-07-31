import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { TaxInvoice } from '../../db/types'
import { useSettings } from '../../db/hooks'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Spinner,
  toast,
} from '../../components/ui'
import { baht, dayKey, fmtDate, fmtDateTime, money, r2 } from '../../lib/format'
import { downloadCsv } from '../../lib/csv'
import { printTaxInvoice } from '../../lib/taxInvoiceDoc'
import { StatCard } from './shared'

/* =========================================================
   แท็บทะเบียนใบกำกับภาษี — ใบกำกับภาษีเต็มรูป + ใบลดหนี้ที่ออกในช่วงเวลา
   ยอดในเอกสารเก็บเป็นค่าบวกเสมอ ทิศทางอยู่ที่ kind
   (ใบลดหนี้ = หักออกจากภาษีขาย, ใบที่ยกเลิกแล้วไม่นับในทุกยอดรวม)
   ========================================================= */

const PAGE_SIZE = 20

type FilterKey = 'all' | 'invoice' | 'creditNote' | 'cancelled'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'invoice', label: 'ใบกำกับภาษี' },
  { key: 'creditNote', label: 'ใบลดหนี้' },
  { key: 'cancelled', label: 'ที่ยกเลิก' },
]

const KIND_LABEL: Record<TaxInvoice['kind'], string> = {
  invoice: 'ใบกำกับภาษี',
  creditNote: 'ใบลดหนี้',
}

/** เครื่องหมายของยอดตามประเภทเอกสาร (ใบลดหนี้หักออกจากภาษีขาย) */
const kindSign = (inv: TaxInvoice) => (inv.kind === 'creditNote' ? -1 : 1)

export default function TaxInvoicesTab({ lo, hi }: { lo: number; hi: number }) {
  const settings = useSettings()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [printingId, setPrintingId] = useState<number | null>(null)

  const all = useLiveQuery(
    () => db.taxInvoices.where('issuedAt').between(lo, hi, true, true).toArray(),
    [lo, hi],
  )

  // ---- สรุปยอด (ไม่นับใบที่ยกเลิกแล้ว — เลขที่ยังถูกเก็บไว้เป็นหลักฐาน) ----
  const kpi = useMemo(() => {
    let invoiceCount = 0
    let creditCount = 0
    let cancelledCount = 0
    let net = 0
    let vat = 0
    for (const r of all ?? []) {
      if (r.cancelledAt != null) {
        cancelledCount += 1
        continue
      }
      if (r.kind === 'creditNote') creditCount += 1
      else invoiceCount += 1
      net += kindSign(r) * r.netAmount
      vat += kindSign(r) * r.vatAmount
    }
    return { invoiceCount, creditCount, cancelledCount, net: r2(net), vat: r2(vat) }
  }, [all])

  // ---- กรอง + ค้นหา + เรียงใหม่ → เก่า ----
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    const digits = term.replace(/\D/g, '')
    return (all ?? [])
      .filter((r) => {
        if (filter === 'cancelled') {
          if (r.cancelledAt == null) return false
        } else if (filter !== 'all') {
          if (r.kind !== filter) return false
        }
        if (!term) return true
        return (
          r.docNo.toLowerCase().includes(term) ||
          r.customer.name.toLowerCase().includes(term) ||
          r.saleReceiptNo.toLowerCase().includes(term) ||
          (digits !== '' && r.customer.taxId.includes(digits))
        )
      })
      .sort((a, b) => b.issuedAt - a.issuedAt)
  }, [all, filter, query])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const changeFilter = (key: FilterKey) => {
    setFilter(key)
    setPage(1)
  }

  const changeQuery = (v: string) => {
    setQuery(v)
    setPage(1)
  }

  /** พิมพ์ซ้ำ — ต้องโหลดบิลต้นทางก่อน (ใบกำกับอ้างอิงรายการสินค้าจากบิล) */
  const doPrint = async (inv: TaxInvoice, copy: boolean) => {
    if (inv.id == null || printingId != null) return
    setPrintingId(inv.id)
    try {
      const sale = await db.sales.get(inv.saleId)
      if (!sale) {
        toast.error('ไม่พบบิลต้นทางของเอกสารนี้')
        return
      }
      printTaxInvoice(inv, sale, settings, { copy })
    } finally {
      setPrintingId(null)
    }
  }

  function exportCsv() {
    if (rows.length === 0) {
      toast.error('ไม่มีเอกสารในช่วงเวลาที่เลือก')
      return
    }
    const sorted = [...rows].sort((a, b) => a.issuedAt - b.issuedAt)
    downloadCsv(`ทะเบียนใบกำกับภาษี_${dayKey(lo)}_${dayKey(hi)}.csv`, [
      [
        'เลขที่',
        'ประเภท',
        'วันที่ออก',
        'เลขที่บิล',
        'วันที่บิล',
        'ชื่อผู้ซื้อ',
        'เลขผู้เสียภาษี',
        'สาขา',
        'ที่อยู่',
        'มูลค่าสินค้า',
        'อัตราภาษี',
        'ภาษีมูลค่าเพิ่ม',
        'รวมทั้งสิ้น',
        'สถานะ',
        'เหตุผลยกเลิก',
      ],
      ...sorted.map((r) => [
        r.docNo,
        KIND_LABEL[r.kind],
        fmtDateTime(r.issuedAt),
        r.saleReceiptNo,
        fmtDate(r.saleDate),
        r.customer.name,
        r.customer.taxId,
        r.customer.taxBranch,
        r.customer.address,
        r2(r.netAmount),
        r.vatRate,
        r2(r.vatAmount),
        r2(r.total),
        r.cancelledAt == null ? 'ปกติ' : 'ยกเลิก',
        r.cancelReason ?? '',
      ]),
    ])
    toast.success(`ส่งออกทะเบียนใบกำกับภาษี ${sorted.length} ฉบับแล้ว`)
  }

  if (all === undefined) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ===== แจ้งเตือนเมื่อร้านยังไม่ได้เปิดใช้ใบกำกับภาษีเต็มรูป ===== */}
      {!settings.vatRegistered && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          <span>
            ร้านยังไม่ได้ระบุว่าจดทะเบียนภาษีมูลค่าเพิ่ม — เปิดใช้งานที่ ตั้งค่า › ใบกำกับภาษี
            เพื่อออกใบกำกับภาษีเต็มรูปจากหน้าประวัติการขาย
          </span>
        </div>
      )}

      {/* ===== KPI 4 ช่อง ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="invoice"
          tone="bg-sky-50 text-sky-600"
          label="จำนวนใบกำกับภาษี"
          value={baht(kpi.invoiceCount)}
          unit="ฉบับ"
          sub={
            kpi.creditCount > 0
              ? `และใบลดหนี้ ${baht(kpi.creditCount)} ฉบับ`
              : 'ไม่มีใบลดหนี้ในช่วงนี้'
          }
        />
        <StatCard
          icon="receipt"
          tone="bg-emerald-50 text-emerald-600"
          label="มูลค่าสินค้ารวม"
          value={baht(kpi.net)}
          unit="บาท"
          sub="ก่อน VAT — หักใบลดหนี้แล้ว"
        />
        <StatCard
          icon="cash"
          tone="bg-emerald-50 text-emerald-600"
          label="ภาษีขายตามใบกำกับ"
          value={baht(kpi.vat)}
          unit="บาท"
          sub="ไม่นับใบที่ยกเลิก"
        />
        <StatCard
          icon="x"
          tone={
            kpi.cancelledCount > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400'
          }
          label="ใบที่ยกเลิก"
          value={baht(kpi.cancelledCount)}
          unit="ฉบับ"
          sub="เก็บไว้เป็นหลักฐาน ไม่นับในยอดรวม"
          valueCls={kpi.cancelledCount > 0 ? 'text-rose-600' : 'text-slate-800'}
        />
      </div>

      {/* ===== ตัวกรอง + ค้นหา + ส่งออก ===== */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => changeFilter(f.key)}
              className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                filter === f.key ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder="ค้นหาเลขที่เอกสาร / ชื่อผู้ซื้อ / เลขผู้เสียภาษี / เลขที่บิล"
          className="w-full sm:w-96"
        />
        <Button variant="secondary" icon="download" className="ml-auto" onClick={exportCsv}>
          ส่งออก CSV
        </Button>
      </div>

      {/* ===== ตารางทะเบียน ===== */}
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon="invoice"
            title={
              (all?.length ?? 0) === 0
                ? 'ยังไม่มีใบกำกับภาษีในช่วงเวลานี้'
                : 'ไม่พบเอกสารที่ตรงกับเงื่อนไข'
            }
            hint={
              (all?.length ?? 0) === 0
                ? 'ออกใบกำกับภาษีเต็มรูปได้จากหน้า "ประวัติการขาย" โดยกดปุ่มในแถวของบิลนั้น'
                : 'ลองเปลี่ยนตัวกรองหรือคำค้นหา'
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">เลขที่</th>
                    <th className="px-4 py-3 font-medium">วันที่ออก</th>
                    <th className="px-4 py-3 font-medium">ประเภท</th>
                    <th className="px-4 py-3 font-medium">ผู้ซื้อ</th>
                    <th className="px-4 py-3 font-medium">เลขที่บิล</th>
                    <th className="px-4 py-3 text-right font-medium">มูลค่าสินค้า</th>
                    <th className="px-4 py-3 text-right font-medium">VAT</th>
                    <th className="px-4 py-3 text-right font-medium">รวม</th>
                    <th className="px-4 py-3 font-medium">สถานะ</th>
                    <th className="px-4 py-3 text-right font-medium">พิมพ์ซ้ำ</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const cancelled = r.cancelledAt != null
                    const credit = r.kind === 'creditNote'
                    return (
                      <tr
                        key={r.id}
                        className={`border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50 ${
                          cancelled ? 'bg-slate-50/60' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              cancelled ? 'text-slate-400 line-through' : 'text-slate-800'
                            }`}
                          >
                            {r.docNo}
                          </span>
                          {credit && r.refInvoiceNo && (
                            <div className="text-xs text-slate-400">อ้างอิง {r.refInvoiceNo}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {fmtDateTime(r.issuedAt)}
                          {r.issuedByName && (
                            <div className="text-xs text-slate-400">โดย {r.issuedByName}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge color={credit ? 'amber' : 'blue'}>{KIND_LABEL[r.kind]}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-800">{r.customer.name}</div>
                          <div className="text-xs text-slate-400">
                            {r.customer.taxId || '—'}
                            {r.customer.taxBranch ? ` · ${r.customer.taxBranch}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {r.saleReceiptNo}
                          <div className="text-xs text-slate-400">{fmtDate(r.saleDate)}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600">
                          {money(kindSign(r) * r.netAmount)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {money(kindSign(r) * r.vatAmount)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600">
                          {money(kindSign(r) * r.total)}
                        </td>
                        <td className="px-4 py-2.5">
                          {cancelled ? (
                            <>
                              <Badge color="red">ยกเลิก</Badge>
                              {r.cancelReason && (
                                <div className="max-w-40 text-xs text-slate-400">
                                  {r.cancelReason}
                                </div>
                              )}
                            </>
                          ) : (
                            <Badge color="green">ปกติ</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="printer"
                              title="พิมพ์ต้นฉบับ"
                              disabled={printingId != null}
                              onClick={() => void doPrint(r, false)}
                            >
                              ต้นฉบับ
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="printer"
                              title="พิมพ์สำเนา"
                              disabled={printingId != null}
                              onClick={() => void doPrint(r, true)}
                            >
                              สำเนา
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ----- แบ่งหน้า ----- */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
              <span className="text-xs text-slate-400">
                แสดง {baht((safePage - 1) * PAGE_SIZE + 1)}–
                {baht(Math.min(safePage * PAGE_SIZE, rows.length))} จาก {baht(rows.length)} ฉบับ
              </span>
              {pageCount > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                  >
                    ก่อนหน้า
                  </Button>
                  <span className="text-xs text-slate-500">
                    หน้า {baht(safePage)} / {baht(pageCount)}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safePage >= pageCount}
                    onClick={() => setPage(safePage + 1)}
                  >
                    ถัดไป
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      <p className="text-xs leading-relaxed text-slate-400">
        ยอดในตารางแสดงตามทิศทางของเอกสาร — ใบลดหนี้แสดงเป็นค่าติดลบเพราะหักออกจากภาษีขาย
        ใบที่ยกเลิกแล้วยังเก็บไว้เป็นหลักฐานตามระเบียบ (เลขที่เอกสารไม่นำกลับมาใช้ซ้ำ)
        แต่ไม่ถูกนับในยอดรวมทั้งหมด
      </p>
    </div>
  )
}
