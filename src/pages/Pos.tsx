import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useCurrentShift, useSettings } from '../db/hooks'
import type { Product, ProductUnit } from '../db/types'
import { useCart } from '../stores/cartStore'
import { useAuth } from '../stores/authStore'
import { computeTotals } from '../lib/totals'
import { baht } from '../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  INPUT_CLS,
  isModalOpen,
  Spinner,
  toast,
} from '../components/ui'
import OptionModal from './pos/OptionModal'
import CustomItemModal from './pos/CustomItemModal'
import CartPanel from './pos/CartPanel'
import PaymentModal from './pos/PaymentModal'

/** เป้าหมายที่จะเปิดโมดัลตัวเลือก (พร้อมหน่วยที่ยิงบาร์โค้ดมา ถ้ามี) */
interface PickTarget {
  p: Product
  unit?: ProductUnit
}

/** ต้องถามรายละเอียดก่อนลงตะกร้าหรือไม่ (ตัวเลือก / หลายหน่วย / ชั่งน้ำหนัก) */
const needsDetail = (p: Product) =>
  (p.options?.length ?? 0) > 0 || (p.units?.length ?? 0) > 0 || !!p.allowDecimalQty

/** ข้อความที่ยิงมาดูเหมือนบาร์โค้ด (ตัวเลขล้วนตั้งแต่ 6 หลัก) ไม่ใช่คำค้นหาที่พนักงานพิมพ์เอง */
const looksLikeBarcode = (s: string) => /^\d{6,}$/.test(s)

/** ค้นบาร์โค้ดในรายการสินค้าที่กำหนด: บาร์โค้ดหลักก่อน แล้วค่อยไล่หาบาร์โค้ดหน่วยย่อย (แพ็ค/ลัง) */
function findCodeIn(list: Product[], code: string): PickTarget | null {
  const main = list.find((p) => (p.barcode ?? '') === code)
  if (main) return { p: main }
  for (const p of list) {
    const u = (p.units ?? []).find((x) => (x.barcode ?? '') === code)
    if (u) return { p, unit: u }
  }
  return null
}

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

  const multiUnit = (p.units?.length ?? 0) > 0
  const hasWholesale = p.wholesalePrice != null

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
        {(multiUnit || hasWholesale) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {multiUnit && (
              <Badge color="blue" className="px-1.5 py-0 text-[10px]">
                หลายหน่วย
              </Badge>
            )}
            {hasWholesale && (
              <Badge color="amber" className="px-1.5 py-0 text-[10px]">
                ราคาส่ง
              </Badge>
            )}
          </div>
        )}
        <div className="mt-auto pt-1 text-sm font-bold text-emerald-700">
          ฿{baht(p.price)}
          {p.allowDecimalQty && (
            <span className="ml-0.5 text-xs font-normal text-slate-400">
              /{(p.unit ?? '').trim() || 'หน่วย'}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

/* ===== หน้าขายหน้าร้าน ===== */
export default function Pos() {
  const settings = useSettings()
  const cafe = settings.mode === 'cafe'
  const navigate = useNavigate()
  const { shift, loading: shiftLoading } = useCurrentShift()

  const items = useCart((s) => s.items)
  const memberId = useCart((s) => s.memberId)
  const billDiscountType = useCart((s) => s.billDiscountType)
  const billDiscountValue = useCart((s) => s.billDiscountValue)
  const redeemPoints = useCart((s) => s.redeemPoints)
  const couponCode = useCart((s) => s.couponCode)
  const addProduct = useCart((s) => s.addProduct)

  const [search, setSearch] = useState('')
  const [catId, setCatId] = useState<number | 'all'>('all')
  const [optionTarget, setOptionTarget] = useState<PickTarget | null>(null)
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

  // คูปองที่ใส่ไว้กับบิลนี้ (null = หาแล้วไม่พบ, undefined = ยังโหลดอยู่)
  const couponRow = useLiveQuery(
    async () =>
      couponCode ? ((await db.coupons.where('code').equals(couponCode).first()) ?? null) : null,
    [couponCode],
  )
  const coupon = couponRow ?? undefined
  const couponLoading = couponCode != null && couponRow === undefined

  const products = useMemo(() => (allProducts ?? []).filter((p) => p.active), [allProducts])

  const filtered = useMemo(() => {
    let list = products
    if (catId !== 'all') list = list.filter((p) => p.categoryId === catId)
    const q = search.trim().toLowerCase()
    if (q)
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode ?? '').toLowerCase().includes(q) ||
          (p.units ?? []).some((u) => (u.barcode ?? '').toLowerCase().includes(q)),
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
        coupon,
      }),
    [items, promos, settings, billDiscountType, billDiscountValue, redeemPoints, member, coupon],
  )

  /** หยิบสินค้าจากการ์ด: ต้องเลือกหน่วย/ตัวเลือก/น้ำหนัก → เปิดโมดัล / ไม่ต้อง → ลงตะกร้าทันที */
  const pick = (p: Product) => {
    if (needsDetail(p)) setOptionTarget({ p })
    else addProduct(p)
  }

  /** หาสินค้าจากบาร์โค้ด: บาร์โค้ดหลักก่อน แล้วค่อยไล่หาบาร์โค้ดของหน่วยย่อย (แพ็ค/ลัง) */
  const findByBarcode = (code: string): PickTarget | null => findCodeIn(products, code)

  /** Enter ในช่องค้นหา: บาร์โค้ดตรงเป๊ะ → หยิบลงตะกร้า + ล้างช่อง (โฟกัสค้างที่เดิม) */
  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    // มีโมดัลเปิดอยู่ (เช่น เลือกตัวเลือก/ชำระเงิน) → ห้ามรับบาร์โค้ดที่ตกมาถึงช่องนี้
    if (isModalOpen()) return
    const code = search.trim()
    if (!code) return
    const hit = findByBarcode(code)
    if (!hit) {
      // พิมพ์ค้นหาด้วยชื่อ → ปล่อยข้อความไว้ให้ดูผลค้นหาต่อ
      if (!looksLikeBarcode(code)) return
      // ยิงบาร์โค้ดที่ไม่พบ/ปิดขาย → ต้องล้างช่อง ไม่งั้นโค้ดถัดไปจะต่อท้ายกันเป็นข้อความขยะ
      e.preventDefault()
      setSearch('')
      const off = findCodeIn(
        (allProducts ?? []).filter((p) => !p.active),
        code,
      )
      toast.error(
        off
          ? `“${off.p.name}” ถูกปิดขายอยู่ — เปิดขายที่เมนูสินค้าก่อน`
          : `ไม่พบสินค้าของบาร์โค้ด “${code}” — ตรวจบาร์โค้ดอีกครั้ง หรือเพิ่มสินค้าที่เมนูสินค้า`,
      )
      return
    }
    e.preventDefault()
    setSearch('')
    const { p, unit } = hit
    if ((p.options?.length ?? 0) > 0) {
      // มีตัวเลือก → เปิดโมดัล (ล็อกหน่วยที่ยิงมา ถ้ายิงบาร์โค้ดหน่วยย่อย)
      setOptionTarget({ p, unit })
    } else if (unit) {
      addProduct(p, { unit })
    } else if (p.allowDecimalQty) {
      // สินค้าชั่งน้ำหนัก → ต้องกรอกน้ำหนักก่อน
      setOptionTarget({ p })
    } else {
      addProduct(p)
    }
  }

  // F9 = เปิดชำระเงิน (เมื่อตะกร้าไม่ว่าง)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        // มีโมดัลเปิดอยู่ → ปล่อยให้โมดัลนั้นทำงานต่อ ห้ามเปิดโมดัลชำระเงินซ้อนทับ
        if (isModalOpen()) return
        // หน้าจอถูกล็อกอยู่ (ฉากล็อกทับอยู่ด้านหน้า) — คีย์ลัดต้องไม่ทำงาน
        if (useAuth.getState().locked) return
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
        {/* เตือนเมื่อตั้งค่าให้ต้องเปิดกะก่อนขาย แต่ยังไม่มีกะเปิดอยู่ (finalizeSale จะปฏิเสธการปิดบิล) */}
        {settings.shiftEnabled && settings.requireShiftToSell && !shift && !shiftLoading && (
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            <Icon name="alert" size={16} className="shrink-0 text-amber-600" />
            <span className="flex-1">ยังไม่ได้เปิดกะ — ปิดบิลไม่ได้จนกว่าจะเปิดกะ</span>
            <Button size="sm" variant="secondary" icon="clock" onClick={() => navigate('/shift')}>
              ไปเปิดกะ
            </Button>
          </div>
        )}

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
        coupon={coupon}
        couponLoading={couponLoading}
        onCheckout={() => {
          if (items.length > 0) setPayOpen(true)
        }}
      />

      {/* ===== โมดัล ===== */}
      {optionTarget && (
        <OptionModal
          key={`${optionTarget.p.id}|${optionTarget.unit?.name ?? ''}`}
          product={optionTarget.p}
          lockedUnit={optionTarget.unit}
          onClose={() => setOptionTarget(null)}
        />
      )}
      <CustomItemModal open={customOpen} onClose={() => setCustomOpen(false)} />
      <PaymentModal
        open={payOpen}
        totals={totals}
        settings={settings}
        coupon={coupon}
        onClose={() => setPayOpen(false)}
        onDone={finishSale}
      />
    </div>
  )
}
