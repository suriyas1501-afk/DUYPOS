import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Category, Product } from '../../db/types'
import type { AddProductOpts, CartItem } from '../../stores/cartStore'
import { baht } from '../../lib/format'
import { Button, Icon, Input, Modal } from '../../components/ui'
import OptionModal from '../pos/OptionModal'
import OrderLines from './OrderLines'

/* =========================================================
   ขั้นที่ 2 — กดรายการที่ลูกค้าแจ้ง

   รูปแบบสำหรับมือถือ: กริดสินค้ากินพื้นที่ทั้งหน้า ส่วนรายการที่สั่งไปแล้ว
   อยู่ในแผ่นที่เรียกจากแถบล่าง (ปุ่มอยู่ในระยะนิ้วโป้ง)
   ไม่ใช้เลย์เอาต์ 2 คอลัมน์แบบหน้าขายที่เคาน์เตอร์ — บนจอ ~326px
   ตะกร้าจะบีบกริดสินค้าจนกดไม่ได้
   ========================================================= */

/** สินค้านี้ต้องถามอะไรก่อนลงใบสั่งไหม (ตัวเลือก / หลายหน่วย / ชั่งน้ำหนัก) */
const needsAsk = (p: Product) =>
  (p.options?.length ?? 0) > 0 || (p.units?.length ?? 0) > 0 || !!p.allowDecimalQty

export default function ItemPicker({
  tableLabel,
  items,
  onAdd,
  onSetQty,
  onSetNote,
  onRemove,
  onSummary,
  onChangeTable,
  onDiscard,
}: {
  tableLabel: string
  items: CartItem[]
  onAdd: (p: Product, opts?: AddProductOpts) => void
  onSetQty: (key: string, qty: number) => void
  onSetNote: (key: string, note: string) => void
  onRemove: (key: string) => void
  onSummary: () => void
  /** ย้ายไปโต๊ะอื่น — เก็บรายการไว้ */
  onChangeTable: () => void
  onDiscard: () => void
}) {
  const [q, setQ] = useState('')
  const [catId, setCatId] = useState<number | 'all'>('all')
  const [asking, setAsking] = useState<Product | null>(null)
  const [listOpen, setListOpen] = useState(false)

  const allProducts = useLiveQuery(() => db.products.toArray(), [])
  const categories: Category[] =
    useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), []) ?? []

  const products = useMemo(() => {
    const active = (allProducts ?? []).filter((p) => p.active)
    const needle = q.trim().toLowerCase()
    return active.filter((p) => {
      if (catId !== 'all' && p.categoryId !== catId) return false
      if (!needle) return true
      return p.name.toLowerCase().includes(needle) || (p.barcode ?? '').includes(needle)
    })
  }, [allProducts, q, catId])

  /** ยอดรวมแบบวิ่ง — ไว้ให้พนักงานบอกลูกค้าได้ทันที (ยอดจริงคิดที่ขั้นที่ 3) */
  const runningTotal = useMemo(
    () => items.reduce((s, it) => s + it.price * it.qty, 0),
    [items],
  )
  const count = items.reduce((n, it) => n + it.qty, 0)

  const tap = (p: Product) => {
    if (needsAsk(p)) setAsking(p)
    else onAdd(p)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ===== หัว: โต๊ะ + ค้นหา + หมวด ===== */}
      <div className="shrink-0 space-y-2.5 border-b border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onChangeTable}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white active:scale-95"
          >
            โต๊ะ {tableLabel}
            <Icon name="pencil" size={13} />
          </button>
          <span className="text-xs text-slate-400">แตะเพื่อย้ายโต๊ะ (รายการไม่หาย)</span>
        </div>

        <Input
          value={q}
          placeholder="ค้นหาสินค้า"
          inputMode="search"
          onChange={(e) => setQ(e.target.value)}
        />

        {categories.length > 0 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {[{ id: 'all' as const, name: 'ทั้งหมด' }, ...categories].map((c) => {
              const active = catId === (c.id === 'all' ? 'all' : c.id)
              return (
                <button
                  key={String(c.id)}
                  type="button"
                  onClick={() => setCatId(c.id === 'all' ? 'all' : c.id!)}
                  className={`shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-slate-800 font-medium text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ===== กริดสินค้า ===== */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {allProducts == null ? (
          <p className="py-8 text-center text-sm text-slate-400">กำลังโหลดสินค้า…</p>
        ) : products.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">ไม่พบสินค้าที่ค้นหา</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => tap(p)}
                className="flex min-h-20 cursor-pointer flex-col justify-between rounded-2xl border border-slate-200 bg-white p-2.5 text-left active:scale-[0.97]"
              >
                <span className="line-clamp-2 text-sm leading-snug font-medium text-slate-800">
                  {p.name}
                </span>
                <span className="mt-1 flex items-center justify-between gap-1">
                  <span className="text-sm font-bold text-emerald-700 tabular-nums">
                    ฿{baht(p.price)}
                  </span>
                  {needsAsk(p) && <Icon name="pencil" size={12} className="text-slate-300" />}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ===== แถบล่าง: อยู่ในระยะนิ้วโป้ง ===== */}
      <div className="shrink-0 border-t border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon="cart"
            className="shrink-0"
            disabled={items.length === 0}
            onClick={() => setListOpen(true)}
          >
            {count > 0 ? `${count.toLocaleString('th-TH')} รายการ` : 'ยังไม่มีรายการ'}
          </Button>
          <div className="min-w-0 flex-1 text-right">
            <div className="text-[11px] text-slate-400">ยอดรวม</div>
            <div className="text-lg leading-none font-bold text-slate-800 tabular-nums">
              ฿{baht(runningTotal)}
            </div>
          </div>
        </div>
        <Button
          size="lg"
          icon="check"
          className="mt-2.5 w-full"
          disabled={items.length === 0}
          title={items.length === 0 ? 'ต้องมีรายการก่อนจึงสรุปได้' : undefined}
          onClick={onSummary}
        >
          สรุปรายการ
        </Button>
      </div>

      {/* ===== ถามหน่วย/ตัวเลือก/จำนวน — ใช้โมดัลตัวเดียวกับหน้าเคาน์เตอร์ ===== */}
      {asking && (
        <OptionModal
          product={asking}
          onAdd={(p, opts) => onAdd(p, opts)}
          onClose={() => setAsking(null)}
        />
      )}

      {/* ===== แผ่นรายการที่สั่งไปแล้ว ===== */}
      <Modal
        open={listOpen}
        onClose={() => setListOpen(false)}
        title={`ใบสั่งโต๊ะ ${tableLabel}`}
        footer={
          <>
            <Button
              variant="ghost"
              icon="trash"
              className="text-rose-500"
              onClick={() => {
                setListOpen(false)
                onDiscard()
              }}
            >
              ทิ้งใบสั่ง
            </Button>
            <Button onClick={() => setListOpen(false)}>สั่งเพิ่ม</Button>
          </>
        }
      >
        <OrderLines items={items} onSetQty={onSetQty} onSetNote={onSetNote} onRemove={onRemove} />
        {items.length > 0 && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="text-sm text-slate-500">ยอดรวม</span>
            <span className="text-lg font-bold text-slate-800 tabular-nums">
              ฿{baht(runningTotal)}
            </span>
          </div>
        )}
      </Modal>
    </div>
  )
}
