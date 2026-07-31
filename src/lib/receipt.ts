import type { Sale, Settings } from '../db/types'
import { fmtDateTime, money } from './format'

/**
 * หนีอักขระพิเศษของ HTML (ข้อมูลทุกช่องมาจากผู้ใช้ ต้อง escape ทั้งหมด)
 * ต้องหนี " และ ' ด้วย เพราะบางค่าถูกแทรกลงใน HTML attribute (เช่น src="...")
 * ถ้าไม่หนี ค่าที่มีเครื่องหมายคำพูดจะปิด attribute แล้วแทรก attribute อื่นเข้ามาได้
 */
export const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/**
 * โลโก้ที่ปลอดภัยพอจะใส่ใน src="..." — ต้องเป็น dataURL ของรูปภาพเท่านั้น
 * (ระบบย่อรูปที่ผู้ใช้อัปโหลดเป็น data:image/... อยู่แล้ว) ค่าอื่นเช่น javascript: หรือ URL
 * ภายนอกให้ทิ้งไป ไม่แสดงรูป
 */
export const safeLogoSrc = (logo: string | undefined): string | undefined =>
  logo && logo.startsWith('data:image/') ? logo : undefined

/** แท็กรูปโลโก้ที่ปลอดภัยสำหรับเอกสารสลิปทุกชนิด (คืนสตริงว่างถ้าไม่มี/ไม่ปลอดภัย) */
export const logoImg = (settings: Settings, cls = 'logo'): string => {
  const src = safeLogoSrc(settings.logo)
  return src ? `<img class="${cls}" src="${esc(src)}" />` : ''
}

const row = (left: string, right: string, cls = '') =>
  `<div class="rr ${cls}"><span>${left}</span><span>${right}</span></div>`

const hr = () => '<div class="hr"></div>'

/** จำนวนแบบแสดงผล (รองรับสินค้าชั่งน้ำหนัก เช่น 0.5) */
const fmtQty = (n: number) =>
  Math.abs(n).toLocaleString('th-TH', { maximumFractionDigits: 3 })

export const PAY_LABEL: Record<Sale['paymentMethod'], string> = {
  cash: 'เงินสด',
  transfer: 'โอน / QR',
  card: 'บัตร',
}

/** สไตล์ร่วมของเอกสารสลิปทั้งหมด (ใบเสร็จ / ใบคืนสินค้า / สลิปครัว / สรุปปิดยอด) */
export function slipStyle(settings: Settings, base: number): string {
  const w = settings.receiptWidth === '58' ? 48 : 72
  return `
  @page { size: ${settings.receiptWidth}mm auto; margin: 0; }
  #print-area { width: ${w}mm; margin: 0 auto; font-family: 'Noto Sans Thai Variable', sans-serif;
    font-size: ${base}px; color: #000; line-height: 1.45; }
  #print-area .c { text-align: center; }
  #print-area .b { font-weight: 700; }
  #print-area .lg { font-size: ${base + 3}px; }
  #print-area .xl { font-size: ${base + 14}px; font-weight: 700; line-height: 1.2; }
  #print-area .sm { font-size: ${base - 1.5}px; }
  #print-area .dim { color: #333; font-size: ${base - 1}px; }
  #print-area .rr { display: flex; justify-content: space-between; gap: 8px; }
  #print-area .hr { border-top: 1px dashed #000; margin: 4px 0; }
  #print-area .box { border: 1.5px solid #000; padding: 3px 6px; margin: 4px 0; }
  #print-area .it { margin-bottom: 2px; }
  #print-area .op { font-size: ${base - 1.5}px; color: #333; }
  #print-area .logo { max-width: 18mm; margin: 0 auto 4px; display: block; }`
}

/** หัวเอกสาร: โลโก้ + ข้อมูลร้าน */
function shopHeader(settings: Settings): string {
  const logoSrc = safeLogoSrc(settings.logo)
  return `
  ${logoSrc ? `<img class="logo" src="${esc(logoSrc)}" />` : ''}
  <div class="c b lg">${esc(settings.shopName)}</div>
  ${settings.branch ? `<div class="c sm">${esc(settings.branch)}</div>` : ''}
  ${settings.address ? `<div class="c sm">${esc(settings.address)}</div>` : ''}
  ${settings.phone ? `<div class="c sm">โทร. ${esc(settings.phone)}</div>` : ''}
  ${settings.taxId ? `<div class="c sm">เลขประจำตัวผู้เสียภาษี ${esc(settings.taxId)}</div>` : ''}`
}

export function buildReceiptHtml(sale: Sale, settings: Settings, opts?: { copy?: boolean }): string {
  const base = settings.receiptWidth === '58' ? 10.5 : 12
  const isRefund = sale.kind === 'refund'

  let itemsHtml = ''
  for (const it of sale.items) {
    const optLine = [...(it.options ?? []), it.note].filter(Boolean).join(', ')
    const unit = it.unitName ? ` [${esc(it.unitName)}]` : ''
    itemsHtml += `<div class="it">
      <div class="nm">${esc(it.name)}${unit}${optLine ? `<span class="op"> (${esc(optLine)})</span>` : ''}</div>
      ${row(`&nbsp;&nbsp;${fmtQty(it.qty)} x ${money(it.price)}`, money(Math.abs(it.price * it.qty)))}
      ${Math.abs(it.manualDiscount) > 0 ? row('&nbsp;&nbsp;ส่วนลด', `-${money(Math.abs(it.manualDiscount))}`, 'dim') : ''}
      ${Math.abs(it.promoDiscount) > 0 ? row('&nbsp;&nbsp;ส่วนลดโปรโมชัน', `-${money(Math.abs(it.promoDiscount))}`, 'dim') : ''}
    </div>`
  }

  const qtyTotal = sale.items.reduce((s, it) => s + Math.abs(it.qty), 0)
  const vatLabel = sale.vatIncluded
    ? `ภาษีมูลค่าเพิ่ม ${sale.vatRate}% (รวมในราคา)`
    : `ภาษีมูลค่าเพิ่ม ${sale.vatRate}%`

  // การชำระเงิน: รองรับหลายก้อน (บิลเก่าที่ไม่มี payments[] ใช้ช่องทางเดียว)
  const payments =
    sale.payments && sale.payments.length > 0
      ? sale.payments
      : [{ method: sale.paymentMethod, amount: sale.received }]
  const payHtml = payments
    .map((p) => row(PAY_LABEL[p.method], money(Math.abs(p.amount))))
    .join('')

  const docTitle = isRefund
    ? 'ใบคืนสินค้า / คืนเงิน'
    : `ใบเสร็จรับเงิน (อย่างย่อ)${opts?.copy ? ' — สำเนา' : ''}`

  return `
<style>${slipStyle(settings, base)}</style>
<div>
  ${shopHeader(settings)}
  ${hr()}
  <div class="c b">${docTitle}</div>
  ${row('เลขที่', esc(sale.receiptNo), 'sm')}
  ${row('วันที่', fmtDateTime(sale.createdAt), 'sm')}
  ${isRefund && sale.refOriginalNo ? row('อ้างอิงบิล', esc(sale.refOriginalNo), 'sm') : ''}
  ${isRefund && sale.refundReason ? `<div class="sm">เหตุผล: ${esc(sale.refundReason)}</div>` : ''}
  ${sale.staffName ? row('พนักงาน', esc(sale.staffName), 'sm') : ''}
  ${sale.memberName ? row('สมาชิก', esc(sale.memberName), 'sm') : ''}
  ${
    sale.queueNo != null && !isRefund
      ? `<div class="box c"><div class="sm">หมายเลขคิว</div><div class="xl">${sale.queueNo}</div></div>`
      : ''
  }
  ${hr()}
  ${itemsHtml}
  ${hr()}
  ${row(`รวม ${fmtQty(qtyTotal)} ชิ้น`, '', 'sm')}
  ${row('ยอดรวม', money(Math.abs(sale.subtotal)))}
  ${Math.abs(sale.itemDiscount) > 0 ? row('ส่วนลดรายการ', `-${money(Math.abs(sale.itemDiscount))}`) : ''}
  ${Math.abs(sale.promoDiscount) > 0 ? row('ส่วนลดโปรโมชัน', `-${money(Math.abs(sale.promoDiscount))}`) : ''}
  ${
    Math.abs(sale.couponDiscount ?? 0) > 0
      ? row(`คูปอง ${esc(sale.couponCode ?? '')}`, `-${money(Math.abs(sale.couponDiscount))}`)
      : ''
  }
  ${Math.abs(sale.billDiscount) > 0 ? row('ส่วนลดท้ายบิล', `-${money(Math.abs(sale.billDiscount))}`) : ''}
  ${
    Math.abs(sale.pointDiscount) > 0
      ? row(`แลกแต้ม (${Math.abs(sale.redeemedPoints)} แต้ม)`, `-${money(Math.abs(sale.pointDiscount))}`)
      : ''
  }
  ${row(isRefund ? 'ยอดคืนเงิน' : 'ยอดสุทธิ', money(Math.abs(sale.total)), 'b lg')}
  ${sale.vatRate > 0 ? row(vatLabel, money(Math.abs(sale.vatAmount)), 'sm') : ''}
  ${hr()}
  ${payHtml}
  ${!isRefund && sale.change > 0 ? row('เงินทอน', money(sale.change)) : ''}
  ${
    sale.memberId != null
      ? `${hr()}${row(
          isRefund ? 'แต้มที่หักคืน' : 'แต้มที่ได้รับ',
          `${isRefund ? '-' : '+'}${Math.abs(sale.earnedPoints)}`,
          'sm',
        )}`
      : ''
  }
  ${sale.appliedPromos.length ? `<div class="sm">โปรที่ใช้: ${esc(sale.appliedPromos.join(', '))}</div>` : ''}
  ${
    sale.taxInvoiceNo
      ? row('ออกใบกำกับภาษีเลขที่', esc(sale.taxInvoiceNo), 'sm')
      : ''
  }
  ${hr()}
  ${settings.receiptFooter ? `<div class="c sm">${esc(settings.receiptFooter)}</div>` : ''}
  ${sale.status === 'voided' ? '<div class="c b lg">*** ยกเลิกแล้ว ***</div>' : ''}
</div>`
}

/** สลิปครัว/บาร์: เฉพาะรายการ + ตัวเลือก + โน้ต (ไม่มีราคา) */
export function buildKitchenSlipHtml(sale: Sale, settings: Settings): string {
  const base = settings.receiptWidth === '58' ? 11 : 13

  const itemsHtml = sale.items
    .map((it) => {
      const optLine = [...(it.options ?? []), it.note].filter(Boolean).join(', ')
      const unit = it.unitName ? ` [${esc(it.unitName)}]` : ''
      return `<div class="it b lg">${fmtQty(it.qty)} x ${esc(it.name)}${unit}
        ${optLine ? `<div class="op">&nbsp;&nbsp;• ${esc(optLine)}</div>` : ''}</div>`
    })
    .join('')

  return `
<style>${slipStyle(settings, base)}</style>
<div>
  <div class="c b lg">** ออเดอร์ครัว/บาร์ **</div>
  ${
    sale.queueNo != null
      ? `<div class="box c"><div class="sm">คิวที่</div><div class="xl">${sale.queueNo}</div></div>`
      : ''
  }
  ${row('บิล', esc(sale.receiptNo), 'sm')}
  ${row('เวลา', fmtDateTime(sale.createdAt), 'sm')}
  ${sale.memberName ? row('ลูกค้า', esc(sale.memberName), 'sm') : ''}
  ${hr()}
  ${itemsHtml}
  ${hr()}
  <div class="c sm">รวม ${fmtQty(sale.items.reduce((s, it) => s + Math.abs(it.qty), 0))} รายการ</div>
</div>`
}

/** ส่งเอกสารเข้าพื้นที่พิมพ์แล้วสั่งพิมพ์ */
function printHtml(html: string) {
  const el = document.getElementById('print-area')
  if (!el) return
  el.innerHTML = html
  // รอให้เบราว์เซอร์วาดเสร็จก่อนสั่งพิมพ์
  setTimeout(() => window.print(), 60)
}

/** พิมพ์ใบเสร็จ / ใบคืนสินค้า ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์ */
export function printReceipt(sale: Sale, settings: Settings, opts?: { copy?: boolean }) {
  printHtml(buildReceiptHtml(sale, settings, opts))
}

/** พิมพ์สลิปครัว/บาร์ */
export function printKitchenSlip(sale: Sale, settings: Settings) {
  printHtml(buildKitchenSlipHtml(sale, settings))
}
