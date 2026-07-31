import type { Sale, SaleItem, Settings, TaxInvoice } from '../db/types'
import { fmtDate, fmtDateTime, money, r2 } from './format'
import { bahtText } from './bahtText'
import { HEAD_OFFICE } from './taxInvoice'

/* =========================================================
   เอกสารใบกำกับภาษีเต็มรูป (ม.86/4) / ใบลดหนี้ (ม.86/10) ขนาด A4
   - สร้างเป็นสตริง HTML แล้วยัดลง #print-area (เหมือนสลิปใน receipt.ts)
     แต่มี <style> ของตัวเองเพราะเป็นกระดาษ A4 ไม่ใช่สลิป 58/80 มม.
   - องค์ประกอบตาม ม.86/4 ครบ 8 ข้อ ดูคอมเมนต์ [86/4-x] ในฟังก์ชัน buildTaxInvoiceHtml
   ========================================================= */

/**
 * หนีอักขระพิเศษของ HTML (ข้อมูลทุกช่องมาจากผู้ใช้ ต้อง escape ทั้งหมด)
 * ต้องหนี " และ ' ด้วย เพราะบางค่าถูกแทรกลงใน HTML attribute (เช่น src="...")
 * ถ้าไม่หนี ค่าที่มีเครื่องหมายคำพูดจะปิด attribute แล้วแทรก attribute อื่นเข้ามาได้
 */
const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/** escape + แปลงบรรทัดใหม่เป็น <br> (ที่อยู่กรอกหลายบรรทัดได้) */
const escLines = (s: string) => esc(s).replaceAll('\n', '<br />')

/**
 * โลโก้ที่ปลอดภัยพอจะใส่ใน src="..." — ต้องเป็น dataURL ของรูปภาพเท่านั้น
 * (ระบบย่อรูปที่ผู้ใช้อัปโหลดเป็น data:image/... อยู่แล้ว) ค่าอื่นเช่น javascript: หรือ URL
 * ภายนอกให้ทิ้งไป ไม่แสดงรูป
 */
const safeLogoSrc = (logo: string | undefined): string | undefined =>
  logo && logo.startsWith('data:image/') ? logo : undefined

/** จำนวนแบบแสดงผล (รองรับสินค้าชั่งน้ำหนัก เช่น 0.5) */
const fmtQty = (n: number) => Math.abs(n).toLocaleString('th-TH', { maximumFractionDigits: 3 })

/** ป้ายสาขาของผู้ขาย/ผู้ซื้อ (ว่าง = สำนักงานใหญ่) */
const branchLabel = (v: string | undefined) => (v && v.trim() ? v.trim() : HEAD_OFFICE)

/** สไตล์เอกสาร A4 — เส้นตารางทึบ 1px ตามแบบใบกำกับภาษีทั่วไป */
function docStyle(): string {
  return `
  @page { size: A4; margin: 10mm; }
  #print-area { width: 190mm; margin: 0 auto; font-family: 'Noto Sans Thai Variable', sans-serif;
    font-size: 11.5px; color: #000; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #print-area * { box-sizing: border-box; }
  #print-area table { width: 100%; border-collapse: collapse; }
  #print-area .b { font-weight: 700; }
  #print-area .c { text-align: center; }
  #print-area .r { text-align: right; }
  #print-area .sm { font-size: 10px; }
  #print-area .dim { color: #333; }

  /* ---- หัวเอกสาร: ข้อมูลร้าน (ซ้าย) + ชื่อเอกสาร/ต้นฉบับ-สำเนา (ขวา) ---- */
  #print-area .ti-head { display: flex; align-items: flex-start; justify-content: space-between;
    gap: 8mm; padding-bottom: 2mm; border-bottom: 2px solid #000; }
  #print-area .ti-brand { display: flex; align-items: flex-start; gap: 4mm; flex: 1 1 auto;
    min-width: 0; }
  #print-area .ti-logo { max-width: 20mm; max-height: 20mm; }
  #print-area .ti-shop { font-size: 15px; font-weight: 700; line-height: 1.3; }
  #print-area .ti-title { text-align: right; flex: 0 0 auto; }
  #print-area .ti-title .t1 { font-size: 21px; font-weight: 700; line-height: 1.2; }
  #print-area .ti-title .t2 { font-size: 10px; }
  #print-area .ti-copy { display: inline-block; margin-top: 1.5mm; border: 1px solid #000;
    padding: 0.6mm 2.5mm; font-size: 11px; font-weight: 700; }

  /* ---- กล่องผู้ขาย / ผู้ซื้อ (2 คอลัมน์) ---- */
  #print-area .party { margin-top: 3mm; }
  #print-area .party > tbody > tr > td { width: 50%; border: 1px solid #000; padding: 0;
    vertical-align: top; }
  #print-area .party .ptitle { background: #eeeeee; border-bottom: 1px solid #000;
    padding: 1mm 2.5mm; font-weight: 700; }
  #print-area .party .pbody { padding: 1.5mm 2.5mm; }
  #print-area .kv { display: flex; gap: 2mm; }
  #print-area .kv .k { flex: 0 0 24mm; color: #333; }
  #print-area .kv .v { flex: 1 1 auto; }

  /* ---- ตารางข้อมูลเอกสาร (เลขที่ / วันที่ / อ้างอิง) ---- */
  #print-area .meta { margin-top: 3mm; }
  #print-area .meta td { border: 1px solid #000; padding: 1.2mm 2.5mm; }
  #print-area .meta .mk { background: #eeeeee; font-weight: 700; width: 32mm; white-space: nowrap; }

  /* ---- กล่องอ้างอิงใบกำกับภาษีเดิม (ใบลดหนี้) ----
     ป้ายในกล่องนี้ยาวกว่ากล่องผู้ขาย/ผู้ซื้อ (ม.86/10(5)) จึงขยายคอลัมน์ป้ายเฉพาะที่นี่ */
  #print-area .cn { margin-top: 3mm; border: 1px solid #000; padding: 1.5mm 2.5mm; }
  #print-area .cn .kv .k { flex: 0 0 64mm; }
  #print-area .cn .amt { display: inline-block; min-width: 30mm; text-align: right; }

  /* ---- ตารางรายการสินค้า ---- */
  #print-area .items { margin-top: 3mm; }
  #print-area .items th, #print-area .items td { border: 1px solid #000; padding: 1.2mm 2mm;
    vertical-align: top; }
  #print-area .items th { background: #eeeeee; font-weight: 700; text-align: center; }
  #print-area .items .op { font-size: 10px; color: #333; }
  #print-area .items .dc { font-size: 10px; }

  /* ---- ท้ายตาราง: ตัวอักษร (ซ้าย) + สรุปยอดแยก VAT (ขวา) ---- */
  #print-area .sum { border-top: 0; }
  #print-area .sum > tbody > tr > td { border: 1px solid #000; border-top: 0; padding: 2mm 2.5mm;
    vertical-align: top; }
  #print-area .sum .lft { width: 58%; }
  #print-area .bt { border: 1px solid #000; padding: 1.2mm 2.5mm; font-weight: 700;
    text-align: center; }
  #print-area .tot td { border: 0; padding: 0.6mm 0; }
  #print-area .tot .lb { color: #000; }
  #print-area .tot .vl { text-align: right; white-space: nowrap; width: 32mm; }
  #print-area .tot .grand td { border-top: 1px solid #000; border-bottom: 3px double #000;
    font-size: 13.5px; font-weight: 700; padding: 1.2mm 0; }

  /* ---- หมายเหตุ + ช่องเซ็น ---- */
  #print-area .note { margin-top: 3mm; font-size: 10.5px; }
  #print-area .sign { margin-top: 10mm; }
  #print-area .sign td { width: 50%; border: 0; padding: 0 8mm; text-align: center;
    vertical-align: bottom; }
  #print-area .sign .line { border-bottom: 1px dotted #000; height: 10mm; }
  #print-area .sign .nm { font-size: 10.5px; margin-top: 1mm; }
  #print-area .sign .lb2 { font-size: 10.5px; }
  #print-area .foot { margin-top: 4mm; display: flex; justify-content: space-between; gap: 6mm;
    font-size: 9.5px; color: #333; }

  /* ---- ตราประทับ "ยกเลิก" ทับกลางหน้า ---- */
  #print-area .void { position: fixed; top: 38%; left: 0; right: 0; text-align: center;
    transform: rotate(-25deg); opacity: .25; font-size: 80px; font-weight: 700; color: #000;
    letter-spacing: 8px; }`
}

/** แถว key–value ในกล่องผู้ขาย/ผู้ซื้อ */
const kv = (k: string, v: string) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`

/**
 * องค์ประกอบของใบลดหนี้ตาม ม.86/10(5) — ต้องแสดงครบ 4 อย่าง:
 *   (ก) มูลค่าของสินค้า/บริการ "ตามที่ลงไว้ในใบกำกับภาษีเดิม"  → inv.refNetAmount
 *   (ข) มูลค่า "ที่ถูกต้อง" ของสินค้า/บริการ                   → refNetAmount − netAmount
 *   (ค) "ผลต่าง" ของจำนวนเงินทั้งสองจำนวน                      → inv.netAmount (ยอดที่ลดลง)
 *   (ง) "ภาษีมูลค่าเพิ่มที่เรียกเก็บเกินไป"                     → inv.vatAmount
 * ทุกช่องเป็นมูลค่าก่อน VAT ตามที่กฎหมายกำหนด (ยอดในใบเก็บเป็นค่าบวกเสมอ)
 *
 * ใบลดหนี้ที่ออกก่อนมีฟิลด์ refNetAmount จะไม่มีข้อมูลใบเดิมให้เทียบ — ข้ามบล็อกนี้ไป
 * เพื่อให้ยังพิมพ์ซ้ำได้ตามปกติ (ไม่พัง)
 */
function creditNoteAmounts(inv: TaxInvoice): string {
  const refNet = inv.refNetAmount
  if (refNet == null) return ''
  const amt = (n: number) => `<span class="amt">${money(n)}</span>`
  return `
    ${kv('มูลค่าตามใบกำกับภาษีเดิม', amt(r2(refNet)))}
    ${kv('มูลค่าที่ถูกต้อง', amt(r2(refNet - inv.netAmount)))}
    ${kv('ผลต่าง (มูลค่าที่ลดลง)', amt(r2(inv.netAmount)))}
    ${kv('ภาษีมูลค่าเพิ่มที่เรียกเก็บเกินไป', amt(r2(inv.vatAmount)))}`
}

/** 1 บรรทัดในตารางรายการ (ใช้ Math.abs เพราะเอกสารคืนสินค้าเก็บค่าติดลบ) */
function itemRow(it: SaleItem, i: number): string {
  const optLine = [...(it.options ?? []), it.note].filter(Boolean).join(', ')
  const unit = it.unitName ? ` [${esc(it.unitName)}]` : ''
  const lineGross = Math.abs(it.price * it.qty)
  const disc = Math.abs(it.manualDiscount) + Math.abs(it.promoDiscount)
  return `<tr>
    <td class="c">${i + 1}</td>
    <td>
      ${esc(it.name)}${unit}
      ${optLine ? `<div class="op">${esc(optLine)}</div>` : ''}
      ${disc > 0 ? `<div class="dc">หักส่วนลด -${money(r2(disc))}</div>` : ''}
    </td>
    <td class="c">${fmtQty(it.qty)}</td>
    <td class="r">${money(Math.abs(it.price))}</td>
    <td class="r">${money(r2(lineGross))}</td>
  </tr>`
}

export function buildTaxInvoiceHtml(
  inv: TaxInvoice,
  sale: Sale,
  settings: Settings,
  opts?: { copy?: boolean },
): string {
  const isCredit = inv.kind === 'creditNote'

  /* [86/4-1] ชื่อเอกสาร — ใบลดหนี้ต้องมีคำว่า "ใบกำกับภาษี" กำกับด้วย */
  const title = isCredit ? 'ใบลดหนี้ / ใบกำกับภาษี' : 'ใบกำกับภาษี'
  const subTitle = isCredit ? 'ตามมาตรา 86/10' : 'แบบเต็มรูป ตามมาตรา 86/4'
  const copyLabel = opts?.copy ? 'สำเนา (ร้าน)' : 'ต้นฉบับ (ลูกค้า)'

  /* ---------- ยอดเงิน ----------
     ยอดในใบเก็บเป็นค่าบวกเสมอ (ทิศทางอยู่ที่ kind) จึงใช้ Math.abs กับข้อมูลบิลให้ตรงกัน
     - รวมรายการ (gross) = Σ ราคาต่อหน่วย × จำนวน = sale.subtotal
     - กรณี sale.vatIncluded = true ราคาสินค้า "รวม VAT อยู่แล้ว" ดังนั้น
       (รวมรายการ − ส่วนลด) = ยอดรวมทั้งสิ้น จึงต้องถอด VAT ออกมาแสดงเป็นมูลค่าสินค้า (net = total − vat)
     - กรณี vatIncluded = false ราคายังไม่รวม VAT ดังนั้น
       (รวมรายการ − ส่วนลด) = มูลค่าสินค้า แล้วจึงบวก VAT เป็นยอดรวมทั้งสิ้น
     ทั้งสองกรณี net/vat/total มาจาก taxInvoiceAmounts() ที่เก็บไว้ในใบแล้ว

     ส่วนลดบนใบต้อง "คำนวณย้อนกลับ" จากบรรทัดที่ต้องไปบรรจบ (payable) ห้ามบวกก้อนส่วนลดตรงๆ
     เพราะเอกสารคืนสินค้า (refundSale) เกลี่ยส่วนลดแต่ละก้อนด้วย ratio แล้วปัด 2 ตำแหน่ง "แยกก้อน"
     ผลรวมของก้อนที่ปัดแล้วจึงคลาดจาก (gross − payable) ได้ถึง ±0.01 บาท (พบ ~10% ของใบลดหนี้)
     ทำให้บรรทัดบนใบไล่ไม่ตรงกัน สรรพากร/ลูกค้าจะทักว่าเลขไม่ลงตัว */
  const gross = r2(Math.abs(sale.subtotal))
  const payable = sale.vatIncluded ? inv.total : inv.netAmount
  const discount = r2(gross - payable)
  const netLabel = sale.vatIncluded
    ? 'มูลค่าสินค้า/บริการ (ถอด VAT ออกจากราคาแล้ว)'
    : 'มูลค่าสินค้า/บริการ'

  /* บิลขายปกติจะได้ discount ≥ 0 เสมอ (ยอดสุทธิไม่มีทางเกินยอดรวมรายการ)
     เผื่อไว้เฉพาะเศษปัดของเอกสารคืน: ถ้าติดลบให้แสดงเป็นบรรทัดปรับปรุง ใบจะได้ยังไล่ตรง */
  const discountRow =
    discount > 0
      ? `<tr><td class="lb">หักส่วนลด</td><td class="vl">-${money(discount)}</td></tr>`
      : discount < 0
        ? `<tr><td class="lb">ปรับปรุงเศษสตางค์</td><td class="vl">+${money(-discount)}</td></tr>`
        : ''

  const totalsRows = `
    <tr><td class="lb">รวมเป็นเงิน</td><td class="vl">${money(gross)}</td></tr>
    ${discountRow}
    <tr><td class="lb">${netLabel}</td><td class="vl">${money(inv.netAmount)}</td></tr>
    <tr><td class="lb">ภาษีมูลค่าเพิ่ม ${inv.vatRate}%</td><td class="vl">${money(inv.vatAmount)}</td></tr>
    <tr class="grand"><td class="lb">จำนวนเงินรวมทั้งสิ้น</td><td class="vl">${money(inv.total)}</td></tr>`

  const notes = [settings.taxInvoiceNote?.trim(), inv.note?.trim()].filter(Boolean) as string[]
  const logoSrc = safeLogoSrc(settings.logo)

  return `
<style>${docStyle()}</style>
<div>
  ${
    /* ตราประทับยกเลิก (ต้องเก็บต้นฉบับที่ยกเลิกไว้เป็นหลักฐาน) */
    inv.cancelledAt != null ? '<div class="void">ยกเลิก</div>' : ''
  }

  <!-- ===== หัวเอกสาร: [86/4-2] ผู้ขาย + [86/4-1] ชื่อเอกสาร ===== -->
  <div class="ti-head">
    <div class="ti-brand">
      ${logoSrc ? `<img class="ti-logo" src="${esc(logoSrc)}" />` : ''}
      <div>
        <div class="ti-shop">${esc(settings.shopName)}</div>
        <div class="sm">${escLines(settings.address)}</div>
        <div class="sm">
          ${settings.phone ? `โทร. ${esc(settings.phone)}` : ''}
          ${settings.phone && settings.taxId ? ' · ' : ''}
          ${settings.taxId ? `เลขประจำตัวผู้เสียภาษี ${esc(settings.taxId)}` : ''}
        </div>
        <div class="sm b">${esc(branchLabel(settings.branchTaxCode))}</div>
      </div>
    </div>
    <div class="ti-title">
      <div class="t1">${esc(title)}</div>
      <div class="t2">${esc(subTitle)}</div>
      <div class="ti-copy">${esc(copyLabel)}</div>
    </div>
  </div>

  <!-- ===== กล่องผู้ขาย / ผู้ซื้อ: [86/4-2] และ [86/4-3] ===== -->
  <table class="party">
    <tbody>
      <tr>
        <td>
          <div class="ptitle">ผู้ขาย / ผู้ประกอบการจดทะเบียน</div>
          <div class="pbody">
            ${kv('ชื่อ', `<span class="b">${esc(settings.shopName)}</span>`)}
            ${kv('ที่อยู่', escLines(settings.address))}
            ${kv('เลขผู้เสียภาษี', esc(settings.taxId))}
            ${kv('สาขา', esc(branchLabel(settings.branchTaxCode)))}
            ${settings.phone ? kv('โทรศัพท์', esc(settings.phone)) : ''}
          </div>
        </td>
        <td>
          <div class="ptitle">ผู้ซื้อ / ลูกค้า</div>
          <div class="pbody">
            ${kv('ชื่อ', `<span class="b">${esc(inv.customer.name)}</span>`)}
            ${kv('ที่อยู่', escLines(inv.customer.address))}
            ${kv('เลขผู้เสียภาษี', esc(inv.customer.taxId))}
            ${kv('สาขา', esc(branchLabel(inv.customer.taxBranch)))}
            ${inv.customer.phone ? kv('โทรศัพท์', esc(inv.customer.phone)) : ''}
          </div>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- ===== [86/4-4] เลขที่เอกสาร + อ้างอิงใบเสร็จ / [86/4-5] วันที่ ===== -->
  <table class="meta">
    <tbody>
      <tr>
        <td class="mk">เลขที่เอกสาร</td>
        <td class="b">${esc(inv.docNo)}</td>
        <td class="mk">วันที่ออกเอกสาร</td>
        <td class="b">${fmtDate(inv.issuedAt)}</td>
      </tr>
      <tr>
        <td class="mk">อ้างอิงใบเสร็จเลขที่</td>
        <td>${esc(inv.saleReceiptNo)}</td>
        <td class="mk">วันที่ขาย</td>
        <td>${fmtDateTime(inv.saleDate)}</td>
      </tr>
    </tbody>
  </table>

  ${
    /* ===== [86/4-8] ใบลดหนี้: อ้างอิงใบกำกับภาษีเดิม + เหตุผล (ม.86/10) ===== */
    isCredit
      ? `<div class="cn">
          <div class="b">รายละเอียดการออกใบลดหนี้ (ตามมาตรา 86/10)</div>
          ${kv('ใบกำกับภาษีเดิมเลขที่', `<span class="b">${esc(inv.refInvoiceNo ?? '-')}</span>`)}
          ${kv('วันที่ใบกำกับเดิม', inv.refInvoiceDate != null ? fmtDate(inv.refInvoiceDate) : '-')}
          ${kv('เหตุผลที่ลดหนี้', esc(inv.reason ?? 'รับคืนสินค้า'))}
          ${creditNoteAmounts(inv)}
          <div class="sm dim">มูลค่าตามใบลดหนี้นี้เป็นยอดที่ลดลงจากใบกำกับภาษีเดิม (นำไปหักออกจากภาษีขาย)</div>
        </div>`
      : ''
  }

  <!-- ===== [86/4-6] ตารางรายการสินค้า/บริการ ===== -->
  <table class="items">
    <thead>
      <tr>
        <th style="width: 13mm">ลำดับ</th>
        <th>รายการ</th>
        <th style="width: 20mm">จำนวน</th>
        <th style="width: 28mm">ราคาต่อหน่วย</th>
        <th style="width: 30mm">จำนวนเงิน</th>
      </tr>
    </thead>
    <tbody>
      ${sale.items.map((it, i) => itemRow(it, i)).join('')}
    </tbody>
  </table>

  <!-- ===== [86/4-7] แยกมูลค่าสินค้ากับ VAT + จำนวนเงินเป็นตัวอักษร ===== -->
  <table class="sum">
    <tbody>
      <tr>
        <td class="lft">
          <div class="bt">(${esc(bahtText(inv.total))})</div>
          <div class="sm dim" style="margin-top: 1.5mm">
            รวม ${sale.items.length} รายการ
            (${fmtQty(sale.items.reduce((n, it) => n + Math.abs(it.qty), 0))} หน่วย) ·
            ${sale.vatIncluded ? 'ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว' : 'ราคาสินค้ายังไม่รวมภาษีมูลค่าเพิ่ม'}
          </div>
        </td>
        <td>
          <table class="tot"><tbody>${totalsRows}</tbody></table>
        </td>
      </tr>
    </tbody>
  </table>

  ${
    notes.length > 0
      ? `<div class="note">${notes.map((n) => escLines(n)).join('<br />')}</div>`
      : ''
  }

  ${
    inv.cancelledAt != null
      ? `<div class="note b">เอกสารนี้ถูกยกเลิกเมื่อ ${fmtDateTime(inv.cancelledAt)} —
          เหตุผล: ${esc(inv.cancelReason?.trim() || '-')}
          <span class="sm dim">(เก็บต้นฉบับที่ยกเลิกไว้เป็นหลักฐาน เลขที่นี้ไม่นำกลับมาใช้ซ้ำ)</span></div>`
      : ''
  }

  <!-- ===== ช่องเซ็น ===== -->
  <table class="sign">
    <tbody>
      <tr>
        <td>
          <div class="line"></div>
          <div class="lb2">ผู้รับสินค้า / ผู้รับบริการ</div>
          <div class="nm dim">วันที่ ........... / ........... / ...........</div>
        </td>
        <td>
          <div class="line"></div>
          <div class="lb2">ผู้มีอำนาจลงนาม</div>
          <div class="nm">${settings.taxInvoiceSigner ? esc(settings.taxInvoiceSigner) : '&nbsp;'}</div>
        </td>
      </tr>
    </tbody>
  </table>

  <div class="foot">
    <span>ผู้ออก: ${esc(inv.issuedByName?.trim() || '-')}</span>
    <span>${esc(copyLabel)} · ${esc(inv.docNo)}</span>
  </div>
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

/** พิมพ์ใบกำกับภาษี/ใบลดหนี้ 1 ชุด (ต้นฉบับ หรือ สำเนา) */
export function printTaxInvoice(
  inv: TaxInvoice,
  sale: Sale,
  settings: Settings,
  opts?: { copy?: boolean },
) {
  printHtml(buildTaxInvoiceHtml(inv, sale, settings, opts))
}

/** พิมพ์ต้นฉบับ (ลูกค้า) + สำเนา (ร้าน) ในการสั่งพิมพ์ครั้งเดียว — คนละหน้ากระดาษ */
export function printTaxInvoiceBothCopies(inv: TaxInvoice, sale: Sale, settings: Settings) {
  printHtml(
    buildTaxInvoiceHtml(inv, sale, settings) +
      '<div style="page-break-before: always"></div>' +
      buildTaxInvoiceHtml(inv, sale, settings, { copy: true }),
  )
}
