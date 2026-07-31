import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import {
  EXPENSE_CATEGORIES,
  type Expense,
  type GoodsReceipt,
  type GoodsReceiptItem,
  type PaymentMethod,
  type Product,
} from '../db/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  Toggle,
  toast,
} from '../components/ui'
import { baht, dayKey, endOfDay, fmtDate, money, r2, startOfDay } from '../lib/format'
import { DOC_PREFIX, formatDocNo, nextSeq } from '../lib/docNo'
import { getActor } from '../lib/actor'
import { PAY_LABEL } from '../lib/receipt'
import { useSettings } from '../db/hooks'
import { ProductPicker, qty3, unitOptionsOf, type UnitOpt } from './products/shared'

/** แปลงค่าจาก input type="date" (YYYY-MM-DD) เป็นเวลาเที่ยงคืนแบบ local */
const parseDay = (s: string): number | null => {
  if (!s) return null
  const t = new Date(`${s}T00:00:00`).getTime()
  return Number.isNaN(t) ? null : t
}

/* =========================================================
   แถวรับของในฟอร์ม
   ========================================================= */

interface RcvRow {
  key: number
  productId: number
  name: string
  baseUnit: string
  baseCost: number
  trackStock: boolean
  unitOpts: UnitOpt[]
  unitIdx: number
  qtyStr: string
  costStr: string
}

let rowKeySeq = 0

const rowQty = (r: RcvRow) => {
  const n = Number(r.qtyStr)
  return Number.isFinite(n) ? n : 0
}
const rowCost = (r: RcvRow) => {
  const n = Number(r.costStr)
  return Number.isFinite(n) ? n : 0
}
const rowFactor = (r: RcvRow) => r.unitOpts[r.unitIdx]?.factor ?? 1
const rowTotal = (r: RcvRow) => r2(rowQty(r) * rowCost(r))
const rowBaseQty = (r: RcvRow) => r2(rowQty(r) * rowFactor(r))

/* =========================================================
   หน้ารับของเข้า
   ========================================================= */

export default function GoodsReceiptPage() {
  const settings = useSettings()
  const allProducts = useLiveQuery(() => db.products.toArray(), [])
  const receipts = useLiveQuery(
    () => db.goodsReceipts.orderBy('createdAt').reverse().limit(20).toArray(),
    [],
  )

  const products = useMemo(() => allProducts ?? [], [allProducts])

  const [dateStr, setDateStr] = useState(() => dayKey(Date.now()))
  const [supplier, setSupplier] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<RcvRow[]>([])
  const [updateCost, setUpdateCost] = useState(true)
  const [asExpense, setAsExpense] = useState(true)
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [hasVat, setHasVat] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<GoodsReceipt | null>(null)

  const total = useMemo(() => r2(rows.reduce((s, r) => s + rowTotal(r), 0)), [rows])
  const vatRate = settings.vatRate
  const purchaseVat = hasVat && vatRate > 0 ? r2((total * vatRate) / (100 + vatRate)) : 0

  /* ----- จัดการแถว ----- */
  const addRow = (p: Product, unitIdx: number) => {
    if (p.id == null) return
    const pid = p.id
    const opts = unitOptionsOf(p)
    const idx = Math.min(Math.max(unitIdx, 0), opts.length - 1)
    setRows((rs) => {
      const i = rs.findIndex((r) => r.productId === pid && r.unitIdx === idx)
      if (i >= 0) {
        // ยิงซ้ำสินค้า+หน่วยเดิม → เพิ่มจำนวน 1
        const next = r2((Number(rs[i].qtyStr) || 0) + 1)
        return rs.map((r, j) => (j === i ? { ...r, qtyStr: String(next) } : r))
      }
      return [
        ...rs,
        {
          key: ++rowKeySeq,
          productId: pid,
          name: p.name,
          baseUnit: p.unit,
          baseCost: p.cost,
          trackStock: p.trackStock,
          unitOpts: opts,
          unitIdx: idx,
          qtyStr: '1',
          costStr: String(r2(p.cost * opts[idx].factor)),
        },
      ]
    })
  }

  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key))

  const patchRow = (key: number, patch: Partial<RcvRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  /** เปลี่ยนหน่วย → ตั้งต้นทุนต่อหน่วยใหม่ตามตัวคูณ */
  const changeUnit = (key: number, idx: number) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? { ...r, unitIdx: idx, costStr: String(r2(r.baseCost * (r.unitOpts[idx]?.factor ?? 1))) }
          : r,
      ),
    )

  const resetForm = () => {
    setRows([])
    setSupplier('')
    setInvoiceNo('')
    setNote('')
    setHasVat(false)
  }

  /* ----- บันทึก ----- */
  const save = async () => {
    const date = parseDay(dateStr)
    if (date == null) {
      toast.error('กรุณาเลือกวันที่รับของ')
      return
    }
    if (rows.length === 0) {
      toast.error('ยังไม่มีรายการ — ยิงบาร์โค้ดหรือค้นหาชื่อสินค้าเพื่อเพิ่มรายการรับของ')
      return
    }
    const items: GoodsReceiptItem[] = []
    for (const r of rows) {
      const qty = Number(r.qtyStr)
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error(`“${r.name}”: จำนวนที่รับต้องมากกว่า 0`)
        return
      }
      // ช่องว่างถือว่า "ยังไม่กรอก" (Number('') = 0 จะเล็ดลอดการตรวจ cost < 0 ไปได้)
      const costRaw = r.costStr.trim()
      const cost = costRaw === '' ? NaN : Number(costRaw)
      if (!Number.isFinite(cost) || cost < 0) {
        toast.error(`“${r.name}”: ต้นทุนต่อหน่วยต้องเป็นตัวเลขและไม่ติดลบ`)
        return
      }
      // ต้นทุน 0 + เปิดอัปเดตต้นทุน = เขียนทับต้นทุนสินค้าเป็น 0 ถาวร (กำไร/มูลค่าสต็อกพังทั้งระบบ)
      if (updateCost && cost <= 0) {
        toast.error(`“${r.name}”: ต้นทุนต่อหน่วยต้องมากกว่า 0 เมื่อเปิด “อัปเดตต้นทุนสินค้า”`)
        return
      }
      const u = r.unitOpts[r.unitIdx]
      items.push({
        productId: r.productId,
        name: r.name,
        qty: r2(qty),
        unitName: u.name,
        unitFactor: u.factor,
        baseQty: r2(qty * u.factor),
        cost: r2(cost),
        total: r2(qty * cost),
      })
    }
    const grand = r2(items.reduce((s, i) => s + i.total, 0))

    setSaving(true)
    try {
      const actor = getActor()
      const docNo = await db.transaction(
        'rw',
        [db.goodsReceipts, db.products, db.stockMoves, db.expenses, db.shifts],
        async () => {
          const now = Date.now()
          // รายจ่ายที่เกิดจากการรับของต้องผูกกับกะที่เปิดอยู่ (ถ้าจ่ายเงินสดจะหักจากลิ้นชักของกะนั้น)
          const openShift = await db.shifts.where('status').equals('open').first()
          // เลขเอกสารของวันนั้น (คิดจากเลขที่มากที่สุดที่มีอยู่)
          const sameDay = await db.goodsReceipts
            .where('date')
            .between(startOfDay(date), endOfDay(date), true, true)
            .toArray()
          const seq = nextSeq(
            sameDay.map((g) => g.docNo),
            DOC_PREFIX.goodsReceipt,
            date,
          )
          const no = formatDocNo(DOC_PREFIX.goodsReceipt, date, seq)

          for (const it of items) {
            const p = await db.products.get(it.productId)
            if (p?.id == null) continue
            const patch: { stock?: number; cost?: number } = {}
            if (p.trackStock) patch.stock = r2(p.stock + it.baseQty)
            // ต้นทุนต่อหน่วยฐาน = ต้นทุนที่รับ ÷ ตัวคูณหน่วย
            if (updateCost) patch.cost = r2(it.cost / (it.unitFactor ?? 1))
            if (Object.keys(patch).length > 0) await db.products.update(p.id, patch)
            if (p.trackStock)
              await db.stockMoves.add({
                productId: p.id,
                type: 'receive',
                qty: it.baseQty,
                note: `รับของเข้า ${no}`,
                refDocNo: no,
                createdAt: now,
              })
          }

          let expenseId: number | undefined
          if (asExpense && grand > 0) {
            const expense: Expense = {
              date,
              category: EXPENSE_CATEGORIES[0], // ค่าสินค้า / วัตถุดิบ
              description: `รับของเข้า ${no}${supplier.trim() ? ` ${supplier.trim()}` : ''}`,
              amount: grand,
              hasVatInvoice: hasVat,
              vatAmount: hasVat && vatRate > 0 ? r2((grand * vatRate) / (100 + vatRate)) : 0,
              paymentMethod: payMethod,
              note: invoiceNo.trim() ? `เลขที่บิลซื้อ ${invoiceNo.trim()}` : undefined,
              refReceiptDocNo: no,
              staffId: actor.id,
              staffName: actor.name,
              shiftId: openShift?.id,
              createdAt: now,
            }
            expenseId = await db.expenses.add(expense)
          }

          await db.goodsReceipts.add({
            docNo: no,
            date,
            supplier: supplier.trim() || undefined,
            invoiceNo: invoiceNo.trim() || undefined,
            items,
            total: grand,
            updateCost,
            expenseId,
            note: note.trim() || undefined,
            createdAt: now,
          })
          return no
        },
      )

      const extra: string[] = []
      if (updateCost) extra.push('อัปเดตต้นทุนแล้ว')
      if (asExpense && grand > 0) extra.push('ลงบัญชีรายจ่ายแล้ว')
      toast.success(
        `บันทึกใบรับของ ${docNo} — ${items.length} รายการ ${baht(grand)} บาท${
          extra.length ? ` (${extra.join(' · ')})` : ''
        }`,
      )
      resetForm()
    } catch {
      toast.error('บันทึกไม่สำเร็จ ข้อมูลไม่ถูกแก้ไข กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="รับของเข้า"
        subtitle="รับของทีเดียวหลายรายการ อัปเดตต้นทุนสินค้าและลงบัญชีรายจ่ายให้อัตโนมัติ"
      />

      {/* ===== หัวเอกสาร ===== */}
      <Card title="ข้อมูลใบรับของ" className="mb-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="วันที่รับของ">
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="ซัพพลายเออร์">
            <Input
              placeholder="เช่น ร้านค้าส่งเจ๊หมวย"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </Field>
          <Field label="เลขที่บิลซื้อ">
            <Input
              placeholder="เลขที่ใบส่งของ / ใบกำกับ"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />
          </Field>
          <Field label="โน้ต">
            <Input
              placeholder="บันทึกเพิ่มเติม (ไม่บังคับ)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {/* ===== รายการรับของ ===== */}
      <Card title="รายการสินค้าที่รับเข้า" className="mb-4" padded={false}>
        <div className="border-b border-slate-100 p-4">
          {!allProducts ? (
            <div className="flex justify-center py-2">
              <Spinner />
            </div>
          ) : (
            <ProductPicker
              products={products}
              autoFocus
              showStock
              onPick={addRow}
              placeholder="ยิงบาร์โค้ด (รองรับบาร์โค้ดแพ็ค/ลัง) หรือพิมพ์ชื่อสินค้าแล้วกด Enter…"
            />
          )}
          <p className="mt-2 text-xs text-slate-400">
            ยิงบาร์โค้ดซ้ำ = เพิ่มจำนวนอีก 1 · ยิงบาร์โค้ดของแพ็ค/ลัง ระบบจะตั้งหน่วยนั้นให้อัตโนมัติ
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="truck"
            title="ยังไม่มีรายการรับของ"
            hint="ยิงบาร์โค้ดหรือค้นหาชื่อสินค้าด้านบนเพื่อเพิ่มรายการ"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">สินค้า</th>
                  <th className="w-40 px-3 py-3 font-medium">หน่วยที่รับ</th>
                  <th className="w-28 px-3 py-3 font-medium">จำนวน</th>
                  <th className="w-32 px-3 py-3 font-medium">ต้นทุน/หน่วย</th>
                  <th className="w-28 px-3 py-3 text-right font-medium">รวม</th>
                  <th className="w-32 px-3 py-3 text-right font-medium">เข้าสต็อก</th>
                  <th className="w-10 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const factor = rowFactor(r)
                  return (
                    <tr key={r.key} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2">
                        <div className="truncate font-medium text-slate-800">{r.name}</div>
                        {!r.trackStock && (
                          <div className="text-xs text-amber-600">
                            สินค้านี้ไม่นับสต็อก — จะไม่เพิ่มจำนวนคงเหลือ
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.unitOpts.length > 1 ? (
                          <Select
                            value={String(r.unitIdx)}
                            onChange={(e) => changeUnit(r.key, Number(e.target.value))}
                          >
                            {r.unitOpts.map((u, i) => (
                              <option key={i} value={String(i)}>
                                {u.name}
                                {i > 0 ? ` (×${u.factor})` : ''}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-slate-600">{r.baseUnit}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          value={r.qtyStr}
                          onChange={(e) => patchRow(r.key, { qtyStr: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          value={r.costStr}
                          onChange={(e) => patchRow(r.key, { costStr: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {baht(rowTotal(r))}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {r.trackStock ? (
                          <>
                            {qty3(rowBaseQty(r))} {r.baseUnit}
                            {factor > 1 && (
                              <div className="text-xs text-slate-400">
                                {qty3(rowQty(r))} × {factor}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
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
              <tfoot>
                <tr className="bg-slate-50">
                  <td colSpan={4} className="px-4 py-3 text-right text-sm font-medium text-slate-600">
                    ยอดรวมทั้งบิล ({rows.length} รายการ)
                  </td>
                  <td className="px-3 py-3 text-right text-base font-bold text-emerald-700">
                    {baht(total)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ===== ท้ายเอกสาร ===== */}
      <Card title="เมื่อบันทึกใบรับของนี้" className="mb-6">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <Toggle
              checked={updateCost}
              onChange={setUpdateCost}
              label="อัปเดตต้นทุนสินค้าตามที่รับเข้า"
            />
            <p className="mt-1.5 text-xs text-slate-400">
              คำนวณต้นทุนต่อหน่วยฐาน = ต้นทุนที่รับ ÷ จำนวนต่อหน่วย (เช่น รับแพ็ค 6 ราคา 30 → ต้นทุน 5
              ต่อชิ้น)
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <Toggle checked={asExpense} onChange={setAsExpense} label="ลงบัญชีเป็นรายจ่ายด้วย" />
            <p className="mt-1.5 text-xs text-slate-400">
              สร้างรายจ่ายหมวด “{EXPENSE_CATEGORIES[0]}” ให้อัตโนมัติ ดูได้ในหน้าบัญชี
            </p>
            {asExpense && (
              <div className="mt-3 space-y-3">
                <Field label="ช่องทางจ่าย">
                  <div className="flex rounded-xl border border-slate-200 bg-white p-1">
                    {(['cash', 'transfer', 'card'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPayMethod(k)}
                        className={`flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                          payMethod === k
                            ? 'bg-emerald-600 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {PAY_LABEL[k]}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <Toggle checked={hasVat} onChange={setHasVat} label="มีใบกำกับภาษีเต็มรูป" />
                  {hasVat && (
                    <p className="mt-2 text-xs text-slate-500">
                      ภาษีซื้อที่จะบันทึก = {baht(total)} × {vatRate}/{100 + vatRate} ={' '}
                      <b className="text-slate-700">{money(purchaseVat)}</b> บาท
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3">
            <div className="text-sm text-emerald-800">
              ยอดรวมทั้งบิล <b className="text-lg">{baht(total)}</b> บาท · {rows.length} รายการ
            </div>
            <Button
              icon="check"
              size="lg"
              disabled={saving || rows.length === 0}
              onClick={() => void save()}
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึกรับของเข้า'}
            </Button>
          </div>
        </div>
      </Card>

      {/* ===== ประวัติใบรับของ ===== */}
      <Card title="ประวัติใบรับของ (20 รายการล่าสุด)" padded={false}>
        {!receipts ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : receipts.length === 0 ? (
          <EmptyState
            icon="history"
            title="ยังไม่มีประวัติการรับของ"
            hint="ใบรับของที่บันทึกแล้วจะแสดงที่นี่"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">เลขที่</th>
                  <th className="px-4 py-3 font-medium">วันที่</th>
                  <th className="px-4 py-3 font-medium">ซัพพลายเออร์</th>
                  <th className="px-4 py-3 text-right font-medium">จำนวนรายการ</th>
                  <th className="px-4 py-3 text-right font-medium">ยอดรวม</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {receipts.map((g) => (
                  <tr
                    key={g.id}
                    className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50"
                    onClick={() => setDetail(g)}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {g.docNo}
                      {g.expenseId != null && (
                        <Badge color="blue" className="ml-2 px-1.5 py-0 text-[10px]">
                          ลงบัญชีแล้ว
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{fmtDate(g.date)}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {g.supplier || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{g.items.length}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                      {baht(g.total)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Icon name="eye" size={16} className="inline text-slate-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ===== รายละเอียดใบรับของ (อ่านอย่างเดียว) ===== */}
      <Modal
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail ? `ใบรับของ ${detail.docNo}` : ''}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            ปิด
          </Button>
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs text-slate-500">วันที่</div>
                <div className="font-medium text-slate-800">{fmtDate(detail.date)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">ซัพพลายเออร์</div>
                <div className="font-medium text-slate-800">{detail.supplier || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">เลขที่บิลซื้อ</div>
                <div className="font-medium text-slate-800">{detail.invoiceNo || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">ยอดรวม</div>
                <div className="font-bold text-emerald-700">{baht(detail.total)} บาท</div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">สินค้า</th>
                    <th className="px-3 py-2 font-medium">หน่วย</th>
                    <th className="px-3 py-2 text-right font-medium">จำนวน</th>
                    <th className="px-3 py-2 text-right font-medium">ต้นทุน/หน่วย</th>
                    <th className="px-3 py-2 text-right font-medium">รวม</th>
                    <th className="px-3 py-2 text-right font-medium">เข้าสต็อก</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 font-medium text-slate-800">{it.name}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {it.unitName ?? '—'}
                        {(it.unitFactor ?? 1) > 1 ? ` (×${it.unitFactor})` : ''}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">{qty3(it.qty)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{baht(it.cost)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {baht(it.total)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{qty3(it.baseQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Badge color={detail.updateCost ? 'green' : 'slate'}>
                {detail.updateCost ? 'อัปเดตต้นทุนสินค้าแล้ว' : 'ไม่อัปเดตต้นทุน'}
              </Badge>
              <Badge color={detail.expenseId != null ? 'blue' : 'slate'}>
                {detail.expenseId != null ? 'ลงบัญชีรายจ่ายแล้ว' : 'ไม่ลงบัญชีรายจ่าย'}
              </Badge>
            </div>

            {detail.note && (
              <Field label="โน้ต">
                <Textarea rows={2} value={detail.note} disabled />
              </Field>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
