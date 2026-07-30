import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useSettings } from '../db/hooks'
import type { Product } from '../db/types'
import { useCart } from '../stores/cartStore'
import { computeTotals } from '../lib/totals'
import { baht } from '../lib/format'
import { Badge, Button, EmptyState, Icon, INPUT_CLS, Spinner } from '../components/ui'
import OptionModal from './pos/OptionModal'
import CustomItemModal from './pos/CustomItemModal'
import CartPanel from './pos/CartPanel'
import PaymentModal from './pos/PaymentModal'

/* ===== ชิปหมวดหมู่ ===== */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-emerald-600 text-white shadow-sm'
          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

/* ===== การ์ดสินค้า ===== */
function ProductCard({
  p,
  cafe,
  onPick,
}: {
  p: Product
  cafe: boolean
  onPick: (p: Product) => void
}) {
  const badgeCls = 'absolute top-1.5 right-1.5 z-10 shadow-sm'
  const stockBadge = p.trackStock ? (
    p.stock <= 0 ? (
      <Badge color="amber" className={badgeCls}>
        หมด
      </Badge>
    ) : p.lowStockAt != null && p.stock <= p.lowStockAt ? (
      <Badge color="red" className={badgeCls}>
        {baht(p.stock)}
      </Badge>
    ) : (
      <Badge color="slate" className={badgeCls}>
        {baht(p.stock)}
      </Badge>
    )
  ) : null

  return (
    <button
      type="button"
      onClick={() => onPick(p)}
      className="relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
    >
      {stockBadge}
      <div
        className={`flex w-full items-center justify-center overflow-hidden bg-emerald-50 ${cafe ? 'h-32' : 'h-20'}`}
      >
        {p.image ? (
          <img src={p.image} alt={p.name} className="h-full w-full object-cover" />
        ) : (
          <span className={`font-bold text-emerald-500 ${cafe ? 'text-3xl' : 'text-2xl'}`}>
            {p.name.trim().charAt(0) || '?'}
          </span>
        )}
      </div>
      <div className="flex w-full flex-1 flex-col p-2.5">
        <div
          className={`line-clamp-2 leading-snug font-medium text-slate-700 ${cafe ? 'text-[15px]' : 'text-sm'}`}
        >
          {p.name}
        </div>
        <div className="mt-auto pt-1 text-sm font-bold text-emerald-700">฿{baht(p.price)}</div>
      </div>
    </button>
  )
}

/* ===== หน้าขายหน้าร้าน ===== */
export default function Pos() {
  const settings = useSettings()
  const cafe = settings.mode === 'cafe'

  const items = useCart((s) => s.items)
  const memberId = useCart((s) => s.memberId)
  const billDiscountType = useCart((s) => s.billDiscountType)
  const billDiscountValue = useCart((s) => s.billDiscountValue)
  const redeemPoints = useCart((s) => s.redeemPoints)
  const addProduct = useCart((s) => s.addProduct)

  const [search, setSearch] = useState('')
  const [catId, setCatId] = useState<number | 'all'>('all')
  const [optionProduct, setOptionProduct] = useState<Product | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const allProducts = useLiveQuery(() => db.products.toArray(), [])
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), []) ?? []
  const promos = useLiveQuery(() => db.promotions.toArray(), []) ?? []
  const member = useLiveQuery(
    () => (memberId != null ? db.members.get(memberId) : undefined),
    [memberId],
  )

  const products = useMemo(() => (allProducts ?? []).filter((p) => p.active), [allProducts])

  const filtered = useMemo(() => {
    let list = products
    if (catId !== 'all') list = list.filter((p) => p.categoryId === catId)
    const q = search.trim().toLowerCase()
    if (q)
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q),
      )
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'th'))
  }, [products, catId, search])

  const totals = useMemo(
    () =>
      computeTotals({
        items,
        promos,
        settings,
        billDiscountType,
        billDiscountValue,
        redeemPoints,
        memberPoints: member?.points,
      }),
    [items, promos, settings, billDiscountType, billDiscountValue, redeemPoints, member],
  )

  /** หยิบสินค้า: มีตัวเลือก → เปิดโมดัล / ไม่มี → ลงตะกร้าทันที */
  const pick = (p: Product) => {
    if (p.options && p.options.length > 0) setOptionProduct(p)
    else addProduct(p)
  }

  /** Enter ในช่องค้นหา: บาร์โค้ดตรงเป๊ะ → หยิบลงตะกร้า + ล้างช่อง (โฟกัสค้างที่เดิม) */
  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const code = search.trim()
    if (!code) return
    const hit = products.find((p) => p.barcode === code)
    if (hit) {
      e.preventDefault()
      setSearch('')
      pick(hit)
    }
  }

  // F9 = เปิดชำระเงิน (เมื่อตะกร้าไม่ว่าง)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault()
        if (useCart.getState().items.length > 0) setPayOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** จบการขาย: เคลียร์ตะกร้า ปิดโมดัล และกลับไปโฟกัสช่องค้นหา */
  const finishSale = () => {
    useCart.getState().clear()
    setPayOpen(false)
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  return (
    <div className="flex h-full">
      {/* ===== ฝั่งซ้าย: เลือกสินค้า ===== */}
      <section className="flex min-w-0 flex-1 flex-col gap-3 bg-slate-100 p-4">
        {/* ค้นหา + รายการกำหนดเอง */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative flex-1">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <input
              ref={searchRef}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="พิมพ์ชื่อสินค้าเพื่อค้นหา หรือยิงบาร์โค้ด…"
              className={`${INPUT_CLS} pl-9`}
            />
          </div>
          <Button variant="secondary" size="sm" icon="plus" onClick={() => setCustomOpen(true)}>
            รายการกำหนดเอง
          </Button>
        </div>

        {/* ชิปหมวดหมู่ */}
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-0.5">
          <Chip active={catId === 'all'} onClick={() => setCatId('all')}>
            ทั้งหมด
          </Chip>
          {categories.map((c) => (
            <Chip key={c.id} active={catId === c.id} onClick={() => setCatId(c.id!)}>
              {c.name}
            </Chip>
          ))}
        </div>

        {/* กริดสินค้า */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!allProducts ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="box"
              title="ไม่พบสินค้า"
              hint="ลองเปลี่ยนคำค้นหา เลือกหมวดอื่น หรือเพิ่มสินค้าที่เมนูสินค้า"
            />
          ) : (
            <div
              className={`grid gap-3 ${
                cafe
                  ? 'grid-cols-[repeat(auto-fill,minmax(170px,1fr))]'
                  : 'grid-cols-[repeat(auto-fill,minmax(140px,1fr))]'
              }`}
            >
              {filtered.map((p) => (
                <ProductCard key={p.id} p={p} cafe={cafe} onPick={pick} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===== ฝั่งขวา: ตะกร้า ===== */}
      <CartPanel
        settings={settings}
        totals={totals}
        member={member}
        onCheckout={() => {
          if (items.length > 0) setPayOpen(true)
        }}
      />

      {/* ===== โมดัล ===== */}
      {optionProduct && (
        <OptionModal
          key={optionProduct.id}
          product={optionProduct}
          onClose={() => setOptionProduct(null)}
        />
      )}
      <CustomItemModal open={customOpen} onClose={() => setCustomOpen(false)} />
      <PaymentModal
        open={payOpen}
        totals={totals}
        settings={settings}
        onClose={() => setPayOpen(false)}
        onDone={finishSale}
      />
    </div>
  )
}
