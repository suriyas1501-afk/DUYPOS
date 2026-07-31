import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Product, StockCount, StockCountItem } from '../db/types'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  toast,
} from '../components/ui'
import { baht, endOfDay, fmtDate, fmtDateTime, money, r2, startOfDay } from '../lib/format'
import { DOC_PREFIX, formatDocNo, nextSeq } from '../lib/docNo'
import { getActor } from '../lib/actor'
import { downloadCsv } from '../lib/csv'
import { ProductPicker, qty3 } from './products/shared'

/* =========================================================
   สถานะเซสชันนับสต็อก
   ========================================================= */

interface CntRow {
  key: number
  productId: number
  name: string
  unit: string
  categoryId?: number
  /** จำนวนในระบบ ณ ตอนที่หยิบสินค้าเข้ารายการนับ */
  systemQty: number
  cost: number
  /** ค่าที่พิมพ์ในช่อง “นับได้” — เว้นว่าง = ยังไม่ได้นับ */
  countedStr: string
}

interface Session {
  id: number
  docNo: string
  date: number
  note: string
  rows: CntRow[]
}

let rowKeySeq = 0

const countedNum = (r: CntRow): number | null => {
  if (r.countedStr.trim() === '') return null
  const n = Number(r.countedStr)
  return Number.isFinite(n) ? r2(n) : null
}
const rowDiff = (r: CntRow): number | null => {
  const c = countedNum(r)
  return c == null ? null : r2(c - r.systemQty)
}
const rowDiffValue = (r: CntRow): number => {
  const d = rowDiff(r)
  return d == null ? 0 : r2(d * r.cost)
}

/**
 * ร่างจะเก็บแถวที่ยังไม่ได้นับเป็น countedQty=0 และ diff=0
 * (ตอนโหลดกลับมาจึงตีความว่า “ยังไม่ได้นับ” = ช่องว่าง)
 */
const draftItems = (rows: CntRow[]): StockCountItem[] =>
  rows.map((r) => {
    const c = countedNum(r)
    return {
      productId: r.productId,
      name: r.name,
      systemQty: r2(r.systemQty),
      countedQty: c ?? 0,
      diff: c == null ? 0 : r2(c - r.systemQty),
      cost: r2(r.cost),
      diffValue: c == null ? 0 : r2((c - r.systemQty) * r.cost),
    }
  })

const CSV_HEADER = ['สินค้า', 'จำนวนในระบบ', 'นับได้', 'ผลต่าง', 'มูลค่าผลต่าง']

const exportCountCsv = (docNo: string, items: StockCountItem[], totalDiffValue: number) => {
  downloadCsv(`ใบนับสต็อก-${docNo}.csv`, [
    CSV_HEADER,
    ...items.map((it) => [it.name, it.systemQty, it.countedQty, it.diff, it.diffValue]),
    ['รวมมูลค่าผลต่าง', '', '', '', totalDiffValue],
  ])
}

/* =========================================================
   หน้านับสต็อก
   ========================================================= */

export default function StockCountPage() {
  const allProducts = useLiveQuery(() => db.products.toArray(), [])
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), [])
  const drafts = useLiveQuery(async () => {
    const list = await db.stockCounts.where('status').equals('draft').toArray()
    return list.sort((a, b) => b.createdAt - a.createdAt)
  }, [])
  const history = useLiveQuery(
    () => db.stockCounts.orderBy('createdAt').reverse().limit(20).toArray(),
    [],
  )

  const products = useMemo(() => allProducts ?? [], [allProducts])
  const productMap = useMemo(() => {
    const m = new Map<number, Product>()
    for (const p of products) if (p.id != null) m.set(p.id, p)
    return m
  }, [products])
  const catNames = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of categories ?? []) if (c.id != null) m.set(c.id, c.name)
    return m
  }, [categories])

  const [session, setSession] = useState<Session | null>(null)
  const [catFilter, setCatFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const [confirmCommit, setConfirmCommit] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [detail, setDetail] = useState<StockCount | null>(null)
  /** เตือนว่าจำนวนในระบบเปลี่ยนไประหว่างนับ (มีการขายเกิดขึ้น) */
  const [drift, setDrift] = useState<{ docNo: string; lines: string[] } | null>(null)

  /* ----- เริ่ม / โหลดเซสชัน ----- */
  const startNew = async () => {
    const date = startOfDay(Date.now())
    try {
      const created = await db.transaction('rw', db.stockCounts, async () => {
        const sameDay = await db.stockCounts
          .where('date')
          .between(startOfDay(date), endOfDay(date), true, true)
          .toArray()
        const seq = nextSeq(
          sameDay.map((s) => s.docNo),
          DOC_PREFIX.stockCount,
          date,
        )
        const docNo = formatDocNo(DOC_PREFIX.stockCount, date, seq)
        const actor = getActor()
        const id = await db.stockCounts.add({
          docNo,
          date,
          status: 'draft',
          items: [],
          totalDiffValue: 0,
          staffId: actor.id,
          staffName: actor.name,
          createdAt: Date.now(),
        })
        return { id, docNo }
      })
      setSession({ id: created.id, docNo: created.docNo, date, note: '', rows: [] })
      setCatFilter('all')
      setDrift(null)
      toast.success(`เริ่มใบนับสต็อก ${created.docNo}`)
    } catch {
      toast.error('เริ่มใบนับสต็อกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    }
  }

  const openDraft = (sc: StockCount) => {
    if (sc.id == null) return
    setSession({
      id: sc.id,
      docNo: sc.docNo,
      date: sc.date,
      note: sc.note ?? '',
      rows: sc.items.map((it) => {
        const p = productMap.get(it.productId)
        // diff=0 และ countedQty=0 → ยังไม่ได้นับ (ดูคำอธิบายที่ draftItems)
        const blank = it.diff === 0 && it.countedQty === 0
        return {
          key: ++rowKeySeq,
          productId: it.productId,
          name: p?.name ?? it.name,
          unit: p?.unit ?? '',
          categoryId: p?.categoryId,
          systemQty: it.systemQty,
          cost: p?.cost ?? it.cost,
          countedStr: blank ? '' : String(it.countedQty),
        }
      }),
    })
    setCatFilter('all')
    setDrift(null)
  }

  /* ----- จัดการแถว ----- */
  const addProduct = (p: Product) => {
    if (p.id == null) return
    if (!p.trackStock) {
      toast.error(`“${p.name}” ไม่ได้เปิดนับสต็อก — เปิด “นับสต็อกสินค้านี้” ที่หน้าสินค้าก่อน`)
      return
    }
    const pid = p.id
    setSession((s) => {
      if (!s) return s
      const i = s.rows.findIndex((r) => r.productId === pid)
      if (i >= 0) {
        // ยิงซ้ำ = เพิ่มจำนวนที่นับได้ 1
        const cur = countedNum(s.rows[i]) ?? 0
        return {
          ...s,
          rows: s.rows.map((r, j) => (j === i ? { ...r, countedStr: String(r2(cur + 1)) } : r)),
        }
      }
      return {
        ...s,
        rows: [
          ...s.rows,
          {
            key: ++rowKeySeq,
            productId: pid,
            name: p.name,
            unit: p.unit,
            categoryId: p.categoryId,
            systemQty: r2(p.stock),
            cost: r2(p.cost),
            countedStr: '1',
          },
        ],
      }
    })
  }

  const addAllTracked = () => {
    if (!session) return
    const have = new Set(session.rows.map((r) => r.productId))
    const pick = products
      .filter(
        (p) =>
          p.id != null &&
          p.trackStock &&
          p.active &&
          !have.has(p.id) &&
          (catFilter === 'all' || p.categoryId === Number(catFilter)),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'th'))
    if (pick.length === 0) {
      toast.error('ไม่มีสินค้าที่จะเพิ่ม (อาจอยู่ในรายการนับครบแล้ว)')
      return
    }
    const fresh: CntRow[] = pick.map((p) => ({
      key: ++rowKeySeq,
      productId: p.id as number,
      name: p.name,
      unit: p.unit,
      categoryId: p.categoryId,
      systemQty: r2(p.stock),
      cost: r2(p.cost),
      countedStr: '',
    }))
    setSession((s) => (s ? { ...s, rows: [...s.rows, ...fresh] } : s))
    toast.success(`เพิ่มสินค้า ${fresh.length} รายการเข้ารายการนับแล้ว`)
  }

  const removeRow = (key: number) =>
    setSession((s) => (s ? { ...s, rows: s.rows.filter((r) => r.key !== key) } : s))

  const setCounted = (key: number, v: string) =>
    setSession((s) =>
      s ? { ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, countedStr: v } : r)) } : s,
    )

  /** ดึงจำนวนในระบบล่าสุดมาทับ (ใช้เมื่อมีการขายระหว่างนับ) */
  const refreshSystemQty = () => {
    if (!session) return
    let changed = 0
    const rows = session.rows.map((r) => {
      const p = productMap.get(r.productId)
      if (!p || r2(p.stock) === r2(r.systemQty)) return r
      changed++
      return { ...r, systemQty: r2(p.stock), cost: r2(p.cost) }
    })
    setSession((s) => (s ? { ...s, rows } : s))
    toast.success(
      changed === 0
        ? 'จำนวนในระบบตรงกับที่แสดงอยู่แล้ว'
        : `อัปเดตจำนวนในระบบ ${changed} รายการแล้ว`,
    )
  }

  /* ----- สรุป ----- */
  const summary = useMemo(() => {
    const rows = session?.rows ?? []
    let countedRows = 0
    let diffRows = 0
    let shortValue = 0
    let overValue = 0
    for (const r of rows) {
      const d = rowDiff(r)
      if (d == null) continue
      countedRows++
      if (d !== 0) diffRows++
      const v = rowDiffValue(r)
      if (v < 0) shortValue += v
      else overValue += v
    }
    return {
      countedRows,
      diffRows,
      shortValue: r2(Math.abs(shortValue)),
      overValue: r2(overValue),
      netValue: r2(overValue + shortValue),
    }
  }, [session])

  const visibleRows = useMemo(() => {
    const rows = session?.rows ?? []
    if (catFilter === 'all') return rows
    return rows.filter((r) => r.categoryId === Number(catFilter))
  }, [session, catFilter])

  /* ----- บันทึกร่าง ----- */
  const saveDraft = async (closeAfter: boolean) => {
    if (!session) return
    setSaving(true)
    try {
      const items = draftItems(session.rows)
      await db.stockCounts.update(session.id, {
        items,
        totalDiffValue: r2(items.reduce((s, i) => s + i.diffValue, 0)),
        note: session.note.trim() || undefined,
      })
      toast.success(`บันทึกร่างใบนับ ${session.docNo} แล้ว — นับต่อวันหลังได้`)
      if (closeAfter) setSession(null)
    } catch {
      toast.error('บันทึกร่างไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  /* ----- ลบร่าง ----- */
  const discardDraft = async () => {
    if (!session) return
    try {
      await db.stockCounts.delete(session.id)
      toast.success(`ลบใบนับ ${session.docNo} แล้ว`)
      setSession(null)
    } catch {
      toast.error('ลบใบนับไม่สำเร็จ')
    }
  }

  /* ----- ยืนยันปรับสต็อก ----- */
  const validateBeforeCommit = (): boolean => {
    if (!session) return false
    const counted = session.rows.filter((r) => r.countedStr.trim() !== '')
    if (counted.length === 0) {
      toast.error('ยังไม่ได้กรอกจำนวนที่นับได้เลย — กรอกอย่างน้อย 1 รายการก่อนปรับสต็อก')
      return false
    }
    for (const r of counted) {
      const n = Number(r.countedStr)
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`“${r.name}”: จำนวนที่นับได้ต้องเป็นตัวเลขและไม่ติดลบ`)
        return false
      }
    }
    return true
  }

  const commit = async () => {
    if (!session) return
    const counted = session.rows.filter((r) => r.countedStr.trim() !== '')
    setSaving(true)
    try {
      const res = await db.transaction(
        'rw',
        db.stockCounts,
        db.products,
        db.stockMoves,
        async () => {
          const now = Date.now()
          const items: StockCountItem[] = []
          const driftLines: string[] = []
          let missing = 0
          let adjusted = 0

          for (const r of counted) {
            const countedQty = r2(Number(r.countedStr))
            const p = await db.products.get(r.productId)
            if (p?.id == null) {
              missing++
              continue
            }
            // อ่านสต็อกปัจจุบันใหม่ — ระหว่างนับอาจมีการขายเกิดขึ้น
            const systemQty = p.trackStock ? r2(p.stock) : 0
            if (systemQty !== r2(r.systemQty))
              driftLines.push(
                `${p.name}: ตอนนับระบบมี ${qty3(r.systemQty)} → ตอนบันทึกมี ${qty3(systemQty)}`,
              )
            const diff = r2(countedQty - systemQty)
            items.push({
              productId: p.id,
              name: p.name,
              systemQty,
              countedQty,
              diff,
              cost: r2(p.cost),
              diffValue: r2(diff * p.cost),
            })
            if (p.trackStock) {
              await db.products.update(p.id, { stock: countedQty })
              if (diff !== 0) {
                adjusted++
                await db.stockMoves.add({
                  productId: p.id,
                  type: 'count',
                  qty: diff,
                  note: `นับสต็อก ${session.docNo}`,
                  refDocNo: session.docNo,
                  createdAt: now,
                })
              }
            }
          }

          const totalDiffValue = r2(items.reduce((s, i) => s + i.diffValue, 0))
          await db.stockCounts.update(session.id, {
            items,
            totalDiffValue,
            status: 'committed',
            committedAt: now,
            note: session.note.trim() || undefined,
          })
          return { count: items.length, adjusted, driftLines, missing, totalDiffValue }
        },
      )

      const parts = [`${res.count} รายการ`, `ปรับสต็อก ${res.adjusted} รายการ`]
      if (res.missing > 0) parts.push(`ข้าม ${res.missing} รายการที่ถูกลบไปแล้ว`)
      toast.success(`ปรับสต็อกตามผลนับ ${session.docNo} แล้ว — ${parts.join(' · ')}`)
      if (res.driftLines.length > 0) setDrift({ docNo: session.docNo, lines: res.driftLines })
      setSession(null)
    } catch {
      toast.error('ปรับสต็อกไม่สำเร็จ ข้อมูลไม่ถูกแก้ไข กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  /* =========================================================
     ยังไม่เปิดเซสชัน — หน้ารวม
     ========================================================= */
  if (!session) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <PageHeader
          title="นับสต็อก"
          subtitle="นับของจริงเทียบกับจำนวนในระบบ แล้วปรับยอดทีเดียวทั้งใบ"
          actions={
            <Button icon="plus" onClick={() => void startNew()}>
              เริ่มนับสต็อกใหม่
            </Button>
          }
        />

        {drift && <DriftAlert drift={drift} onClose={() => setDrift(null)} />}

        {/* ร่างที่ค้างอยู่ */}
        {drafts && drafts.length > 0 && (
          <Card title="ใบนับที่ค้างอยู่ (ร่าง)" className="mb-4" padded={false}>
            <div className="divide-y divide-slate-50">
              {drafts.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Badge color="amber">ร่าง</Badge>
                  <span className="font-medium text-slate-800">{d.docNo}</span>
                  <span className="text-sm text-slate-500">{fmtDateTime(d.createdAt)}</span>
                  <span className="text-sm text-slate-500">{d.items.length} รายการ</span>
                  <Button
                    className="ml-auto"
                    variant="secondary"
                    size="sm"
                    icon="pencil"
                    onClick={() => openDraft(d)}
                  >
                    นับต่อ
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="ประวัติใบนับสต็อก (20 รายการล่าสุด)" padded={false}>
          {!history ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : history.length === 0 ? (
            <EmptyState
              icon="clipboard"
              title="ยังไม่มีการนับสต็อก"
              hint="กด “เริ่มนับสต็อกใหม่” เพื่อเริ่มนับของจริงเทียบกับระบบ"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">เลขที่</th>
                    <th className="px-4 py-3 font-medium">วันที่</th>
                    <th className="px-4 py-3 font-medium">สถานะ</th>
                    <th className="px-4 py-3 text-right font-medium">รายการ</th>
                    <th className="px-4 py-3 text-right font-medium">ผลต่าง ≠ 0</th>
                    <th className="px-4 py-3 text-right font-medium">มูลค่าผลต่าง</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((sc) => {
                    const diffCount = sc.items.filter((it) => it.diff !== 0).length
                    return (
                      <tr
                        key={sc.id}
                        className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50"
                        onClick={() => setDetail(sc)}
                      >
                        <td className="px-4 py-2.5 font-medium text-slate-800">{sc.docNo}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {sc.committedAt != null ? fmtDateTime(sc.committedAt) : fmtDate(sc.date)}
                        </td>
                        <td className="px-4 py-2.5">
                          {sc.status === 'committed' ? (
                            <Badge color="green">ปรับสต็อกแล้ว</Badge>
                          ) : (
                            <Badge color="amber">ร่าง</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600">{sc.items.length}</td>
                        <td className="px-4 py-2.5 text-right text-slate-600">{diffCount}</td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold ${
                            sc.totalDiffValue < 0
                              ? 'text-rose-600'
                              : sc.totalDiffValue > 0
                                ? 'text-amber-600'
                                : 'text-slate-500'
                          }`}
                        >
                          {sc.totalDiffValue > 0 ? '+' : ''}
                          {baht(sc.totalDiffValue)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Icon name="eye" size={16} className="inline text-slate-400" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <CountDetailModal
          doc={detail}
          onClose={() => setDetail(null)}
          onContinue={(sc) => {
            setDetail(null)
            openDraft(sc)
          }}
        />
      </div>
    )
  }

  /* =========================================================
     กำลังนับ
     ========================================================= */
  const sessionItems = draftItems(session.rows).filter(
    (_, i) => countedNum(session.rows[i]) != null,
  )

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title={`นับสต็อก · ${session.docNo}`}
        subtitle="กรอกจำนวนที่นับได้จริง ระบบจะคำนวณผลต่างและมูลค่าให้ — ยังไม่ปรับสต็อกจนกดยืนยัน"
        actions={
          <>
            <Button
              variant="secondary"
              icon="download"
              disabled={sessionItems.length === 0}
              title="ส่งออกผลนับที่กรอกไว้เป็นไฟล์ CSV"
              onClick={() =>
                exportCountCsv(
                  session.docNo,
                  sessionItems,
                  r2(sessionItems.reduce((s, i) => s + i.diffValue, 0)),
                )
              }
            >
              ส่งออก CSV
            </Button>
            <Button
              variant="secondary"
              icon="clock"
              disabled={saving}
              onClick={() => void saveDraft(false)}
            >
              บันทึกร่าง
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => void saveDraft(true)}
            >
              บันทึกร่างและปิด
            </Button>
          </>
        }
      />

      {/* ===== แถบสรุปติดบน ===== */}
      <div className="sticky top-0 z-10 -mx-6 mb-4 border-b border-slate-200 bg-slate-100/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <StatChip
            icon="clipboard"
            label="นับแล้ว"
            value={`${summary.countedRows}/${session.rows.length}`}
            unit="รายการ"
          />
          <StatChip
            icon="alert"
            label="ผลต่าง ≠ 0"
            value={String(summary.diffRows)}
            unit="รายการ"
            tone={summary.diffRows > 0 ? 'amber' : 'slate'}
          />
          <StatChip
            icon="minus"
            label="มูลค่าของขาด"
            value={baht(summary.shortValue)}
            unit="บาท"
            tone={summary.shortValue > 0 ? 'red' : 'slate'}
          />
          <StatChip
            icon="plus"
            label="มูลค่าของเกิน"
            value={baht(summary.overValue)}
            unit="บาท"
            tone={summary.overValue > 0 ? 'amber' : 'slate'}
          />
          <Button
            className="ml-auto"
            icon="check"
            disabled={saving || summary.countedRows === 0}
            onClick={() => {
              if (validateBeforeCommit()) setConfirmCommit(true)
            }}
          >
            ยืนยันปรับสต็อกตามผลนับ
          </Button>
        </div>
      </div>

      {/* ===== เพิ่มสินค้าเข้ารายการนับ ===== */}
      <Card className="mb-4">
        <div className="space-y-3">
          {!allProducts ? (
            <div className="flex justify-center py-2">
              <Spinner />
            </div>
          ) : (
            <ProductPicker
              products={products}
              autoFocus
              showStock
              onPick={addProduct}
              placeholder="ยิงบาร์โค้ด หรือพิมพ์ชื่อสินค้าแล้วกด Enter เพื่อเพิ่มเข้ารายการนับ…"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                <option value="all">หมวดหมู่: ทั้งหมด</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="secondary" icon="box" onClick={addAllTracked}>
              {catFilter === 'all'
                ? 'เพิ่มสินค้าทั้งหมดที่นับสต็อก'
                : `เพิ่มสินค้าในหมวด “${catNames.get(Number(catFilter)) ?? ''}”`}
            </Button>
            <Button variant="secondary" icon="refresh" onClick={refreshSystemQty}>
              รีเฟรชจำนวนในระบบ
            </Button>
            <Button
              variant="ghost"
              icon="trash"
              className="text-rose-500 hover:bg-rose-50"
              onClick={() => setConfirmDiscard(true)}
            >
              ลบใบนับนี้
            </Button>
          </div>
          <p className="text-xs text-slate-400">
            ยิงบาร์โค้ดซ้ำ = เพิ่มจำนวนที่นับได้ 1 · แถวที่เว้นช่อง “นับได้” ว่างจะไม่ถูกปรับสต็อก
            {catFilter !== 'all' &&
              ` · กำลังแสดงเฉพาะหมวดที่เลือก (${visibleRows.length} จาก ${session.rows.length} รายการ)`}
          </p>
        </div>
      </Card>

      {/* ===== ตารางนับ ===== */}
      <Card className="mb-4" padded={false}>
        {session.rows.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="ยังไม่มีสินค้าในรายการนับ"
            hint="ยิงบาร์โค้ด ค้นหาชื่อสินค้า หรือกด “เพิ่มสินค้าทั้งหมดที่นับสต็อก”"
          />
        ) : visibleRows.length === 0 ? (
          <EmptyState icon="search" title="ไม่มีรายการในหมวดที่เลือก" hint="เปลี่ยนตัวกรองหมวดหมู่" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">สินค้า</th>
                  <th className="w-32 px-3 py-3 text-right font-medium">ในระบบ</th>
                  <th className="w-32 px-3 py-3 font-medium">นับได้</th>
                  <th className="w-28 px-3 py-3 text-right font-medium">ผลต่าง</th>
                  <th className="w-28 px-3 py-3 text-right font-medium">ต้นทุน/หน่วย</th>
                  <th className="w-32 px-3 py-3 text-right font-medium">มูลค่าผลต่าง</th>
                  <th className="w-10 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const d = rowDiff(r)
                  const dv = rowDiffValue(r)
                  const live = productMap.get(r.productId)
                  // สต็อกในระบบขยับหลังหยิบสินค้าเข้ารายการนับ (เช่น มีการขายระหว่างนับ)
                  const liveStock =
                    live != null && r2(live.stock) !== r2(r.systemQty) ? r2(live.stock) : null
                  return (
                    <tr key={r.key} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2">
                        <div className="truncate font-medium text-slate-800">{r.name}</div>
                        <div className="text-xs text-slate-400">
                          {r.categoryId != null ? (catNames.get(r.categoryId) ?? '') : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {qty3(r.systemQty)} {r.unit}
                        {liveStock != null && (
                          <div className="text-xs font-medium text-amber-600">
                            ตอนนี้ระบบมี {qty3(liveStock)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          placeholder="ยังไม่นับ"
                          value={r.countedStr}
                          onChange={(e) => setCounted(r.key, e.target.value)}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${
                          d == null
                            ? 'text-slate-300'
                            : d < 0
                              ? 'text-rose-600'
                              : d > 0
                                ? 'text-amber-600'
                                : 'text-emerald-600'
                        }`}
                      >
                        {d == null ? '—' : `${d > 0 ? '+' : ''}${qty3(d)}`}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{baht(r.cost)}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${
                          dv < 0 ? 'text-rose-600' : dv > 0 ? 'text-amber-600' : 'text-slate-400'
                        }`}
                      >
                        {d == null ? '—' : `${dv > 0 ? '+' : ''}${baht(dv)}`}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="trash"
                          title="ลบแถวนี้"
                          className="text-rose-500 hover:bg-rose-50"
                          onClick={() => removeRow(r.key)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="โน้ตของใบนับนี้" className="mb-6">
        <Textarea
          rows={2}
          placeholder="เช่น นับสิ้นเดือน กรกฎาคม โดยพี่หนึ่ง"
          value={session.note}
          onChange={(e) => setSession((s) => (s ? { ...s, note: e.target.value } : s))}
        />
      </Card>

      <ConfirmDialog
        open={confirmCommit}
        title="ยืนยันปรับสต็อกตามผลนับ"
        confirmLabel="ปรับสต็อกเลย"
        message={
          <div className="space-y-2">
            <div>
              จะปรับสต็อกตามผลนับ <b>{summary.countedRows}</b> รายการ (รายการที่ผลต่างไม่เป็น 0 มี{' '}
              <b>{summary.diffRows}</b> รายการ)
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs">
              <div className="flex justify-between">
                <span>มูลค่าของขาด</span>
                <b className="text-rose-600">-{money(summary.shortValue)} บาท</b>
              </div>
              <div className="flex justify-between">
                <span>มูลค่าของเกิน</span>
                <b className="text-amber-600">+{money(summary.overValue)} บาท</b>
              </div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span>ผลต่างสุทธิ</span>
                <b className="text-slate-800">
                  {summary.netValue > 0 ? '+' : ''}
                  {money(summary.netValue)} บาท
                </b>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              ระบบจะอ่านจำนวนในระบบใหม่อีกครั้งตอนบันทึก (กันกรณีมีการขายระหว่างนับ) และบันทึกความเคลื่อนไหว
              สต็อกให้ทุกรายการ — แถวที่ยังไม่ได้กรอกจำนวนจะไม่ถูกแตะ
            </div>
          </div>
        }
        onConfirm={() => void commit()}
        onClose={() => setConfirmCommit(false)}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="ลบใบนับนี้"
        message={
          <>
            ต้องการลบใบนับ <b>{session.docNo}</b> ทิ้งใช่ไหม? รายการที่นับไว้จะหายทั้งหมด
            <br />
            (สต็อกสินค้ายังไม่ถูกแก้ไข)
          </>
        }
        confirmLabel="ลบใบนับ"
        danger
        onConfirm={() => void discardDraft()}
        onClose={() => setConfirmDiscard(false)}
      />
    </div>
  )
}

/* =========================================================
   ชิ้นส่วนย่อย
   ========================================================= */

function StatChip({
  icon,
  label,
  value,
  unit,
  tone = 'slate',
}: {
  icon: 'clipboard' | 'alert' | 'minus' | 'plus'
  label: string
  value: string
  unit: string
  tone?: 'slate' | 'amber' | 'red'
}) {
  const iconTone = {
    slate: 'bg-slate-100 text-slate-500',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-rose-50 text-rose-600',
  }[tone]
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-sm">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconTone}`}>
        <Icon name={icon} size={16} />
      </span>
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-bold text-slate-800">
        {value} <span className="font-normal text-slate-400">{unit}</span>
      </span>
    </div>
  )
}

function DriftAlert({
  drift,
  onClose,
}: {
  drift: { docNo: string; lines: string[] }
  onClose: () => void
}) {
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <Icon name="alert" size={18} className="mt-0.5 text-amber-600" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-amber-800">
            จำนวนในระบบเปลี่ยนไประหว่างนับ ({drift.lines.length} รายการ)
          </div>
          <p className="mt-0.5 text-xs text-amber-700">
            ใบนับ {drift.docNo} บันทึกโดยใช้จำนวนในระบบ ณ ตอนกดยืนยัน (อาจมีการขายเกิดขึ้นระหว่างนับ)
            ผลต่างที่บันทึกไว้จึงคิดจากจำนวนล่าสุด
          </p>
          <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-amber-800">
            {drift.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-lg p-1 text-amber-600 hover:bg-amber-100"
          title="ปิดข้อความนี้"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  )
}

function CountDetailModal({
  doc,
  onClose,
  onContinue,
}: {
  doc: StockCount | null
  onClose: () => void
  onContinue: (sc: StockCount) => void
}) {
  const shortValue = r2(
    Math.abs(doc?.items.filter((i) => i.diffValue < 0).reduce((s, i) => s + i.diffValue, 0) ?? 0),
  )
  const overValue = r2(doc?.items.filter((i) => i.diffValue > 0).reduce((s, i) => s + i.diffValue, 0) ?? 0)

  return (
    <Modal
      open={doc != null}
      onClose={onClose}
      title={doc ? `ใบนับสต็อก ${doc.docNo}` : ''}
      size="xl"
      footer={
        <>
          {doc?.status === 'draft' && (
            <Button
              className="mr-auto"
              icon="pencil"
              variant="secondary"
              onClick={() => doc && onContinue(doc)}
            >
              นับต่อ
            </Button>
          )}
          <Button
            variant="secondary"
            icon="download"
            disabled={!doc || doc.items.length === 0}
            onClick={() => doc && exportCountCsv(doc.docNo, doc.items, doc.totalDiffValue)}
          >
            ส่งออก CSV
          </Button>
          <Button variant="secondary" onClick={onClose}>
            ปิด
          </Button>
        </>
      }
    >
      {doc && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-slate-500">สถานะ</div>
              <div className="font-medium text-slate-800">
                {doc.status === 'committed' ? 'ปรับสต็อกแล้ว' : 'ร่าง (ยังไม่ปรับ)'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {doc.status === 'committed' ? 'บันทึกเมื่อ' : 'สร้างเมื่อ'}
              </div>
              <div className="font-medium text-slate-800">
                {fmtDateTime(doc.committedAt ?? doc.createdAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">มูลค่าของขาด / เกิน</div>
              <div className="font-medium">
                <span className="text-rose-600">-{baht(shortValue)}</span>
                <span className="text-slate-400"> / </span>
                <span className="text-amber-600">+{baht(overValue)}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">ผลต่างสุทธิ</div>
              <div
                className={`font-bold ${
                  doc.totalDiffValue < 0
                    ? 'text-rose-600'
                    : doc.totalDiffValue > 0
                      ? 'text-amber-600'
                      : 'text-slate-700'
                }`}
              >
                {doc.totalDiffValue > 0 ? '+' : ''}
                {baht(doc.totalDiffValue)} บาท
              </div>
            </div>
          </div>

          {doc.items.length === 0 ? (
            <EmptyState icon="clipboard" title="ใบนับนี้ยังไม่มีรายการ" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">สินค้า</th>
                    <th className="px-3 py-2 text-right font-medium">ในระบบ</th>
                    <th className="px-3 py-2 text-right font-medium">นับได้</th>
                    <th className="px-3 py-2 text-right font-medium">ผลต่าง</th>
                    <th className="px-3 py-2 text-right font-medium">ต้นทุน/หน่วย</th>
                    <th className="px-3 py-2 text-right font-medium">มูลค่าผลต่าง</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.map((it, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 font-medium text-slate-800">{it.name}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{qty3(it.systemQty)}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{qty3(it.countedQty)}</td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${
                          it.diff < 0
                            ? 'text-rose-600'
                            : it.diff > 0
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                        }`}
                      >
                        {it.diff > 0 ? '+' : ''}
                        {qty3(it.diff)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{baht(it.cost)}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${
                          it.diffValue < 0
                            ? 'text-rose-600'
                            : it.diffValue > 0
                              ? 'text-amber-600'
                              : 'text-slate-400'
                        }`}
                      >
                        {it.diffValue > 0 ? '+' : ''}
                        {baht(it.diffValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {doc.note && (
            <Field label="โน้ต">
              <Textarea rows={2} value={doc.note} disabled />
            </Field>
          )}
        </div>
      )}
    </Modal>
  )
}
