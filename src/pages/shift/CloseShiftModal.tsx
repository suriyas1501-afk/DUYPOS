import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CashCountLine, Expense, Sale, Shift, ShiftSummary } from '../../db/types'
import { useSettings } from '../../db/hooks'
import {
  DENOMS,
  DENOM_LABEL,
  closeShift,
  computeShiftSummary,
  countTotal,
  loadShiftDocs,
} from '../../lib/shift'
import { printShiftReport } from '../../lib/shiftReport'
import { baht, endOfDay, money, r2 } from '../../lib/format'
import { Button, Field, Icon, Input, Modal, Textarea, Toggle, toast } from '../../components/ui'

/* =========================================================
   โมดัลปิดกะ + ใบนับเงินลิ้นชัก

   ยอดเงินทุกช่องในไฟล์นี้มาจาก computeShiftSummary() ที่เดียว (ผ่านฮุก useShiftSummary)
   ห้ามคิดสูตร "เงินสดที่ควรมี" ซ้ำในหน้าจอ — ไม่งั้นจอกับที่บันทึกลง DB จะเพี้ยนกันได้
   ตอนกดยืนยัน closeShift() ยังคำนวณสรุปใหม่จากฐานข้อมูลอีกครั้ง (ไม่เชื่อยอดจากหน้าจอ)
   ========================================================= */

/** ผลต่างที่ถือว่า "เยอะ" — เกินเท่านี้บังคับกรอกหมายเหตุอธิบายสาเหตุก่อนปิดกะ */
const NOTE_REQUIRED_DIFF = 100

/** ผลต่างต่ำกว่านี้ถือว่าตรงพอดี (กันเศษทศนิยมจากการปัด) */
const EPS = 0.005

/**
 * สรุปยอดสดของกะ — ใช้ทั้งในการ์ดสรุปหน้ากะและโมดัลปิดกะ (สูตรเดียวกันแน่นอน)
 *
 * ขอบบนของช่วง createdAt ใช้ "สิ้นวันของวันนี้" จาก state ที่ขยับทุก 30 วินาที
 * ห้ามใส่ Date.now() ตรงๆ ใน deps ของ useLiveQuery เพราะค่าจะเปลี่ยนทุกเรนเดอร์
 * → useLiveQuery จะยิง query ใหม่ไม่จบ (ลูปไม่รู้จบ)
 * บิลใหม่ระหว่างกะไม่ต้องพึ่งขอบบนนี้ เพราะ useLiveQuery เฝ้าดูตารางให้อยู่แล้ว —
 * ตัวจับเวลามีไว้ให้ขอบบนเลื่อนตามเองเมื่อกะเปิดคาบเกี่ยวข้ามเที่ยงคืน
 */
export function useShiftSummary(
  shift: Shift | null,
  countedCash = 0,
): { summary: ShiftSummary | null; loading: boolean } {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const active = shift != null
  const shiftId = shift?.id
  const to = endOfDay(now)

  /* ต้องดึงผ่าน loadShiftDocs() เท่านั้น — ดึงด้วยช่วงเวลาอย่างเดียวจะไม่เห็นบิล
     ที่ openShift() ดูดเข้ากะ (createdAt ก่อน openedAt) แล้วจอจะขึ้นว่าเงิน "เกิน"
     ผลลัพธ์พก shiftId ที่มันถูกคำนวณมาด้วย เพราะ useLiveQuery เสิร์ฟค่าเก่าอีกเฟรม
     หลัง deps เปลี่ยน — ถ้าเชื่อค่านั้นจะเอายอดของกะก่อนหน้ามาโชว์ */
  const docs = useLiveQuery<{ shiftId: number | undefined; sales: Sale[]; expenses: Expense[] } | null>(
    async () => {
      if (!shift) return null
      return { shiftId: shift.id, ...(await loadShiftDocs(shift, to)) }
    },
    [active, shiftId, shift?.openedAt, to],
  )

  const fresh = docs && docs.shiftId === shiftId ? docs : null

  const summary = useMemo(() => {
    if (!shift || !fresh) return null
    // computeShiftSummary กรองรายการของกะนี้ให้เอง (ตาม shiftId / ช่วงเวลา)
    return computeShiftSummary(shift, fresh.sales, fresh.expenses, countedCash)
  }, [shift, fresh, countedCash])

  return { summary, loading: active && fresh == null }
}

interface Props {
  open: boolean
  shift: Shift
  onClose: () => void
  /** เรียกเมื่อปิดกะสำเร็จ (ส่งกะที่ปิดแล้วพร้อม summary กลับไป) */
  onClosed?: (shift: Shift) => void
}

export default function CloseShiftModal({ open, shift, onClose, onClosed }: Props) {
  const settings = useSettings()
  /** กรอกยอดรวมเอง (ร้านที่ไม่อยากนับแยกใบ/เหรียญ) */
  const [manual, setManual] = useState(false)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [totalStr, setTotalStr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Shift | null>(null)
  /** ล็อกกันกดซ้ำแบบทันที (state busy อัปเดตช้ากว่าการกดรัว) */
  const lock = useRef(false)

  // เปิดโมดัลใหม่ / เปลี่ยนกะ → ล้างใบนับเงินทั้งใบ
  useEffect(() => {
    if (!open) return
    setManual(false)
    setCounts({})
    setTotalStr('')
    setNote('')
    setErr('')
    setDone(null)
  }, [open, shift.id])

  // ---- ใบนับเงิน ----
  const countOf = (denom: number) => {
    const v = Number(counts[denom])
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
  }
  const setCount = (denom: number, v: string) =>
    setCounts((c) => ({ ...c, [denom]: v }))
  const bump = (denom: number, delta: number) =>
    setCount(denom, String(Math.max(0, countOf(denom) + delta)))

  // 11 แถวเท่านั้น — คิดสดทุกเรนเดอร์ได้ ไม่ต้อง memo
  const lines: CashCountLine[] = DENOMS.map((d) => ({ denom: d, count: countOf(d) }))
  const linesTotal = countTotal(lines)
  const manualTotal = Number(totalStr)

  /** ยอดที่นับได้ — โหมดใบนับเงินใช้ผลรวมสด, โหมดกรอกเองใช้ตัวเลขที่พิมพ์ */
  const counted = manual
    ? Number.isFinite(manualTotal) && manualTotal > 0
      ? r2(manualTotal)
      : 0
    : linesTotal

  // สรุปยอดของกะ (สูตรเดียวกับตอนบันทึก) — หยุด query เมื่อปิดกะเสร็จแล้ว
  const { summary } = useShiftSummary(open && !done ? shift : null, counted)
  const expected = summary?.expectedCash ?? 0
  const diff = summary?.diff ?? 0
  const needNote = Math.abs(diff) >= NOTE_REQUIRED_DIFF

  // สีของแผงผลต่าง: ตรง = เขียว, เกิน = น้ำเงิน, ขาด = แดง
  const tone =
    Math.abs(diff) < EPS
      ? { box: 'bg-emerald-50 text-emerald-700', value: 'text-emerald-600', word: 'ตรงพอดี' }
      : diff > 0
        ? { box: 'bg-sky-50 text-sky-700', value: 'text-sky-600', word: 'เงินเกิน' }
        : { box: 'bg-rose-50 text-rose-700', value: 'text-rose-600', word: 'เงินขาด' }

  const confirm = async () => {
    if (lock.current) return
    if (shift.id == null) return
    if (manual && !(Number.isFinite(manualTotal) && manualTotal >= 0)) {
      setErr('กรุณากรอกยอดเงินที่นับได้เป็นตัวเลขไม่ติดลบ')
      return
    }
    if (needNote && !note.trim()) {
      setErr(
        `ผลต่าง ${tone.word} ฿${baht(Math.abs(diff))} (ตั้งแต่ ฿${baht(
          NOTE_REQUIRED_DIFF,
        )} ขึ้นไป) — กรุณากรอกหมายเหตุอธิบายสาเหตุก่อนปิดกะ`,
      )
      return
    }
    lock.current = true
    setBusy(true)
    setErr('')
    try {
      // closeShift คำนวณ summary ใหม่จาก DB เองเสมอ + บันทึกชื่อผู้ปิดกะจาก actor
      const closed = await closeShift(shift.id, {
        countLines: manual ? undefined : lines.filter((l) => l.count > 0),
        countedCash: counted,
        note,
      })
      toast.success(`ปิดกะ ${closed.docNo} เรียบร้อย`)
      setDone(closed)
      onClosed?.(closed)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ปิดกะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const handleClose = () => {
    if (busy) return // กำลังบันทึกอยู่ — กัน Esc / คลิกฉากหลังปิดกลางคัน
    onClose()
  }

  const doneSum = done?.summary
  const doneDiff = doneSum?.diff ?? 0
  const doneTone =
    Math.abs(doneDiff) < EPS
      ? { box: 'bg-emerald-50', value: 'text-emerald-600', word: 'ตรงพอดี' }
      : doneDiff > 0
        ? { box: 'bg-sky-50', value: 'text-sky-600', word: 'เงินเกิน' }
        : { box: 'bg-rose-50', value: 'text-rose-600', word: 'เงินขาด' }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="lg"
      title={done ? `ปิดกะ ${done.docNo} เรียบร้อย` : `ปิดกะ ${shift.docNo}`}
      footer={
        done ? undefined : (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button icon="lock" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'กำลังปิดกะ…' : 'ยืนยันปิดกะ'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        /* ===== ปิดกะเสร็จ + ถามพิมพ์รายงานกะ ===== */
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="rounded-full bg-emerald-100 p-4 text-emerald-600">
            <Icon name="check" size={44} />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-800">บันทึกการปิดกะแล้ว</div>
            <div className="mt-0.5 text-xs text-slate-400">
              {done.docNo} · ปิดโดย {done.closedByName?.trim() || '—'}
            </div>
          </div>
          <div className={`w-full rounded-2xl py-4 ${doneTone.box}`}>
            <div className="text-sm text-slate-500">ผลต่างเงินสด ({doneTone.word})</div>
            <div className={`text-4xl font-bold ${doneTone.value}`}>
              {doneDiff > 0 ? '+' : doneDiff < 0 ? '-' : ''}฿{baht(Math.abs(doneDiff))}
            </div>
            {doneSum && (
              <div className="mt-1 text-xs text-slate-500">
                ควรมี ฿{baht(doneSum.expectedCash)} · นับได้ ฿{baht(doneSum.countedCash)}
              </div>
            )}
          </div>
          <div className="mt-2 flex w-full gap-2">
            <Button
              variant="secondary"
              icon="printer"
              className="flex-1"
              onClick={() => printShiftReport(done, settings)}
            >
              พิมพ์รายงานกะ
            </Button>
            <Button icon="check" className="flex-1" onClick={onClose}>
              เสร็จสิ้น
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ===== ใบนับเงิน / กรอกยอดรวมเอง ===== */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <Icon name="cash" size={17} className="text-slate-400" />
              ใบนับเงินในลิ้นชัก
            </span>
            <Toggle checked={manual} onChange={setManual} label="กรอกยอดรวมเอง" />
          </div>

          {manual ? (
            <Field
              label="ยอดเงินสดที่นับได้ (บาท)"
              hint="ข้ามการนับแยกใบ/เหรียญ — กรอกยอดรวมที่นับได้ทั้งลิ้นชัก"
            >
              <Input
                autoFocus
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                placeholder="0"
                className="text-right text-lg font-bold"
                value={totalStr}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setTotalStr(e.target.value)}
              />
            </Field>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
                <span className="flex-1">มูลค่า</span>
                <span className="w-40 text-center">จำนวน</span>
                <span className="w-24 text-right">รวม</span>
              </div>
              <div className="divide-y divide-slate-100">
                {DENOMS.map((d) => {
                  const n = countOf(d)
                  return (
                    <div key={d} className="flex items-center gap-3 px-4 py-2">
                      <span className="flex-1 text-sm text-slate-700">{DENOM_LABEL(d)}</span>
                      <span className="flex w-40 items-center justify-center gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="minus"
                          disabled={n <= 0}
                          onClick={() => bump(d, -1)}
                          title="ลด 1"
                        />
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          placeholder="0"
                          className="w-20 text-center"
                          value={counts[d] ?? ''}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => setCount(d, e.target.value)}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="plus"
                          onClick={() => bump(d, 1)}
                          title="เพิ่ม 1"
                        />
                      </span>
                      <span
                        className={`w-24 text-right text-sm font-semibold ${
                          n > 0 ? 'text-slate-800' : 'text-slate-300'
                        }`}
                      >
                        {money(r2(d * n))}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="text-sm font-medium text-slate-600">รวมนับได้</span>
                <span className="text-lg font-bold text-slate-800">฿{baht(linesTotal)}</span>
              </div>
            </div>
          )}

          {/* ===== แผงเทียบยอด (ตัวเลขทั้งหมดมาจาก computeShiftSummary) ===== */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-xs text-slate-500">เงินสดที่ควรมี</div>
              <div className="text-2xl font-bold text-slate-800">฿{baht(expected)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-xs text-slate-500">นับได้จริง</div>
              <div className="text-2xl font-bold text-slate-800">฿{baht(counted)}</div>
            </div>
            <div className={`rounded-2xl px-4 py-3 ${tone.box}`}>
              <div className="text-xs opacity-80">ผลต่าง ({tone.word})</div>
              <div className={`text-2xl font-bold ${tone.value}`}>
                {diff > 0 ? '+' : diff < 0 ? '-' : ''}฿{baht(Math.abs(diff))}
              </div>
            </div>
          </div>

          {summary && (
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
              เงินทอนตั้งต้น ฿{baht(shift.openingCash)} + ขายเงินสด ฿{baht(summary.byMethod.cash)} −
              รายจ่ายเงินสด ฿{baht(summary.expenseCash)} + นำเงินเข้า ฿{baht(summary.cashIn)} −
              นำเงินออก ฿{baht(summary.cashOut)} = <b>฿{baht(summary.expectedCash)}</b>
              <div className="mt-0.5">
                * ยอดขายเงินสดหักเงินทอนที่จ่ายลูกค้าและเอกสารคืนเงินสดแล้ว
              </div>
            </div>
          )}

          {/* ===== หมายเหตุ (บังคับเมื่อผลต่างเยอะ) ===== */}
          <Field
            label={`หมายเหตุปิดกะ${needNote ? ' (จำเป็น)' : ' (ถ้ามี)'}`}
            hint={
              needNote
                ? `ผลต่างตั้งแต่ ฿${baht(NOTE_REQUIRED_DIFF)} ขึ้นไป ต้องอธิบายสาเหตุ เช่น ทอนเงินผิด / ลืมบันทึกรายจ่าย`
                : 'เช่น เงินขาดจากการทอนผิด, ลูกค้าจ่ายเกินแล้วยังไม่ได้ทอน'
            }
          >
            <Textarea
              rows={2}
              className={needNote && !note.trim() ? 'border-rose-400' : ''}
              placeholder="อธิบายสาเหตุของผลต่าง (ถ้ามี)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          {needNote && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
              <Icon name="alert" size={16} className="mt-0.5" />
              <span>
                ผลต่าง{tone.word} ฿{baht(Math.abs(diff))} — ต้องกรอกหมายเหตุก่อนปิดกะ
                เพื่อให้ตรวจย้อนหลังได้ว่าเงินหายหรือเกินเพราะอะไร
              </span>
            </div>
          )}

          {err && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
              <Icon name="alert" size={16} className="mt-0.5" />
              {err}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
