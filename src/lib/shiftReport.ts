import type { PaymentMethod, Settings, Shift, ShiftSummary } from '../db/types'
import { fmtDateTime, money } from './format'
import { PAY_LABEL, esc, logoImg, slipStyle } from './receipt'
import { DENOM_LABEL } from './shift'

/* =========================================================
   รายงานปิดกะ — สร้าง HTML สำหรับพิมพ์ (แพทเทิร์นเดียวกับ receipt.ts / dailyReport.ts)

   ยอดเงินทุกช่องมาจาก ShiftSummary ที่ computeShiftSummary() คิดไว้แล้วเท่านั้น
   ไฟล์นี้ "ไม่คิดสูตรเงินสดเอง" — หน้าที่คือจัดรูปแบบให้พิมพ์ลงกระดาษ 58/80 มม.
   ========================================================= */

// esc / logoImg ใช้ตัวเดียวกับใบเสร็จ (หนี " และ ' ด้วย และรับเฉพาะโลโก้ที่เป็น data:image/)

const row = (left: string, right: string, cls = '') =>
  `<div class="rr ${cls}"><span>${left}</span><span>${right}</span></div>`

const hr = () => '<div class="hr"></div>'

const PAY_KEYS: PaymentMethod[] = ['cash', 'transfer', 'card']

/** ผลต่างเงินสด: บวก = เกิน, ลบ = ขาด, 0 = ตรงพอดี (สูตรอยู่ใน computeShiftSummary) */
const diffWord = (diff: number) => (diff === 0 ? 'ตรงพอดี' : diff > 0 ? 'เกิน' : 'ขาด')

/** ใส่เครื่องหมายเฉพาะเมื่อมียอดจริง (กันพิมพ์ "-0.00") */
const minus = (n: number) => (n > 0 ? `-${money(n)}` : money(n))
const plus = (n: number) => (n > 0 ? `+${money(n)}` : money(n))

/** หัวเอกสาร: โลโก้ + ข้อมูลร้าน (เหมือนใบเสร็จ) */
function shopHeader(settings: Settings): string {
  return `
  ${logoImg(settings)}
  <div class="c b lg">${esc(settings.shopName)}</div>
  ${settings.branch ? `<div class="c sm">${esc(settings.branch)}</div>` : ''}
  ${settings.address ? `<div class="c sm">${esc(settings.address)}</div>` : ''}
  ${settings.phone ? `<div class="c sm">โทร. ${esc(settings.phone)}</div>` : ''}
  ${settings.taxId ? `<div class="c sm">เลขประจำตัวผู้เสียภาษี ${esc(settings.taxId)}</div>` : ''}`
}

/** ช่องเซ็นชื่อท้ายรายงาน */
const signBlock = (label: string, name?: string) => `
  <div style="margin-top:14px" class="c sm">ลงชื่อ ..............................................</div>
  <div class="c sm">(${esc(name?.trim() || '.'.repeat(20))})</div>
  <div class="c sm b">${esc(label)}</div>`

/**
 * รายงานกะ — ปิดแล้วใช้ summary ที่บันทึกไว้ (snapshot ตอนปิดกะ),
 * กะที่ยังเปิดอยู่ให้ส่ง summary สดที่คำนวณจาก computeShiftSummary() เข้ามา
 */
export function buildShiftReportHtml(
  shift: Shift,
  settings: Settings,
  summary?: ShiftSummary,
): string {
  const base = settings.receiptWidth === '58' ? 10.5 : 12 // ขนาดฟอนต์ (px)
  const sum = shift.summary ?? summary
  const isClosed = shift.status === 'closed'

  // ---- ยอดแยกช่องทาง (เงินสดหักเงินทอนแล้ว, เอกสารคืนติดลบหักกลบเอง) ----
  const methodRows = sum
    ? PAY_KEYS.map((k) => row(`&nbsp;&nbsp;${PAY_LABEL[k]}`, money(sum.byMethod[k]))).join('')
    : ''

  // ---- รายการนำเงินเข้า/ออกลิ้นชักระหว่างกะ ----
  const moves = shift.cashMoves ?? []
  const moveRows = moves
    .map((m) =>
      row(
        `&nbsp;&nbsp;${m.type === 'in' ? 'เข้า' : 'ออก'} ${esc(m.reason)}${
          m.byName ? ` (${esc(m.byName)})` : ''
        }`,
        `${m.type === 'in' ? '+' : '-'}${money(m.amount)}`,
        'sm',
      ),
    )
    .join('')

  // ---- ใบนับเงิน (ถ้านับแยกใบ/เหรียญไว้) ----
  const countRows = (shift.countLines ?? [])
    .filter((l) => l.count > 0)
    .map((l) =>
      row(`&nbsp;&nbsp;${DENOM_LABEL(l.denom)} x ${l.count}`, money(l.denom * l.count), 'sm'),
    )
    .join('')

  return `
<style>${slipStyle(settings, base)}</style>
<div>
  ${shopHeader(settings)}
  ${hr()}
  <div class="c b">${isClosed ? 'รายงานปิดกะ' : 'รายงานกะ (ยังไม่ปิด)'}</div>
  ${row('เลขที่กะ', esc(shift.docNo), 'sm')}
  ${row('เปิดกะ', fmtDateTime(shift.openedAt), 'sm')}
  ${row('&nbsp;&nbsp;โดย', esc(shift.openedByName?.trim() || '—'), 'sm')}
  ${
    isClosed && shift.closedAt != null
      ? row('ปิดกะ', fmtDateTime(shift.closedAt), 'sm') +
        row('&nbsp;&nbsp;โดย', esc(shift.closedByName?.trim() || '—'), 'sm')
      : ''
  }
  ${row('พิมพ์เมื่อ', fmtDateTime(Date.now()), 'sm')}
  ${shift.openNote ? `<div class="sm">หมายเหตุเปิดกะ: ${esc(shift.openNote)}</div>` : ''}
  ${hr()}
  ${row('เงินทอนตั้งต้น', money(shift.openingCash))}
  ${
    sum
      ? `
  ${hr()}
  ${row(
    `ยอดขาย${sum.refundCount > 0 ? 'สุทธิ' : 'รวม'} (${sum.billCount} บิล)`,
    money(sum.salesTotal),
    'b',
  )}
  ${methodRows}
  ${
    sum.refundCount > 0
      ? row(`คืนสินค้า (${sum.refundCount} รายการ)`, `-${money(sum.refundTotal)}`) +
        `<div class="dim">(หักออกจากยอดขายสุทธิและยอดแยกช่องทางแล้ว)</div>`
      : ''
  }
  ${row('บิลยกเลิกในกะ', `${sum.voidedCount} บิล`, 'sm')}
  ${hr()}
  ${row('รายจ่ายเงินสดในกะ', minus(sum.expenseCash))}
  ${row('นำเงินเข้าลิ้นชัก', plus(sum.cashIn))}
  ${row('นำเงินออกจากลิ้นชัก', minus(sum.cashOut))}
  ${moveRows}
  ${hr()}
  ${row('เงินสดที่ควรมี', money(sum.expectedCash), 'b')}
  <div class="dim">(ตั้งต้น ${money(shift.openingCash)} + ขายเงินสด ${money(
    sum.byMethod.cash,
  )} − รายจ่ายเงินสด ${money(sum.expenseCash)} + นำเข้า ${money(
    sum.cashIn,
  )} − นำออก ${money(sum.cashOut)})</div>
  ${
    // กะที่ยังไม่ปิดยังไม่มีการนับเงิน (countedCash = 0) — ถ้าพิมพ์ยอดนับ/ผลต่างออกไปจะกลายเป็น
    // "ขาดเงิน" ทั้งใบทั้งที่ยังไม่มีใครนับ จึงซ่อนบล็อกนับเงินไว้จนกว่าจะปิดกะ
    isClosed
      ? `
  ${row('นับเงินได้จริง', money(sum.countedCash), 'b')}
  <div class="box">
    ${row('ผลต่าง', `${sum.diff > 0 ? '+' : ''}${money(sum.diff)}`, 'b lg')}
    <div class="c b">${diffWord(sum.diff)}${
      sum.diff === 0 ? '' : ` ${money(Math.abs(sum.diff))} บาท`
    }</div>
  </div>
  ${countRows ? `${hr()}<div class="b sm">ใบนับเงิน</div>${countRows}` : ''}`
      : `
  <div class="box c b">ยังไม่ได้นับเงิน — ปิดกะเพื่อบันทึกยอดที่นับได้</div>
  <div class="c sm">(ใบนี้เป็นรายงานระหว่างกะ ยังไม่มีการกระทบยอดเงินในลิ้นชัก)</div>`
  }
  <div class="sm">* ยอดเงินสดหักเงินทอนที่จ่ายลูกค้าแล้ว และรวมเงินทอนตั้งต้นในลิ้นชัก</div>
  <div class="sm">* ยอดนี้คิด “ต่อกะ” จึงรวมเงินทอนตั้งต้น — ต่างจากสรุปปิดยอดรายวันที่คิดทั้งวันเป็นเงินสดรับสุทธิ จึงไม่รวมเงินทอนตั้งต้น</div>`
      : `${hr()}<div class="sm">* ยังไม่มีข้อมูลสรุปของกะนี้</div>`
  }
  ${shift.closeNote ? `${hr()}<div class="sm">หมายเหตุปิดกะ: ${esc(shift.closeNote)}</div>` : ''}
  ${hr()}
  ${
    // ช่องเซ็น "ผู้ปิดกะ" มีความหมายเฉพาะตอนปิดกะจริง — ระหว่างกะยังไม่มีใครปิด
    isClosed ? signBlock('ผู้ปิดกะ', shift.closedByName) : ''
  }
  ${signBlock('ผู้ตรวจ / ผู้จัดการ')}
  ${settings.receiptFooter ? `${hr()}<div class="c sm">${esc(settings.receiptFooter)}</div>` : ''}
</div>`
}

/** พิมพ์รายงานกะผ่านหน้าต่างพิมพ์ของเบราว์เซอร์ */
export function printShiftReport(shift: Shift, settings: Settings, summary?: ShiftSummary) {
  const el = document.getElementById('print-area')
  if (!el) return
  el.innerHTML = buildShiftReportHtml(shift, settings, summary)
  // รอให้เบราว์เซอร์วาดเสร็จก่อนสั่งพิมพ์
  setTimeout(() => window.print(), 60)
}
