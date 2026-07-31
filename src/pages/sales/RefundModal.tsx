import { useMemo, useState } from 'react'
import type { Payment, PaymentMethod, Sale } from '../../db/types'
import { primaryMethod, refundSale, refundableQty } from '../../lib/checkout'
import type { Actor } from '../../lib/actor'
import { printReceipt } from '../../lib/receipt'
import { useSettings } from '../../db/hooks'
import { baht, fmtDateTime, r2 } from '../../lib/format'
import {
  Badge,
  Button,
  Field,
  Icon,
  Input,
  Modal,
  toast,
  type IconName,
} from '../../components/ui'

/* =========================================================
   โมดัลคืนสินค้าบางรายการ (partial refund)
   ========================================================= */

const METHODS: { key: PaymentMethod; label: string; icon: IconName }[] = [
  { key: 'cash', label: 'เงินสด', icon: 'cash' },
  { key: 'transfer', label: 'โอน·QR', icon: 'qr' },
  { key: 'card', label: 'บัตร', icon: 'card' },
]

const PRESET_REASONS = [
  'สินค้าชำรุด / เสียหาย',
  'ลูกค้าเปลี่ยนใจ',
  'คีย์รายการผิด',
  'สินค้าไม่ตรงตามที่สั่ง',
  'สินค้าหมดอายุ',
]

/** จำนวนสินค้า (รองรับทศนิยม เช่น 0.5 กก.) */
const qtyText = (n: number) =>
  Math.abs(n).toLocaleString('th-TH', { maximumFractionDigits: 3 })

interface Props {
  /** บิลขายต้นทาง (ผู้เรียกต้องใส่ key={sale.id} เพื่อรีเซ็ตฟอร์มเมื่อเปลี่ยนบิล) */
  sale: Sale
  onClose: () => void
  /** เรียกเมื่อคืนสินค้าสำเร็จ (ส่งเอกสารคืนกลับไป) */
  onRefunded?: (refundDoc: Sale) => void
  /** ผู้อนุมัติ (เมื่อพนักงานไม่มีสิทธิ์คืนสินค้าและผู้จัดการใส่ PIN อนุมัติให้) */
  actor?: Actor
}

export default function RefundModal({ sale, onClose, onRefunded, actor }: Props) {
  const settings = useSettings()
  /** จำนวนที่จะคืนของแต่ละรายการ (เก็บเป็นสตริงเพื่อให้พิมพ์ทศนิยมได้ลื่น) */
  const [qtyStr, setQtyStr] = useState<Record<number, string>>({})
  const [method, setMethod] = useState<PaymentMethod>(() => {
    const list: Payment[] =
      sale.payments && sale.payments.length > 0
        ? sale.payments
        : [{ method: sale.paymentMethod, amount: Math.abs(sale.total) }]
    return primaryMethod(list.map((p) => ({ method: p.method, amount: Math.abs(p.amount) })))
  })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Sale | null>(null)

  // ---- แถวรายการ + จำนวนที่ยังคืนได้ ----
  const rows = useMemo(
    () => sale.items.map((it, i) => ({ it, i, max: refundableQty(it) })),
    [sale],
  )
  const itemsTotal = useMemo(
    () => r2(sale.items.reduce((s, it) => s + it.total, 0)),
    [sale],
  )
  const refundableRows = rows.filter((r) => r.max > 0.0001)

  const num = (i: number) => {
    const v = Number(qtyStr[i])
    return Number.isFinite(v) && v > 0 ? v : 0
  }
  const picked = rows.filter((r) => num(r.i) > 0)
  const overRow = rows.find((r) => num(r.i) > r.max + 0.0001)

  // ---- ยอดคืนโดยประมาณ (คิดสัดส่วนเดียวกับ refundSale ใน checkout.ts) ----
  const refundItemsTotal = r2(
    picked.reduce(
      (s, r) => s + (r.it.qty === 0 ? 0 : (r.it.total * num(r.i)) / r.it.qty),
      0,
    ),
  )
  const ratio = itemsTotal > 0 ? Math.min(1, refundItemsTotal / itemsTotal) : 0
  const est = Math.max(0, r2(sale.total * ratio))

  const setQty = (i: number, v: string) => setQtyStr((s) => ({ ...s, [i]: v }))
  const fillRow = (i: number, max: number) => setQty(i, String(r2(max)))
  const fillAll = () => {
    const next: Record<number, string> = {}
    for (const r of refundableRows) next[r.i] = String(r2(r.max))
    setQtyStr(next)
  }
  const clearAll = () => setQtyStr({})

  const confirm = async () => {
    if (busy || done) return
    if (sale.id == null) return
    if (picked.length === 0) {
      toast.error('กรุณาเลือกรายการที่ต้องการคืน')
      return
    }
    if (overRow) {
      toast.error(
        `"${overRow.it.name}" คืนได้ไม่เกิน ${qtyText(overRow.max)} ${overRow.it.unitName ?? 'หน่วย'}`,
      )
      return
    }
    if (!reason.trim()) {
      toast.error('กรุณาระบุเหตุผลการคืนสินค้า')
      return
    }

    setBusy(true)
    try {
      const doc = await refundSale(
        sale.id,
        picked.map((r) => ({ itemIndex: r.i, qty: num(r.i) })),
        // actor = ผู้อนุมัติ (ถ้ามี) — เอกสารคืนต้องบันทึกว่าใครอนุมัติ ไม่ใช่พนักงานที่ไม่มีสิทธิ์
        { reason: reason.trim(), payments: [{ method, amount: est }], actor },
      )
      toast.success('คืนสินค้าเรียบร้อย — คืนสต็อกและปรับแต้มแล้ว')
      setDone(doc)
      onRefunded?.(doc)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'คืนสินค้าไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  const handleClose = () => {
    if (busy) return // กำลังบันทึกอยู่ — กัน Esc / คลิกฉากหลังปิดกลางคัน
    onClose()
  }

  return (
    <Modal
      open
      onClose={handleClose}
      size="lg"
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{done ? 'คืนสินค้าเรียบร้อย' : 'คืนสินค้า'}</span>
          <Badge color="red">อ้างอิงบิล {sale.receiptNo}</Badge>
          <span className="text-xs font-normal text-slate-400">
            {fmtDateTime(sale.createdAt)}
          </span>
        </span>
      }
      footer={
        done ? undefined : (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              icon="undo"
              disabled={busy || picked.length === 0 || overRow != null}
              onClick={() => void confirm()}
            >
              {busy ? 'กำลังบันทึก…' : `ยืนยันคืนสินค้า ฿${baht(est)}`}
            </Button>
          </>
        )
      }
    >
      {done ? (
        /* ===== หน้าสำเร็จ + ถามพิมพ์ใบคืนสินค้า ===== */
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="rounded-full bg-emerald-100 p-4 text-emerald-600">
            <Icon name="check" size={44} />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-800">บันทึกการคืนสินค้าแล้ว</div>
            <div className="mt-0.5 text-xs text-slate-400">
              เอกสาร {done.receiptNo} · อ้างอิงบิล {sale.receiptNo}
            </div>
          </div>
          <div className="w-full rounded-2xl bg-rose-50 py-4">
            <div className="text-sm text-rose-500">ยอดคืนเงิน</div>
            <div className="text-4xl font-bold text-rose-600">
              ฿{baht(Math.abs(done.total))}
            </div>
            <div className="mt-1 text-xs text-rose-400">
              คืนผ่าน {METHODS.find((m) => m.key === done.paymentMethod)?.label ?? 'เงินสด'}
            </div>
          </div>
          {done.memberId != null && Math.abs(done.earnedPoints) > 0 && (
            <Badge color="amber">
              หักแต้ม {done.memberName ?? 'สมาชิก'} {Math.abs(done.earnedPoints)} แต้ม
            </Badge>
          )}
          <div className="mt-2 flex w-full gap-2">
            <Button
              variant="secondary"
              icon="printer"
              className="flex-1"
              onClick={() => printReceipt(done, settings)}
            >
              พิมพ์ใบคืนสินค้า
            </Button>
            <Button icon="check" className="flex-1" onClick={onClose}>
              เสร็จสิ้น
            </Button>
          </div>
        </div>
      ) : (
        /* ===== ฟอร์มเลือกรายการที่จะคืน ===== */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-2.5 text-sm">
            <span className="text-slate-500">
              ยอดบิลเดิม <span className="font-semibold text-slate-700">฿{baht(sale.total)}</span>
              {(sale.refundedTotal ?? 0) > 0 && (
                <span className="text-rose-500">
                  {' '}
                  · คืนแล้ว ฿{baht(sale.refundedTotal ?? 0)}
                </span>
              )}
              {sale.memberName && <span className="text-slate-400"> · {sale.memberName}</span>}
            </span>
            <span className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon="check"
                disabled={refundableRows.length === 0}
                onClick={fillAll}
              >
                เลือกทุกรายการ
              </Button>
              <Button variant="ghost" size="sm" onClick={clearAll}>
                ล้าง
              </Button>
            </span>
          </div>

          {/* ---- ตารางรายการ ---- */}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
              <span>รายการ</span>
              <span>จำนวนที่จะคืน</span>
            </div>
            <div className="divide-y divide-slate-100">
              {rows.map((r) => {
                const optLine = [...(r.it.options ?? []), r.it.note].filter(Boolean).join(', ')
                const refunded = r.it.refundedQty ?? 0
                const decimal = !Number.isInteger(r.it.qty) || !Number.isInteger(r.max)
                const bad = num(r.i) > r.max + 0.0001
                return (
                  <div
                    key={r.i}
                    className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                      r.max <= 0.0001 ? 'bg-slate-50/60' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800">
                        {r.it.name}
                        {r.it.unitName && (
                          <span className="text-xs font-normal text-slate-400">
                            {' '}
                            [{r.it.unitName}]
                          </span>
                        )}
                      </div>
                      {optLine && <div className="text-xs text-slate-400">{optLine}</div>}
                      <div className="mt-0.5 text-xs text-slate-500">
                        ขายไป {qtyText(r.it.qty)} × ฿{baht(r.it.price)} · รวม ฿
                        {baht(r.it.total)}
                        {refunded > 0 && (
                          <span className="text-rose-500"> · คืนแล้ว {qtyText(refunded)}</span>
                        )}
                      </div>
                      {bad && (
                        <div className="mt-0.5 text-xs font-medium text-rose-600">
                          คืนได้ไม่เกิน {qtyText(r.max)}
                        </div>
                      )}
                    </div>

                    {r.max <= 0.0001 ? (
                      <Badge color="slate">คืนครบแล้ว</Badge>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={r.max}
                          step={decimal ? 0.01 : 1}
                          placeholder="0"
                          className={`w-24 text-right ${bad ? 'border-rose-400' : ''}`}
                          value={qtyStr[r.i] ?? ''}
                          onChange={(e) => setQty(r.i, e.target.value)}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => fillRow(r.i, r.max)}
                          title={`คืนทั้งหมด ${qtyText(r.max)}`}
                        >
                          คืนทั้งหมด
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ---- ยอดคืนโดยประมาณ ---- */}
          <div className="rounded-2xl bg-rose-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-rose-600">ยอดคืนประมาณ</span>
              <span className="text-2xl font-bold text-rose-600">฿{baht(est)}</span>
            </div>
            <div className="mt-0.5 text-xs text-rose-400">
              คำนวณตามสัดส่วนส่วนลด/VAT ของบิลเดิม — ยอดจริงจะถูกคำนวณอีกครั้งเมื่อบันทึก
            </div>
          </div>

          {/* ---- ช่องทางคืนเงิน ---- */}
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-600">ช่องทางคืนเงิน</span>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMethod(m.key)}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 py-3 text-sm font-medium transition-colors ${
                    method === m.key
                      ? 'border-rose-500 bg-rose-50 text-rose-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <Icon name={m.icon} size={22} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* ---- เหตุผล (บังคับกรอก) ---- */}
          <Field label="เหตุผลการคืนสินค้า" hint="จำเป็นต้องระบุ — จะพิมพ์ลงใบคืนสินค้าด้วย">
            <Input
              placeholder="เช่น สินค้าชำรุด / ลูกค้าเปลี่ยนใจ"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {PRESET_REASONS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setReason(p)}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  reason === p
                    ? 'border-rose-300 bg-rose-50 text-rose-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
