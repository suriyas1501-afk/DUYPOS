/** ดาวน์โหลดไฟล์ CSV (ใส่ BOM ให้ Excel อ่านภาษาไทยถูกต้อง) */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const escapeCell = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const BOM = String.fromCharCode(0xfeff)
  const csv = BOM + rows.map((r) => r.map(escapeCell).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * แปลงข้อความ CSV เป็นตาราง (รองรับเซลล์ในเครื่องหมายคำพูด, ขึ้นบรรทัดในเซลล์, BOM, CRLF)
 * ใช้กับการนำเข้าสินค้าจากไฟล์ CSV/Excel
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows.map((r) => r.map((c) => c.trim()))
}
