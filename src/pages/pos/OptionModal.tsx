import { useState } from 'react'
import type { Product, ProductUnit } from '../../db/types'
import {
  effectivePrice,
  MAX_LINE_QTY,
  useCart,
  type AddProductOpts,
} from '../../stores/cartStore'
import { baht, r2 } from '../../lib/format'
import { Badge, Button, Field, Icon, Input, Modal, Textarea } from '../../components/ui'
import QtyStepper from './QtyStepper'

/** ปุ่มลัดน้ำหนักสำหรับสินค้าชั่งขาย */
const WEIGHT_SHORTCUTS = [0.25, 0.5, 1, 2]

const fmtQty = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 })

const PICK_BTN = (active: boolean) =>
  `cursor-pointer rounded-xl border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    active
      ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
  }`

/**
 * โมดัลก่อนลงตะกร้า: เลือกหน่วยขาย (แพ็ค/ลัง) + จำนวน (ทศนิยมได้ถ้าสินค้าชั่งน้ำหนัก)
 * + ตัวเลือกสินค้ากลุ่มละ 1 ตัวเลือก + โน้ต
 */
export default function OptionModal({
  product,
  lockedUnit,
  onAdd,
  onClose,
}: {
  product: Product
  /** หน่วยที่ยิงบาร์โค้ดมา — ล็อกไว้ไม่ให้เปลี่ยน */
  lockedUnit?: ProductUnit
  /**
   * ปลายทางที่จะรับสินค้า — ไม่ระบุ = ตะกร้าหน้าเคาน์เตอร์
   * ใบสั่งที่โต๊ะส่งของตัวเองมา เพื่อให้ตรรกะเลือกหน่วย/จำนวน/ตัวเลือก
   * เป็นโค้ดชุดเดียวกันทั้งสองทาง ไม่ต้องทำ UI ซ้ำ
   */
  onAdd?: (product: Product, opts: AddProductOpts) => void
  onClose: () => void
}) {
  const groups = product.options ?? []
  const units = product.units ?? []
  const baseUnitName = (product.unit ?? '').trim() || 'หน่วย'

  const lockedIdx = lockedUnit
    ? units.findIndex((u) => u.name === lockedUnit.name && u.factor === lockedUnit.factor)
    : -1
  const locked = lockedIdx >= 0

  const [unitIdx, setUnitIdx] = useState(lockedIdx) // -1 = หน่วยฐาน
  const [sel, setSel] = useState<number[]>(() => groups.map(() => 0))
  // เก็บจำนวนเป็นข้อความ เพื่อให้พิมพ์ทศนิยม (เช่น "0.5") ได้ลื่นไหล
  const [qtyStr, setQtyStr] = useState('1')
  const [note, setNote] = useState('')

  const unit = unitIdx >= 0 ? units[unitIdx] : undefined
  const isBase = !unit
  const unitName = unit ? unit.name : baseUnitName
  const decimal = !!product.allowDecimalQty && isBase

  const typed = Number(qtyStr)
  const safeTyped = Number.isFinite(typed) ? typed : 0
  const qty = decimal ? Math.max(0, r2(safeTyped)) : Math.max(0, Math.round(safeTyped))
  const setQty = (v: number) => setQtyStr(String(v))

  const priceDelta = r2(groups.reduce((s, g, i) => s + (g.choices[sel[i]]?.priceDelta ?? 0), 0))
  const listPrice = r2((unit ? unit.price : product.price) + priceDelta)
  const wholesalePrice =
    isBase && product.wholesalePrice != null ? r2(product.wholesalePrice + priceDelta) : undefined
  const wholesaleMinQty = isBase ? product.wholesaleMinQty : undefined

  const unitPrice = effectivePrice(
    { listPrice, wholesalePrice, wholesaleMinQty, unitFactor: unit ? unit.factor : 1 },
    qty,
  )
  const isWholesale = unitPrice < listPrice
  const lineTotal = r2(unitPrice * qty)
  // จำนวนเกินเพดาน = แทบทุกครั้งคือเผลอยิงบาร์โค้ดลงช่องจำนวน (Enter ของสแกนเนอร์กดยืนยันเอง)
  const qtyTooBig = qty > MAX_LINE_QTY
  const canConfirm = qty > 0 && !qtyTooBig

  /** เปลี่ยนหน่วย — ถ้าหน่วยใหม่ขายเป็นชิ้น ต้องปัดจำนวนทศนิยมขึ้นเป็นจำนวนเต็ม */
  const pickUnit = (idx: number) => {
    if (locked) return
    setUnitIdx(idx)
    const nextDecimal = !!product.allowDecimalQty && idx < 0
    if (!nextDecimal) setQty(Math.max(1, Math.round(qty)))
  }

  const confirm = () => {
    if (!canConfirm) return
    const labels = groups.map((g, i) => g.choices[sel[i]]?.label ?? '').filter((l) => l !== '')
    const opts: AddProductOpts = { options: labels, priceDelta, note, qty, unit }
    if (onAdd) onAdd(product, opts)
    else useCart.getState().addProduct(product, opts)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      footer={
        <>
          <div className="mr-auto self-center text-sm text-slate-500">
            ฿{baht(unitPrice)} / {unitName} × {fmtQty(qty)}
            {isWholesale && <span className="ml-1 text-emerald-600">(ราคาส่ง)</span>}
          </div>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button icon="plus" disabled={!canConfirm} onClick={confirm}>
            เพิ่มลงตะกร้า ฿{baht(lineTotal)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* ===== หน่วยขาย ===== */}
        {units.length > 0 && (
          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-600">หน่วยขาย</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={locked}
                onClick={() => pickUnit(-1)}
                className={PICK_BTN(isBase)}
              >
                {baseUnitName}
                <span className={`ml-1 text-xs ${isBase ? 'text-emerald-600' : 'text-slate-400'}`}>
                  ฿{baht(product.price)}
                </span>
              </button>
              {units.map((u, i) => {
                const active = unitIdx === i
                return (
                  <button
                    key={`${u.name}-${i}`}
                    type="button"
                    disabled={locked && lockedIdx !== i}
                    onClick={() => pickUnit(i)}
                    className={PICK_BTN(active)}
                  >
                    {u.name}
                    <span
                      className={`ml-1 text-xs ${active ? 'text-emerald-600' : 'text-slate-400'}`}
                    >
                      ฿{baht(u.price)}
                    </span>
                    <span className="ml-1 text-[11px] text-slate-400">
                      = {fmtQty(u.factor)} {baseUnitName}
                    </span>
                  </button>
                )
              })}
            </div>
            {locked && (
              <div className="mt-1.5 text-xs text-slate-400">
                ล็อกหน่วยตามบาร์โค้ดที่ยิงมา ({unitName})
              </div>
            )}
          </div>
        )}

        {/* ===== ราคาส่ง (หน่วยฐานเท่านั้น) ===== */}
        {wholesalePrice != null && wholesaleMinQty != null && wholesaleMinQty > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <span>
              ซื้อครบ {fmtQty(wholesaleMinQty)} {unitName} ขึ้นไป ได้ราคาส่ง ฿{baht(wholesalePrice)}/
              {unitName}
            </span>
            {isWholesale && (
              <Badge color="green" className="ml-auto shrink-0">
                ใช้ราคาส่งแล้ว
              </Badge>
            )}
          </div>
        )}

        {/* ===== จำนวน ===== */}
        {decimal ? (
          <div>
            <div className="mb-1.5 flex items-end justify-between gap-2">
              <span className="text-sm font-semibold text-slate-600">จำนวน ({unitName})</span>
              <span className="text-xs text-slate-400">กรอกน้ำหนักได้ เช่น 0.5</span>
            </div>
            <Input
              autoFocus
              type="number"
              min={0.01}
              step={0.01}
              className="py-2.5 text-center text-xl font-bold"
              value={qtyStr}
              // เลือกข้อความทั้งหมดตอนโฟกัส — ถ้าเผลอยิงบาร์โค้ด ค่าจะถูกแทนที่ ไม่ต่อท้ายเลข 1 เดิม
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setQtyStr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.repeat) confirm()
              }}
            />
            {qtyTooBig && (
              <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
                <Icon name="alert" size={14} className="mt-px" />
                จำนวนต้องไม่เกิน {fmtQty(MAX_LINE_QTY)} {unitName} — ถ้าเผลอยิงบาร์โค้ดลงช่องนี้
                ให้ลบตัวเลขแล้วกรอกน้ำหนักใหม่
              </div>
            )}
            <div className="mt-2 grid grid-cols-4 gap-2">
              {WEIGHT_SHORTCUTS.map((v) => (
                <Button key={v} variant="secondary" size="sm" onClick={() => setQty(v)}>
                  {fmtQty(v)} {unitName}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-600">จำนวน ({unitName})</span>
            <QtyStepper value={qty} onChange={setQty} />
          </div>
        )}

        {/* ===== ตัวเลือกสินค้า (กลุ่มละ 1 ตัวเลือก) ===== */}
        {groups.map((g, gi) => (
          <div key={gi}>
            <div className="mb-1.5 text-sm font-semibold text-slate-600">{g.name}</div>
            <div className="flex flex-wrap gap-2">
              {g.choices.map((c, ci) => {
                const active = sel[gi] === ci
                return (
                  <button
                    key={ci}
                    type="button"
                    onClick={() => setSel((s) => s.map((v, i) => (i === gi ? ci : v)))}
                    className={PICK_BTN(active)}
                  >
                    {c.label}
                    {c.priceDelta > 0 && (
                      <span
                        className={`ml-1 text-xs ${active ? 'text-emerald-600' : 'text-slate-400'}`}
                      >
                        +฿{baht(c.priceDelta)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <Field label="โน้ต (ถ้ามี)">
          <Textarea
            rows={2}
            placeholder="เช่น ไม่ใส่น้ำแข็ง แยกซอส…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
