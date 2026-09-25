import { useState } from 'react'
import type { CartItem } from '../../stores/cartStore'
import { baht } from '../../lib/format'
import { Button, EmptyState, Icon, Modal, Textarea } from '../../components/ui'

/* =========================================================
   รายการในใบสั่ง — ใช้ร่วมกันทั้งขั้นที่ 2 (แก้ได้) และขั้นที่ 3 (อ่านอย่างเดียว)

   สูตรยอดต่อบรรทัดต้องเป็น price * qty เหมือน computeTotals() เท่านั้น
   ห้ามคิดสูตรใหม่ที่นี่ ไม่งั้นตัวเลขบนจอกับยอดที่ใช้จ่ายเงินจะไม่ตรงกัน
   ========================================================= */

const fmtQty = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 })

export default function OrderLines({
  items,
  readOnly,
  onSetQty,
  onSetNote,
  onRemove,
}: {
  items: CartItem[]
  /** ขั้นที่ 3 ล็อกยอดแล้ว — ซ่อนปุ่มแก้ทั้งหมด */
  readOnly?: boolean
  onSetQty?: (key: string, qty: number) => void
  /** แก้โน้ตต่อบรรทัด — จำเป็นเพราะสินค้าที่ไม่มีตัวเลือกจะไม่ได้ผ่านหน้าถามอะไรเลย */
  onSetNote?: (key: string, note: string) => void
  onRemove?: (key: string) => void
}) {
  /** บรรทัดที่กำลังแก้โน้ต */
  const [noting, setNoting] = useState<CartItem | null>(null)
  const [draft, setDraft] = useState('')

  const openNote = (it: CartItem) => {
    setDraft(it.note ?? '')
    setNoting(it)
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="cart"
        title="ยังไม่มีรายการ"
        hint="แตะสินค้าด้านบนเพื่อเพิ่มลงใบสั่ง"
      />
    )
  }

  return (
    <>
      <ul className="divide-y divide-slate-100">
      {items.map((it) => {
        const extra = [...(it.options ?? []), it.note?.trim()].filter(Boolean).join(' · ')
        const step = it.allowDecimalQty ? 0.25 : 1
        return (
          <li key={it.key} className="py-2.5">
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium break-words text-slate-800">
                  {it.name}
                  {it.unitName ? (
                    <span className="ml-1 text-xs font-normal text-slate-400">({it.unitName})</span>
                  ) : null}
                </div>
                {extra && (
                  <div className="mt-0.5 text-xs leading-snug break-words text-amber-700">
                    {extra}
                  </div>
                )}
                <div className="mt-0.5 text-xs text-slate-400 tabular-nums">
                  ฿{baht(it.price)} × {fmtQty(it.qty)}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-sm font-bold text-slate-800 tabular-nums">
                  ฿{baht(it.price * it.qty)}
                </div>
                {!readOnly && onSetQty && (
                  <div className="mt-1 flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="ลดจำนวน"
                      onClick={() => onSetQty(it.key, it.qty - step)}
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 active:scale-95"
                    >
                      <Icon name="minus" size={15} />
                    </button>
                    <span className="min-w-8 text-center text-sm font-bold tabular-nums">
                      {fmtQty(it.qty)}
                    </span>
                    <button
                      type="button"
                      aria-label="เพิ่มจำนวน"
                      onClick={() => onSetQty(it.key, it.qty + step)}
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 active:scale-95"
                    >
                      <Icon name="plus" size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {!readOnly && (onRemove || onSetNote) && (
              <div className="mt-1 flex justify-end gap-1">
                {onSetNote && (
                  <Button variant="ghost" size="sm" icon="pencil" onClick={() => openNote(it)}>
                    {it.note?.trim() ? 'แก้โน้ต' : 'ใส่โน้ต'}
                  </Button>
                )}
                {onRemove && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    className="text-rose-500"
                    onClick={() => onRemove(it.key)}
                  >
                    เอาออก
                  </Button>
                )}
              </div>
            )}
          </li>
        )
      })}
      </ul>

      {/* โน้ตต่อบรรทัด — ครัวอ่านจากตรงนี้ ไม่ใส่ก็ทำผิดได้ (เช่น "ไม่ใส่ไข่") */}
      <Modal
        open={noting != null}
        onClose={() => setNoting(null)}
        title={noting ? `โน้ต — ${noting.name}` : 'โน้ต'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoting(null)}>
              ยกเลิก
            </Button>
            <Button
              icon="check"
              onClick={() => {
                if (noting && onSetNote) onSetNote(noting.key, draft)
                setNoting(null)
              }}
            >
              บันทึกโน้ต
            </Button>
          </>
        }
      >
        <Textarea
          value={draft}
          rows={3}
          maxLength={200}
          placeholder="เช่น ไม่ใส่ไข่ · เผ็ดน้อย · แยกน้ำจิ้ม"
          onChange={(e) => setDraft(e.target.value)}
        />
      </Modal>
    </>
  )
}
