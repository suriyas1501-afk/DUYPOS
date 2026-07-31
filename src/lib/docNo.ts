import { dayKey } from './format'

/** ส่วนหัวเลขเอกสารของวันนั้น เช่น R20260730- */
const head = (prefix: string, date: number) => `${prefix}${dayKey(date).replaceAll('-', '')}-`

/** เลขเอกสารรูปแบบ <PREFIX><YYYYMMDD>-<NNNN> */
export const formatDocNo = (prefix: string, date: number, seq: number) =>
  `${head(prefix, date)}${String(seq).padStart(4, '0')}`

/**
 * ลำดับถัดไปของเอกสารในวันนั้น — คิดจากเลขที่มากที่สุดที่มีอยู่ ไม่ใช่การนับจำนวนแถว
 * (กันเลขซ้ำกับใบเสร็จที่พิมพ์ให้ลูกค้าไปแล้ว หลังกู้คืนข้อมูลหรือล้างข้อมูลระหว่างวัน)
 */
export function nextSeq(existing: (string | undefined)[], prefix: string, date: number): number {
  const h = head(prefix, date)
  let max = 0
  for (const code of existing) {
    if (!code || !code.startsWith(h)) continue
    const n = Number(code.slice(h.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

export const DOC_PREFIX = {
  sale: 'R',
  refund: 'RF',
  goodsReceipt: 'GR',
  stockCount: 'SC',
  shift: 'SH',
  taxInvoice: 'TX',
  creditNote: 'CN',
} as const
