import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Product } from '../db/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  PageHeader,
  Select,
  Spinner,
  Toggle,
} from '../components/ui'
import { baht } from '../lib/format'
import ProductModal from './products/ProductModal'
import StockModal from './products/StockModal'
import CategoryModal from './products/CategoryModal'

type StatusFilter = 'all' | 'active' | 'inactive'

export default function Products() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), [])

  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [productModal, setProductModal] = useState<{ open: boolean; product: Product | null }>({
    open: false,
    product: null,
  })
  const [stockProduct, setStockProduct] = useState<Product | null>(null)
  const [catModalOpen, setCatModalOpen] = useState(false)

  const catNames = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of categories ?? []) if (c.id != null) m.set(c.id, c.name)
    return m
  }, [categories])

  const filtered = useMemo(() => {
    if (!products) return []
    const q = search.trim().toLowerCase()
    return products
      .filter((p) => {
        if (q && !p.name.toLowerCase().includes(q) && !(p.barcode ?? '').toLowerCase().includes(q))
          return false
        if (catFilter !== 'all' && p.categoryId !== Number(catFilter)) return false
        if (statusFilter === 'active' && !p.active) return false
        if (statusFilter === 'inactive' && p.active) return false
        return true
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'th'))
  }, [products, search, catFilter, statusFilter])

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="สินค้า"
        subtitle={products ? `ทั้งหมด ${products.length} รายการ` : undefined}
        actions={
          <>
            <Button variant="secondary" icon="tag" onClick={() => setCatModalOpen(true)}>
              จัดการหมวดหมู่
            </Button>
            <Button icon="plus" onClick={() => setProductModal({ open: true, product: null })}>
              เพิ่มสินค้า
            </Button>
          </>
        }
      />

      {/* ===== แถวกรอง ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <Input
            className="pl-9"
            placeholder="ค้นหาชื่อสินค้า หรือบาร์โค้ด…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="all">หมวดหมู่: ทั้งหมด</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">สถานะ: ทั้งหมด</option>
            <option value="active">ขายอยู่</option>
            <option value="inactive">ปิดขาย</option>
          </Select>
        </div>
      </div>

      {/* ===== ตารางสินค้า ===== */}
      <Card padded={false}>
        {!products ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon="box"
            title="ยังไม่มีสินค้า"
            hint="กดปุ่ม “เพิ่มสินค้า” เพื่อเริ่มสร้างรายการสินค้าของร้าน"
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon="search" title="ไม่พบสินค้าตามเงื่อนไข" hint="ลองเปลี่ยนคำค้นหาหรือตัวกรอง" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">สินค้า</th>
                  <th className="px-4 py-3 font-medium">หมวดหมู่</th>
                  <th className="px-4 py-3 text-right font-medium">ราคา</th>
                  <th className="px-4 py-3 text-right font-medium">ต้นทุน</th>
                  <th className="px-4 py-3 text-right font-medium">สต็อก</th>
                  <th className="px-4 py-3 text-center font-medium">เปิดขาย</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        {p.image ? (
                          <img
                            src={p.image}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-sm font-bold text-emerald-600">
                            {p.name.charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{p.name}</div>
                          {p.barcode && (
                            <div className="truncate text-xs text-slate-400">{p.barcode}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {p.categoryId != null ? (catNames.get(p.categoryId) ?? '—') : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                      {baht(p.price)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{baht(p.cost)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {p.trackStock ? (
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <span
                            className={
                              p.stock <= 0 ||
                              (p.lowStockAt != null && p.stock <= p.lowStockAt)
                                ? 'font-semibold text-rose-600'
                                : 'text-slate-700'
                            }
                          >
                            {baht(p.stock)}
                          </span>
                          {p.stock <= 0 ? (
                            <Badge color="red">หมด</Badge>
                          ) : p.lowStockAt != null && p.stock <= p.lowStockAt ? (
                            <Badge color="red">ใกล้หมด</Badge>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Toggle
                        checked={p.active}
                        onChange={(v) => {
                          if (p.id != null) void db.products.update(p.id, { active: v })
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="box"
                          title={p.trackStock ? 'ปรับสต็อก' : 'สินค้านี้ไม่นับสต็อก'}
                          disabled={!p.trackStock}
                          onClick={() => setStockProduct(p)}
                        >
                          ปรับสต็อก
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="pencil"
                          title="แก้ไข"
                          onClick={() => setProductModal({ open: true, product: p })}
                        >
                          แก้ไข
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ===== โมดัล ===== */}
      <ProductModal
        open={productModal.open}
        product={productModal.product}
        onClose={() => setProductModal({ open: false, product: null })}
      />
      <StockModal product={stockProduct} onClose={() => setStockProduct(null)} />
      <CategoryModal open={catModalOpen} onClose={() => setCatModalOpen(false)} />
    </div>
  )
}
