import type { PaymentMethod, Settings } from '../db/types'
import { fmtDate, fmtDateTime, money } from './format'
import { PAY_LABEL, esc, logoImg, slipStyle } from './receipt'

/* ===== สรุปปิดยอดรายวัน — สร้าง HTML สำหรับพิมพ์ (แพทเทิร์นเดียวกับ receipt.ts) ===== */

export interface DailyCloseSummary {
  /** เที่ยงคืน (local) ของวันที่ปิดยอด */
  date: number
  /** จำนวนบิลขาย (ไม่นับเอกสารคืนสินค้า) */
  billCount: number
  /** ยอดขายสุทธิ (หักเอกสารคืนสินค้าแล้ว) */
  salesTotal: number
  /**
   * ยอดแยกช่องทาง — คำนวณจาก saleAmountByMethod() ที่ฝั่ง DailyCloseTab
   * (หักเงินทอนจากเงินสด, รองรับบิลจ่ายผสม, เอกสารคืนหักออกเองเพราะติดลบ)
   * count = จำนวนบิลขายที่มีก้อนชำระของช่องทางนั้น (บิลจ่ายผสมนับทุกช่องทางที่ใช้)
   */
  byMethod: Record<PaymentMethod, { count: number; total: number }>
  voidedCount: number
  voidedTotal: number
  /** จำนวนเอกสารคืนสินค้าของวันนั้น */
  refundCount: number
  /** ยอดคืนสินค้ารวม (ค่าบวก — ถูกหักออกจากยอดขายสุทธิแล้ว) */
  refundTotal: number
  /** จำนวนบิลที่จ่ายผสมหลายช่องทาง (ใช้เตือนว่าจำนวนบิลแยกช่องทางรวมกันเกินจำนวนบิล) */
  mixedCount: number
  expenseCount: number
  expenseTotal: number
  expenseCash: number
  /**
   * เงินที่ "นำเข้า" ลิ้นชักระหว่างวัน (รวม cashMoves ของทุกกะที่เปิดวันนั้น)
   * ร้านที่ไม่ได้ใช้ระบบกะจะไม่มีกะเลย → 0
   */
  cashIn: number
  /** เงินที่ "นำออก" จากลิ้นชักระหว่างวัน (เช่น ถอนไปฝากธนาคาร) — ค่าบวกเสมอ */
  cashOut: number
  /**
   * เงินสดรับสุทธิของ "ทั้งวัน"
   * = ขายเงินสด (หักคืนเงินสด/เงินทอนแล้ว) − รายจ่ายเงินสด + นำเข้าลิ้นชัก − นำออกจากลิ้นชัก
   *
   * ตั้งใจให้ต่างจาก expectedCash ของรายงานปิดกะ:
   * - ปิดยอดรายวัน = ทั้งวัน (อาจครอบหลายกะ) จึง **ไม่รวมเงินทอนตั้งต้น** ของกะใดกะหนึ่ง
   * - ปิดกะ = เฉพาะกะนั้น และ **รวมเงินทอนตั้งต้น** เพราะต้องเอาไปเทียบกับเงินที่นับได้ในลิ้นชักจริง
   */
  cashNet: number
}

// esc / logoImg ใช้ตัวเดียวกับใบเสร็จ (หนี " และ ' ด้วย และรับเฉพาะโลโก้ที่เป็น data:image/)

const row = (left: string, right: string, cls = '') =>
  `<div class="rr ${cls}"><span>${left}</span><span>${right}</span></div>`

const hr = () => '<div class="hr"></div>'

/** ใส่เครื่องหมายเฉพาะเมื่อมียอดจริง (กันพิมพ์ "-0.00") */
const minus = (n: number) => (n > 0 ? `-${money(n)}` : money(n))
const plus = (n: number) => (n > 0 ? `+${money(n)}` : money(n))

/**
 * ที่มาของ "เงินสดสุทธิที่ควรมีในลิ้นชัก" — ใช้ร่วมกันทั้งบนหน้าจอและใบพิมพ์
 * เพื่อให้ข้อความอธิบายตรงกับสูตรที่คำนวณจริงเสมอ
 */
export function cashNetFormula(sum: DailyCloseSummary): string {
  const parts = [
    `ขายเงินสด${sum.refundCount > 0 ? ' (หลังหักคืนเงินสด)' : ''} ${money(sum.byMethod.cash.total)}`,
    `− รายจ่ายเงินสด ${money(sum.expenseCash)}`,
  ]
  if (sum.cashIn > 0) parts.push(`+ นำเข้าลิ้นชัก ${money(sum.cashIn)}`)
  if (sum.cashOut > 0) parts.push(`− นำออกจากลิ้นชัก ${money(sum.cashOut)}`)
  return parts.join(' ')
}

export function buildDailyReportHtml(sum: DailyCloseSummary, settings: Settings): string {
  const base = settings.receiptWidth === '58' ? 10.5 : 12 // ขนาดฟอนต์ (px)

  const methodRows = (['cash', 'transfer', 'card'] as const)
    .map((k) =>
      row(
        `&nbsp;&nbsp;${PAY_LABEL[k]} (${sum.byMethod[k].count} บิล)`,
        money(sum.byMethod[k].total),
      ),
    )
    .join('')

  return `
<style>${slipStyle(settings, base)}</style>
<div>
  ${logoImg(settings)}
  <div class="c b lg">${esc(settings.shopName)}</div>
  ${settings.branch ? `<div class="c sm">${esc(settings.branch)}</div>` : ''}
  ${settings.address ? `<div class="c sm">${esc(settings.address)}</div>` : ''}
  ${settings.phone ? `<div class="c sm">โทร. ${esc(settings.phone)}</div>` : ''}
  ${settings.taxId ? `<div class="c sm">เลขประจำตัวผู้เสียภาษี ${esc(settings.taxId)}</div>` : ''}
  ${hr()}
  <div class="c b">สรุปปิดยอดรายวัน</div>
  ${row('ประจำวันที่', fmtDate(sum.date), 'sm')}
  ${row('พิมพ์เมื่อ', fmtDateTime(Date.now()), 'sm')}
  ${hr()}
  ${row(
    `ยอดขาย${sum.refundCount > 0 ? 'สุทธิ' : 'รวม'} (${sum.billCount} บิล)`,
    money(sum.salesTotal),
    'b',
  )}
  ${methodRows}
  ${
    sum.mixedCount > 0
      ? `<div class="sm">* มีบิลจ่ายผสม ${sum.mixedCount} บิล — จำนวนบิลแยกช่องทางนับตามก้อนที่จ่าย</div>`
      : ''
  }
  ${hr()}
  ${
    sum.refundCount > 0
      ? row(`คืนสินค้า (${sum.refundCount} รายการ)`, `-${money(sum.refundTotal)}`) +
        `<div class="dim">(หักออกจากยอดขายสุทธิและยอดแยกช่องทางแล้ว)</div>`
      : ''
  }
  ${row(`บิลยกเลิก (${sum.voidedCount} บิล)`, money(sum.voidedTotal))}
  ${hr()}
  ${row(`รายจ่ายรวม (${sum.expenseCount} รายการ)`, money(sum.expenseTotal), 'b')}
  ${row('&nbsp;&nbsp;จ่ายเงินสด', money(sum.expenseCash))}
  ${row('&nbsp;&nbsp;จ่ายโอน / บัตร', money(sum.expenseTotal - sum.expenseCash))}
  ${
    // แสดงเฉพาะเมื่อมีการนำเงินเข้า/ออกลิ้นชักจริง (ร้านที่ไม่ใช้ระบบกะจะไม่มีบล็อกนี้)
    sum.cashIn > 0 || sum.cashOut > 0
      ? hr() +
        row('นำเงินเข้าลิ้นชัก', plus(sum.cashIn)) +
        row('นำเงินออกจากลิ้นชัก', minus(sum.cashOut)) +
        `<div class="dim">(รวมรายการเข้า-ออกลิ้นชักของทุกกะที่เปิดในวันนี้)</div>`
      : ''
  }
  ${hr()}
  ${row('เงินสดสุทธิที่ควรมีในลิ้นชัก', money(sum.cashNet), 'b lg')}
  <div class="dim">(${cashNetFormula(sum)})</div>
  <div class="sm">* ยอดเงินสดหักเงินทอนที่จ่ายลูกค้าแล้ว</div>
  <div class="sm">* ยอดนี้คือ “เงินสดรับสุทธิของทั้งวัน” จึงไม่รวมเงินทอนตั้งต้นของกะ — ถ้าต้องการยอดที่ต้องมีในลิ้นชักจริงต่อกะ (รวมเงินทอนตั้งต้น) ให้ดูรายงานปิดกะ</div>
  ${hr()}
  ${settings.receiptFooter ? `<div class="c sm">${esc(settings.receiptFooter)}</div>` : ''}
</div>`
}

/** พิมพ์สรุปปิดยอดผ่านหน้าต่างพิมพ์ของเบราว์เซอร์ */
export function printDailyReport(sum: DailyCloseSummary, settings: Settings) {
  const el = document.getElementById('print-area')
  if (!el) return
  el.innerHTML = buildDailyReportHtml(sum, settings)
  // รอให้เบราว์เซอร์วาดเสร็จก่อนสั่งพิมพ์
  setTimeout(() => window.print(), 60)
}
