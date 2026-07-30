import type { Sale, Settings } from '../db/types'
import { fmtDateTime, money } from './format'

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const row = (left: string, right: string, cls = '') =>
  `<div class="rr ${cls}"><span>${left}</span><span>${right}</span></div>`

const hr = () => '<div class="hr"></div>'

export const PAY_LABEL: Record<Sale['paymentMethod'], string> = {
  cash: 'เงินสด',
  transfer: 'โอน / QR',
  card: 'บัตร',
}

export function buildReceiptHtml(sale: Sale, settings: Settings, opts?: { copy?: boolean }): string {
  const w = settings.receiptWidth === '58' ? 48 : 72 // ความกว้างพื้นที่พิมพ์ (มม.)
  const base = settings.receiptWidth === '58' ? 10.5 : 12 // ขนาดฟอนต์ (px)

  let itemsHtml = ''
  for (const it of sale.items) {
    const optLine = [...(it.options ?? []), it.note].filter(Boolean).join(', ')
    itemsHtml += `<div class="it">
      <div class="nm">${esc(it.name)}${optLine ? `<span class="op"> (${esc(optLine)})</span>` : ''}</div>
      ${row(`&nbsp;&nbsp;${it.qty} x ${money(it.price)}`, money(it.price * it.qty))}
      ${it.manualDiscount > 0 ? row('&nbsp;&nbsp;ส่วนลด', `-${money(it.manualDiscount)}`, 'dim') : ''}
      ${it.promoDiscount > 0 ? row('&nbsp;&nbsp;ส่วนลดโปรโมชัน', `-${money(it.promoDiscount)}`, 'dim') : ''}
    </div>`
  }

  const qtyTotal = sale.items.reduce((s, it) => s + it.qty, 0)
  const vatLabel = sale.vatIncluded
    ? `ภาษีมูลค่าเพิ่ม ${sale.vatRate}% (รวมในราคา)`
    : `ภาษีมูลค่าเพิ่ม ${sale.vatRate}%`

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
  #print-area .it { margin-bottom: 2px; }
  #print-area .op { font-size: ${base - 1.5}px; color: #333; }
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
  <div class="c b">ใบเสร็จรับเงิน (อย่างย่อ)${opts?.copy ? ' — สำเนา' : ''}</div>
  ${row('เลขที่', esc(sale.receiptNo), 'sm')}
  ${row('วันที่', fmtDateTime(sale.createdAt), 'sm')}
  ${sale.memberName ? row('สมาชิก', esc(sale.memberName), 'sm') : ''}
  ${hr()}
  ${itemsHtml}
  ${hr()}
  ${row(`รวม ${qtyTotal} ชิ้น`, '', 'sm')}
  ${row('ยอดรวม', money(sale.subtotal))}
  ${sale.itemDiscount > 0 ? row('ส่วนลดรายการ', `-${money(sale.itemDiscount)}`) : ''}
  ${sale.promoDiscount > 0 ? row('ส่วนลดโปรโมชัน', `-${money(sale.promoDiscount)}`) : ''}
  ${sale.billDiscount > 0 ? row('ส่วนลดท้ายบิล', `-${money(sale.billDiscount)}`) : ''}
  ${sale.pointDiscount > 0 ? row(`แลกแต้ม (${sale.redeemedPoints} แต้ม)`, `-${money(sale.pointDiscount)}`) : ''}
  ${row('ยอดสุทธิ', money(sale.total), 'b lg')}
  ${sale.vatRate > 0 ? row(vatLabel, money(sale.vatAmount), 'sm') : ''}
  ${hr()}
  ${row(PAY_LABEL[sale.paymentMethod], money(sale.received))}
  ${sale.paymentMethod === 'cash' ? row('เงินทอน', money(sale.change)) : ''}
  ${sale.memberId != null ? `${hr()}${row('แต้มที่ได้รับ', `+${sale.earnedPoints}`, 'sm')}` : ''}
  ${sale.appliedPromos.length ? `<div class="sm">โปรที่ใช้: ${esc(sale.appliedPromos.join(', '))}</div>` : ''}
  ${hr()}
  ${settings.receiptFooter ? `<div class="c sm">${esc(settings.receiptFooter)}</div>` : ''}
  ${sale.status === 'voided' ? '<div class="c b lg">*** ยกเลิกแล้ว ***</div>' : ''}
</div>`
}

/** พิมพ์ใบเสร็จผ่านหน้าต่างพิมพ์ของเบราว์เซอร์ */
export function printReceipt(sale: Sale, settings: Settings, opts?: { copy?: boolean }) {
  const el = document.getElementById('print-area')
  if (!el) return
  el.innerHTML = buildReceiptHtml(sale, settings, opts)
  // รอให้เบราว์เซอร์วาดเสร็จก่อนสั่งพิมพ์
  setTimeout(() => window.print(), 60)
}
