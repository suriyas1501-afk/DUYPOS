import { db } from '../db/db'
import type {
  CashCountLine,
  CashMove,
  CashMoveType,
  Expense,
  PaymentMethod,
  Sale,
  Shift,
  ShiftSummary,
} from '../db/types'
import { getActor, type Actor } from './actor'
import { saleAmountByMethod } from './checkout'
import { DOC_PREFIX, formatDocNo, nextSeq } from './docNo'
import { endOfDay, r2, startOfDay } from './format'

/* =========================================================
   กะการขาย (shift) + นับเงินลิ้นชัก
   - มีกะเปิดอยู่ได้ทีละกะเดียว (บังคับใน openShift)
   - ยอดเงินสดที่ควรมี คิดจาก saleAmountByMethod() เสมอ
     (หักเงินทอนออกจากเงินสด, บิลจ่ายผสมนับแยกก้อน, เอกสารคืนสินค้ายอดติดลบหักกลบเอง)
   ========================================================= */

/** ธนบัตร/เหรียญไทยสำหรับใบนับเงิน (มาก → น้อย) */
export const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25] as const

export const DENOM_LABEL = (d: number) => (d >= 20 ? `฿${d} (ธนบัตร)` : `฿${d} (เหรียญ)`)

/** รวมยอดจากใบนับเงิน */
export const countTotal = (lines: CashCountLine[] | undefined) =>
  r2((lines ?? []).reduce((s, l) => s + l.denom * (Number.isFinite(l.count) ? l.count : 0), 0))

const PAY_KEYS: PaymentMethod[] = ['cash', 'transfer', 'card']

/** กะที่เปิดอยู่ (ถ้ามี) */
export const getOpenShift = () => db.shifts.where('status').equals('open').first()

/** บิลนี้อยู่ในกะนี้ไหม — ใช้ shiftId เป็นหลัก, ช่วงเวลาเป็นทางสำรองของบิลเก่า */
export function saleInShift(s: Sale, shift: Shift): boolean {
  if (s.shiftId != null) return s.shiftId === shift.id
  const hi = shift.closedAt ?? Date.now()
  return s.createdAt >= shift.openedAt && s.createdAt <= hi
}

/** รวม 2 ชุดโดยไม่ให้แถวเดียวกันถูกนับซ้ำ (เอกสารที่เข้าเงื่อนไขทั้ง 2 query) */
function mergeById<T extends { id?: number }>(byTime: T[], byShiftId: T[]): T[] {
  const out = [...byTime]
  const seen = new Set(byTime.map((x) => x.id))
  for (const x of byShiftId) if (!seen.has(x.id)) out.push(x)
  return out
}

/**
 * ดึงบิล + รายจ่ายของกะนี้ให้ครบ — **ทุกที่ที่คำนวณเงินของกะต้องเรียกตัวนี้**
 *
 * ต้องดึงด้วย index `shiftId` เป็นหลัก เพราะ openShift() ดูดเอกสารที่เกิดตอนไม่มีกะเปิด
 * เข้ากะใหม่ (ตั้ง shiftId ให้) แต่เอกสารพวกนั้นมี createdAt **ก่อน** openedAt
 * ถ้าดึงด้วยช่วงเวลาอย่างเดียวจะหลุดหมด → ปิดกะแล้วเงิน "เกิน" โดยหาสาเหตุไม่ได้
 * ซึ่งตรงข้ามกับเจตนาของการดูดบิลพอดี
 *
 * ยังต้องดึงด้วยช่วงเวลาควบคู่ไปด้วย เพราะเอกสารที่ไม่มี shiftId
 * (ร้านที่เพิ่งเปิดระบบกะกลางคัน) อาศัย saleInShift()/expenseInShift() ตัดสินจากเวลาแทน
 * การกรองจริงยังเป็นหน้าที่ของ computeShiftSummary() เหมือนเดิม
 */
export async function loadShiftDocs(
  shift: Shift,
  until: number = Date.now(),
): Promise<{ sales: Sale[]; expenses: Expense[] }> {
  const [salesByTime, expensesByTime] = await Promise.all([
    db.sales.where('createdAt').between(shift.openedAt, until, true, true).toArray(),
    db.expenses.where('createdAt').between(shift.openedAt, until, true, true).toArray(),
  ])
  if (shift.id == null) return { sales: salesByTime, expenses: expensesByTime }

  const [salesById, expensesById] = await Promise.all([
    db.sales.where('shiftId').equals(shift.id).toArray(),
    db.expenses.where('shiftId').equals(shift.id).toArray(),
  ])
  return {
    sales: mergeById(salesByTime, salesById),
    expenses: mergeById(expensesByTime, expensesById),
  }
}

/** รายจ่ายนี้อยู่ในกะนี้ไหม (เกณฑ์เดียวกับบิล แต่ใช้เวลาที่บันทึก ไม่ใช่วันที่ของรายการ) */
export function expenseInShift(e: Expense, shift: Shift): boolean {
  if (e.shiftId != null) return e.shiftId === shift.id
  const hi = shift.closedAt ?? Date.now()
  return e.createdAt >= shift.openedAt && e.createdAt <= hi
}

/**
 * สรุปกะจากรายการที่ให้มา (กรองเฉพาะของกะนี้ให้เอง เพื่อให้หน้าจอกับตอนปิดกะใช้สูตรเดียวกัน)
 * ส่ง sales/expenses เป็นข้อมูลทั้งช่วงเวลาเข้ามาได้เลย
 */
export function computeShiftSummary(
  shift: Shift,
  sales: Sale[],
  expenses: Expense[],
  countedCash: number,
): ShiftSummary {
  const byMethod: Record<PaymentMethod, number> = { cash: 0, transfer: 0, card: 0 }
  /** เงินสดจากโต๊ะที่ยังอยู่กับพนักงาน / ที่นำส่งลิ้นชักแล้ว (โหมดโต๊ะเท่านั้น) */
  let cashWithStaff = 0
  let cashHandedOver = 0
  let billCount = 0
  let salesTotal = 0
  let refundCount = 0
  let refundTotal = 0
  let voidedCount = 0

  for (const s of sales) {
    if (!saleInShift(s, shift)) continue
    if (s.status !== 'completed') {
      voidedCount += 1
      continue
    }
    if (s.kind === 'refund') {
      refundCount += 1
      refundTotal += Math.abs(s.total)
    } else {
      billCount += 1
    }
    salesTotal += s.total
    for (const k of PAY_KEYS) byMethod[k] += saleAmountByMethod(s, k)

    // โหมดโต๊ะ: พนักงานรับเงินสดที่โต๊ะ เงินยังไม่ถึงลิ้นชัก
    // ต้องแยกออกมา ไม่งั้นระบบจะคิดว่าเงินอยู่ในลิ้นชักแล้วและปิดกะจะขาดทุกวัน
    // (บิลเก่าทั้งหมดไม่มีฟิลด์นี้ → ไม่เข้าเงื่อนไข ผลลัพธ์เท่าเดิมเป๊ะ)
    if (s.cashCustody === 'staff') {
      // ใช้ saleAmountByMethod เพื่อให้เอกสารคืนสินค้า (ค่าลบ) หักกลับถูกทางเอง
      const cash = saleAmountByMethod(s, 'cash')
      if (s.cashHandoverAt == null) cashWithStaff += cash
      else cashHandedOver += cash
    }
  }
  for (const k of PAY_KEYS) byMethod[k] = r2(byMethod[k])
  cashWithStaff = r2(cashWithStaff)
  cashHandedOver = r2(cashHandedOver)

  let expenseCash = 0
  for (const e of expenses) {
    if (!expenseInShift(e, shift)) continue
    if (e.paymentMethod === 'cash') expenseCash += e.amount
  }
  expenseCash = r2(expenseCash)

  let cashIn = 0
  let cashOut = 0
  for (const m of shift.cashMoves ?? []) {
    if (m.type === 'in') cashIn += m.amount
    else cashOut += m.amount
  }
  cashIn = r2(cashIn)
  cashOut = r2(cashOut)

  // byMethod.cash คงความหมายเดิม (ยอดขายเงินสดทั้งหมดของกะ) — หัก cashWithStaff ที่นี่จุดเดียว
  const expectedCash = r2(
    shift.openingCash + byMethod.cash - cashWithStaff - expenseCash + cashIn - cashOut,
  )

  return {
    billCount,
    salesTotal: r2(salesTotal),
    byMethod,
    refundCount,
    refundTotal: r2(refundTotal),
    voidedCount,
    expenseCash,
    cashIn,
    cashOut,
    cashWithStaff,
    cashHandedOver,
    expectedCash,
    countedCash: r2(countedCash),
    diff: r2(r2(countedCash) - expectedCash),
  }
}

/** เปิดกะใหม่ — ห้ามซ้อนกับกะที่ยังเปิดอยู่ */
export async function openShift(input: {
  openingCash: number
  note?: string
  actor?: Actor
}): Promise<Shift> {
  const openedAt = Date.now()
  const actor = input.actor ?? getActor()
  const openingCash = r2(Math.max(0, Number(input.openingCash) || 0))

  return db.transaction('rw', [db.shifts, db.sales, db.expenses], async () => {
    const existing = await db.shifts.where('status').equals('open').first()
    if (existing) throw new Error(`ยังมีกะ ${existing.docNo} เปิดอยู่ — ต้องปิดกะเดิมก่อน`)

    const sameDay = await db.shifts
      .where('openedAt')
      .between(startOfDay(openedAt), endOfDay(openedAt), true, true)
      .toArray()
    const docNo = formatDocNo(
      DOC_PREFIX.shift,
      openedAt,
      nextSeq(
        sameDay.map((s) => s.docNo),
        DOC_PREFIX.shift,
        openedAt,
      ),
    )

    const shift: Shift = {
      docNo,
      status: 'open',
      openedAt,
      openedById: actor.id,
      openedByName: actor.name,
      openingCash,
      openNote: input.note?.trim() || undefined,
      cashMoves: [],
    }
    const id = await db.shifts.add(shift)

    /* ดูดบิล/รายจ่ายที่เกิด "ตอนไม่มีกะเปิด" เข้ากะใหม่
       เช่นพนักงานเปิดร้านขายไปก่อนแล้วค่อยนึกได้ว่ายังไม่เปิดกะ — เงินอยู่ในลิ้นชักจริง
       แต่เอกสารไม่มี shiftId จึงไม่ถูกนับในกะไหนเลย ทำให้ตอนปิดกะเงิน "เกิน" โดยหาสาเหตุไม่ได้
       จำกัดช่วงไว้แค่ตั้งแต่กะล่าสุดปิด (หรือต้นวันนี้ ถ้ายังไม่เคยมีกะ) เพื่อไม่ให้ย้อนไปดูดของเก่า */
    const closed = await db.shifts.where('status').equals('closed').toArray()
    const lastClosedAt = closed.reduce((mx, s) => Math.max(mx, s.closedAt ?? 0), 0)
    const gapFrom = Math.max(lastClosedAt, startOfDay(openedAt))
    if (gapFrom < openedAt) {
      const sales = await db.sales.where('createdAt').between(gapFrom, openedAt, true, true).toArray()
      for (const s of sales) {
        if (s.id != null && s.shiftId == null) await db.sales.update(s.id, { shiftId: id })
      }
      const expenses = await db.expenses
        .where('createdAt')
        .between(gapFrom, openedAt, true, true)
        .toArray()
      for (const e of expenses) {
        if (e.id != null && e.shiftId == null) await db.expenses.update(e.id, { shiftId: id })
      }
    }

    return { ...shift, id }
  })
}

/** นำเงินเข้า/ออกลิ้นชักระหว่างกะ */
export async function addCashMove(
  shiftId: number,
  input: { type: CashMoveType; amount: number; reason: string; actor?: Actor },
): Promise<void> {
  const amount = r2(Number(input.amount) || 0)
  if (amount <= 0) throw new Error('กรุณากรอกจำนวนเงินให้ถูกต้อง')
  const reason = input.reason.trim()
  if (!reason) throw new Error('กรุณาระบุเหตุผล')
  const actor = input.actor ?? getActor()

  await db.transaction('rw', [db.shifts, db.sales, db.expenses], async () => {
    const shift = await db.shifts.get(shiftId)
    if (!shift) throw new Error('ไม่พบกะนี้')
    if (shift.status !== 'open') throw new Error('กะนี้ปิดแล้ว')
    if (input.type === 'out') {
      // กันถอนเกินเงินที่มีในลิ้นชัก (คิดจากยอดที่ระบบคาดว่ามีอยู่ ณ ตอนนี้)
      const { sales, expenses } = await loadShiftDocs(shift)
      const { expectedCash } = computeShiftSummary(shift, sales, expenses, 0)
      if (amount > expectedCash + 0.001) {
        throw new Error(
          `นำเงินออกเกินเงินสดที่ควรมีในลิ้นชัก (฿${expectedCash.toLocaleString('th-TH')})`,
        )
      }
    }
    const move: CashMove = {
      type: input.type,
      amount,
      reason,
      at: Date.now(),
      byId: actor.id,
      byName: actor.name,
    }
    await db.shifts.update(shiftId, { cashMoves: [...(shift.cashMoves ?? []), move] })
  })
}

/**
 * ปิดกะ — คำนวณสรุปใหม่จากฐานข้อมูลเสมอ (ไม่เชื่อยอดที่ส่งมาจากหน้าจอ)
 * ยอดที่นับได้มาจากใบนับเงิน (countLines) ถ้ามี ไม่มีก็ใช้ countedCash ที่กรอกตรงๆ
 */
export async function closeShift(
  shiftId: number,
  input: { countLines?: CashCountLine[]; countedCash?: number; note?: string; actor?: Actor },
): Promise<Shift> {
  const closedAt = Date.now()
  const actor = input.actor ?? getActor()
  const counted =
    input.countLines && input.countLines.length > 0
      ? countTotal(input.countLines)
      : r2(Math.max(0, Number(input.countedCash) || 0))

  return db.transaction('rw', db.shifts, db.sales, db.expenses, async () => {
    const shift = await db.shifts.get(shiftId)
    if (!shift) throw new Error('ไม่พบกะนี้')
    if (shift.status !== 'open') throw new Error('กะนี้ปิดแล้ว')

    const { sales, expenses } = await loadShiftDocs(shift, closedAt)

    const summary = computeShiftSummary(shift, sales, expenses, counted)
    const patch: Partial<Shift> = {
      status: 'closed',
      closedAt,
      closedById: actor.id,
      closedByName: actor.name,
      countedCash: counted,
      countLines: input.countLines?.filter((l) => l.count > 0),
      closeNote: input.note?.trim() || undefined,
      summary,
    }
    await db.shifts.update(shiftId, patch)
    return { ...shift, ...patch }
  })
}
