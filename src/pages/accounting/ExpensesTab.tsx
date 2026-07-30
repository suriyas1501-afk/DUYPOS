import { useMemo, useState } from 'react'
import { db } from '../../db/db'
import type { Expense } from '../../db/types'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Spinner,
  toast,
} from '../../components/ui'
import { baht, dayKey, fmtDate, money, r2 } from '../../lib/format'
import { downloadCsv } from '../../lib/csv'
import { PAY_LABEL } from '../../lib/receipt'
import { SummaryChip, categoryBadge } from './shared'
import ExpenseModal from './ExpenseModal'

/* =========================================================
   แท็บรายจ่าย — ตาราง + เพิ่ม/แก้ไข/ลบ + ส่งออก CSV
   ========================================================= */

export default function ExpensesTab({
  expenses,
  lo,
  hi,
}: {
  expenses: Expense[] | undefined
  lo: number
  hi: number
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)

  // ---- เรียงใหม่ → เก่า ----
  const rows = useMemo(
    () =>
      [...(expenses ?? [])].sort((a, b) => b.date - a.date || b.createdAt - a.createdAt),
    [expenses],
  )

  // ---- สรุปยอดรวมช่วงที่เลือก ----
  const summary = useMemo(() => {
    let total = 0
    let vat = 0
    for (const e of rows) {
      total += e.amount
      if (e.hasVatInvoice) vat += e.vatAmount
    }
    return { count: rows.length, total: r2(total), vat: r2(vat) }
  }, [rows])

  const openAdd = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (e: Expense) => {
    setEditing(e)
    setModalOpen(true)
  }

  const remove = async (e: Expense) => {
    if (e.id == null) return
    await db.expenses.delete(e.id)
    toast.success('ลบรายจ่ายแล้ว')
  }

  function exportCsv() {
    if (rows.length === 0) {
      toast.error('ไม่มีรายจ่ายในช่วงเวลาที่เลือก')
      return
    }
    const sorted = [...rows].sort((a, b) => a.date - b.date || a.createdAt - b.createdAt)
    downloadCsv(`รายจ่าย_${dayKey(lo)}_${dayKey(hi)}.csv`, [
      ['วันที่', 'หมวด', 'รายละเอียด', 'ช่องทาง', 'มีใบกำกับ', 'ภาษีซื้อ', 'จำนวนเงิน'],
      ...sorted.map((e) => [
        fmtDate(e.date),
        e.category,
        e.note ? `${e.description} (${e.note})` : e.description,
        PAY_LABEL[e.paymentMethod],
        e.hasVatInvoice ? 'มี' : 'ไม่มี',
        e.hasVatInvoice ? r2(e.vatAmount) : 0,
        r2(e.amount),
      ]),
    ])
    toast.success(`ส่งออกรายจ่าย ${sorted.length} รายการแล้ว`)
  }

  return (
    <div className="space-y-4">
      {/* ===== ปุ่ม + ชิปสรุป ===== */}
      <div className="flex flex-wrap items-center gap-3">
        <Button icon="plus" onClick={openAdd}>
          บันทึกรายจ่าย
        </Button>
        <Button variant="secondary" icon="download" onClick={exportCsv}>
          ส่งออก CSV
        </Button>
        <div className="ml-auto flex flex-wrap gap-3">
          <SummaryChip
            icon="wallet"
            label="จำนวนรายการ"
            value={baht(summary.count)}
            unit="รายการ"
          />
          <SummaryChip icon="cash" label="รายจ่ายรวม" value={baht(summary.total)} unit="บาท" />
          <SummaryChip icon="receipt" label="ภาษีซื้อ" value={baht(summary.vat)} unit="บาท" />
        </div>
      </div>

      {/* ===== ตารางรายจ่าย ===== */}
      <Card padded={false}>
        {expenses === undefined ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="ยังไม่มีรายจ่ายในช่วงเวลานี้"
            hint='กดปุ่ม "บันทึกรายจ่าย" เพื่อเพิ่มรายการแรก'
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">วันที่</th>
                  <th className="px-4 py-3 font-medium">หมวด</th>
                  <th className="px-4 py-3 font-medium">รายละเอียด</th>
                  <th className="px-4 py-3 font-medium">ช่องทาง</th>
                  <th className="px-4 py-3 text-right font-medium">ภาษีซื้อ</th>
                  <th className="px-4 py-3 text-right font-medium">จำนวนเงิน</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                      {fmtDate(e.date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge color={categoryBadge(e.category)}>{e.category}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{e.description}</div>
                      {e.note && <div className="text-xs text-slate-400">{e.note}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{PAY_LABEL[e.paymentMethod]}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {e.hasVatInvoice ? (
                        money(e.vatAmount)
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                      {money(e.amount)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="pencil"
                          title="แก้ไข"
                          onClick={() => openEdit(e)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="trash"
                          title="ลบ"
                          className="text-rose-500 hover:bg-rose-50"
                          onClick={() => setDeleting(e)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ===== โมดัลเพิ่ม/แก้ไข (mount ใหม่ทุกครั้งที่เปิด) ===== */}
      {modalOpen && <ExpenseModal initial={editing} onClose={() => setModalOpen(false)} />}

      {/* ===== ยืนยันลบ ===== */}
      <ConfirmDialog
        open={deleting != null}
        title="ลบรายจ่าย"
        danger
        confirmLabel="ลบรายจ่าย"
        message={
          deleting ? (
            <>
              ต้องการลบรายจ่าย <span className="font-semibold">"{deleting.description}"</span>{' '}
              จำนวน {baht(deleting.amount)} บาท ({fmtDate(deleting.date)}) ใช่หรือไม่?
              การลบไม่สามารถย้อนกลับได้
            </>
          ) : (
            ''
          )
        }
        onConfirm={() => {
          if (deleting) void remove(deleting)
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
