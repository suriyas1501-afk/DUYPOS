import { Fragment, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { CashMoveType, PaymentMethod, Shift as ShiftDoc } from '../db/types'
import { useCurrentShift, usePermissions, useSettings } from '../db/hooks'
import { baht, fmtDate, fmtDateTime, fmtTime, money } from '../lib/format'
import { PAY_LABEL } from '../lib/receipt'
import { DENOM_LABEL } from '../lib/shift'
import { printShiftReport } from '../lib/shiftReport'
import { PAY_METHODS } from './accounting/shared'
import OpenShiftModal from './shift/OpenShiftModal'
import CashMoveModal from './shift/CashMoveModal'
import CloseShiftModal, { useShiftSummary } from './shift/CloseShiftModal'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  Spinner,
  toast,
  type IconName,
} from '../components/ui'

/* =========================================================
   หน้ากะ / ลิ้นชัก — เปิดกะ, นำเงินเข้า-ออก, ปิดกะ + นับเงิน, ประวัติกะ

   "เงินสดที่ควรมีในลิ้นชัก" คิดที่ computeShiftSummary() (src/lib/shift.ts) ที่เดียวเท่านั้น
   หน้านี้อ่านผ่านฮุก useShiftSummary จาก CloseShiftModal เพื่อให้การ์ดสรุปสด
   กับหน้าจอปิดกะใช้ตัวเลขชุดเดียวกันแน่นอน (ห้ามคิดสูตรเงินสดซ้ำในหน้าจอ)
   ========================================================= */

/** จำนวนแถวประวัติกะต่อหน้า */
const PAGE_SIZE = 20

/** ผลต่างต่ำกว่านี้ถือว่าตรงพอดี (กันเศษทศนิยมจากการปัด) */
const EPS = 0.005

const METHOD_ICONS: Record<PaymentMethod, IconName> = {
  cash: 'cash',
  transfer: 'qr',
  card: 'card',
}

/* ---------------------------------------------------------
   ชิ้นส่วนย่อย
   --------------------------------------------------------- */

/** ป้ายผลต่างเงินสด: 0 = ตรง, บวก = เกิน, ลบ = ขาด (diff = นับได้ − ควรมี) */
function DiffBadge({ diff }: { diff: number }) {
  if (Math.abs(diff) < EPS) return <Badge color="green">ตรง</Badge>
  if (diff > 0) return <Badge color="blue">เกิน ฿{baht(diff)}</Badge>
  return <Badge color="red">ขาด ฿{baht(Math.abs(diff))}</Badge>
}

/** แถวตัวเลขในการ์ดสรุป */
function StatRow({
  icon,
  label,
  value,
  sub,
  tone = 'text-slate-800',
}: {
  icon: IconName
  label: string
  value: string
  sub?: string
  tone?: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icon name={icon} size={15} />
      </span>
      <span className="text-slate-600">{label}</span>
      {sub && <span className="text-xs text-slate-400">{sub}</span>}
      <span className={`ml-auto font-semibold ${tone}`}>{value}</span>
    </div>
  )
}

/* ---------------------------------------------------------
   การ์ดกะที่เปิดอยู่ (สรุปสด)
   --------------------------------------------------------- */

function OpenShiftPanel({
  shift,
  canDo,
  onCashMove,
  onCloseShift,
}: {
  shift: ShiftDoc
  canDo: boolean
  onCashMove: (type: CashMoveType) => void
  onCloseShift: () => void
}) {
  const settings = useSettings()
  // สรุปสดของกะนี้ (countedCash = 0 เพราะยังไม่นับเงิน — สนใจแค่ expectedCash)
  const { summary, loading } = useShiftSummary(shift)
  const moves = shift.cashMoves ?? []

  return (
    <div className="space-y-4">
      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>กะ {shift.docNo}</span>
            <Badge color="green">
              <Icon name="unlock" size={12} />
              เปิดอยู่
            </Badge>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon="printer"
              onClick={() => printShiftReport(shift, settings, summary ?? undefined)}
            >
              พิมพ์รายงานกะ
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              disabled={!canDo}
              title={canDo ? undefined : 'ไม่มีสิทธิ์จัดการกะ'}
              onClick={() => onCashMove('in')}
            >
              นำเงินเข้า
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="minus"
              disabled={!canDo}
              title={canDo ? undefined : 'ไม่มีสิทธิ์จัดการกะ'}
              onClick={() => onCashMove('out')}
            >
              นำเงินออก
            </Button>
            <Button
              size="sm"
              icon="lock"
              disabled={!canDo}
              title={canDo ? undefined : 'ไม่มีสิทธิ์จัดการกะ'}
              onClick={onCloseShift}
            >
              ปิดกะ
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* ---- หัวกะ ---- */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-slate-600">
              <Icon name="clock" size={15} className="text-slate-400" />
              เปิดเมื่อ <span className="font-medium">{fmtDateTime(shift.openedAt)}</span>
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <Icon name="user" size={15} className="text-slate-400" />
              โดย <span className="font-medium">{shift.openedByName?.trim() || '—'}</span>
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <Icon name="wallet" size={15} className="text-slate-400" />
              เงินทอนตั้งต้น{' '}
              <span className="font-medium">฿{baht(shift.openingCash)}</span>
            </span>
          </div>
          {shift.openNote && (
            <div className="rounded-xl bg-slate-50 px-4 py-2 text-xs text-slate-500">
              หมายเหตุเปิดกะ: {shift.openNote}
            </div>
          )}

          {loading || !summary ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 border-t border-slate-100 pt-4 text-sm lg:grid-cols-2">
                <StatRow
                  icon="receipt"
                  label={`ยอดขาย${summary.refundCount > 0 ? 'สุทธิ' : 'รวม'}`}
                  sub={`${baht(summary.billCount)} บิล`}
                  value={`฿${baht(summary.salesTotal)}`}
                />
                {PAY_METHODS.map((k) => (
                  <StatRow
                    key={k}
                    icon={METHOD_ICONS[k]}
                    label={PAY_LABEL[k]}
                    value={`฿${baht(summary.byMethod[k])}`}
                    tone={summary.byMethod[k] < 0 ? 'text-rose-600' : 'text-slate-800'}
                  />
                ))}
                <StatRow
                  icon="undo"
                  label="คืนสินค้า"
                  sub={`${baht(summary.refundCount)} รายการ`}
                  value={summary.refundTotal > 0 ? `-฿${baht(summary.refundTotal)}` : '฿0'}
                  tone={summary.refundTotal > 0 ? 'text-rose-600' : 'text-slate-400'}
                />
                <StatRow
                  icon="x"
                  label="บิลยกเลิก"
                  value={`${baht(summary.voidedCount)} บิล`}
                  tone={summary.voidedCount > 0 ? 'text-rose-600' : 'text-slate-400'}
                />
                <StatRow
                  icon="cash"
                  label="รายจ่ายเงินสด"
                  value={summary.expenseCash > 0 ? `-฿${baht(summary.expenseCash)}` : '฿0'}
                  tone={summary.expenseCash > 0 ? 'text-rose-600' : 'text-slate-400'}
                />
                <StatRow
                  icon="wallet"
                  label="นำเงินเข้า / ออก"
                  value={`+฿${baht(summary.cashIn)} / -฿${baht(summary.cashOut)}`}
                />
              </div>

              {/* ---- เงินสดที่ควรมีในลิ้นชักตอนนี้ (expectedCash จาก computeShiftSummary) ---- */}
              <div className="rounded-2xl bg-emerald-600 p-5 text-white shadow-sm">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
                    <Icon name="cash" size={24} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-emerald-100">
                      เงินสดที่ควรมีในลิ้นชักตอนนี้
                    </div>
                    <div className="text-3xl font-bold">฿{baht(summary.expectedCash)}</div>
                  </div>
                  <div className="text-right text-xs text-emerald-100">
                    <div>
                      ตั้งต้น {money(shift.openingCash)} + ขายเงินสด{' '}
                      {money(summary.byMethod.cash)} − รายจ่ายเงินสด{' '}
                      {money(summary.expenseCash)} + นำเข้า {money(summary.cashIn)} − นำออก{' '}
                      {money(summary.cashOut)}
                    </div>
                    <div className="mt-0.5 text-emerald-200">
                      * ยอดขายเงินสดหักเงินทอนที่จ่ายลูกค้าและเอกสารคืนเงินสดแล้ว
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* ===== รายการนำเงินเข้า/ออกของกะนี้ ===== */}
      <Card title={`นำเงินเข้า / ออกลิ้นชัก (${baht(moves.length)} รายการ)`} padded={false}>
        {moves.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="ยังไม่มีการนำเงินเข้า/ออกในกะนี้"
            hint="ใช้ปุ่ม “นำเงินเข้า” หรือ “นำเงินออก” เมื่อเติมเงินทอนหรือถอนเงินไปฝากธนาคาร"
          />
        ) : (
          <div className="divide-y divide-slate-50">
            {[...moves]
              .sort((a, b) => b.at - a.at)
              .map((m, i) => (
                <div key={`${m.at}-${i}`} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="w-20 shrink-0 text-slate-500">{fmtTime(m.at)}</span>
                  <Badge color={m.type === 'in' ? 'green' : 'amber'}>
                    {m.type === 'in' ? 'นำเข้า' : 'นำออก'}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{m.reason}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {m.byName?.trim() || '—'}
                  </span>
                  <span
                    className={`w-28 shrink-0 text-right font-semibold ${
                      m.type === 'in' ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {m.type === 'in' ? '+' : '-'}฿{baht(m.amount)}
                  </span>
                </div>
              ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ---------------------------------------------------------
   ประวัติกะที่ปิดแล้ว
   --------------------------------------------------------- */

function ClosedShiftHistory() {
  const settings = useSettings()
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<number | null>(null)

  const list = useLiveQuery(async () => {
    const rows = await db.shifts.where('status').equals('closed').toArray()
    return rows.sort((a, b) => b.openedAt - a.openedAt)
  })

  if (!list) {
    return (
      <Card title="ประวัติกะที่ปิดแล้ว">
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      </Card>
    )
  }

  if (list.length === 0) {
    return (
      <Card title="ประวัติกะที่ปิดแล้ว" padded={false}>
        <EmptyState
          icon="clock"
          title="ยังไม่มีกะที่ปิดแล้ว"
          hint="เมื่อปิดกะ ระบบจะเก็บยอดขาย เงินที่ควรมี เงินที่นับได้ และผลต่างไว้ที่นี่"
        />
      </Card>
    )
  }

  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = list.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <Card title={`ประวัติกะที่ปิดแล้ว (${baht(list.length)} กะ)`} padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-3 font-medium">เลขที่</th>
              <th className="px-4 py-3 font-medium">เปิด – ปิด</th>
              <th className="px-4 py-3 font-medium">ผู้เปิด / ผู้ปิด</th>
              <th className="px-4 py-3 text-right font-medium">ยอดขาย</th>
              <th className="px-4 py-3 text-right font-medium">ควรมี</th>
              <th className="px-4 py-3 text-right font-medium">นับได้</th>
              <th className="px-4 py-3 text-center font-medium">ผลต่าง</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const sum = s.summary
              const open = expanded === s.id
              const countLines = (s.countLines ?? []).filter((l) => l.count > 0)
              return (
                <Fragment key={s.id}>
                  <tr
                    className="cursor-pointer border-b border-slate-50 transition-colors hover:bg-slate-50"
                    onClick={() => setExpanded(open ? null : (s.id ?? null))}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-800">{s.docNo}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <div>{fmtDate(s.openedAt)}</div>
                      <div className="text-xs text-slate-400">
                        {fmtTime(s.openedAt)} – {s.closedAt != null ? fmtTime(s.closedAt) : '—'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <div>{s.openedByName?.trim() || '—'}</div>
                      <div className="text-xs text-slate-400">
                        {s.closedByName?.trim() || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">
                      {sum ? `฿${baht(sum.salesTotal)}` : '—'}
                      {sum && (
                        <div className="text-xs text-slate-400">{baht(sum.billCount)} บิล</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">
                      {sum ? `฿${baht(sum.expectedCash)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                      ฿{baht(s.countedCash ?? 0)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <DiffBadge diff={sum?.diff ?? 0} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="printer"
                          title="พิมพ์รายงานกะซ้ำ"
                          onClick={(e) => {
                            e.stopPropagation()
                            printShiftReport(s, settings)
                          }}
                        >
                          พิมพ์
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="eye"
                          title="ดูรายละเอียด"
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpanded(open ? null : (s.id ?? null))
                          }}
                        />
                      </div>
                    </td>
                  </tr>

                  {open && (
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid grid-cols-1 gap-4 text-sm lg:grid-cols-3">
                          {/* ---- ยอดแยกช่องทาง + เงินสด ---- */}
                          <div className="space-y-1.5">
                            <div className="text-xs font-bold text-slate-500">
                              ยอดแยกช่องทาง
                            </div>
                            {sum ? (
                              <>
                                {PAY_METHODS.map((k) => (
                                  <div key={k} className="flex justify-between gap-3">
                                    <span className="text-slate-500">{PAY_LABEL[k]}</span>
                                    <span
                                      className={
                                        sum.byMethod[k] < 0
                                          ? 'font-medium text-rose-600'
                                          : 'font-medium text-slate-700'
                                      }
                                    >
                                      ฿{baht(sum.byMethod[k])}
                                    </span>
                                  </div>
                                ))}
                                <div className="flex justify-between gap-3 border-t border-slate-200 pt-1.5">
                                  <span className="text-slate-500">เงินทอนตั้งต้น</span>
                                  <span className="font-medium text-slate-700">
                                    ฿{baht(s.openingCash)}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-500">รายจ่ายเงินสด</span>
                                  <span
                                    className={
                                      sum.expenseCash > 0
                                        ? 'font-medium text-rose-600'
                                        : 'font-medium text-slate-700'
                                    }
                                  >
                                    {sum.expenseCash > 0 ? '-' : ''}฿{baht(sum.expenseCash)}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-500">นำเงินเข้า / ออก</span>
                                  <span className="font-medium text-slate-700">
                                    +฿{baht(sum.cashIn)} / -฿{baht(sum.cashOut)}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-500">คืนสินค้า</span>
                                  <span
                                    className={
                                      sum.refundCount > 0
                                        ? 'font-medium text-rose-600'
                                        : 'font-medium text-slate-700'
                                    }
                                  >
                                    {baht(sum.refundCount)} รายการ
                                    {sum.refundTotal > 0 ? ` (-฿${baht(sum.refundTotal)})` : ''}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-500">บิลยกเลิก</span>
                                  <span className="font-medium text-slate-700">
                                    {baht(sum.voidedCount)} บิล
                                  </span>
                                </div>
                              </>
                            ) : (
                              <div className="text-slate-400">ไม่มีข้อมูลสรุปของกะนี้</div>
                            )}
                          </div>

                          {/* ---- ใบนับเงิน ---- */}
                          <div className="space-y-1.5">
                            <div className="text-xs font-bold text-slate-500">ใบนับเงิน</div>
                            {countLines.length === 0 ? (
                              <div className="text-slate-400">
                                ไม่ได้นับแยกใบ/เหรียญ (กรอกยอดรวมเอง ฿
                                {baht(s.countedCash ?? 0)})
                              </div>
                            ) : (
                              countLines.map((l) => (
                                <div key={l.denom} className="flex justify-between gap-3">
                                  <span className="text-slate-500">
                                    {DENOM_LABEL(l.denom)} × {baht(l.count)}
                                  </span>
                                  <span className="font-medium text-slate-700">
                                    ฿{baht(l.denom * l.count)}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>

                          {/* ---- เทียบยอด + หมายเหตุ ---- */}
                          <div className="space-y-1.5">
                            <div className="text-xs font-bold text-slate-500">เทียบยอดเงินสด</div>
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-500">เงินสดที่ควรมี</span>
                              <span className="font-medium text-slate-700">
                                ฿{baht(sum?.expectedCash ?? 0)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-500">นับได้จริง</span>
                              <span className="font-medium text-slate-700">
                                ฿{baht(s.countedCash ?? 0)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-1.5">
                              <span className="text-slate-500">ผลต่าง</span>
                              <DiffBadge diff={sum?.diff ?? 0} />
                            </div>
                            {s.openNote && (
                              <div className="pt-1 text-xs text-slate-500">
                                หมายเหตุเปิดกะ: {s.openNote}
                              </div>
                            )}
                            {s.closeNote && (
                              <div className="text-xs text-slate-500">
                                หมายเหตุปิดกะ: {s.closeNote}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ===== แบ่งหน้า 20 แถวต่อหน้า ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        <span>
          แสดง {baht(visible.length)} จาก {baht(list.length)} กะ · หน้า {safePage + 1}/{pageCount}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={safePage <= 0}
            onClick={() => setPage(safePage - 1)}
          >
            ก่อนหน้า
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            ถัดไป
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ---------------------------------------------------------
   หน้าหลัก
   --------------------------------------------------------- */

export default function Shift() {
  const settings = useSettings()
  const { can } = usePermissions()
  const { shift, loading } = useCurrentShift()
  const canDo = can('shift')

  const [openModal, setOpenModal] = useState(false)
  const [moveType, setMoveType] = useState<CashMoveType | null>(null)
  /**
   * กะที่กำลังปิด — เก็บ snapshot ไว้เอง ไม่ผูกกับ useCurrentShift
   * เพราะทันทีที่ปิดกะสำเร็จ กะจะหลุดจาก "กะที่เปิดอยู่" ถ้าผูกกันโมดัลจะหายไป
   * ก่อนผู้ใช้ได้กดพิมพ์รายงานกะ
   */
  const [closing, setClosing] = useState<ShiftDoc | null>(null)

  /** กันไว้อีกชั้น — แถบนำทางกรองสิทธิ์แล้ว แต่ห้ามให้ปุ่มทำรายการทำงานถ้าไม่มีสิทธิ์ */
  const allow = () => {
    if (canDo) return true
    toast.error('ไม่มีสิทธิ์จัดการกะ — ติดต่อผู้จัดการหรือเจ้าของร้าน')
    return false
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="กะ / ลิ้นชัก"
        subtitle="เปิด-ปิดกะ นับเงินในลิ้นชัก และตรวจผลต่างเงินสดของแต่ละกะ"
        actions={
          shift == null && !loading ? (
            <Button
              icon="unlock"
              disabled={!canDo}
              title={canDo ? undefined : 'ไม่มีสิทธิ์จัดการกะ'}
              onClick={() => {
                if (allow()) setOpenModal(true)
              }}
            >
              เปิดกะ
            </Button>
          ) : undefined
        }
      />

      {/* ===== แจ้งเตือนเมื่อระบบกะยังปิดอยู่ ===== */}
      {!settings.shiftEnabled && (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          <span>
            <b>ระบบกะยังปิดอยู่</b> — เปิดใช้งานได้ที่ ตั้งค่า › กะ
            (เปิดแล้วจะบันทึกบิล/รายจ่ายเข้ากะให้อัตโนมัติ และบังคับเปิดกะก่อนขายได้)
            ระหว่างนี้ยังใช้หน้านี้ดูประวัติกะและเปิด-ปิดกะเองได้ตามปกติ
          </span>
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          <Card>
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          </Card>
        ) : shift == null ? (
          /* ===== ยังไม่เปิดกะ ===== */
          <Card>
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="rounded-2xl bg-slate-100 p-5 text-slate-400">
                <Icon name="lock" size={36} />
              </div>
              <div>
                <div className="text-lg font-bold text-slate-800">ยังไม่เปิดกะ</div>
                <p className="mt-1 max-w-md text-sm text-slate-500">
                  เปิดกะเพื่อเริ่มนับเงินในลิ้นชัก — ระบบจะผูกบิลขายและรายจ่ายที่เกิดขึ้นเข้ากับกะนี้
                  แล้วสรุป “เงินสดที่ควรมี” ให้เทียบกับเงินจริงตอนปิดกะ
                </p>
              </div>
              <Button
                size="lg"
                icon="unlock"
                disabled={!canDo}
                title={canDo ? undefined : 'ไม่มีสิทธิ์จัดการกะ'}
                onClick={() => {
                  if (allow()) setOpenModal(true)
                }}
              >
                เปิดกะ
              </Button>
            </div>
          </Card>
        ) : (
          <OpenShiftPanel
            shift={shift}
            canDo={canDo}
            onCashMove={(t) => {
              if (allow()) setMoveType(t)
            }}
            onCloseShift={() => {
              if (allow()) setClosing(shift)
            }}
          />
        )}

        <ClosedShiftHistory />
      </div>

      {/* ===== โมดัล ===== */}
      <OpenShiftModal open={openModal} onClose={() => setOpenModal(false)} />

      {shift != null && shift.id != null && moveType != null && (
        <CashMoveModal
          open
          shiftId={shift.id}
          type={moveType}
          onClose={() => setMoveType(null)}
        />
      )}

      {closing != null && (
        /* ยังเปิดอยู่ → ใช้ข้อมูลสดจาก useCurrentShift, ปิดแล้ว → ใช้ snapshot ที่เก็บไว้ */
        <CloseShiftModal
          open
          shift={shift != null && shift.id === closing.id ? shift : closing}
          onClose={() => setClosing(null)}
        />
      )}
    </div>
  )
}
