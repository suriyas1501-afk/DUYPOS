import { useState, type ChangeEvent } from 'react'
import { db } from '../../db/db'
import { usePermissions } from '../../db/hooks'
import type { Product, StockMove } from '../../db/types'
import { Badge, Button, Icon, Modal, Spinner, toast } from '../../components/ui'
import { parseCsv } from '../../lib/csv'
import { baht, r2 } from '../../lib/format'
import { parseNumLoose, qty3 } from './shared'

/* =========================================================
   คอลัมน์มาตรฐานของไฟล์นำเข้า/ส่งออกสินค้า
   ========================================================= */

export const PRODUCT_CSV_HEADER = [
  'ชื่อสินค้า',
  'บาร์โค้ด',
  'หมวดหมู่',
  'ราคาขาย',
  'ต้นทุน',
  'หน่วย',
  'นับสต็อก(ใช่/ไม่)',
  'สต็อก',
  'จุดแจ้งเตือน',
] as const

/** ตัวอย่างข้อมูลในเทมเพลต (ช่วยให้ผู้ใช้เห็นรูปแบบที่ถูกต้อง) */
export const PRODUCT_CSV_SAMPLE: (string | number)[][] = [
  ['น้ำเปล่า 600 มล.', '8850100100100', 'เครื่องดื่ม', 7, 5, 'ขวด', 'ใช่', 48, 12],
  ['กล้วยหอม', '', 'ผลไม้', 25, 18, 'กก.', 'ใช่', 10, 2],
  ['ลาเต้เย็น', '', 'กาแฟ', 55, 20, 'แก้ว', 'ไม่', '', ''],
]

/** แถวข้อมูลของสินค้า 1 รายการสำหรับส่งออก CSV (เรียงตาม PRODUCT_CSV_HEADER) */
export const productCsvRow = (p: Product, categoryName: string): (string | number)[] => [
  p.name,
  p.barcode ?? '',
  categoryName,
  p.price,
  p.cost,
  p.unit,
  p.trackStock ? 'ใช่' : 'ไม่',
  p.trackStock ? p.stock : '',
  p.lowStockAt ?? '',
]

/* =========================================================
   จับคอลัมน์จากบรรทัดหัวตาราง (ยืดหยุ่นทั้งไทย/อังกฤษ)
   ========================================================= */

interface ColMap {
  name: number
  barcode: number
  category: number
  price: number
  cost: number
  unit: number
  trackStock: number
  stock: number
  lowStockAt: number
}

const normHeader = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const normKey = (s: string) => s.trim().toLowerCase()

const ALIASES = {
  name: ['ชื่อสินค้า', 'ชื่อ', 'name', 'product', 'productname'],
  barcode: ['บาร์โค้ด', 'barcode', 'sku', 'รหัสสินค้า', 'รหัส'],
  category: ['หมวดหมู่', 'หมวด', 'category', 'group'],
  price: ['ราคาขาย', 'ราคา', 'price', 'sellprice'],
  cost: ['ต้นทุน', 'cost', 'ทุน'],
  unit: ['หน่วย', 'unit'],
  trackStock: ['นับสต็อก(ใช่/ไม่)', 'นับสต็อก', 'trackstock', 'นับสตอก'],
  lowStockAt: ['จุดแจ้งเตือน', 'แจ้งเตือน', 'lowstock', 'lowstockat', 'จุดสั่งซื้อ'],
  stock: ['สต็อก', 'stock', 'จำนวน', 'คงเหลือ', 'qty'],
} as const

/** จับคอลัมน์ที่ชื่อเฉพาะเจาะจงก่อน (นับสต็อก ต้องมาก่อน สต็อก) */
function mapColumns(header: string[]): ColMap {
  const norm = header.map(normHeader)
  const used = new Set<number>()
  const find = (aliases: readonly string[]): number => {
    for (const a of aliases) {
      const k = normHeader(a)
      const i = norm.findIndex((h, idx) => !used.has(idx) && h === k)
      if (i >= 0) {
        used.add(i)
        return i
      }
    }
    for (const a of aliases) {
      const k = normHeader(a)
      if (k.length < 3) continue
      const i = norm.findIndex((h, idx) => !used.has(idx) && h !== '' && h.includes(k))
      if (i >= 0) {
        used.add(i)
        return i
      }
    }
    return -1
  }
  const name = find(ALIASES.name)
  const barcode = find(ALIASES.barcode)
  const category = find(ALIASES.category)
  const price = find(ALIASES.price)
  const cost = find(ALIASES.cost)
  const unit = find(ALIASES.unit)
  const trackStock = find(ALIASES.trackStock)
  const lowStockAt = find(ALIASES.lowStockAt)
  const stock = find(ALIASES.stock)
  return { name, barcode, category, price, cost, unit, trackStock, lowStockAt, stock }
}

const YES_WORDS = ['ใช่', 'นับ', 'y', 'yes', 'true', 't', '1', 'ใช้']
const NO_WORDS = ['ไม่', 'ไม่นับ', 'n', 'no', 'false', 'f', '0', '-', 'ไม่ใช่']

/** null = ไม่ระบุ (ให้ใช้ค่าเดิม/ค่าเริ่มต้น) */
function parseYesNo(s: string): boolean | null {
  const v = normKey(s)
  if (v === '') return null
  if (YES_WORDS.includes(v)) return true
  if (NO_WORDS.includes(v)) return false
  return null
}

/* =========================================================
   วิเคราะห์แถวข้อมูล
   ========================================================= */

type RowStatus = 'create' | 'update' | 'skip'

interface AnalyzedRow {
  /** เลขบรรทัดในไฟล์ (นับหัวตารางเป็นบรรทัดที่ 1) */
  line: number
  status: RowStatus
  reason?: string
  name: string
  barcode: string
  categoryName: string
  price: number
  cost: number | null
  unit: string
  trackStock: boolean | null
  stock: number | null
  lowStockAt: number | null
  /** ชื่อสินค้าเดิมที่จะถูกอัปเดตทับ */
  targetName?: string
}

interface Analysis {
  error?: string
  rows: AnalyzedRow[]
  createCount: number
  updateCount: number
  skipCount: number
  newCategories: string[]
}

const cellOf = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')

/** อ่านตัวเลขที่ไม่บังคับ — คืน undefined ถ้าเว้นว่าง, null ถ้ารูปแบบผิด */
function optNum(raw: string, allowNegative: boolean): number | null | undefined {
  if (raw === '') return undefined
  const n = parseNumLoose(raw)
  if (!Number.isFinite(n)) return null
  if (!allowNegative && n < 0) return null
  return r2(n)
}

function analyze(table: string[][], products: Product[], categoryNames: string[]): Analysis {
  const empty: Analysis = {
    rows: [],
    createCount: 0,
    updateCount: 0,
    skipCount: 0,
    newCategories: [],
  }
  if (table.length === 0) return { ...empty, error: 'ไฟล์นี้ไม่มีข้อมูล' }

  const cols = mapColumns(table[0])
  const missing: string[] = []
  if (cols.name < 0) missing.push('ชื่อสินค้า')
  if (cols.price < 0) missing.push('ราคาขาย')
  if (missing.length > 0) {
    return {
      ...empty,
      error: `ไม่พบคอลัมน์ ${missing.map((m) => `“${m}”`).join(' และ ')} ในบรรทัดหัวตาราง — กด “เทมเพลต CSV” เพื่อดาวน์โหลดรูปแบบที่ถูกต้อง`,
    }
  }
  if (table.length < 2) return { ...empty, error: 'ไฟล์มีแต่บรรทัดหัวตาราง ยังไม่มีข้อมูลสินค้า' }

  const byBarcode = new Map<string, Product>()
  const byName = new Map<string, Product>()
  // บาร์โค้ดของ "หน่วยเพิ่มเติม (แพ็ค/ลัง)" ก็ต้องไม่ชนกัน ไม่งั้นยิงบาร์โค้ดลังจะได้สินค้าผิดตัว
  const byUnitBarcode = new Map<string, Product>()
  for (const p of products) {
    const b = (p.barcode ?? '').trim()
    if (b) byBarcode.set(b, p)
    byName.set(normKey(p.name), p)
    for (const u of p.units ?? []) {
      const ub = (u.barcode ?? '').trim()
      if (ub) byUnitBarcode.set(ub, p)
    }
  }
  const knownCats = new Set(categoryNames.map(normKey))

  const rows: AnalyzedRow[] = []
  const seen = new Set<string>()
  const newCategories: string[] = []
  let createCount = 0
  let updateCount = 0
  let skipCount = 0

  for (let i = 1; i < table.length; i++) {
    const r = table[i]
    const line = i + 1
    const name = cellOf(r, cols.name)
    const barcode = cellOf(r, cols.barcode)
    const categoryName = cellOf(r, cols.category)
    const base: AnalyzedRow = {
      line,
      status: 'skip',
      name,
      barcode,
      categoryName,
      price: 0,
      cost: null,
      unit: cellOf(r, cols.unit),
      trackStock: parseYesNo(cellOf(r, cols.trackStock)),
      stock: null,
      lowStockAt: null,
    }
    const skip = (reason: string) => {
      rows.push({ ...base, status: 'skip', reason })
      skipCount++
    }

    if (!name) {
      skip('ไม่ได้กรอกชื่อสินค้า')
      continue
    }
    const priceRaw = cellOf(r, cols.price)
    const price = parseNumLoose(priceRaw)
    if (!Number.isFinite(price) || price < 0) {
      skip(`ราคาขาย “${priceRaw}” ไม่ใช่ตัวเลขที่ถูกต้อง`)
      continue
    }
    const cost = optNum(cellOf(r, cols.cost), false)
    if (cost === null) {
      skip(`ต้นทุน “${cellOf(r, cols.cost)}” ไม่ใช่ตัวเลขที่ถูกต้อง`)
      continue
    }
    const stock = optNum(cellOf(r, cols.stock), true)
    if (stock === null) {
      skip(`สต็อก “${cellOf(r, cols.stock)}” ไม่ใช่ตัวเลขที่ถูกต้อง`)
      continue
    }
    const lowStockAt = optNum(cellOf(r, cols.lowStockAt), false)
    if (lowStockAt === null) {
      skip(`จุดแจ้งเตือน “${cellOf(r, cols.lowStockAt)}” ไม่ใช่ตัวเลขที่ถูกต้อง`)
      continue
    }

    const target = (barcode ? byBarcode.get(barcode) : undefined) ?? byName.get(normKey(name))

    // บาร์โค้ดชนกับหน่วยเพิ่มเติมของสินค้าตัวอื่น → ห้ามนำเข้า (ยิงบาร์โค้ดจะได้สินค้าผิด)
    if (barcode) {
      const unitClash = byUnitBarcode.get(barcode)
      if (unitClash && unitClash.id !== target?.id) {
        skip(`บาร์โค้ด ${barcode} ถูกใช้เป็นหน่วยเพิ่มเติมของสินค้า “${unitClash.name}” อยู่แล้ว`)
        continue
      }
    }

    // กันบรรทัดซ้ำทั้งทางบาร์โค้ดและทางชื่อ — ชื่อเดียวกันแต่บาร์โค้ดต่างกัน
    // จะถูกจับคู่เป็นสินค้าเดิมตัวเดียวกันตอนนำเข้า (ทับกันเอง + ledger ไม่ตรงสต็อก)
    const barcodeKey = barcode ? `b:${barcode}` : ''
    const nameKey = `n:${normKey(name)}`
    if ((barcodeKey && seen.has(barcodeKey)) || seen.has(nameKey)) {
      skip('ซ้ำกับบรรทัดก่อนหน้าในไฟล์นี้ (ชื่อหรือบาร์โค้ดเดียวกัน)')
      continue
    }
    if (barcodeKey) seen.add(barcodeKey)
    seen.add(nameKey)

    if (categoryName && !knownCats.has(normKey(categoryName))) {
      knownCats.add(normKey(categoryName))
      newCategories.push(categoryName)
    }

    rows.push({
      ...base,
      status: target ? 'update' : 'create',
      price: r2(price),
      cost: cost ?? null,
      stock: stock ?? null,
      lowStockAt: lowStockAt ?? null,
      targetName: target?.name,
    })
    if (target) updateCount++
    else createCount++
  }

  return { rows, createCount, updateCount, skipCount, newCategories }
}

/* =========================================================
   อ่านไฟล์ (รองรับ UTF-8 และ Windows-874/TIS-620 ที่ Excel ไทยมักบันทึกมา)
   ========================================================= */

async function readCsvText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  if (!hasBom) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      try {
        return new TextDecoder('windows-874').decode(bytes)
      } catch {
        /* ตกไปใช้ utf-8 แบบผ่อนปรนด้านล่าง */
      }
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/* =========================================================
   โมดัลนำเข้าสินค้าจาก CSV
   ========================================================= */

const STATUS_LABEL: Record<RowStatus, string> = {
  create: 'เพิ่มใหม่',
  update: 'อัปเดตทับ',
  skip: 'ข้าม',
}

export default function ImportCsvModal({
  open,
  products,
  categoryNames,
  onClose,
}: {
  open: boolean
  products: Product[]
  categoryNames: string[]
  onClose: () => void
}) {
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<Analysis | null>(null)
  // การนำเข้าเขียน products.stock + stockMoves ด้วย จึงต้องมีสิทธิ์ 'stock' ไม่ใช่แค่ 'products'
  // ดึง can ที่ระดับคอมโพเนนต์ (ห้ามเรียก hook ในฟังก์ชัน async) แล้วไปตรวจซ้ำใน runImport()
  const { can } = usePermissions()
  const canStock = can('stock')

  const reset = () => {
    setFileName('')
    setResult(null)
    setLoading(false)
    setSaving(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setLoading(true)
    try {
      const text = await readCsvText(file)
      const table = parseCsv(text)
      const analysis = analyze(table, products, categoryNames)
      setResult(analysis)
      if (analysis.error) toast.error(analysis.error)
    } catch {
      toast.error('อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ CSV (บันทึกจาก Excel เป็น “CSV UTF-8” ได้)')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  /** นำเข้าจริง — อ่านข้อมูลปัจจุบันใหม่ในทรานแซกชันเดียว กันข้อมูลเปลี่ยนระหว่างพรีวิว */
  const runImport = async () => {
    const plan = result?.rows.filter((r) => r.status !== 'skip') ?? []
    if (plan.length === 0) return
    // กันสิทธิ์ชั้นที่สอง ณ จุดเขียนฐานข้อมูล — ปุ่ม “นำเข้า CSV” ในหน้าสินค้าถูกปิดไว้แล้ว
    // แต่โมดัลอาจเปิดค้างไว้ตั้งแต่ก่อนสิทธิ์ถูกถอน จึงต้องตรวจก่อนเข้าทรานแซกชันเสมอ
    if (!canStock) {
      toast.error('ไม่มีสิทธิ์ปรับสต็อก — ต้องมีสิทธิ์ “รับของเข้า / ปรับสต็อก / นับสต็อก”')
      return
    }
    setSaving(true)
    try {
      const summary = await db.transaction(
        'rw',
        db.products,
        db.categories,
        db.stockMoves,
        async () => {
          const now = Date.now()

          // 1) สร้างหมวดหมู่ที่ยังไม่มี
          const cats = await db.categories.toArray()
          const catMap = new Map<string, number>()
          for (const c of cats) if (c.id != null) catMap.set(normKey(c.name), c.id)
          let maxOrder = cats.reduce((m, c) => Math.max(m, c.sortOrder), 0)
          let newCats = 0
          for (const r of plan) {
            const cname = r.categoryName.trim()
            if (!cname || catMap.has(normKey(cname))) continue
            const id = await db.categories.add({ name: cname, sortOrder: ++maxOrder })
            catMap.set(normKey(cname), id)
            newCats++
          }

          // 2) จับคู่สินค้าเดิมอีกครั้งจากข้อมูลสดในฐานข้อมูล
          const existing = await db.products.toArray()
          const byBarcode = new Map<string, Product>()
          const byName = new Map<string, Product>()
          const byUnitBarcode = new Map<string, Product>()
          for (const p of existing) {
            const b = (p.barcode ?? '').trim()
            if (b) byBarcode.set(b, p)
            byName.set(normKey(p.name), p)
            for (const u of p.units ?? []) {
              const ub = (u.barcode ?? '').trim()
              if (ub) byUnitBarcode.set(ub, p)
            }
          }

          /** สินค้าเดิมที่จะเขียนทับ (productId → ค่าล่าสุด) — หลายบรรทัดที่ชี้สินค้าเดียวกันต้องต่อยอดกัน */
          const pending = new Map<number, Product>()
          const moves: StockMove[] = []
          let created = 0
          let updated = 0
          let blocked = 0

          for (const r of plan) {
            const catId = r.categoryName.trim() ? catMap.get(normKey(r.categoryName)) : undefined
            const found =
              (r.barcode ? byBarcode.get(r.barcode) : undefined) ?? byName.get(normKey(r.name))
            // ข้อมูลอาจเปลี่ยนไปหลังพรีวิว — ตรวจบาร์โค้ดชนกับหน่วยเพิ่มเติมของสินค้าอื่นอีกครั้ง
            if (r.barcode) {
              const unitClash = byUnitBarcode.get(r.barcode)
              if (unitClash && unitClash.id !== found?.id) {
                blocked++
                continue
              }
            }
            // ถ้ามีบรรทัดก่อนหน้าแก้สินค้าตัวนี้ไปแล้ว ให้คิดต่อจากค่านั้น (สต็อก/ledger จึงตรงกัน)
            const target = found?.id != null ? (pending.get(found.id) ?? found) : undefined

            if (target?.id != null) {
              const trackStock = r.trackStock ?? target.trackStock
              const next: Product = {
                ...target,
                name: r.name,
                barcode: r.barcode || target.barcode,
                categoryId: catId ?? target.categoryId,
                price: r.price,
                cost: r.cost ?? target.cost,
                unit: r.unit || target.unit,
                trackStock,
                lowStockAt: r.lowStockAt ?? target.lowStockAt,
              }
              // แก้สต็อกเฉพาะเมื่อกรอกช่องสต็อกมา (เว้นว่าง = คงสต็อกเดิม)
              if (trackStock && r.stock != null) {
                const diff = r2(r.stock - target.stock)
                next.stock = r2(r.stock)
                if (diff !== 0)
                  moves.push({
                    productId: target.id,
                    type: 'adjust',
                    qty: diff,
                    note: 'นำเข้าสินค้าจาก CSV',
                    createdAt: now,
                  })
              }
              if (!pending.has(target.id)) updated++
              pending.set(target.id, next)
            } else {
              const trackStock = r.trackStock ?? false
              const stock = trackStock && r.stock != null ? r2(r.stock) : 0
              const fresh: Product = {
                name: r.name,
                barcode: r.barcode || undefined,
                categoryId: catId,
                price: r.price,
                cost: r.cost ?? 0,
                unit: r.unit || 'ชิ้น',
                trackStock,
                stock,
                lowStockAt: r.lowStockAt ?? undefined,
                active: true,
                createdAt: now,
              }
              const id = await db.products.add(fresh)
              // ลงทะเบียนตัวที่เพิ่งสร้าง กันบรรทัดถัดไปสร้างสินค้าชื่อ/บาร์โค้ดเดียวกันซ้ำ
              const saved: Product = { ...fresh, id }
              byName.set(normKey(saved.name), saved)
              if (saved.barcode) byBarcode.set(saved.barcode, saved)
              if (trackStock && stock > 0)
                moves.push({
                  productId: id,
                  type: 'receive',
                  qty: stock,
                  note: 'นำเข้าสินค้าจาก CSV (สต็อกเริ่มต้น)',
                  createdAt: now,
                })
              created++
            }
          }

          const puts = [...pending.values()]
          if (puts.length > 0) await db.products.bulkPut(puts)
          if (moves.length > 0) await db.stockMoves.bulkAdd(moves)
          return { created, updated, newCats, blocked }
        },
      )

      const parts = [`เพิ่มใหม่ ${summary.created} รายการ`, `อัปเดต ${summary.updated} รายการ`]
      if (summary.newCats > 0) parts.push(`หมวดหมู่ใหม่ ${summary.newCats} หมวด`)
      const skipped = (result?.skipCount ?? 0) + summary.blocked
      if (skipped > 0) parts.push(`ข้าม ${skipped} บรรทัด`)
      toast.success(`นำเข้าสินค้าสำเร็จ — ${parts.join(' · ')}`)
      close()
    } catch {
      toast.error('นำเข้าไม่สำเร็จ ข้อมูลเดิมไม่ถูกแก้ไข กรุณาลองใหม่อีกครั้ง')
      setSaving(false)
    }
  }

  const importable = (result?.createCount ?? 0) + (result?.updateCount ?? 0)
  const errorRows = result?.rows.filter((r) => r.status === 'skip') ?? []
  const preview = result?.rows.slice(0, 20) ?? []

  return (
    <Modal
      open={open}
      onClose={close}
      title="นำเข้าสินค้าจากไฟล์ CSV"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            ยกเลิก
          </Button>
          <Button
            icon="check"
            disabled={importable === 0 || saving || loading || !canStock}
            title={canStock ? undefined : 'ต้องมีสิทธิ์ “รับของเข้า / ปรับสต็อก / นับสต็อก”'}
            onClick={() => void runImport()}
          >
            {saving ? 'กำลังนำเข้า…' : `ยืนยันนำเข้า ${importable} รายการ`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* ----- เลือกไฟล์ ----- */}
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 py-7 text-slate-500 transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 hover:text-emerald-600">
          <Icon name="upload" size={26} />
          <span className="text-sm font-medium">
            {fileName ? `ไฟล์: ${fileName} — คลิกเพื่อเปลี่ยนไฟล์` : 'คลิกเพื่อเลือกไฟล์ CSV'}
          </span>
          <span className="text-xs text-slate-400">
            บรรทัดแรกต้องเป็นหัวตาราง · จับคู่สินค้าเดิมด้วยบาร์โค้ด ถ้าไม่มีจะใช้ชื่อสินค้า
          </span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onPickFile} />
        </label>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
            <Spinner /> กำลังอ่านไฟล์…
          </div>
        )}

        {result?.error && (
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <Icon name="alert" size={16} className="mt-0.5" />
            <span>{result.error}</span>
          </div>
        )}

        {result && !result.error && (
          <>
            {/* ----- สรุป ----- */}
            <div className="flex flex-wrap gap-2">
              <SumChip color="green" label="เพิ่มใหม่" value={result.createCount} />
              <SumChip color="blue" label="อัปเดตทับ" value={result.updateCount} />
              <SumChip color="red" label="ข้ามเพราะข้อมูลผิด" value={result.skipCount} />
              {result.newCategories.length > 0 && (
                <SumChip
                  color="amber"
                  label="หมวดหมู่ใหม่"
                  value={result.newCategories.length}
                  unit="หมวด"
                />
              )}
            </div>
            {result.newCategories.length > 0 && (
              <p className="text-xs text-slate-500">
                จะสร้างหมวดหมู่ใหม่ให้อัตโนมัติ: {result.newCategories.join(', ')}
              </p>
            )}

            {/* ----- พรีวิว 20 แถวแรก ----- */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">
                  ตัวอย่างข้อมูล (20 บรรทัดแรก)
                </span>
                <span className="text-xs text-slate-400">
                  ทั้งไฟล์ {result.rows.length} บรรทัดข้อมูล
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-3 py-2 font-medium">บรรทัด</th>
                      <th className="px-3 py-2 font-medium">ผล</th>
                      <th className="px-3 py-2 font-medium">ชื่อสินค้า</th>
                      <th className="px-3 py-2 font-medium">บาร์โค้ด</th>
                      <th className="px-3 py-2 font-medium">หมวดหมู่</th>
                      <th className="px-3 py-2 text-right font-medium">ราคา</th>
                      <th className="px-3 py-2 text-right font-medium">ต้นทุน</th>
                      <th className="px-3 py-2 font-medium">หน่วย</th>
                      <th className="px-3 py-2 text-right font-medium">สต็อก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr
                        key={r.line}
                        className={`border-b border-slate-50 last:border-0 ${r.status === 'skip' ? 'bg-rose-50/40' : ''}`}
                      >
                        <td className="px-3 py-2 text-xs text-slate-400">{r.line}</td>
                        <td className="px-3 py-2">
                          <Badge
                            color={
                              r.status === 'create' ? 'green' : r.status === 'update' ? 'blue' : 'red'
                            }
                          >
                            {STATUS_LABEL[r.status]}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="max-w-52 truncate font-medium text-slate-800">
                            {r.name || <span className="text-slate-300">— ไม่มีชื่อ —</span>}
                          </div>
                          {r.status === 'update' && r.targetName && r.targetName !== r.name && (
                            <div className="truncate text-xs text-slate-400">
                              ทับรายการเดิม: {r.targetName}
                            </div>
                          )}
                          {r.status === 'skip' && r.reason && (
                            <div className="text-xs text-rose-600">{r.reason}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">{r.barcode || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{r.categoryName || '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {r.status === 'skip' ? '—' : baht(r.price)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {r.cost != null ? baht(r.cost) : '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{r.unit || '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {r.stock != null ? qty3(r.stock) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ----- บรรทัดที่ข้าม ----- */}
            {errorRows.length > 0 && (
              <div>
                <span className="mb-1.5 block text-sm font-medium text-slate-600">
                  บรรทัดที่จะข้าม ({errorRows.length})
                </span>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-rose-50 p-3">
                  {errorRows.map((r) => (
                    <div key={r.line} className="text-xs text-rose-700">
                      บรรทัด {r.line}
                      {r.name ? ` (${r.name})` : ''}: {r.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400">
              การอัปเดตทับจะแก้เฉพาะข้อมูลในไฟล์ — รูปสินค้า, กลุ่มตัวเลือก, หน่วยเพิ่มเติม และราคาส่ง
              ยังคงอยู่ครบ (ช่องสต็อกที่เว้นว่างไว้ก็ไม่ถูกแก้)
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

function SumChip({
  color,
  label,
  value,
  unit = 'รายการ',
}: {
  color: 'green' | 'blue' | 'red' | 'amber'
  label: string
  value: number
  unit?: string
}) {
  const tone = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    blue: 'bg-sky-50 text-sky-700 ring-sky-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  }[color]
  return (
    <span className={`rounded-xl px-3.5 py-2 text-sm ring-1 ${tone}`}>
      {label} <b className="text-base">{value}</b> {unit}
    </span>
  )
}
