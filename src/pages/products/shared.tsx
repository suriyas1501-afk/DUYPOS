import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Product } from '../../db/types'
import { Badge, Icon, INPUT_CLS, toast } from '../../components/ui'
import { baht } from '../../lib/format'

/* =========================================================
   ตัวช่วยเรื่องจำนวน / ตัวเลขจากผู้ใช้
   ========================================================= */

/** แสดงจำนวนสินค้า (รองรับทศนิยมถึง 3 ตำแหน่ง เช่น 0.5 กก.) */
export const qty3 = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 })

const THAI_DIGITS = /[๐-๙]/g

/**
 * แปลงข้อความเป็นตัวเลขแบบยืดหยุ่น — ล้าง comma / ช่องว่าง / สัญลักษณ์บาท / เลขไทย
 * คืน NaN ถ้าไม่ใช่ตัวเลข (ใช้กับการนำเข้า CSV ที่ยอดมักมี 1,234.50)
 */
export function parseNumLoose(s: string): number {
  const cleaned = s
    .replace(THAI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[,\s฿]/g, '')
  if (cleaned === '') return NaN
  return Number(cleaned)
}

/* =========================================================
   หน่วยขาย (หน่วยฐาน + หน่วยเพิ่มเติม)
   ========================================================= */

export interface UnitOpt {
  name: string
  /** 1 หน่วยนี้ = factor หน่วยฐาน */
  factor: number
  price: number
}

/** ตัวเลือกหน่วยของสินค้า — ลำดับ 0 = หน่วยฐานเสมอ */
export const unitOptionsOf = (p: Product): UnitOpt[] => [
  { name: p.unit, factor: 1, price: p.price },
  ...(p.units ?? []).map((u) => ({ name: u.name, factor: u.factor, price: u.price })),
]

/** ค้นสินค้าจากบาร์โค้ดหลักก่อน แล้วค่อยหาในบาร์โค้ดหน่วยเพิ่มเติม */
export function findByBarcode(
  products: Product[],
  code: string,
): { product: Product; unitIdx: number } | null {
  const c = code.trim()
  if (!c) return null
  for (const p of products) if ((p.barcode ?? '').trim() === c) return { product: p, unitIdx: 0 }
  for (const p of products) {
    const i = (p.units ?? []).findIndex((u) => (u.barcode ?? '').trim() === c)
    if (i >= 0) return { product: p, unitIdx: i + 1 }
  }
  return null
}

/* =========================================================
   ป้ายกำกับความสามารถของสินค้า (ใช้ในตารางสินค้า)
   ========================================================= */

export function ProductBadges({ p }: { p: Product }) {
  const hasUnits = (p.units?.length ?? 0) > 0
  if (!hasUnits && !p.allowDecimalQty && p.wholesalePrice == null) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {hasUnits && (
        <Badge color="blue" className="px-1.5 py-0 text-[10px]">
          หลายหน่วย
        </Badge>
      )}
      {p.allowDecimalQty && (
        <Badge color="amber" className="px-1.5 py-0 text-[10px]">
          ชั่งกิโล
        </Badge>
      )}
      {p.wholesalePrice != null && (
        <Badge color="green" className="px-1.5 py-0 text-[10px]">
          ราคาส่ง
        </Badge>
      )}
    </span>
  )
}

/* =========================================================
   ช่องยิงบาร์โค้ด / ค้นหาสินค้า (ใช้ร่วมกันในหน้ารับของเข้า + นับสต็อก)
   ========================================================= */

export function ProductPicker({
  products,
  onPick,
  placeholder = 'ยิงบาร์โค้ด หรือพิมพ์ชื่อสินค้าแล้วกด Enter…',
  autoFocus = false,
  showStock = false,
}: {
  products: Product[]
  /** unitIdx: 0 = หน่วยฐาน, 1.. = ลำดับใน units[] */
  onPick: (p: Product, unitIdx: number) => void
  placeholder?: string
  autoFocus?: boolean
  showStock?: boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          (p.barcode ?? '').toLowerCase().includes(s) ||
          (p.units ?? []).some((u) => (u.barcode ?? '').toLowerCase().includes(s)),
      )
      .slice(0, 8)
  }, [products, q])

  const take = (p: Product, unitIdx: number) => {
    onPick(p, unitIdx)
    setQ('')
    setOpen(false)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const code = q.trim()
    if (!code) return
    // บาร์โค้ดตรงเป๊ะมาก่อนเสมอ (หน่วยย่อยจะถูกตั้งให้อัตโนมัติ)
    const hit = findByBarcode(products, code)
    if (hit) {
      take(hit.product, hit.unitIdx)
      return
    }
    if (results.length === 1) {
      take(results[0], 0)
      return
    }
    if (results.length === 0) {
      toast.error(`ไม่พบสินค้า “${code}” — ตรวจบาร์โค้ดอีกครั้ง หรือค้นหาด้วยชื่อสินค้า`)
      return
    }
    setOpen(true)
  }

  return (
    <div className="relative">
      <Icon
        name="search"
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
      />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        className={`${INPUT_CLS} pl-9`}
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && results.length > 0 && (
        <div className="absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {results.map((p) => {
            const opts = unitOptionsOf(p)
            return (
              <div key={p.id} className="px-1">
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-emerald-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => take(p, 0)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {p.name}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {p.barcode ? `${p.barcode} · ` : ''}
                      {p.unit}
                      {showStock && p.trackStock ? ` · คงเหลือ ${qty3(p.stock)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-slate-500">
                    {baht(p.price)}
                  </span>
                </button>
                {opts.length > 1 && (
                  <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                    {opts.slice(1).map((u, i) => (
                      <button
                        key={i}
                        type="button"
                        className="cursor-pointer rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-emerald-100 hover:text-emerald-700"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => take(p, i + 1)}
                      >
                        {u.name} (×{u.factor})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
