import type { PaymentMethod, Settings } from '../db/types'
import { fmtDate, fmtDateTime, money } from './format'
import { PAY_LABEL } from './receipt'

/* ===== สรุปปิดยอดรายวัน — สร้าง HTML สำหรับพิมพ์ (แพทเทิร์นเดียวกับ receipt.ts) ===== */

export interface DailyCloseSummary {
  /** เที่ยงคืน (local) ของวันที่ปิดยอด */
  date: number
  billCount: number
  salesTotal: number
  byMethod: Record<PaymentMethod, { count: number; total: number }>
  voidedCount: number
  voidedTotal: number
  expenseCount: number
  expenseTotal: number
  expenseCash: number
  /** ขายเงินสด − รายจ่ายเงินสด (ไม่รวมเงินทอนตั้งต้น) */
  cashNet: number
}

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const row = (left: string, right: string, cls = '') =>
  `<div class="rr ${cls}"><span>${left}</span><span>${right}</span></div>`

const hr = () => '<div class="hr"></div>'

export function buildDailyReportHtml(sum: DailyCloseSummary, settings: Settings): string {
  const w = settings.receiptWidth === '58' ? 48 : 72 // ความกว้างพื้นที่พิมพ์ (มม.)
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
<style>
  @page { size: ${settings.receiptWidth}mm auto; margin: 0; }
  #print-area { width: ${w}mm; margin: 0 auto; font-family: 'Noto Sans Thai Variable', sans-serif;
    font-size: ${base}px; color: #000; line-height: 1.45; }
  #print-area .c { text-align: center; }
  #print-area .b { font-weight: 700; }
  #print-area .lg { font-size: ${base + 3}px; }
  #print-area .sm { font-size: ${base - 1.5}px; }
  #print-area .dim { color: #333; font-size: ${base - 1}px; }
  #print-area .rr { display: flex; justify-content: space-between; gap: 8px; }
  #print-area .hr { border-top: 1px dashed #000; margin: 4px 0; }
  #print-area .logo { max-width: 18mm; margin: 0 auto 4px; display: block; }
</style>
<div>
  ${settings.logo ? `<img class="logo" src="${settings.logo}" />` : ''}
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
  ${row(`ยอดขายรวม (${sum.billCount} บิล)`, money(sum.salesTotal), 'b')}
  ${methodRows}
  ${hr()}
  ${row(`บิลยกเลิก (${sum.voidedCount} บิล)`, money(sum.voidedTotal))}
  ${hr()}
  ${row(`รายจ่ายรวม (${sum.expenseCount} รายการ)`, money(sum.expenseTotal), 'b')}
  ${row('&nbsp;&nbsp;จ่ายเงินสด', money(sum.expenseCash))}
  ${row('&nbsp;&nbsp;จ่ายโอน / บัตร', money(sum.expenseTotal - sum.expenseCash))}
  ${hr()}
  ${row('เงินสดสุทธิที่ควรมีในลิ้นชัก', money(sum.cashNet), 'b lg')}
  <div class="dim">(ขายเงินสด ${money(sum.byMethod.cash.total)} − รายจ่ายเงินสด ${money(sum.expenseCash)})</div>
  <div class="sm">* ไม่รวมเงินทอนตั้งต้นในลิ้นชัก</div>
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
