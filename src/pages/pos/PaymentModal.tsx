import { useEffect, useState } from 'react'
import type { Coupon, Payment, PaymentMethod, Sale, Settings } from '../../db/types'
import type { Totals } from '../../lib/totals'
import { finalizeSale, paymentsTotal } from '../../lib/checkout'
import { PAY_LABEL, printKitchenSlip, printReceipt } from '../../lib/receipt'
import { useCart } from '../../stores/cartStore'
import { baht, r2 } from '../../lib/format'
import {
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  Input,
  Modal,
  toast,
  type IconName,
} from '../../components/ui'
import QrPay from './QrPay'
import VerifyPaymentPanel from './VerifyPaymentPanel'

const METHODS: { key: PaymentMethod; label: string; icon: IconName }[] = [
  { key: 'cash', label: 'เงินสด', icon: 'cash' },
  { key: 'transfer', label: 'โอน·QR', icon: 'qr' },
  { key: 'card', label: 'บัตร', icon: 'card' },
]

const PAY_ICON: Record<PaymentMethod, IconName> = { cash: 'cash', transfer: 'qr', card: 'card' }

/**
 * เงินทอนสูงสุดที่ยอมให้ปิดบิลได้ — กันเคสเผลอยิงบาร์โค้ดลงช่องรับเงินแล้ว Enter
 * ของสแกนเนอร์ปิดบิลให้เองด้วยยอดรับ/เงินทอนระดับล้านล้าน
 */
const MAX_OVERPAY = 100_000

const AMOUNT_LABEL: Record<PaymentMethod, string> = {
  cash: 'รับเงินสดมา',
  transfer: 'ยอดที่โอน',
  card: 'ยอดที่รูดบัตร',
}

interface Props {
  open: boolean
  totals: Totals
  settings: Settings
  /** คูปองที่ใช้กับบิลนี้ (ส่งต่อให้ finalizeSale เพื่อนับจำนวนการใช้) */
  coupon?: Coupon
  onClose: () => void
  /** เรียกเมื่อจบการขาย: เคลียร์ตะกร้า + ปิดโมดัล + โฟกัสช่องค้นหา */
  onDone: () => void
}

/**
 * โมดัลชำระเงิน (จ่ายผสมหลายช่องทาง + QR พร้อมเพย์) + หน้าสำเร็จ
 * หน้าสำเร็จใช้ข้อมูลจาก sale ที่บันทึกแล้วเท่านั้น ไม่คำนวณใหม่หลังเคลียร์ตะกร้า
 */
export default function PaymentModal({
  open,
  totals,
  settings,
  coupon,
  onClose,
  onDone,
}: Props) {
  /** ช่องทางของก้อนที่กำลังกรอกอยู่ */
  const [method, setMethod] = useState<PaymentMethod>('cash')
  /** ยอดของก้อนที่กำลังกรอกอยู่ */
  const [amountStr, setAmountStr] = useState('')
  /** ก้อนที่กดเพิ่มไว้แล้ว (จ่ายผสมหลายช่องทาง) */
  const [payments, setPayments] = useState<Payment[]>([])
  const [busy, setBusy] = useState(false)
  const [sale, setSale] = useState<Sale | null>(null)
  /** กล่องยืนยันตอนจะข้ามไปทั้งที่ยังไม่ได้ส่งออเดอร์เข้าครัว */
  const [confirmSkip, setConfirmSkip] = useState(false)

  useEffect(() => {
    if (open) {
      setMethod('cash')
      setAmountStr('')
      setPayments([])
      setBusy(false)
      setSale(null)
      setConfirmSkip(false)
    }
  }, [open])

  const due = totals.payable
  const committed = paymentsTotal(payments)
  /** ยอดคงเหลือที่ต้องจ่าย (ยังไม่นับก้อนที่กำลังกรอก) */
  const remaining = Math.max(0, r2(due - committed))
  const pending = Math.max(0, r2(Number(amountStr) || 0))
  const paid = r2(committed + pending)
  const shortfall = Math.max(0, r2(due - paid))
  const change = Math.max(0, r2(paid - due))
  /** เงินสดที่รับมาทั้งหมด (รวมก้อนที่กำลังกรอก) — เงินทอนต้องมาจากเงินสดเท่านั้น */
  const cashPaid = r2(
    payments.reduce((s, p) => s + (p.method === 'cash' ? p.amount : 0), 0) +
      (method === 'cash' ? pending : 0),
  )

  const blockReason =
    change > MAX_OVERPAY
      ? `ยอดรับเงินสูงกว่ายอดที่ต้องชำระมากผิดปกติ (เงินทอน ฿${baht(change)}) — ถ้าเผลอยิงบาร์โค้ดลงช่องนี้ ให้ลบตัวเลขแล้วกรอกใหม่`
      : change > 0 && cashPaid <= 0
        ? 'โอน/บัตรต้องจ่ายพอดี ไม่มีเงินทอน'
        : change > cashPaid + 0.001
          ? `เงินทอนต้องไม่เกินเงินสดที่รับมา (฿${baht(cashPaid)})`
          : undefined

  const canConfirm = !busy && !sale && paid + 0.001 >= due && !blockReason

  /** เปลี่ยนช่องทาง: เงินสดให้กรอกยอดที่รับมาเอง, ช่องทางอื่นเติมยอดคงเหลือให้เลย */
  const selectMethod = (m: PaymentMethod) => {
    if (m === method) return
    setMethod(m)
    setAmountStr(m === 'cash' || remaining <= 0 ? '' : String(remaining))
  }

  /** ดันก้อนที่กรอกอยู่เข้า payments[] แล้วเริ่มก้อนใหม่ด้วยยอดคงเหลือ */
  const addTender = () => {
    if (busy || pending <= 0) return
    const next: Payment[] = [...payments, { method, amount: pending }]
    setPayments(next)
    const left = Math.max(0, r2(due - paymentsTotal(next)))
    setMethod(METHODS.find((m) => m.key !== method)?.key ?? 'cash')
    setAmountStr(left > 0 ? String(left) : '')
  }

  const removeTender = (idx: number) => {
    if (busy) return
    setPayments((ps) => ps.filter((_, i) => i !== idx))
  }

  const confirm = async () => {
    if (!canConfirm || sale) return
    const { items, memberId, discountApprovedById, discountApprovedByName } = useCart.getState()
    if (items.length === 0) return
    setBusy(true)
    try {
      const all: Payment[] =
        pending > 0 ? [...payments, { method, amount: pending }] : [...payments]
      const s = await finalizeSale({
        items,
        totals,
        settings,
        memberId,
        payments: all,
        coupon,
        // ผู้จัดการที่อนุมัติส่วนลดให้บิลนี้ (ถ้าพนักงานไม่มีสิทธิ์เอง) — ต้องตามกลับได้ว่าใครอนุมัติ
        discountApprover:
          discountApprovedById != null
            ? { id: discountApprovedById, name: discountApprovedByName }
            : undefined,
      })
      setSale(s)
    } catch (e) {
      // finalizeSale โยนข้อความภาษาไทยที่บอกสาเหตุชัดเจน (เช่น ยังไม่ได้เปิดกะ) — ต้องให้ผู้ใช้เห็น
      toast.error(e instanceof Error ? e.message : 'บันทึกการขายไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  /** โหมดบริการด่วน: หน้าสำเร็จกลายเป็นด่านตรวจการชำระเงินก่อนส่งเข้าครัว */
  const quickMode = !!settings.quickServiceEnabled
  /**
   * ขายจบแล้วแต่ออเดอร์ยังไม่ได้เข้าครัว — ห้ามปิดเงียบๆ แล้วครัวไม่เห็นออเดอร์
   * (ยังข้ามไปได้ แต่ต้องรู้ตัวก่อน)
   */
  const kitchenPending = quickMode && sale != null && sale.orderStatus == null

  // ปิดหลังขายสำเร็จ = ถือว่าจบการขาย (เคลียร์ตะกร้า)
  const handleClose = () => {
    if (busy) return // กำลังบันทึกอยู่ — กัน Esc / คลิกฉากหลัง / ปุ่ม X ปิดโมดัลกลางคัน
    if (kitchenPending) {
      setConfirmSkip(true)
      return
    }
    if (sale) onDone()
    else onClose()
  }

  /** ช่องทางที่จ่ายจริงของบิลที่บันทึกแล้ว (บิลเก่าไม่มี payments[] ใช้ช่องทางเดียว) */
  const salePayments: Payment[] = sale
    ? (sale.payments && sale.payments.length > 0
        ? sale.payments
        : [{ method: sale.paymentMethod, amount: sale.received }]
      ).filter((p) => p.amount > 0)
    : []

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={sale ? 'ขายสำเร็จ' : 'ชำระเงิน'}
        footer={
          sale ? undefined : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                ยกเลิก
              </Button>
              <Button icon="check" disabled={!canConfirm} onClick={() => void confirm()}>
                {busy ? 'กำลังบันทึก…' : `ยืนยันชำระเงิน ฿${baht(due)}`}
              </Button>
            </>
          )
        }
      >
        {sale ? (
          /* ===== หน้าสำเร็จ ===== */
          <div className="flex flex-col items-center gap-3 py-1 text-center">
            {sale.queueNo != null ? (
              <div className="w-full rounded-2xl bg-emerald-600 px-4 py-4 text-white shadow-sm">
                <div className="text-sm font-medium text-emerald-50">หมายเลขคิว</div>
                <div className="text-8xl leading-none font-black tabular-nums">{sale.queueNo}</div>
              </div>
            ) : (
              <div className="rounded-full bg-emerald-100 p-4 text-emerald-600">
                <Icon name="check" size={44} />
              </div>
            )}

            <div>
              <div className="text-lg font-bold text-slate-800">ชำระเงินเรียบร้อย</div>
              <div className="mt-0.5 text-xs text-slate-400">
                ใบเสร็จ {sale.receiptNo} · ยอดสุทธิ ฿{baht(sale.total)}
              </div>
            </div>

            {sale.change > 0 && (
              <div className="w-full rounded-2xl bg-slate-50 py-4">
                <div className="text-sm text-slate-500">เงินทอน</div>
                <div className="text-4xl font-bold text-emerald-600">฿{baht(sale.change)}</div>
                <div className="mt-1 text-xs text-slate-400">รับเงินมา ฿{baht(sale.received)}</div>
              </div>
            )}

            {salePayments.length > 0 && (
              <div className="w-full space-y-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm">
                {salePayments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Icon name={PAY_ICON[p.method]} size={15} />
                      {PAY_LABEL[p.method]}
                    </span>
                    <span className="font-semibold text-slate-700">฿{baht(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {(sale.memberId != null || sale.couponCode) && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {sale.memberId != null && (
                  <Badge color="green">
                    {sale.memberName ?? 'สมาชิก'} ได้รับ +{sale.earnedPoints} แต้ม
                  </Badge>
                )}
                {sale.couponCode && (
                  <Badge color="blue">
                    <Icon name="ticket" size={13} />
                    คูปอง {sale.couponCode} -฿{baht(sale.couponDiscount)}
                  </Badge>
                )}
              </div>
            )}

            {quickMode ? (
              /* ด่านตรวจการชำระเงิน → ส่งเข้าครัว (แทนแถวปุ่มเดิมทั้งแถว) */
              <div className="mt-2 w-full">
                <VerifyPaymentPanel
                  sale={sale}
                  settings={settings}
                  busy={busy}
                  onBusy={setBusy}
                  onSaleChange={setSale}
                  onDone={onDone}
                  onSkipRequest={() => setConfirmSkip(true)}
                />
              </div>
            ) : (
              <div className="mt-2 grid w-full grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  icon="printer"
                  onClick={() => printReceipt(sale, settings)}
                >
                  พิมพ์ใบเสร็จ
                </Button>
                {settings.kitchenPrintEnabled && (
                  <Button
                    variant="secondary"
                    icon="coffee"
                    onClick={() => printKitchenSlip(sale, settings)}
                  >
                    พิมพ์สลิปครัว
                  </Button>
                )}
                <Button
                  icon="cart"
                  className={settings.kitchenPrintEnabled ? 'col-span-2' : ''}
                  onClick={onDone}
                >
                  ขายรายการถัดไป
                </Button>
              </div>
            )}
          </div>
        ) : (
          /* ===== ฟอร์มชำระเงิน ===== */
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => selectMethod(m.key)}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 py-3 text-sm font-medium transition-colors ${
                    method === m.key
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <Icon name={m.icon} size={22} />
                  {m.label}
                </button>
              ))}
            </div>

            {/* แถบสรุปยอด */}
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-center">
                <div className="text-sm text-slate-500">ยอดสุทธิที่ต้องชำระ</div>
                <div className="text-3xl font-bold text-slate-800">฿{baht(due)}</div>
                {totals.couponCode && totals.couponDiscount > 0 && (
                  <div className="mt-0.5 text-xs text-slate-400">
                    รวมส่วนลดคูปอง {totals.couponCode} -฿{baht(totals.couponDiscount)}
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
                <div className="flex items-center justify-between text-slate-600">
                  <span>จ่ายแล้วรวม</span>
                  <span className="font-semibold text-slate-800">฿{baht(paid)}</span>
                </div>
                {shortfall > 0 ? (
                  <div className="flex items-center justify-between font-bold text-rose-600">
                    <span>ยังขาด</span>
                    <span className="text-lg">฿{baht(shortfall)}</span>
                  </div>
                ) : change > 0 ? (
                  <div className="flex items-center justify-between font-bold text-emerald-600">
                    <span>เงินทอน</span>
                    <span className="text-lg">฿{baht(change)}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between font-bold text-emerald-600">
                    <span>จ่ายพอดี</span>
                    <Icon name="check" size={18} />
                  </div>
                )}
              </div>
            </div>

            {/* ก้อนที่จ่ายแล้ว */}
            {payments.length > 0 && (
              <div className="space-y-1.5">
                {payments.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <Icon name={PAY_ICON[p.method]} size={16} className="text-slate-400" />
                    <span className="font-medium text-slate-700">{PAY_LABEL[p.method]}</span>
                    <span className="ml-auto font-semibold text-slate-800">฿{baht(p.amount)}</span>
                    <button
                      type="button"
                      onClick={() => removeTender(i)}
                      disabled={busy}
                      title="ลบการชำระก้อนนี้"
                      className="cursor-pointer rounded-lg p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ก้อนที่กำลังกรอก */}
            <div className="space-y-2">
              <div className="flex items-end justify-between">
                <span className="text-sm font-medium text-slate-600">{AMOUNT_LABEL[method]}</span>
                {payments.length > 0 && (
                  <span className="text-xs text-slate-400">คงเหลือ ฿{baht(remaining)}</span>
                )}
              </div>
              <Input
                type="number"
                min={0}
                step="any"
                autoFocus
                placeholder={`฿${baht(remaining)}`}
                className="py-3 text-center text-2xl font-bold"
                value={amountStr}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setAmountStr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.repeat) void confirm()
                }}
              />
              {method === 'cash' && (
                <div className="grid grid-cols-4 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setAmountStr(String(remaining))}
                  >
                    พอดี
                  </Button>
                  {[100, 500, 1000].map((v) => (
                    <Button
                      key={v}
                      variant="secondary"
                      size="sm"
                      onClick={() => setAmountStr(String(v))}
                    >
                      {v.toLocaleString('th-TH')}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {/* QR พร้อมเพย์ / คำแนะนำต่อช่องทาง */}
            {method === 'transfer' && (
              <QrPay
                promptpayId={settings.promptpayId}
                amount={pending > 0 ? pending : remaining}
                shopName={settings.shopName}
              />
            )}
            {method !== 'cash' && (
              <div className="rounded-xl bg-sky-50 px-4 py-3 text-center text-sm text-sky-700">
                {method === 'transfer'
                  ? 'ตรวจสอบยอดเงินโอน / สลิปให้เรียบร้อยก่อนกดยืนยัน'
                  : 'ทำรายการที่เครื่องรูดบัตรให้เรียบร้อยก่อนกดยืนยัน'}
              </div>
            )}

            <Button
              variant="secondary"
              icon="plus"
              className="w-full"
              onClick={addTender}
              disabled={busy || pending <= 0}
            >
              เพิ่มการชำระอีกช่องทาง
            </Button>

            {blockReason && (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-600">
                <Icon name="alert" size={16} />
                {blockReason}
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmSkip}
        title="ยังไม่ได้ส่งเข้าครัว"
        message={
          <>
            ออเดอร์นี้ยังไม่ได้ส่งเข้าครัว — ครัวจะไม่เห็นออเดอร์นี้ ยืนยันข้ามไปหรือไม่?
            <br />
            ส่งเข้าครัวย้อนหลังได้ที่หน้า “ประวัติการขาย”
          </>
        }
        confirmLabel="ข้ามไป ไม่ส่งเข้าครัว"
        danger
        onConfirm={onDone}
        onClose={() => setConfirmSkip(false)}
      />
    </>
  )
}
