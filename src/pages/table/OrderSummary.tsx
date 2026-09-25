import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Settings } from '../../db/types'
import type { CartItem } from '../../stores/cartStore'
import { computeTotals } from '../../lib/totals'
import { baht } from '../../lib/format'
import { Button, Icon } from '../../components/ui'
import OrderLines from './OrderLines'

/* =========================================================
   ขั้นที่ 3 — สรุปรายการที่ลูกค้าสั่ง (ล็อกยอด)

   **ยอดในหน้านี้ต้องมาจาก computeTotals() ตัวเดียวกับหน้าเคาน์เตอร์**
   เพราะขั้นที่ 4 จะเอายอดนี้ไปฝังใน QR พร้อมเพย์ แล้วขั้นที่ 6 เครื่องกลาง
   จะเรียก finalizeSale() คิดยอดใหม่อีกครั้ง — ถ้าสองทางคิดไม่เหมือนกัน
   ลูกค้าจะจ่ายไม่ตรงกับบิล ซึ่งตามแก้ทีหลังไม่ได้

   โปรโมชันอัตโนมัติจึงต้องคิดที่นี่ด้วย (ไม่ใช่ข้ามไป) ส่วนส่วนลดที่คนกดเอง
   คูปอง และแต้ม ไม่มีที่โต๊ะตามที่ตกลงไว้ — ลูกค้าที่ขอต้องไปเคาน์เตอร์
   ========================================================= */

export default function OrderSummary({
  tableLabel,
  items,
  settings,
  onBack,
  onDiscard,
}: {
  tableLabel: string
  items: CartItem[]
  settings: Settings
  /** กลับไปแก้รายการ (ปลดล็อกยอด) */
  onBack: () => void
  onDiscard: () => void
}) {
  const promos = useLiveQuery(() => db.promotions.toArray(), []) ?? []

  const totals = useMemo(
    () =>
      computeTotals({
        items,
        promos,
        settings,
        billDiscountType: 'amount',
        billDiscountValue: 0,
        redeemPoints: 0,
      }),
    [items, promos, settings],
  )

  const promoDiscount = totals.promoLineDiscount + totals.promoBillDiscount

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="rounded-2xl bg-white p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-slate-800">โต๊ะ {tableLabel}</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              ยอดล็อกแล้ว
            </span>
          </div>

          <div className="mt-2 border-t border-slate-100 pt-1">
            <OrderLines items={items} readOnly />
          </div>

          <dl className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">รวมสินค้า</dt>
              <dd className="tabular-nums text-slate-700">฿{baht(totals.subtotal)}</dd>
            </div>
            {promoDiscount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>ส่วนลดโปรโมชัน</dt>
                <dd className="tabular-nums">−฿{baht(promoDiscount)}</dd>
              </div>
            )}
            {totals.vatAmount > 0 && (
              <div className="flex justify-between text-slate-400">
                <dt>
                  VAT {settings.vatRate}%{settings.vatIncluded ? ' (รวมในราคาแล้ว)' : ''}
                </dt>
                <dd className="tabular-nums">฿{baht(totals.vatAmount)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
              <dt className="font-medium text-slate-700">ยอดที่ลูกค้าต้องจ่าย</dt>
              <dd className="text-2xl leading-none font-bold text-slate-900 tabular-nums">
                ฿{baht(totals.payable)}
              </dd>
            </div>
          </dl>
        </div>

        {/* ขั้นที่ 4-6 ยังไม่ได้สร้าง — บอกตรงๆ ดีกว่าให้ปุ่มที่กดแล้วไม่เกิดอะไร */}
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-xs leading-relaxed text-amber-900">
            <span className="font-medium">ขั้นถัดไปยังสร้างไม่เสร็จ</span> — การกาง QR ให้ลูกค้า
            สแกนจ่าย ถ่ายรูปสลิป และส่งเข้าเครื่องกลาง เป็นงานก้อนต่อไป
            ตอนนี้ทดสอบได้ถึงขั้นสรุปยอดนี้
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white p-3">
        <Button size="lg" icon="qr" className="w-full" disabled>
          กาง QR ให้ลูกค้าสแกนจ่าย
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" icon="undo" className="flex-1" onClick={onBack}>
            กลับไปแก้รายการ
          </Button>
          <Button variant="ghost" icon="trash" className="text-rose-500" onClick={onDiscard}>
            ทิ้งใบสั่ง
          </Button>
        </div>
      </div>
    </div>
  )
}
