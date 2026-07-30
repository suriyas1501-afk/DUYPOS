import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Member, Settings } from '../../db/types'
import type { Totals } from '../../lib/totals'
import { useCart } from '../../stores/cartStore'
import { baht, fmtTime, r2 } from '../../lib/format'
import { Button, ConfirmDialog, EmptyState, Icon, Input, toast } from '../../components/ui'
import MemberModal from './MemberModal'
import EditItemModal from './EditItemModal'
import HeldBillsModal from './HeldBillsModal'

const STEP_BTN =
  'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100'

function Row({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

interface Props {
  settings: Settings
  totals: Totals
  member?: Member
  onCheckout: () => void
}

/** แผงตะกร้าฝั่งขวา: สมาชิก / รายการ / สรุปยอด / ปุ่มพักบิล-เรียกบิล-ล้าง-ชำระเงิน */
export default function CartPanel({ settings, totals, member, onCheckout }: Props) {
  const items = useCart((s) => s.items)
  const memberId = useCart((s) => s.memberId)
  const billDiscountType = useCart((s) => s.billDiscountType)
  const billDiscountValue = useCart((s) => s.billDiscountValue)
  const redeemPoints = useCart((s) => s.redeemPoints)
  const setQty = useCart((s) => s.setQty)
  const setMember = useCart((s) => s.setMember)
  const setBillDiscount = useCart((s) => s.setBillDiscount)
  const setRedeemPoints = useCart((s) => s.setRedeemPoints)

  const heldCount = useLiveQuery(() => db.heldBills.count(), []) ?? 0

  const [memberOpen, setMemberOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [billOpen, setBillOpen] = useState(false)
  const [editKey, setEditKey] = useState<string | null>(null)

  const editItem = items.find((it) => it.key === editKey) ?? null
  const qtyTotal = items.reduce((s, it) => s + it.qty, 0)

  // แต้มสูงสุดที่แลกได้ = min(แต้มคงเหลือ, ยอดที่เหลือให้ลด / มูลค่าต่อแต้ม)
  const maxRedeem =
    member && settings.redeemValue > 0
      ? Math.min(
          member.points,
          Math.floor((totals.net + totals.pointDiscount) / settings.redeemValue),
        )
      : 0

  const holdBill = async () => {
    if (items.length === 0) return
    const label = `${fmtTime(Date.now())} · ${member ? member.name : `${items.length} รายการ`}`
    await db.heldBills.add({
      label,
      items,
      memberId,
      billDiscountType,
      billDiscountValue,
      redeemPoints,
      createdAt: Date.now(),
    })
    useCart.getState().clear()
    toast.success('พักบิลแล้ว')
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-slate-200 bg-white">
      {/* ===== แถบสมาชิก ===== */}
      <div className="shrink-0 border-b border-slate-100 p-3">
        {member ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 px-3 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="user" size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-emerald-800">{member.name}</div>
              <div className="text-xs text-emerald-600">แต้มคงเหลือ {baht(member.points)} แต้ม</div>
            </div>
            <button
              type="button"
              title="เอาสมาชิกออก"
              onClick={() => setMember(undefined)}
              className="cursor-pointer rounded-lg p-1 text-emerald-500 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon="user"
            className="w-full"
            onClick={() => setMemberOpen(true)}
          >
            เพิ่มสมาชิก
          </Button>
        )}
      </div>

      {/* ===== รายการในตะกร้า ===== */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState
            icon="cart"
            title="ตะกร้าว่าง"
            hint="เลือกสินค้าทางซ้าย หรือยิงบาร์โค้ดเพื่อเริ่มขาย"
          />
        ) : (
          <div className="divide-y divide-slate-50">
            {items.map((it) => {
              const lineDiscount = Math.min(it.manualDiscount, r2(it.price * it.qty))
              const lineTotal = Math.max(0, r2(it.price * it.qty - lineDiscount))
              const sub = [...(it.options ?? []), it.note].filter(Boolean).join(' · ')
              return (
                <div
                  key={it.key}
                  onClick={() => setEditKey(it.key)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-700">{it.name}</div>
                    {sub && <div className="truncate text-xs text-slate-400">{sub}</div>}
                    {lineDiscount > 0 && (
                      <div className="text-xs text-rose-500">ส่วนลด -{baht(lineDiscount)}</div>
                    )}
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className={STEP_BTN}
                      onClick={() => setQty(it.key, it.qty - 1)}
                    >
                      <Icon name="minus" size={13} />
                    </button>
                    <span className="w-7 text-center text-sm font-semibold text-slate-700">
                      {it.qty}
                    </span>
                    <button
                      type="button"
                      className={STEP_BTN}
                      onClick={() => setQty(it.key, it.qty + 1)}
                    >
                      <Icon name="plus" size={13} />
                    </button>
                  </div>
                  <div className="w-16 shrink-0 text-right text-sm font-semibold text-slate-800">
                    {baht(lineTotal)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ===== สรุปยอด ===== */}
      {items.length > 0 && (
        <div className="shrink-0 space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
          <Row label={`ยอดรวม (${qtyTotal} ชิ้น)`} value={baht(totals.subtotal)} />

          {totals.itemManualDiscount > 0 && (
            <Row
              label="ส่วนลดรายการ"
              value={`-${baht(totals.itemManualDiscount)}`}
              className="text-rose-500"
            />
          )}

          {totals.applied.map((a) => (
            <div key={a.name} className="flex items-center justify-between gap-2 text-emerald-600">
              <span className="flex min-w-0 items-center gap-1">
                <Icon name="tag" size={13} />
                <span className="truncate">{a.name}</span>
              </span>
              <span className="shrink-0">-{baht(a.amount)}</span>
            </div>
          ))}

          {/* ส่วนลดท้ายบิล (คลิกเพื่อกรอก) */}
          <div>
            <button
              type="button"
              onClick={() => setBillOpen((o) => !o)}
              className="flex w-full cursor-pointer items-center justify-between transition-colors hover:text-slate-800"
            >
              <span className="flex items-center gap-1">
                ส่วนลดท้ายบิล
                <Icon name="pencil" size={12} className="text-slate-400" />
              </span>
              <span className={totals.billManualDiscount > 0 ? 'text-rose-500' : 'text-slate-400'}>
                {totals.billManualDiscount > 0 ? `-${baht(totals.billManualDiscount)}` : 'กดเพื่อกรอก'}
              </span>
            </button>
            {billOpen && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-300 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setBillDiscount('percent', billDiscountValue)}
                    className={`cursor-pointer px-2.5 py-1.5 transition-colors ${
                      billDiscountType === 'percent'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillDiscount('amount', billDiscountValue)}
                    className={`cursor-pointer px-2.5 py-1.5 transition-colors ${
                      billDiscountType === 'amount'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    ฿
                  </button>
                </div>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  className="py-1.5 text-right"
                  placeholder="0"
                  value={billDiscountValue || ''}
                  onChange={(e) =>
                    setBillDiscount(billDiscountType, Number(e.target.value) || 0)
                  }
                />
              </div>
            )}
          </div>

          {/* แลกแต้ม (เมื่อมีสมาชิก) */}
          {member && settings.redeemValue > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0">แลกแต้ม</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    max={maxRedeem}
                    className="w-20 py-1 text-right"
                    placeholder="0"
                    value={redeemPoints || ''}
                    onChange={(e) => setRedeemPoints(Number(e.target.value) || 0)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={maxRedeem <= 0}
                    onClick={() => setRedeemPoints(maxRedeem)}
                  >
                    สูงสุด
                  </Button>
                </div>
              </div>
              {totals.redeemedPoints > 0 && (
                <div className="mt-0.5 text-right text-xs text-emerald-600">
                  ใช้ {totals.redeemedPoints} แต้ม = -{baht(totals.pointDiscount)}
                </div>
              )}
            </div>
          )}

          {/* VAT */}
          {settings.vatRate > 0 &&
            (settings.vatIncluded ? (
              <div className="text-right text-xs text-slate-400">
                รวม VAT {settings.vatRate}%: {baht(totals.vatAmount)}
              </div>
            ) : (
              <Row label={`VAT ${settings.vatRate}%`} value={`+${baht(totals.vatAmount)}`} />
            ))}
        </div>
      )}

      {/* ===== ยอดสุทธิ + ปุ่ม ===== */}
      <div className="shrink-0 space-y-2 border-t border-slate-200 p-3">
        <div className="flex items-end justify-between px-1">
          <span className="text-sm font-semibold text-slate-600">ยอดสุทธิ</span>
          <span className="text-2xl font-bold text-emerald-700">฿{baht(totals.payable)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon="pause"
            disabled={items.length === 0}
            onClick={() => void holdBill()}
          >
            พักบิล
          </Button>
          <Button variant="secondary" size="sm" icon="history" onClick={() => setHeldOpen(true)}>
            เรียกบิล{heldCount > 0 ? ` (${heldCount})` : ''}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon="trash"
            disabled={items.length === 0}
            onClick={() => setClearOpen(true)}
          >
            ล้าง
          </Button>
        </div>
        <Button
          size="lg"
          icon="cash"
          className="w-full"
          disabled={items.length === 0}
          onClick={onCheckout}
        >
          ชำระเงิน ฿{baht(totals.payable)}
        </Button>
        <div className="text-center text-[11px] text-slate-300">กด F9 เพื่อชำระเงิน</div>
      </div>

      {/* ===== โมดัล ===== */}
      <MemberModal open={memberOpen} onClose={() => setMemberOpen(false)} />
      <HeldBillsModal open={heldOpen} onClose={() => setHeldOpen(false)} />
      {editItem && (
        <EditItemModal key={editItem.key} item={editItem} onClose={() => setEditKey(null)} />
      )}
      <ConfirmDialog
        open={clearOpen}
        title="ล้างตะกร้า"
        message="รายการทั้งหมดในตะกร้าจะถูกลบ ต้องการล้างตะกร้าหรือไม่?"
        confirmLabel="ล้างตะกร้า"
        danger
        onConfirm={() => useCart.getState().clear()}
        onClose={() => setClearOpen(false)}
      />
    </aside>
  )
}
