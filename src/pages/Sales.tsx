import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Sale } from '../db/types'
import { useSettings } from '../db/hooks'
import { voidSale } from '../lib/checkout'
import { PAY_LABEL, printReceipt } from '../lib/receipt'
import { addDays, baht, fmtDateTime, r2, startOfDay } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  toast,
  type IconName,
} from '../components/ui'

/* =========================================================
   ตัวกรอง
   ========================================================= */

type RangeKey = 'today' | 'd7' | 'd30' | 'all'
type StatusFilter = 'all' | 'completed' | 'voided'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'วันนี้' },
  { key: 'd7', label: '7 วัน' },
  { key: 'd30', label: '30 วัน' },
  { key: 'all', label: 'ทั้งหมด' },
]

/* =========================================================
   ชิ้นส่วนย่อย
   ========================================================= */

/** Badge สถานะบิล */
function StatusBadge({ status }: { status: Sale['status'] }) {
  return status === 'voided' ? (
    <Badge color="red">ยกเลิก</Badge>
  ) : (
    <Badge color="green">สำเร็จ</Badge>
  )
}

/** ชิปสรุปเหนือตาราง */
function SummaryChip({
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

/** แถวสรุปเงินในโมดัล */
function SumRow({ label, value, red = false }: { label: string; value: string; red?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${red ? 'text-rose-600' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className={red ? '' : 'font-medium text-slate-700'}>{value}</span>
    </div>
  )
}

/* =========================================================
   โมดัลรายละเอียดบิล (+ ยืนยันยกเลิกบิล)
   ========================================================= */

function SaleDetailModal({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const settings = useSettings()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)
  /** กันไดอะล็อกยืนยันปิดตัวเองตอนกรอกเหตุผลไม่ครบ */
  const keepConfirmOpen = useRef(false)

  const doVoid = async (s: Sale) => {
    if (s.id == null || working) return
    setWorking(true)
    try {
      await voidSale(s.id, reason.trim())
      toast.success('ยกเลิกบิลแล้ว — คืนสต็อกและแต้มเรียบร้อย')
      setConfirmOpen(false)
      onClose()
    } catch {
      toast.error('ยกเลิกบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <Modal
        open={sale != null}
        onClose={onClose}
        size="lg"
        title={
          sale ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>ใบเสร็จ {sale.receiptNo}</span>
              <StatusBadge status={sale.status} />
              <span className="text-xs font-normal text-slate-400">
                {fmtDateTime(sale.createdAt)}
              </span>
            </span>
          ) : undefined
        }
        footer={
          sale ? (
            <>
              {sale.status === 'completed' && (
                <Button
                  variant="danger"
                  icon="x"
                  className="mr-auto"
                  onClick={() => {
                    setReason('')
                    setConfirmOpen(true)
                  }}
                >
                  ยกเลิกบิล
                </Button>
              )}
              <Button
                variant="secondary"
                icon="printer"
                onClick={() => printReceipt(sale, settings, { copy: true })}
              >
                พิมพ์ใบเสร็จ
              </Button>
              <Button variant="secondary" onClick={onClose}>
                ปิด
              </Button>
            </>
          ) : undefined
        }
      >
        {sale && (
          <div className="space-y-4 text-sm">
            {/* ---- แถบแจ้งบิลที่ถูกยกเลิก ---- */}
            {sale.status === 'voided' && (
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-700">
                <div className="flex items-center gap-2 font-semibold">
                  <Icon name="alert" size={16} />
                  บิลนี้ถูกยกเลิกแล้ว
                </div>
                <div className="mt-0.5 text-xs">
                  เหตุผล: {sale.voidReason?.trim() ? sale.voidReason : '—'}
                  {sale.voidedAt != null && <> · เมื่อ {fmtDateTime(sale.voidedAt)}</>}
                </div>
              </div>
            )}

            {/* ---- รายการสินค้า ---- */}
            <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-100">
              {sale.items.map((it, i) => {
                const optLine = [...(it.options ?? []), it.note].filter(Boolean).join(', ')
                return (
                  <div key={i} className="flex items-start justify-between gap-4 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800">{it.name}</div>
                      {optLine && <div className="text-xs text-slate-400">{optLine}</div>}
                      <div className="mt-0.5 text-xs text-slate-500">
                        {baht(it.qty)} x {baht(it.price)}
                      </div>
                      {it.manualDiscount > 0 && (
                        <div className="text-xs text-rose-500">
                          ส่วนลด -{baht(it.manualDiscount)}
                        </div>
                      )}
                      {it.promoDiscount > 0 && (
                        <div className="text-xs text-rose-500">
                          ส่วนลดโปรโมชัน -{baht(it.promoDiscount)}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right font-semibold text-slate-800">
                      {baht(it.total)}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ---- สรุปยอด ---- */}
            <div className="space-y-1.5 border-t border-slate-100 pt-3">
              <SumRow label="ยอดรวม" value={baht(sale.subtotal)} />
              {sale.itemDiscount > 0 && (
                <SumRow red label="ส่วนลดรายการ" value={`-${baht(sale.itemDiscount)}`} />
              )}
              {sale.promoDiscount > 0 && (
                <>
                  <SumRow red label="ส่วนลดโปรโมชัน" value={`-${baht(sale.promoDiscount)}`} />
                  {sale.appliedPromos.length > 0 && (
                    <div className="text-xs text-slate-400">
                      โปรที่ใช้: {sale.appliedPromos.join(', ')}
                    </div>
                  )}
                </>
              )}
              {sale.billDiscount > 0 && (
                <SumRow red label="ส่วนลดท้ายบิล" value={`-${baht(sale.billDiscount)}`} />
              )}
              {sale.pointDiscount > 0 && (
                <SumRow
                  red
                  label={`แลกแต้ม (${sale.redeemedPoints} แต้ม)`}
                  value={`-${baht(sale.pointDiscount)}`}
                />
              )}

              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                <span className="text-base font-bold text-slate-800">ยอดสุทธิ</span>
                <span className="text-xl font-bold text-emerald-600">฿{baht(sale.total)}</span>
              </div>
              {sale.vatRate > 0 && (
                <div className="text-right text-xs text-slate-400">
                  {sale.vatIncluded
                    ? `รวม VAT ${sale.vatRate}%: ${baht(sale.vatAmount)}`
                    : `VAT ${sale.vatRate}%: ${baht(sale.vatAmount)}`}
                </div>
              )}
            </div>

            {/* ---- การชำระเงิน / สมาชิก ---- */}
            <div className="space-y-1.5 border-t border-slate-100 pt-3">
              <SumRow label="ช่องทางชำระ" value={PAY_LABEL[sale.paymentMethod]} />
              {sale.paymentMethod === 'cash' && (
                <div className="flex justify-between gap-4 text-xs text-slate-400">
                  <span>รับเงิน {baht(sale.received)}</span>
                  <span>เงินทอน {baht(sale.change)}</span>
                </div>
              )}
              {sale.memberId != null && (
                <div className="flex justify-between gap-4 text-slate-600">
                  <span>สมาชิก</span>
                  <span className="font-medium text-slate-700">
                    {sale.memberName ?? '—'}
                    <span className="font-normal text-emerald-600">
                      {' '}
                      (+{sale.earnedPoints} แต้ม)
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ---- ยืนยันยกเลิกบิล (บังคับกรอกเหตุผล) ---- */}
      <ConfirmDialog
        open={confirmOpen}
        title={sale ? `ยกเลิกบิล ${sale.receiptNo}` : 'ยกเลิกบิล'}
        danger
        confirmLabel={working ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกบิล'}
        message={
          <div className="space-y-3">
            <p>
              ระบบจะคืนสต็อกสินค้า และคืน/หักแต้มสมาชิก (ถ้ามี) ให้อัตโนมัติ
              การยกเลิกบิลไม่สามารถย้อนกลับได้
            </p>
            <Field label="เหตุผลการยกเลิก">
              <Input
                autoFocus
                placeholder="เช่น คีย์รายการผิด / ลูกค้าคืนสินค้า"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
        }
        onConfirm={() => {
          if (!sale) return
          if (!reason.trim()) {
            keepConfirmOpen.current = true
            toast.error('กรุณากรอกเหตุผลการยกเลิกบิล')
            return
          }
          void doVoid(sale)
        }}
        onClose={() => {
          if (keepConfirmOpen.current) {
            keepConfirmOpen.current = false
            return
          }
          setConfirmOpen(false)
        }}
      />
    </>
  )
}

/* =========================================================
   หน้าประวัติการขาย
   ========================================================= */

export default function Sales() {
  const [range, setRange] = useState<RangeKey>('today')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<Sale | null>(null)

  // ---- ข้อมูลบิลตามช่วงเวลา (reactive) ----
  const sales = useLiveQuery(() => {
    if (range === 'all') return db.sales.toArray()
    const days = range === 'today' ? 0 : range === 'd7' ? -6 : -29
    const from = startOfDay(addDays(Date.now(), days))
    return db.sales.where('createdAt').aboveOrEqual(from).toArray()
  }, [range])

  // ---- กรองสถานะ + ค้นหาเลขที่ใบเสร็จ แล้วเรียงใหม่ → เก่า ----
  const filtered = useMemo(() => {
    if (!sales) return []
    const q = search.trim().toLowerCase()
    return sales
      .filter((s) => {
        if (status !== 'all' && s.status !== status) return false
        if (q && !s.receiptNo.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [sales, status, search])

  // ---- ชิปสรุป (เฉพาะบิลสำเร็จในผลกรอง) ----
  const summary = useMemo(() => {
    let count = 0
    let total = 0
    for (const s of filtered) {
      if (s.status !== 'completed') continue
      count += 1
      total += s.total
    }
    return { count, total: r2(total) }
  }, [filtered])

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader title="ประวัติการขาย" subtitle="ดูบิลย้อนหลัง พิมพ์ใบเสร็จ และยกเลิกบิล" />

      {/* ===== แถวกรอง ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                range === r.key ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">สถานะ: ทั้งหมด</option>
            <option value="completed">สำเร็จ</option>
            <option value="voided">ยกเลิก</option>
          </Select>
        </div>
        <div className="relative min-w-60 flex-1">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <Input
            className="pl-9"
            placeholder="ค้นหาเลขที่ใบเสร็จ…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ===== ชิปสรุป ===== */}
      <div className="mb-4 flex flex-wrap gap-3">
        <SummaryChip icon="receipt" label="จำนวนบิล" value={baht(summary.count)} unit="บิล" />
        <SummaryChip icon="cash" label="ยอดรวม" value={baht(summary.total)} unit="บาท" />
      </div>

      {/* ===== ตารางบิล ===== */}
      <Card padded={false}>
        {!sales ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : sales.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="ยังไม่มีบิลในช่วงเวลานี้"
            hint="เริ่มขายที่หน้าขายหน้าร้าน แล้วบิลจะแสดงที่นี่"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="search"
            title="ไม่พบบิลตามเงื่อนไข"
            hint="ลองเปลี่ยนคำค้นหา สถานะ หรือช่วงเวลา"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">เลขที่</th>
                  <th className="px-4 py-3 font-medium">วันเวลา</th>
                  <th className="px-4 py-3 font-medium">สมาชิก</th>
                  <th className="px-4 py-3 text-right font-medium">จำนวนรายการ</th>
                  <th className="px-4 py-3 font-medium">ช่องทาง</th>
                  <th className="px-4 py-3 text-right font-medium">ยอดสุทธิ</th>
                  <th className="px-4 py-3 text-center font-medium">สถานะ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50"
                    onClick={() => setViewing(s)}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-800">{s.receiptNo}</td>
                    <td className="px-4 py-2.5 text-slate-600">{fmtDateTime(s.createdAt)}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {s.memberName ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {baht(s.items.reduce((n, it) => n + it.qty, 0))} ชิ้น
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{PAY_LABEL[s.paymentMethod]}</td>
                    <td
                      className={`px-4 py-2.5 text-right font-semibold ${
                        s.status === 'voided' ? 'text-slate-400 line-through' : 'text-slate-800'
                      }`}
                    >
                      {baht(s.total)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="eye"
                          title="ดูรายละเอียด"
                          onClick={(e) => {
                            e.stopPropagation()
                            setViewing(s)
                          }}
                        >
                          ดู
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SaleDetailModal sale={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}
