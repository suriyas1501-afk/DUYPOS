// ===== สร้าง QR พร้อมเพย์ (EMVCo) แบบฝังยอดเงิน — ทำงานออฟไลน์ 100% =====

/** ต่อฟิลด์ EMVCo: id + ความยาว 2 หลัก + ค่า */
const tlv = (id: string, value: string) =>
  `${id}${String(value.length).padStart(2, '0')}${value}`

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) ตามสเปกพร้อมเพย์ */
function crc16(input: string): string {
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export type PromptpayIdKind = 'phone' | 'nationalId' | 'ewallet'

export interface PromptpayTarget {
  kind: PromptpayIdKind
  /** ค่าที่ใส่ลง payload แล้ว (เบอร์แปลงเป็น 0066xxxxxxxxx) */
  value: string
}

/**
 * ตรวจและแปลงรหัสพร้อมเพย์
 * - เบอร์โทร 10 หลัก (0812345678) → 0066812345678
 * - เลขประจำตัวประชาชน / เลขผู้เสียภาษี 13 หลัก
 * - e-Wallet 15 หลัก
 */
export function parsePromptpayId(raw: string): PromptpayTarget | null {
  const d = (raw ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 10 && d.startsWith('0')) return { kind: 'phone', value: `0066${d.slice(1)}` }
  if (d.length === 13) return { kind: 'nationalId', value: d }
  if (d.length === 15) return { kind: 'ewallet', value: d }
  // เบอร์ที่ใส่มาพร้อมรหัสประเทศแล้ว เช่น 66812345678
  if (d.length === 11 && d.startsWith('66')) return { kind: 'phone', value: `00${d}` }
  return null
}

export const PROMPTPAY_ID_HINT =
  'เบอร์โทร 10 หลัก, เลขบัตรประชาชน/ผู้เสียภาษี 13 หลัก หรือ e-Wallet 15 หลัก'

/**
 * สร้าง payload สำหรับ QR พร้อมเพย์
 * @param id รหัสพร้อมเพย์ของร้าน
 * @param amount ยอดเงิน (บาท) — ไม่ระบุ = QR ไม่ฝังยอด (ลูกค้ากรอกเอง)
 */
export function buildPromptpayPayload(id: string, amount?: number): string | null {
  const target = parsePromptpayId(id)
  if (!target) return null

  const subTag = target.kind === 'phone' ? '01' : target.kind === 'nationalId' ? '02' : '03'
  const merchant = tlv('00', 'A000000677010111') + tlv(subTag, target.value)

  const hasAmount = typeof amount === 'number' && Number.isFinite(amount) && amount > 0
  let payload =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') + // 12 = ใช้ครั้งเดียว (ฝังยอด), 11 = ใช้ซ้ำได้
    tlv('29', merchant) +
    tlv('53', '764') // สกุลเงินบาท
  if (hasAmount) payload += tlv('54', amount.toFixed(2))
  payload += tlv('58', 'TH')

  const withCrcTag = `${payload}6304`
  return `${withCrcTag}${crc16(withCrcTag)}`
}
