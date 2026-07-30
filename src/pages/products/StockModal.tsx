import { useEffect, useState } from 'react'
import { db } from '../../db/db'
import type { Product } from '../../db/types'
import { Button, Field, Input, Modal, toast } from '../../components/ui'
import { baht, r2 } from '../../lib/format'

type MoveKind = 'receive' | 'adjust'

/** โมดัลปรับสต็อก — เปิดเมื่อ product != null */
export default function StockModal({
  product,
  onClose,
}: {
  product: Product | null
  onClose: () => void
}) {
  const [kind, setKind] = useState<MoveKind>('receive')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (product) {
      setKind('receive')
      setQty('')
      setNote('')
    }
  }, [product])

  const q = Number(qty)
  const validNumber = qty.trim() !== '' && !Number.isNaN(q)
  const validForKind = validNumber && (kind === 'receive' ? q > 0 : q !== 0)
  const delta = kind === 'receive' ? Math.abs(q) : q
  const newStock = product && validForKind ? r2(product.stock + delta) : null

  const save = async () => {
    if (product?.id == null) return
    if (!validNumber) {
      toast.error('กรุณากรอกจำนวนเป็นตัวเลข')
      return
    }
    if (kind === 'receive' && q <= 0) {
      toast.error('จำนวนรับเข้าต้องมากกว่า 0')
      return
    }
    if (kind === 'adjust' && q === 0) {
      toast.error('จำนวนปรับปรุงต้องไม่เป็น 0')
      return
    }
    const stock = r2(product.stock + delta)
    await db.products.update(product.id, { stock })
    await db.stockMoves.add({
      productId: product.id,
      type: kind,
      qty: r2(delta),
      note: note.trim() || undefined,
      createdAt: Date.now(),
    })
    toast.success(`ปรับสต็อก “${product.name}” เป็น ${baht(stock)} ${product.unit}`)
    onClose()
  }

  return (
    <Modal
      open={product != null}
      onClose={onClose}
      title="ปรับสต็อก"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save}>บันทึก</Button>
        </>
      }
    >
      {product && (
        <div className="space-y-4">
          {/* ข้อมูลสินค้า */}
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            {product.image ? (
              <img
                src={product.image}
                alt=""
                className="h-11 w-11 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-sm font-bold text-emerald-600">
                {product.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800">{product.name}</div>
              <div className="text-xs text-slate-500">
                สต็อกปัจจุบัน: {baht(product.stock)} {product.unit}
              </div>
            </div>
          </div>

          {/* ประเภทการปรับ */}
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-600">ประเภท</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind('receive')}
                className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  kind === 'receive'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                รับเข้า
              </button>
              <button
                type="button"
                onClick={() => setKind('adjust')}
                className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  kind === 'adjust'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                ปรับปรุง
              </button>
            </div>
          </div>

          <Field
            label={`จำนวน (${product.unit})`}
            hint={
              kind === 'receive'
                ? 'จำนวนที่รับเข้า จะถูกบวกเพิ่มในสต็อกเสมอ'
                : 'ใส่ค่าบวกเพื่อเพิ่ม หรือค่าลบเพื่อตัดออก เช่น -3'
            }
          >
            <Input
              autoFocus
              type="number"
              step="any"
              min={kind === 'receive' ? 0 : undefined}
              placeholder={kind === 'receive' ? 'เช่น 10' : 'เช่น -3 หรือ 5'}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
            />
          </Field>

          <Field label="โน้ต">
            <Input
              placeholder={kind === 'receive' ? 'เช่น รับของจากซัพพลายเออร์' : 'เช่น นับสต็อกจริง / ของเสีย'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          {newStock != null && (
            <div
              className={`rounded-xl px-4 py-3 text-sm font-medium ${
                newStock < 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              สต็อกใหม่: {baht(newStock)} {product.unit}
              {newStock < 0 && ' — ติดลบ กรุณาตรวจสอบจำนวนอีกครั้ง'}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
