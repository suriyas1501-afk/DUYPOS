import { useEffect, useState } from 'react'
import type { PaymentMethod, Sale, Settings } from '../../db/types'
import type { Totals } from '../../lib/totals'
import { finalizeSale } from '../../lib/checkout'
import { printReceipt } from '../../lib/receipt'
import { useCart } from '../../stores/cartStore'
import { baht, r2 } from '../../lib/format'
import { Badge, Button, Icon, Input, Modal, toast, type IconName } from '../../components/ui'

const METHODS: { key: PaymentMethod; label: string; icon: IconName }[] = [
  { key: 'cash', label: 'เงินสด', icon: 'cash' },
  { key: 'transfer', label: 'โอน·QR', icon: 'qr' },
  { key: 'card', label: 'บัตร', icon: 'card' },
]

interface Props {
  open: boolean
  totals: Totals
  settings: Settings
  onClose: () => void
  /** เรียกเมื่อจบการขาย: เคลียร์ตะกร้า + ปิดโมดัล + โฟกัสช่องค้นหา */
  onDone: () => void
}

/** โมดัลชำระเงิน + หน้าสำเร็จ (ใช้ข้อมูลจาก sale ที่บันทึกแล้ว ไม่คำนวณใหม่) */
export default function PaymentModal({ open, totals, settings, onClose, onDone }: Props) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [receivedStr, setReceivedStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sale, setSale] = useState<Sale | null>(null)

  useEffect(() => {
    if (open) {
      setMethod('cash')
      setReceivedStr('')
      setBusy(false)
      setSale(null)
    }
  }, [open])

  const received = Number(receivedStr) || 0
  const change = r2(received - totals.payable)
  const canConfirm = !busy && (method !== 'cash' || received >= totals.payable)

  const confirm = async () => {
    if (!canConfirm || sale) return
    const { items, memberId } = useCart.getState()
    if (items.length === 0) return
    setBusy(true)
    try {
      const s = await finalizeSale({
        items,
        totals,
        settings,
        memberId,
        paymentMethod: method,
        received: method === 'cash' ? received : totals.payable,
      })
      setSale(s)
    } catch {
      toast.error('บันทึกการขายไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  // ปิดหลังขายสำเร็จ = ถือว่าจบการขาย (เคลียร์ตะกร้า)
  const handleClose = () => {
    if (busy) return // กำลังบันทึกอยู่ — กัน Esc / คลิกฉากหลัง / ปุ่ม X ปิดโมดัลกลางคัน
    if (sale) onDone()
    else onClose()
  }

  return (
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
              {busy ? 'กำลังบันทึก…' : `ยืนยันชำระเงิน ฿${baht(totals.payable)}`}
            </Button>
          </>
        )
      }
    >
      {sale ? (
        /* ===== หน้าสำเร็จ ===== */
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="rounded-full bg-emerald-100 p-4 text-emerald-600">
            <Icon name="check" size={44} />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-800">ชำระเงินเรียบร้อย</div>
            <div className="mt-0.5 text-xs text-slate-400">
              ใบเสร็จ {sale.receiptNo} · ยอดสุทธิ ฿{baht(sale.total)}
            </div>
          </div>

          {sale.paymentMethod === 'cash' && (
            <div className="w-full rounded-2xl bg-slate-50 py-4">
              <div className="text-sm text-slate-500">เงินทอน</div>
              <div className="text-4xl font-bold text-emerald-600">฿{baht(sale.change)}</div>
              <div className="mt-1 text-xs text-slate-400">รับเงินมา ฿{baht(sale.received)}</div>
            </div>
          )}

          {sale.memberId != null && (
            <Badge color="green">
              {sale.memberName ?? 'สมาชิก'} ได้รับ +{sale.earnedPoints} แต้ม
            </Badge>
          )}

          <div className="mt-2 flex w-full gap-2">
            <Button
              variant="secondary"
              icon="printer"
              className="flex-1"
              onClick={() => printReceipt(sale, settings)}
            >
              พิมพ์ใบเสร็จ
            </Button>
            <Button icon="cart" className="flex-1" onClick={onDone}>
              ขายรายการถัดไป
            </Button>
          </div>
        </div>
      ) : (
        /* ===== ฟอร์มชำระเงิน ===== */
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
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

          <div className="rounded-2xl bg-slate-50 py-3 text-center">
            <div className="text-sm text-slate-500">ยอดสุทธิที่ต้องชำระ</div>
            <div className="text-3xl font-bold text-slate-800">฿{baht(totals.payable)}</div>
          </div>

          {method === 'cash' ? (
            <div className="space-y-2">
              <Input
                type="number"
                min={0}
                step="any"
                autoFocus
                placeholder="รับเงินมา…"
                className="py-3 text-center text-2xl font-bold"
                value={receivedStr}
                onChange={(e) => setReceivedStr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirm()
                }}
              />
              <div className="grid grid-cols-4 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setReceivedStr(String(totals.payable))}
                >
                  พอดี
                </Button>
                {[100, 500, 1000].map((v) => (
                  <Button
                    key={v}
                    variant="secondary"
                    size="sm"
                    onClick={() => setReceivedStr(String(v))}
                  >
                    {v.toLocaleString('th-TH')}
                  </Button>
                ))}
              </div>
              {receivedStr !== '' &&
                (change >= 0 ? (
                  <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-2.5 font-semibold text-emerald-700">
                    <span>เงินทอน</span>
                    <span className="text-lg">฿{baht(change)}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-xl bg-rose-50 px-4 py-2.5 font-semibold text-rose-600">
                    <span>ยังขาดอีก</span>
                    <span className="text-lg">฿{baht(-change)}</span>
                  </div>
                ))}
            </div>
          ) : (
            <div className="rounded-xl bg-sky-50 px-4 py-3 text-center text-sm text-sky-700">
              {method === 'transfer'
                ? 'ตรวจสอบยอดเงินโอน / สลิป QR ให้เรียบร้อยก่อนกดยืนยัน'
                : 'ทำรายการที่เครื่องรูดบัตรให้เรียบร้อยก่อนกดยืนยัน'}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
