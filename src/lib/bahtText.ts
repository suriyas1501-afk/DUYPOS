// ===== จำนวนเงินเป็นตัวอักษรไทย (ใช้บนใบกำกับภาษี) =====

import { r2 } from './format'

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

/** อ่านจำนวนเต็ม (สตริงตัวเลข) เป็นคำไทย — รองรับหลักล้านขึ้นไปด้วยการวนซ้ำทีละ 6 หลัก */
function readInt(digits: string): string {
  const n = digits.replace(/^0+/, '')
  if (n === '') return ''
  if (n.length > 6) {
    return readInt(n.slice(0, n.length - 6)) + 'ล้าน' + readInt(n.slice(n.length - 6))
  }
  let out = ''
  for (let i = 0; i < n.length; i++) {
    const d = Number(n[i])
    const pos = n.length - i - 1 // 0 = หลักหน่วย
    if (d === 0) continue
    if (pos === 0) out += d === 1 && n.length > 1 ? 'เอ็ด' : DIGITS[d]
    else if (pos === 1) out += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : DIGITS[d] + 'สิบ'
    else out += DIGITS[d] + POS[pos]
  }
  return out
}

/** เช่น 1234.5 → 'หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์' */
export function bahtText(amount: number): string {
  const value = r2(Math.abs(amount))
  const baht = Math.floor(value + 1e-9)
  const satang = Math.round(r2(value - baht) * 100)
  const sign = amount < 0 ? 'ลบ' : ''

  if (baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน'
  let out = ''
  if (baht > 0) out += readInt(String(baht)) + 'บาท'
  out += satang > 0 ? readInt(String(satang)) + 'สตางค์' : 'ถ้วน'
  return sign + out
}
