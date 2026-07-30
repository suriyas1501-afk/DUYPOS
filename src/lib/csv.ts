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
