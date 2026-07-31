import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Coupon, Member, Settings } from '../../db/types'
import type { Totals } from '../../lib/totals'
import { checkCoupon, normalizeCode } from '../../lib/coupons'
import { useCart } from '../../stores/cartStore'
import { useCurrentStaff, usePermissions } from '../../db/hooks'
import { baht, fmtTime, r2 } from '../../lib/format'
import { Badge, Button, ConfirmDialog, EmptyState, Icon, Input, toast } from '../../components/ui'
import PinApprovalModal from '../../components/auth/PinApprovalModal'
import MemberModal from './MemberModal'
import EditItemModal from './EditItemModal'
import HeldBillsModal from './HeldBillsModal'

const STEP_BTN =
  'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100'

/** จำนวนอาจเป็นทศนิยม (สินค้าชั่งน้ำหนัก) — ไม่ปัดทิ้ง */
const fmtQty = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 })

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
  /** คูปองที่ resolve จากโค้ดในตะกร้า (undefined = ไม่พบ หรือยังไม่ใส่) */
  coupon?: Coupon
  /** กำลังค้นคูปองจากฐานข้อมูล — ยังไม่ต้องเตือนว่าใช้ไม่ได้ */
  couponLoading?: boolean
  onCheckout: () => void
}

/** แผงตะกร้าฝั่งขวา: สมาชิก / รายการ / คูปอง / สรุปยอด / ปุ่มพักบิล-เรียกบิล-ล้าง-ชำระเงิน */
export default function CartPanel({
  settings,
  totals,
  member,
  coupon,
  couponLoading = false,
  onCheckout,
}: Props) {
  const items = useCart((s) => s.items)
  const memberId = useCart((s) => s.memberId)
  const billDiscountType = useCart((s) => s.billDiscountType)
  const billDiscountValue = useCart((s) => s.billDiscountValue)
  const redeemPoints = useCart((s) => s.redeemPoints)
  const couponCode = useCart((s) => s.couponCode)
  const discountApprovedById = useCart((s) => s.discountApprovedById)
  const discountApprovedByName = useCart((s) => s.discountApprovedByName)
  const setQty = useCart((s) => s.setQty)
  const setMember = useCart((s) => s.setMember)
  const setBillDiscount = useCart((s) => s.setBillDiscount)
  const setRedeemPoints = useCart((s) => s.setRedeemPoints)
  const setCouponCode = useCart((s) => s.setCouponCode)
  const setDiscountApproval = useCart((s) => s.setDiscountApproval)
  const clearDiscounts = useCart((s) => s.clearDiscounts)

  const heldCount = useLiveQuery(() => db.heldBills.count(), []) ?? 0

  const [memberOpen, setMemberOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [billOpen, setBillOpen] = useState(false)
  const [editKey, setEditKey] = useState<string | null>(null)
  const [couponOpen, setCouponOpen] = useState(false)
  const [couponInput, setCouponInput] = useState('')
  const [couponBusy, setCouponBusy] = useState(false)

  /* ===== สิทธิ์ให้ส่วนลด =====
     พนักงานที่ไม่มีสิทธิ์ 'discount' ต้องให้ผู้จัดการใส่ PIN อนุมัติ
     การอนุมัติมีผลกับ "บิลใบนี้" เท่านั้น — ล้างตะกร้าแล้วต้องขออนุมัติใหม่

     สถานะอนุมัติเก็บไว้ในตะกร้า (cartStore) ไม่ใช่ใน state ของคอมโพเนนต์นี้
     เพราะตัวเลขส่วนลดอยู่ในตะกร้าซึ่ง persist ลง localStorage และถูกเขียนลง heldBills
     ถ้าเก็บแยกกัน สถานะอนุมัติจะหายตอนรีเฟรช/พักบิล ทั้งที่ส่วนลดยังอยู่ */
  const { can, enabled, staff } = usePermissions()
  const { loading: staffLoading } = useCurrentStaff()
  const [askDiscount, setAskDiscount] = useState(false)
  const canDiscount = can('discount')
  const mayDiscount = canDiscount || discountApprovedById != null

  /* ===== ล้างส่วนลดที่ค้างมาโดยไม่มีผู้อนุมัติ =====
     ครอบคลุมทุกทางที่ตัวเลขส่วนลดเข้ามาในตะกร้าโดยข้ามหน้าจอนี้:
     รีเฟรชหน้า (rehydrate จาก localStorage) / เรียกบิลที่พักไว้ / สลับผู้ใช้กลางบิล */
  const itemDiscountTotal = items.reduce((s, it) => s + it.manualDiscount, 0)
  const hasPendingDiscount =
    billDiscountValue > 0 || !!couponCode || redeemPoints > 0 || itemDiscountTotal > 0
  // ระหว่างอ่านแถวพนักงาน staff ยังเป็น null → can() คืน false ชั่วขณะ
  // ถ้าล้างตอนนั้นจะไปลบส่วนลดของผู้จัดการที่มีสิทธิ์อยู่แล้วตอนรีเฟรชหน้า
  const permsReady = !enabled || (!staffLoading && staff != null)
  // กันยิงซ้ำ: ล้างได้ครั้งเดียวต่อหนึ่งเหตุการณ์ แล้วรีเซ็ตเมื่อไม่มีส่วนลดค้างแล้ว
  const clearedRef = useRef(false)
  useEffect(() => {
    // ปิดระบบพนักงาน → canDiscount เป็น true เสมอ จึงไม่มีทางเข้าเงื่อนไขนี้
    if (!permsReady || canDiscount || discountApprovedById != null || !hasPendingDiscount) {
      clearedRef.current = false
      return
    }
    if (clearedRef.current) return
    clearedRef.current = true
    clearDiscounts()
    toast.error('ส่วนลดที่ค้างอยู่ถูกยกเลิก — ต้องขออนุมัติใหม่สำหรับบิลนี้')
  }, [permsReady, canDiscount, discountApprovedById, hasPendingDiscount, clearDiscounts])

  /** เปิดแผงส่วนลด/คูปอง/แต้ม ถ้ามีสิทธิ์ ไม่มีก็ขออนุมัติก่อน */
  const guardDiscount = (open: () => void) => {
    if (mayDiscount) open()
    else setAskDiscount(true)
  }

  const editItem = items.find((it) => it.key === editKey) ?? null
  const qtyTotal = r2(items.reduce((s, it) => s + it.qty, 0))

  // แต้มสูงสุดที่แลกได้ = min(แต้มคงเหลือ, ยอดที่เหลือให้ลด / มูลค่าต่อแต้ม)
  const maxRedeem =
    member && settings.redeemValue > 0
      ? Math.min(
          member.points,
          Math.floor((totals.net + totals.pointDiscount) / settings.redeemValue),
        )
      : 0

  // ยอดฐานสำหรับตรวจเงื่อนไขคูปอง = หลังหักส่วนลดรายการ + โปรโมชัน (ตรงกับลำดับใน computeTotals)
  const couponBase = Math.max(
    0,
    r2(
      totals.subtotal -
        totals.itemManualDiscount -
        totals.promoLineDiscount -
        totals.promoBillDiscount,
    ),
  )
  // คูปองที่ใส่ไว้ยังใช้ได้อยู่หรือไม่ (ยอดบิลอาจเปลี่ยนจนต่ำกว่าขั้นต่ำ)
  const couponCheck = couponCode && !couponLoading ? checkCoupon(coupon, couponBase) : null
  const couponInvalid = couponCheck != null && !couponCheck.ok

  const applyCoupon = async () => {
    const code = normalizeCode(couponInput)
    if (!code || couponBusy) return
    setCouponBusy(true)
    try {
      const found = await db.coupons.where('code').equals(code).first()
      const res = checkCoupon(found, couponBase)
      if (!res.ok) {
        toast.error(res.reason ?? 'ใช้คูปองนี้ไม่ได้')
        return
      }
      setCouponCode(code)
      setCouponInput('')
      setCouponOpen(false)
      toast.success(`ใช้คูปอง ${code} แล้ว`)
    } catch {
      toast.error('ตรวจสอบคูปองไม่สำเร็จ')
    } finally {
      setCouponBusy(false)
    }
  }

  const removeCoupon = () => {
    setCouponCode(undefined)
    setCouponInput('')
    setCouponOpen(false)
  }

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
      couponCode,
      // ส่วนลดถูกพักไปพร้อมบิล ผู้อนุมัติจึงต้องไปด้วย ไม่งั้นเรียกบิลกลับมาแล้ว
      // จะได้ส่วนลดที่ไม่มีใครรับผิดชอบ (และถูกล้างทิ้งทั้งที่ผู้จัดการอนุมัติไว้แล้ว)
      discountApprovedById,
      discountApprovedByName,
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
              const step = it.allowDecimalQty ? 0.25 : 1
              const isWholesale = it.price < it.listPrice
              return (
                <div
                  key={it.key}
                  onClick={() => setEditKey(it.key)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-slate-700">{it.name}</span>
                      {it.unitName && (
                        <Badge color="blue" className="shrink-0 px-1.5 py-0 text-[10px]">
                          {it.unitName}
                        </Badge>
                      )}
                    </div>
                    {sub && <div className="truncate text-xs text-slate-400">{sub}</div>}
                    {isWholesale && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                        <Badge color="green" className="px-1.5 py-0 text-[10px]">
                          ราคาส่ง
                        </Badge>
                        <span className="text-slate-400 line-through">฿{baht(it.listPrice)}</span>
                        <span className="font-medium text-emerald-600">฿{baht(it.price)}</span>
                      </div>
                    )}
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
                      onClick={() => setQty(it.key, r2(it.qty - step))}
                    >
                      <Icon name="minus" size={13} />
                    </button>
                    <button
                      type="button"
                      title="กดเพื่อแก้จำนวน"
                      onClick={() => setEditKey(it.key)}
                      className="min-w-9 cursor-pointer rounded-md px-0.5 text-center text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                    >
                      {fmtQty(it.qty)}
                    </button>
                    <button
                      type="button"
                      className={STEP_BTN}
                      onClick={() => setQty(it.key, r2(it.qty + step))}
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
          <Row label={`ยอดรวม (${fmtQty(qtyTotal)} ชิ้น)`} value={baht(totals.subtotal)} />

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

          {/* ส่วนลดคูปอง */}
          {totals.couponDiscount > 0 && (
            <div className="flex items-center justify-between gap-2 text-emerald-600">
              <span className="flex min-w-0 items-center gap-1">
                <Icon name="ticket" size={13} />
                <span className="truncate">คูปอง {totals.couponCode ?? couponCode}</span>
              </span>
              <span className="shrink-0">-{baht(totals.couponDiscount)}</span>
            </div>
          )}

          {/* ส่วนลดท้ายบิล (คลิกเพื่อกรอก) */}
          <div>
            <button
              type="button"
              onClick={() => guardDiscount(() => setBillOpen((o) => !o))}
              className="flex w-full cursor-pointer items-center justify-between transition-colors hover:text-slate-800"
            >
              <span className="flex items-center gap-1">
                ส่วนลดท้ายบิล
                <Icon name={mayDiscount ? 'pencil' : 'lock'} size={12} className="text-slate-400" />
              </span>
              <span className={totals.billManualDiscount > 0 ? 'text-rose-500' : 'text-slate-400'}>
                {totals.billManualDiscount > 0
                  ? `-${baht(totals.billManualDiscount)}`
                  : mayDiscount
                    ? 'กดเพื่อกรอก'
                    : 'ต้องขออนุมัติ'}
              </span>
            </button>
            {billOpen && mayDiscount && (
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

          {/* ===== คูปอง ===== */}
          {couponCode ? (
            couponInvalid ? (
              <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-2.5 py-1.5 text-amber-700">
                <Icon name="alert" size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 text-xs leading-snug">
                  คูปองยังใช้ไม่ได้: {couponCheck?.reason ?? 'เงื่อนไขไม่ครบ'}
                </span>
                <button
                  type="button"
                  title="เอาคูปองออก"
                  onClick={removeCoupon}
                  className="shrink-0 cursor-pointer rounded-md p-0.5 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-2.5 py-1.5">
                <Icon name="ticket" size={14} className="shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-emerald-800">
                    {couponCode}
                    {coupon ? ` · ${coupon.name}` : ''}
                  </div>
                </div>
                <span className="shrink-0 text-xs font-semibold text-emerald-700">
                  -{baht(totals.couponDiscount)}
                </span>
                <button
                  type="button"
                  title="เอาคูปองออก"
                  onClick={removeCoupon}
                  className="shrink-0 cursor-pointer rounded-md p-0.5 text-emerald-500 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            )
          ) : (
            <div>
              <button
                type="button"
                onClick={() => guardDiscount(() => setCouponOpen((o) => !o))}
                className="flex w-full cursor-pointer items-center justify-between transition-colors hover:text-slate-800"
              >
                <span className="flex items-center gap-1">
                  <Icon name={mayDiscount ? 'ticket' : 'lock'} size={13} className="text-slate-400" />
                  คูปองส่วนลด
                </span>
                <span className="text-slate-400">
                  {mayDiscount ? 'ใส่โค้ดคูปอง' : 'ต้องขออนุมัติ'}
                </span>
              </button>
              {couponOpen && mayDiscount && (
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    autoFocus
                    className="py-1.5 uppercase"
                    placeholder="เช่น SAVE50"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void applyCoupon()
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!couponInput.trim() || couponBusy}
                    onClick={() => void applyCoupon()}
                  >
                    {couponBusy ? 'ตรวจสอบ…' : 'ใช้'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* แลกแต้ม (เมื่อมีสมาชิก) */}
          {member && settings.redeemValue > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex shrink-0 items-center gap-1">
                  แลกแต้ม
                  {!mayDiscount && <Icon name="lock" size={12} className="text-slate-400" />}
                </span>
                {mayDiscount ? (
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
                ) : (
                  <button
                    type="button"
                    onClick={() => setAskDiscount(true)}
                    className="cursor-pointer text-slate-400 transition-colors hover:text-slate-600"
                  >
                    ต้องขออนุมัติ
                  </button>
                )}
              </div>
              {totals.redeemedPoints > 0 && (
                <div className="mt-0.5 text-right text-xs text-emerald-600">
                  ใช้ {totals.redeemedPoints} แต้ม = -{baht(totals.pointDiscount)}
                </div>
              )}
            </div>
          )}

          {/* ร่องรอยว่าใครอนุมัติส่วนลดของบิลนี้ (ค้างอยู่จนกว่าจะจบบิล) */}
          {discountApprovedByName && (
            <div className="flex items-center gap-1 text-xs text-amber-600">
              <Icon name="shield" size={12} className="shrink-0" />
              <span className="truncate">อนุมัติส่วนลดโดย {discountApprovedByName}</span>
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
      <PinApprovalModal
        open={askDiscount}
        perm="discount"
        title="ขออนุมัติให้ส่วนลด"
        description="อนุมัติแล้วจะให้ส่วนลด / ใช้คูปอง / แลกแต้ม ได้เฉพาะบิลใบนี้"
        onClose={() => setAskDiscount(false)}
        onApprove={(approver) => {
          setDiscountApproval({ id: approver.id, name: approver.name })
          setAskDiscount(false)
          toast.success(`${approver.name} อนุมัติส่วนลดของบิลนี้แล้ว`)
        }}
      />
    </aside>
  )
}
