import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Payment, PaymentMethod, Sale } from '../db/types'
import { usePermissions, useSettings } from '../db/hooks'
import { refundableQty, voidSale } from '../lib/checkout'
import type { Actor } from '../lib/actor'
import PinApprovalModal from '../components/auth/PinApprovalModal'
import { PAY_LABEL, printReceipt } from '../lib/receipt'
import { addDays, baht, fmtDateTime, r2, startOfDay } from '../lib/format'
import RefundModal from './sales/RefundModal'
import TaxInvoiceModal from './sales/TaxInvoiceModal'
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
type KindFilter = 'all' | 'sale' | 'refund'
/** ตัวกรองใบกำกับภาษีเต็มรูป (แสดงเฉพาะร้านที่จด VAT) */
type TaxFilter = 'all' | 'issued' | 'none'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'วันนี้' },
  { key: 'd7', label: '7 วัน' },
  { key: 'd30', label: '30 วัน' },
  { key: 'all', label: 'ทั้งหมด' },
]

const KINDS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'sale', label: 'บิลขาย' },
  { key: 'refund', label: 'คืนสินค้า' },
]

/** จำนวนแถวที่เรนเดอร์ต่อหน้า (กันตารางบวมเมื่อบิลเยอะ) */
const PAGE_SIZE = 100

/* =========================================================
   ตัวช่วย
   ========================================================= */

/** เอกสารคืนสินค้าหรือไม่ (บิลเก่าไม่มี kind = บิลขาย) */
const isRefundDoc = (s: Sale) => s.kind === 'refund'
const docKind = (s: Sale): 'sale' | 'refund' => (isRefundDoc(s) ? 'refund' : 'sale')

/** จำนวนสินค้า (รองรับทศนิยม เช่น 0.5 กก.) */
const qtyText = (n: number) =>
  Math.abs(n).toLocaleString('th-TH', { maximumFractionDigits: 3 })

/** ยังมีรายการที่คืนได้อยู่ไหม */
const hasRefundable = (s: Sale) => s.items.some((it) => refundableQty(it) > 0.0001)

/** สถานะการคืนสินค้าของบิลขาย */
function refundState(s: Sale): 'none' | 'partial' | 'full' {
  if (isRefundDoc(s) || s.status !== 'completed') return 'none'
  const refunded = s.refundedTotal ?? 0
  const anyRefunded = refunded > 0 || s.items.some((it) => (it.refundedQty ?? 0) > 0)
  if (!anyRefunded) return 'none'
  return hasRefundable(s) ? 'partial' : 'full'
}

/**
 * บิลนี้ออกใบกำกับภาษีเต็มรูปได้ไหม — ร้านต้องจด VAT, บิลต้องยังไม่ถูกยกเลิก และมี VAT อยู่จริง
 * (เงื่อนไขเดียวกับที่ issueTaxInvoice ตรวจ เพื่อไม่ให้ขึ้นปุ่มที่กดแล้วขึ้น error แน่ๆ)
 */
const taxEligible = (s: Sale, vatRegistered: boolean | undefined) =>
  !!vatRegistered && s.status === 'completed' && s.vatRate > 0 && Math.abs(s.vatAmount) > 0

/** ก้อนการชำระเงินของบิล (บิลเก่าที่ไม่มี payments[] → ใช้ paymentMethod เดิม) */
function salePayments(s: Sale): Payment[] {
  if (s.payments && s.payments.length > 0) return s.payments
  return [{ method: s.paymentMethod, amount: isRefundDoc(s) ? s.total : s.received }]
}

/** ป้ายช่องทางชำระของบิล (จ่ายผสมหลายช่องทาง → ต่อกันด้วย +) */
function payText(s: Sale): string {
  const seen: PaymentMethod[] = []
  for (const p of salePayments(s)) if (!seen.includes(p.method)) seen.push(p.method)
  return seen.map((m) => PAY_LABEL[m]).join(' + ')
}

/* =========================================================
   ชิ้นส่วนย่อย
   ========================================================= */

/** Badge สถานะ/ประเภทเอกสาร */
function DocBadge({ sale }: { sale: Sale }) {
  if (sale.status === 'voided') return <Badge color="red">ยกเลิก</Badge>
  if (isRefundDoc(sale)) return <Badge color="red">คืนสินค้า</Badge>
  const st = refundState(sale)
  if (st === 'full') return <Badge color="slate">คืนครบแล้ว</Badge>
  if (st === 'partial') return <Badge color="amber">คืนบางส่วน</Badge>
  return <Badge color="green">สำเร็จ</Badge>
}

/** ชิปสรุปเหนือตาราง */
function SummaryChip({
  icon,
  label,
  value,
  unit,
  tone = 'emerald',
}: {
  icon: IconName
  label: string
  value: string
  unit: string
  tone?: 'emerald' | 'rose'
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
          tone === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
        }`}
      >
        <Icon name={icon} size={16} />
      </span>
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-bold text-slate-800">
        {value} <span className="font-normal text-slate-400">{unit}</span>
      </span>
    </div>
  )
}

/** ป้าย/ปุ่มใบกำกับภาษีเต็มรูปของบิล (ใช้ในตารางประวัติการขาย) */
function TaxInvoiceCell({
  sale,
  canIssue,
  onOpen,
}: {
  sale: Sale
  /** มีสิทธิ์ออกใบ (ยังไม่ออก) — ไม่มีสิทธิ์จะเห็นแค่ขีด */
  canIssue: boolean
  onOpen: () => void
}) {
  if (sale.taxInvoiceNo) {
    return (
      <button
        type="button"
        title="ดู / พิมพ์ซ้ำ / ยกเลิกใบกำกับภาษี"
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
      >
        <Badge color="blue">
          <Icon name="invoice" size={13} />
          {sale.taxInvoiceNo}
        </Badge>
      </button>
    )
  }
  if (!canIssue) return <span className="text-slate-300">—</span>
  return (
    <Button
      variant="secondary"
      size="sm"
      icon="invoice"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    >
      {isRefundDoc(sale) ? 'ออกใบลดหนี้' : 'ออกใบกำกับภาษี'}
    </Button>
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
   โมดัลรายละเอียดบิล (+ ยกเลิกบิล / คืนสินค้า)
   ========================================================= */

function SaleDetailModal({
  sale,
  onClose,
  onView,
  onTaxInvoice,
}: {
  sale: Sale | null
  onClose: () => void
  /** เปิดดูเอกสารอื่น (บิลต้นทาง / เอกสารคืน) */
  onView: (s: Sale) => void
  /** เปิดโมดัลใบกำกับภาษีเต็มรูปของบิลนี้ */
  onTaxInvoice: (s: Sale) => void
}) {
  const settings = useSettings()
  const { can } = usePermissions()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)
  /** กันไดอะล็อกยืนยันปิดตัวเองตอนกรอกเหตุผลไม่ครบ */
  const keepConfirmOpen = useRef(false)

  /* ===== ขออนุมัติด้วย PIN สำหรับยกเลิกบิล / คืนสินค้า =====
     พนักงานที่ไม่มีสิทธิ์กดได้ แต่ต้องให้ผู้จัดการใส่ PIN ก่อน
     และเอกสารจะบันทึก "ผู้อนุมัติ" เป็นคนที่ใส่ PIN ไม่ใช่พนักงานที่กด */
  const [asking, setAsking] = useState<null | 'void' | 'refund'>(null)
  const [approver, setApprover] = useState<Actor | undefined>()

  /** เริ่มยกเลิกบิล / คืนสินค้า — มีสิทธิ์ก็ทำเลย ไม่มีก็ขออนุมัติก่อน */
  const startVoid = () => {
    setReason('')
    if (can('void')) {
      setApprover(undefined)
      setConfirmOpen(true)
    } else setAsking('void')
  }
  const startRefund = () => {
    if (can('refund')) {
      setApprover(undefined)
      setRefundOpen(true)
    } else setAsking('refund')
  }

  // อ่านข้อมูลบิลสดจาก DB เพื่อให้ยอด/จำนวนที่คืนแล้วอัปเดตทันทีหลังคืนสินค้า
  const live = useLiveQuery(
    async () => (sale?.id != null ? await db.sales.get(sale.id) : undefined),
    [sale?.id],
  )
  const s = live ?? sale

  // เอกสารคืนสินค้าที่อ้างอิงบิลนี้ (เฉพาะเมื่อดูบิลขาย)
  const origId = s != null && !isRefundDoc(s) ? s.id : undefined
  const refundDocs = useLiveQuery(async () => {
    if (origId == null) return []
    const list = await db.sales.where('refOriginalId').equals(origId).toArray()
    return list.sort((a, b) => b.createdAt - a.createdAt)
  }, [origId])

  // ปิดโมดัลย่อยทุกครั้งที่เปลี่ยนบิล / ปิดโมดัล — และล้างการอนุมัติ (อนุมัติได้ทีละเอกสาร)
  useEffect(() => {
    setConfirmOpen(false)
    setRefundOpen(false)
    setReason('')
    setAsking(null)
    setApprover(undefined)
  }, [sale?.id])

  const doVoid = async (target: Sale) => {
    if (target.id == null || working) return
    setWorking(true)
    try {
      // approver = ผู้จัดการที่ใส่ PIN อนุมัติ (ถ้าไม่มี ใช้ผู้ที่เข้าสู่ระบบอยู่)
      await voidSale(target.id, reason.trim(), approver)
      toast.success('ยกเลิกบิลแล้ว — คืนสต็อกและแต้มเรียบร้อย')
      setConfirmOpen(false)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ยกเลิกบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setWorking(false)
    }
  }

  const openOriginal = async (originalId: number) => {
    const o = await db.sales.get(originalId)
    if (o) onView(o)
    else toast.error('ไม่พบบิลต้นทาง (อาจถูกลบไปแล้ว)')
  }

  const isRefund = s != null && isRefundDoc(s)
  /** บิลต้นทางของเอกสารคืน (ใช้ปุ่ม “ดูบิลต้นทาง”) */
  const refOrigId = s?.refOriginalId
  const refunded = r2(s?.refundedTotal ?? 0)
  const state = s ? refundState(s) : 'none'
  const canRefund = s != null && !isRefund && s.status === 'completed' && hasRefundable(s)
  const pays = s ? salePayments(s) : []

  return (
    <>
      <Modal
        open={s != null}
        onClose={onClose}
        size="lg"
        title={
          s ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>
                {isRefund ? 'ใบคืนสินค้า' : 'ใบเสร็จ'} {s.receiptNo}
              </span>
              <DocBadge sale={s} />
              <span className="text-xs font-normal text-slate-400">
                {fmtDateTime(s.createdAt)}
              </span>
            </span>
          ) : undefined
        }
        footer={
          s ? (
            <>
              {/* เอกสารคืนสินค้า: ยกเลิก/คืนซ้ำไม่ได้ (checkout.ts จะ throw) */}
              {!isRefund && s.status === 'completed' && (
                <Button
                  variant="danger"
                  icon="x"
                  className="mr-auto"
                  disabled={refunded > 0 || state !== 'none'}
                  title={
                    refunded > 0 || state !== 'none'
                      ? 'บิลนี้มีการคืนสินค้าแล้ว ยกเลิกทั้งบิลไม่ได้'
                      : undefined
                  }
                  onClick={startVoid}
                >
                  {can('void') ? 'ยกเลิกบิล' : 'ยกเลิกบิล (ขออนุมัติ)'}
                </Button>
              )}
              {canRefund && (
                <Button variant="secondary" icon="undo" onClick={startRefund}>
                  {can('refund') ? 'คืนสินค้า' : 'คืนสินค้า (ขออนุมัติ)'}
                </Button>
              )}
              {/* ---- ใบกำกับภาษีเต็มรูป / ใบลดหนี้ ---- */}
              {taxEligible(s, settings.vatRegistered) &&
                (s.taxInvoiceNo ? (
                  <Button variant="secondary" icon="invoice" onClick={() => onTaxInvoice(s)}>
                    {isRefund ? 'ใบลดหนี้' : 'ใบกำกับภาษี'} {s.taxInvoiceNo}
                  </Button>
                ) : can('taxInvoice') ? (
                  <Button variant="secondary" icon="invoice" onClick={() => onTaxInvoice(s)}>
                    {isRefund ? 'ออกใบลดหนี้' : 'ออกใบกำกับภาษี'}
                  </Button>
                ) : null)}
              <Button
                variant="secondary"
                icon="printer"
                onClick={() => printReceipt(s, settings, { copy: !isRefund })}
              >
                {isRefund ? 'พิมพ์ใบคืนสินค้า' : 'พิมพ์ใบเสร็จ'}
              </Button>
              <Button variant="secondary" onClick={onClose}>
                ปิด
              </Button>
            </>
          ) : undefined
        }
      >
        {s && (
          <div className="space-y-4 text-sm">
            {/* ---- แถบเอกสารคืนสินค้า ---- */}
            {isRefund && (
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-700">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  <Icon name="undo" size={16} />
                  เอกสารคืนสินค้า
                  {s.refOriginalNo && <span>อ้างอิงบิล {s.refOriginalNo}</span>}
                  {refOrigId != null && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="eye"
                      className="text-rose-700 hover:bg-rose-100"
                      onClick={() => void openOriginal(refOrigId)}
                    >
                      ดูบิลต้นทาง
                    </Button>
                  )}
                </div>
                <div className="mt-0.5 text-xs">
                  เหตุผล: {s.refundReason?.trim() ? s.refundReason : '—'}
                </div>
              </div>
            )}

            {/* ---- แถบแจ้งบิลที่ถูกยกเลิก ---- */}
            {s.status === 'voided' && (
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-700">
                <div className="flex items-center gap-2 font-semibold">
                  <Icon name="alert" size={16} />
                  บิลนี้ถูกยกเลิกแล้ว
                </div>
                <div className="mt-0.5 text-xs">
                  เหตุผล: {s.voidReason?.trim() ? s.voidReason : '—'}
                  {s.voidedAt != null && <> · เมื่อ {fmtDateTime(s.voidedAt)}</>}
                </div>
              </div>
            )}

            {/* ---- แถบแจ้งว่าออกใบกำกับภาษีเต็มรูปแล้ว ---- */}
            {s.taxInvoiceNo && (
              <button
                type="button"
                onClick={() => onTaxInvoice(s)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-left text-sky-700 transition-colors hover:bg-sky-100"
              >
                <Icon name="invoice" size={16} />
                <span className="font-semibold">
                  ออก{isRefund ? 'ใบลดหนี้' : 'ใบกำกับภาษีเต็มรูป'}แล้ว เลขที่ {s.taxInvoiceNo}
                </span>
                <span className="ml-auto text-xs">ดู / พิมพ์ซ้ำ / ยกเลิก</span>
              </button>
            )}

            {/* ---- แถบแจ้งบิลที่มีการคืนสินค้า ---- */}
            {!isRefund && state !== 'none' && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-amber-700">
                <div className="flex items-center gap-2 font-semibold">
                  <Icon name="undo" size={16} />
                  {state === 'full' ? 'บิลนี้ถูกคืนครบทุกรายการแล้ว' : 'บิลนี้มีการคืนสินค้าบางส่วน'}
                </div>
                <div className="mt-0.5 text-xs">
                  คืนแล้วรวม ฿{baht(refunded)} · บิลนี้มีการคืนสินค้าแล้ว ยกเลิกทั้งบิลไม่ได้
                </div>
                {refundDocs && refundDocs.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {refundDocs.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => onView(d)}
                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-1.5 text-xs text-amber-800 transition-colors hover:bg-white"
                      >
                        <span className="font-medium">{d.receiptNo}</span>
                        <span className="text-amber-600">{fmtDateTime(d.createdAt)}</span>
                        <span className="font-semibold text-rose-600">
                          -฿{baht(Math.abs(d.total))}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---- เลขคิว ---- */}
            {s.queueNo != null && !isRefund && (
              <div className="flex items-center gap-2 text-slate-600">
                <Icon name="clock" size={16} className="text-slate-400" />
                หมายเลขคิว <span className="font-bold text-slate-800">{s.queueNo}</span>
              </div>
            )}

            {/* ---- รายการสินค้า ---- */}
            <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-100">
              {s.items.map((it, i) => {
                const optLine = [...(it.options ?? []), it.note].filter(Boolean).join(', ')
                const refundedQty = it.refundedQty ?? 0
                return (
                  <div key={i} className="flex items-start justify-between gap-4 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800">
                        {it.name}
                        {it.unitName && (
                          <span className="text-xs font-normal text-slate-400">
                            {' '}
                            [{it.unitName}]
                          </span>
                        )}
                      </div>
                      {optLine && <div className="text-xs text-slate-400">{optLine}</div>}
                      <div className="mt-0.5 text-xs text-slate-500">
                        {qtyText(it.qty)} x {baht(it.price)}
                      </div>
                      {Math.abs(it.manualDiscount) > 0 && (
                        <div className="text-xs text-rose-500">
                          ส่วนลด -{baht(Math.abs(it.manualDiscount))}
                        </div>
                      )}
                      {Math.abs(it.promoDiscount) > 0 && (
                        <div className="text-xs text-rose-500">
                          ส่วนลดโปรโมชัน -{baht(Math.abs(it.promoDiscount))}
                        </div>
                      )}
                      {!isRefund && refundedQty > 0 && (
                        <div className="text-xs font-medium text-rose-500">
                          คืนแล้ว {qtyText(refundedQty)}
                        </div>
                      )}
                    </div>
                    <div
                      className={`shrink-0 text-right font-semibold ${
                        isRefund ? 'text-rose-600' : 'text-slate-800'
                      }`}
                    >
                      {baht(it.total)}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ---- สรุปยอด ---- */}
            <div className="space-y-1.5 border-t border-slate-100 pt-3">
              <SumRow label="ยอดรวม" value={baht(s.subtotal)} />
              {Math.abs(s.itemDiscount) > 0 && (
                <SumRow red label="ส่วนลดรายการ" value={`-${baht(Math.abs(s.itemDiscount))}`} />
              )}
              {Math.abs(s.promoDiscount) > 0 && (
                <>
                  <SumRow
                    red
                    label="ส่วนลดโปรโมชัน"
                    value={`-${baht(Math.abs(s.promoDiscount))}`}
                  />
                  {s.appliedPromos.length > 0 && (
                    <div className="text-xs text-slate-400">
                      โปรที่ใช้: {s.appliedPromos.join(', ')}
                    </div>
                  )}
                </>
              )}
              {Math.abs(s.couponDiscount ?? 0) > 0 && (
                <SumRow
                  red
                  label={`คูปอง${s.couponCode ? ` ${s.couponCode}` : ''}`}
                  value={`-${baht(Math.abs(s.couponDiscount))}`}
                />
              )}
              {Math.abs(s.billDiscount) > 0 && (
                <SumRow red label="ส่วนลดท้ายบิล" value={`-${baht(Math.abs(s.billDiscount))}`} />
              )}
              {Math.abs(s.pointDiscount) > 0 && (
                <SumRow
                  red
                  label={`แลกแต้ม (${Math.abs(s.redeemedPoints)} แต้ม)`}
                  value={`-${baht(Math.abs(s.pointDiscount))}`}
                />
              )}

              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                <span className="text-base font-bold text-slate-800">
                  {isRefund ? 'ยอดคืนเงิน' : 'ยอดสุทธิ'}
                </span>
                <span
                  className={`text-xl font-bold ${isRefund ? 'text-rose-600' : 'text-emerald-600'}`}
                >
                  ฿{baht(s.total)}
                </span>
              </div>
              {s.vatRate > 0 && (
                <div className="text-right text-xs text-slate-400">
                  {s.vatIncluded
                    ? `รวม VAT ${s.vatRate}%: ${baht(Math.abs(s.vatAmount))}`
                    : `VAT ${s.vatRate}%: ${baht(Math.abs(s.vatAmount))}`}
                </div>
              )}
            </div>

            {/* ---- การชำระเงิน (ทุกก้อน) / สมาชิก ---- */}
            <div className="space-y-1.5 border-t border-slate-100 pt-3">
              <div className="text-xs font-medium text-slate-400">
                {isRefund ? 'ช่องทางคืนเงิน' : 'การชำระเงิน'}
              </div>
              {pays.map((p, i) => (
                <SumRow
                  key={i}
                  label={PAY_LABEL[p.method]}
                  value={`${isRefund ? '-' : ''}฿${baht(Math.abs(p.amount))}`}
                />
              ))}
              {!isRefund && s.change > 0 && (
                <div className="flex justify-between gap-4 text-xs text-slate-400">
                  <span>รับเงิน {baht(s.received)}</span>
                  <span>เงินทอน {baht(s.change)}</span>
                </div>
              )}
              {s.memberId != null && (
                <div className="flex justify-between gap-4 text-slate-600">
                  <span>สมาชิก</span>
                  <span className="font-medium text-slate-700">
                    {s.memberName ?? '—'}
                    <span
                      className={`font-normal ${isRefund ? 'text-rose-600' : 'text-emerald-600'}`}
                    >
                      {' '}
                      ({isRefund ? '-' : '+'}
                      {Math.abs(s.earnedPoints)} แต้ม)
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
        title={s ? `ยกเลิกบิล ${s.receiptNo}` : 'ยกเลิกบิล'}
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
          if (!s) return
          if (!reason.trim()) {
            keepConfirmOpen.current = true
            toast.error('กรุณากรอกเหตุผลการยกเลิกบิล')
            return
          }
          void doVoid(s)
        }}
        onClose={() => {
          if (keepConfirmOpen.current) {
            keepConfirmOpen.current = false
            return
          }
          setConfirmOpen(false)
        }}
      />

      {/* ---- โมดัลคืนสินค้าบางรายการ ---- */}
      {refundOpen && s != null && s.id != null && !isRefund && (
        <RefundModal
          key={s.id}
          sale={s}
          actor={approver}
          onClose={() => {
            setRefundOpen(false)
            setApprover(undefined)
          }}
        />
      )}

      {/* ---- ขออนุมัติด้วย PIN (พนักงานไม่มีสิทธิ์ยกเลิกบิล/คืนสินค้า) ---- */}
      <PinApprovalModal
        open={asking != null}
        perm={asking === 'refund' ? 'refund' : 'void'}
        title={asking === 'refund' ? 'ขออนุมัติคืนสินค้า' : 'ขออนุมัติยกเลิกบิล'}
        description={
          s ? `เอกสาร ${s.receiptNo} ยอด ฿${baht(Math.abs(s.total))}` : undefined
        }
        onClose={() => setAsking(null)}
        onApprove={(who) => {
          const next = asking
          setApprover({ id: who.id, name: who.name })
          setAsking(null)
          toast.success(`${who.name} อนุมัติแล้ว`)
          if (next === 'refund') setRefundOpen(true)
          else {
            setReason('')
            setConfirmOpen(true)
          }
        }}
      />
    </>
  )
}

/* =========================================================
   หน้าประวัติการขาย
   ========================================================= */

export default function Sales() {
  const settings = useSettings()
  const { can } = usePermissions()
  const canTax = can('taxInvoice')
  /** ร้านจด VAT → แสดงคอลัมน์/ตัวกรองใบกำกับภาษีเต็มรูป */
  const taxCol = !!settings.vatRegistered

  const [range, setRange] = useState<RangeKey>('today')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [tax, setTax] = useState<TaxFilter>('all')
  const [search, setSearch] = useState('')
  /** คำค้นแบบหน่วงเวลา (กันยิง query ทุกตัวอักษร) */
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [viewing, setViewing] = useState<Sale | null>(null)
  /** บิลที่เปิดโมดัลใบกำกับภาษีอยู่ */
  const [taxSale, setTaxSale] = useState<Sale | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  // ---- ข้อมูลบิล (reactive) — ค้นหาเลขที่ใช้ index receiptNo, ปกติใช้ index createdAt ----
  const sales = useLiveQuery(async () => {
    /** บิลในช่วงเวลาที่เลือก (เรียงใหม่→เก่าจาก index ไม่ต้อง sort ใน JS) */
    const byRange = async (): Promise<Sale[]> => {
      if (range === 'all') return db.sales.orderBy('createdAt').reverse().toArray()
      const days = range === 'today' ? 0 : range === 'd7' ? -6 : -29
      const from = startOfDay(addDays(Date.now(), days))
      return db.sales.where('createdAt').aboveOrEqual(from).reverse().toArray()
    }
    if (query) {
      // ค้นด้วย index ก่อน (เร็วมาก ไม่ต้องโหลดทุกบิล) — ครอบทุกช่วงเวลา
      const hits = await db.sales.where('receiptNo').startsWithIgnoreCase(query).toArray()
      if (hits.length > 0) return hits.sort((a, b) => b.createdAt - a.createdAt)
      // เผื่อพิมพ์เฉพาะเลขท้ายบิล → ค้นแบบมีคำนี้อยู่ ในช่วงเวลาที่เลือก
      const q = query.toLowerCase()
      return (await byRange()).filter((s) => s.receiptNo.toLowerCase().includes(q))
    }
    return byRange()
  }, [range, query])

  // ---- กรองสถานะ + ประเภทเอกสาร (ข้อมูลเรียงใหม่→เก่ามาแล้วจาก index) ----
  const filtered = useMemo(() => {
    if (!sales) return []
    return sales.filter((s) => {
      if (status !== 'all' && s.status !== status) return false
      if (kind !== 'all' && docKind(s) !== kind) return false
      // ใบกำกับภาษี: 'issued' = มีเลขที่ใบแล้ว, 'none' = บิลที่ออกได้แต่ยังไม่ออก
      if (tax === 'issued' && !s.taxInvoiceNo) return false
      if (tax === 'none' && (s.taxInvoiceNo != null || !taxEligible(s, taxCol))) return false
      return true
    })
  }, [sales, status, kind, tax, taxCol])

  // เปลี่ยนตัวกรอง → กลับไปหน้าแรก
  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [range, status, kind, tax, query])

  // ---- ชิปสรุป (เอกสารคืนยอดติดลบ จึงหักกลบยอดรวมให้เองอัตโนมัติ) ----
  const summary = useMemo(() => {
    let count = 0
    let total = 0
    let refundCount = 0
    let refundTotal = 0
    for (const s of filtered) {
      if (s.status !== 'completed') continue
      total += s.total
      if (isRefundDoc(s)) {
        refundCount += 1
        refundTotal += s.total
      } else {
        count += 1
      }
    }
    return { count, total: r2(total), refundCount, refundTotal: r2(refundTotal) }
  }, [filtered])

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="ประวัติการขาย"
        subtitle="ดูบิลย้อนหลัง พิมพ์ใบเสร็จ คืนสินค้าบางรายการ และยกเลิกบิล"
      />

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
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                kind === k.key ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {k.label}
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
        {taxCol && (
          <div className="w-48">
            <Select value={tax} onChange={(e) => setTax(e.target.value as TaxFilter)}>
              <option value="all">ใบกำกับภาษี: ทั้งหมด</option>
              <option value="issued">ออกใบกำกับภาษีแล้ว</option>
              <option value="none">ยังไม่ออกใบกำกับภาษี</option>
            </Select>
          </div>
        )}
        <div className="relative min-w-60 flex-1">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <Input
            className="pl-9"
            placeholder="ค้นหาเลขที่ใบเสร็จ / ใบคืนสินค้า…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {query && (
        <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
          <Icon name="search" size={14} className="text-slate-400" />
          ค้นหาเลขที่ขึ้นต้นด้วย “{query}” (ค้นข้ามช่วงเวลาให้ด้วย)
          <button
            type="button"
            onClick={() => setSearch('')}
            className="cursor-pointer font-medium text-emerald-600 hover:underline"
          >
            ล้างคำค้น
          </button>
        </div>
      )}

      {/* ===== ชิปสรุป ===== */}
      <div className="mb-4 flex flex-wrap gap-3">
        <SummaryChip icon="receipt" label="จำนวนบิล" value={baht(summary.count)} unit="บิล" />
        <SummaryChip icon="cash" label="ยอดรวม" value={baht(summary.total)} unit="บาท" />
        {summary.refundCount > 0 && (
          <SummaryChip
            icon="undo"
            tone="rose"
            label="คืนสินค้า"
            value={baht(summary.refundCount)}
            unit={`รายการ (-฿${baht(Math.abs(summary.refundTotal))})`}
          />
        )}
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
            title={query ? 'ไม่พบเลขที่เอกสารนี้' : 'ยังไม่มีบิลในช่วงเวลานี้'}
            hint={
              query
                ? 'ลองพิมพ์เลขที่ให้ตรงขึ้น เช่น R20260730 หรือ RF20260730'
                : 'เริ่มขายที่หน้าขายหน้าร้าน แล้วบิลจะแสดงที่นี่'
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="search"
            title="ไม่พบบิลตามเงื่อนไข"
            hint="ลองเปลี่ยนคำค้นหา ประเภทเอกสาร สถานะ หรือช่วงเวลา"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">เลขที่</th>
                    <th className="px-4 py-3 font-medium">อ้างอิง</th>
                    <th className="px-4 py-3 font-medium">วันเวลา</th>
                    <th className="px-4 py-3 font-medium">สมาชิก</th>
                    <th className="px-4 py-3 text-right font-medium">จำนวนรายการ</th>
                    <th className="px-4 py-3 font-medium">ช่องทาง</th>
                    <th className="px-4 py-3 text-right font-medium">ยอดสุทธิ</th>
                    <th className="px-4 py-3 text-center font-medium">สถานะ</th>
                    {taxCol && <th className="px-4 py-3 font-medium">ใบกำกับภาษี</th>}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => {
                    const refund = isRefundDoc(s)
                    return (
                      <tr
                        key={s.id}
                        className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50"
                        onClick={() => setViewing(s)}
                      >
                        <td
                          className={`px-4 py-2.5 font-medium ${
                            refund ? 'text-rose-600' : 'text-slate-800'
                          }`}
                        >
                          {s.receiptNo}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {s.refOriginalNo ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{fmtDateTime(s.createdAt)}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {s.memberName ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600">
                          {qtyText(s.items.reduce((n, it) => n + Math.abs(it.qty), 0))} ชิ้น
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{payText(s)}</td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold ${
                            s.status === 'voided'
                              ? 'text-slate-400 line-through'
                              : refund
                                ? 'text-rose-600'
                                : 'text-slate-800'
                          }`}
                        >
                          {refund ? `-฿${baht(Math.abs(s.total))}` : baht(s.total)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <DocBadge sale={s} />
                        </td>
                        {taxCol && (
                          <td className="px-4 py-2.5">
                            {/* บิลที่ยกเลิกแล้ว/ไม่มี VAT ไม่ต้องแสดงปุ่ม */}
                            {taxEligible(s, taxCol) ? (
                              <TaxInvoiceCell
                                sale={s}
                                canIssue={canTax}
                                onOpen={() => setTaxSale(s)}
                              />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )}
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
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ===== แบ่งหน้า ===== */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              <span>
                แสดง {baht(visible.length)} จาก {baht(filtered.length)} รายการ
              </span>
              {filtered.length > visible.length && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="plus"
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                >
                  โหลดเพิ่ม {PAGE_SIZE} รายการ
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      <SaleDetailModal
        sale={viewing}
        onClose={() => setViewing(null)}
        onView={(s) => setViewing(s)}
        onTaxInvoice={(s) => setTaxSale(s)}
      />

      {/* โมดัลใบกำกับภาษีเต็มรูป / ใบลดหนี้ (ซ้อนบนโมดัลรายละเอียดบิลได้) */}
      <TaxInvoiceModal
        open={taxSale != null}
        sale={taxSale}
        onClose={() => setTaxSale(null)}
      />
    </div>
  )
}
