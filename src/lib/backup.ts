import { db } from '../db/db'
import { dayKey } from './format'

const TABLES = [
  'settings',
  'categories',
  'products',
  'members',
  'promotions',
  'sales',
  'stockMoves',
  'heldBills',
  'expenses',
] as const

interface BackupFile {
  app: 'pos-system'
  version: 1
  exportedAt: number
  data: Record<string, unknown[]>
}

/** ส่งออกข้อมูลทั้งหมดเป็นไฟล์ JSON */
export async function exportBackup() {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) {
    data[t] = await db.table(t).toArray()
  }
  const payload: BackupFile = { app: 'pos-system', version: 1, exportedAt: Date.now(), data }
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pos-backup-${dayKey(Date.now())}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** นำเข้าข้อมูลจากไฟล์สำรอง (แทนที่ข้อมูลปัจจุบันทั้งหมด) */
export async function importBackup(file: File): Promise<void> {
  const text = await file.text()
  const payload = JSON.parse(text) as BackupFile
  if (payload.app !== 'pos-system' || !payload.data) {
    throw new Error('ไฟล์ไม่ถูกต้อง — ต้องเป็นไฟล์สำรองจากระบบนี้เท่านั้น')
  }
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      const rows = payload.data[t]
      if (Array.isArray(rows) && rows.length) await db.table(t).bulkAdd(rows)
    }
  })
}

/** ล้างข้อมูลทั้งหมด (คงการตั้งค่าไว้) */
export async function clearAllData(keepSettings: boolean) {
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) {
      if (keepSettings && t === 'settings') continue
      await db.table(t).clear()
    }
  })
}
