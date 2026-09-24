import { db } from '../db/db'
import type { Settings } from '../db/types'
import { dayKey, endOfDay, startOfDay } from './format'

/* =========================================================
   ชนิดข้อมูลของ File System Access API
   (TypeScript ยังไม่มี type ให้ และเบราว์เซอร์บางตัวก็ยังไม่รองรับ
   จึงประกาศเองแบบเท่าที่ใช้ แล้วเช็คการมีอยู่จริงตอนรันเสมอ)
   ========================================================= */

interface FsWritable {
  write(data: string): Promise<void>
  close(): Promise<void>
}

interface FsFileHandle {
  kind: 'file'
  name: string
  createWritable(): Promise<FsWritable>
}

export interface FsDirHandle {
  kind: 'directory'
  name: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  values(): AsyncIterableIterator<{ kind: string; name: string }>
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite'
      id?: string
    }) => Promise<FsDirHandle>
    showSaveFilePicker?: (options?: {
      suggestedName?: string
      types?: { description?: string; accept: Record<string, string[]> }[]
    }) => Promise<FsFileHandle>
  }
}

/**
 * ตารางที่ถูกใส่ลงไฟล์สำรอง
 *
 * **ห้ามเพิ่มตารางที่เก็บไฟล์หรือรูปภาพลงลิสต์นี้** (เช่น slipQueue ของรูปสลิปโอนเงิน) —
 * buildBackupJson() ด้านล่าง JSON.stringify ทั้งก้อนครั้งเดียว ถ้าข้อมูลโตจะชนเพดาน
 * ความยาวสตริงของ V8 แล้ว runAutoBackup() ดัก error ทิ้งเงียบ
 * = ระบบสำรองตายโดยไม่มีสัญญาณเตือน ซึ่งเป็นทางกู้คืนทางเดียวของร้าน
 * ตารางที่ต้องอยู่นอกลิสต์นี้ให้ทำแบบ appState (ดูคอมเมนต์ที่ pickBackupFolder)
 */
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
  'coupons',
  'goodsReceipts',
  'stockCounts',
  'staff',
  'shifts',
  'taxInvoices',
] as const

interface BackupFile {
  app: 'pos-system'
  version: 1
  exportedAt: number
  data: Record<string, unknown[]>
}

/** รวมข้อมูลทุกตารางเป็นสตริง JSON ก้อนเดียว (ใช้ทั้งดาวน์โหลดเองและสำรองอัตโนมัติ) */
async function buildBackupJson(): Promise<string> {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) {
    data[t] = await db.table(t).toArray()
  }
  const payload: BackupFile = { app: 'pos-system', version: 1, exportedAt: Date.now(), data }
  return JSON.stringify(payload)
}

/** ชื่อไฟล์สำรองของวันนั้น — วันละไฟล์ (สำรองซ้ำในวันเดียวกันจะเขียนทับไฟล์เดิม) */
const backupFileName = (t: number = Date.now()) => `pos-backup-${dayKey(t)}.json`

/** จำวันที่สำรองล่าสุด เพื่อใช้เตือนและกันสำรองซ้ำในวันเดียวกัน */
export async function markBackedUp(at: number = Date.now()): Promise<void> {
  await db.settings.update(1, { lastBackupAt: at })
}

/**
 * ส่งออกข้อมูลทั้งหมดเป็นไฟล์ JSON
 *
 * 'saved'      = ผู้ใช้เลือกที่เก็บและเขียนไฟล์สำเร็จจริง → บันทึกเวลาสำรองให้เลย
 * 'downloaded' = เบราว์เซอร์เก่าที่ต้องดาวน์โหลดผ่านลิงก์ ซึ่ง **ไม่มีทางรู้** ว่าผู้ใช้กด
 *                ยกเลิกหน้าต่างเลือกที่เก็บหรือไม่ → ผู้เรียกต้องถามยืนยันก่อนค่อย markBackedUp()
 *                (ถ้าเหมาเอาว่าสำเร็จ แถบเตือนจะหายไปทั้งที่ยังไม่มีไฟล์สำรองจริง = อันตราย)
 * ผู้ใช้กดยกเลิกหน้าต่างเลือกที่เก็บ → โยน DOMException ชื่อ AbortError
 */
export async function exportBackup(): Promise<'saved' | 'downloaded'> {
  const json = await buildBackupJson()
  const name = backupFileName()

  const saver = window.showSaveFilePicker
  if (saver) {
    const handle = await saver({
      suggestedName: name,
      types: [{ description: 'ไฟล์สำรองข้อมูล POS', accept: { 'application/json': ['.json'] } }],
    })
    const w = await handle.createWritable()
    await w.write(json)
    await w.close()
    await markBackedUp()
    return 'saved'
  }

  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  // บางเบราว์เซอร์ไม่ทำงานถ้าลิงก์ไม่ได้อยู่ในเอกสาร
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return 'downloaded'
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
      // ไฟล์สำรองรุ่นเก่าอาจไม่มีตารางใหม่ — เก็บข้อมูลเดิมไว้ ไม่ล้างทิ้งเปล่าๆ
      if (!(t in payload.data)) continue
      await db.table(t).clear()
      const rows = payload.data[t]
      if (Array.isArray(rows) && rows.length) await db.table(t).bulkAdd(rows)
    }
  })
}

/**
 * ล้างข้อมูลทั้งหมด — keepSettings คงการตั้งค่า "และรายชื่อพนักงาน" ไว้
 * (ถ้าล้างพนักงานทิ้งขณะเปิดระบบพนักงานอยู่ จะเข้าระบบไม่ได้เลย)
 */
export async function clearAllData(keepSettings: boolean) {
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) {
      if (keepSettings && (t === 'settings' || t === 'staff')) continue
      await db.table(t).clear()
    }
  })
}

/* =========================================================
   สำรองข้อมูลอัตโนมัติลงโฟลเดอร์ในเครื่อง

   เว็บเขียนไฟล์ลงเครื่องเองไม่ได้ ยกเว้นผู้ใช้ "เลือกโฟลเดอร์" ให้ครั้งหนึ่ง
   (File System Access API — Chrome/Edge บนคอมพิวเตอร์) เบราว์เซอร์จะจำสิทธิ์ไว้
   ตัว handle เก็บในตาราง appState ซึ่งไม่อยู่ใน TABLES จึงไม่ถูกใส่ลงไฟล์สำรอง
   และไม่ถูกล้างตอนล้างข้อมูล — เบราว์เซอร์ที่ไม่รองรับจะเหลือแค่ "เตือนให้สำรอง"
   ========================================================= */

/** เก็บไฟล์สำรองล่าสุดกี่ไฟล์ (เกินกว่านี้ลบไฟล์เก่าทิ้ง) */
export const BACKUP_KEEP = 14

const DIR_KEY = 'backupDir'

/** เบราว์เซอร์นี้เลือกโฟลเดอร์สำรองอัตโนมัติได้ไหม */
export const backupFolderSupported = () => typeof window.showDirectoryPicker === 'function'

/** โฟลเดอร์ที่ผู้ใช้เลือกไว้ (null = ยังไม่ได้เลือก) */
export async function getBackupFolder(): Promise<FsDirHandle | null> {
  const row = await db.appState.get(DIR_KEY)
  const handle = row?.value as FsDirHandle | undefined
  return handle && handle.kind === 'directory' ? handle : null
}

/** ตรวจ/ขอสิทธิ์เขียนโฟลเดอร์ — request=false ใช้ตอนเปิดแอป (ขอสิทธิ์เองไม่ได้ ต้องมีการกดจากผู้ใช้) */
export async function ensureFolderPermission(
  handle: FsDirHandle,
  request: boolean,
): Promise<boolean> {
  const desc = { mode: 'readwrite' } as const
  const current = (await handle.queryPermission?.(desc)) ?? 'granted'
  if (current === 'granted') return true
  if (!request) return false
  const asked = (await handle.requestPermission?.(desc)) ?? 'denied'
  return asked === 'granted'
}

/** ให้ผู้ใช้เลือกโฟลเดอร์เก็บไฟล์สำรอง — คืนชื่อโฟลเดอร์ */
export async function pickBackupFolder(): Promise<string> {
  const picker = window.showDirectoryPicker
  if (!picker) throw new Error('เบราว์เซอร์นี้ยังเลือกโฟลเดอร์ไม่ได้ — ใช้ Chrome หรือ Edge บนคอมพิวเตอร์')
  const handle = await picker({ mode: 'readwrite', id: 'pos-backup' })
  if (!(await ensureFolderPermission(handle, true))) {
    throw new Error('ไม่ได้รับสิทธิ์เขียนไฟล์ในโฟลเดอร์นี้')
  }
  await db.appState.put({ key: DIR_KEY, value: handle })
  return handle.name
}

/** เลิกใช้โฟลเดอร์ที่เลือกไว้ */
export async function forgetBackupFolder(): Promise<void> {
  await db.appState.delete(DIR_KEY)
}

/** ลบไฟล์สำรองเก่าให้เหลือ BACKUP_KEEP ไฟล์ล่าสุด (ชื่อไฟล์เรียงตามวันที่อยู่แล้ว) */
async function pruneOldBackups(handle: FsDirHandle): Promise<void> {
  const names: string[] = []
  for await (const entry of handle.values()) {
    // ต้องตรงรูปแบบที่ระบบเขียนเองเป๊ะๆ เท่านั้น — ไฟล์ที่ผู้ใช้เปลี่ยนชื่อเก็บไว้เอง
    // (เช่น "pos-backup-2026-07-31-ก่อนล้างข้อมูล.json") ต้องไม่ถูกลบทิ้ง
    // ชื่อเป็นวันที่แบบ ISO เติมศูนย์หน้า การเรียงตามตัวอักษรจึงเท่ากับเรียงตามวันที่
    if (entry.kind === 'file' && /^pos-backup-\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) {
      names.push(entry.name)
    }
  }
  names.sort()
  for (const name of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
    try {
      await handle.removeEntry(name)
    } catch {
      // ลบไม่ได้ก็ข้าม — ไม่ควรทำให้การสำรองล้มเหลวทั้งหมด
    }
  }
}

/** เขียนไฟล์สำรองลงโฟลเดอร์ที่เลือกไว้ (ต้องมีสิทธิ์แล้ว) — คืนชื่อไฟล์ */
export async function writeBackupToFolder(handle: FsDirHandle): Promise<string> {
  const json = await buildBackupJson()
  const name = backupFileName()
  const file = await handle.getFileHandle(name, { create: true })
  const w = await file.createWritable()
  await w.write(json)
  await w.close()
  await pruneOldBackups(handle)
  await markBackedUp()
  return name
}

export type AutoBackupResult =
  | 'off' // ปิดใช้งานอยู่
  | 'unsupported' // เบราว์เซอร์ไม่รองรับ
  | 'no-folder' // ยังไม่ได้เลือกโฟลเดอร์
  | 'no-permission' // สิทธิ์หลุด ต้องให้ผู้ใช้กดอนุญาตใหม่
  | 'not-due' // สำรองของวันนี้ไปแล้ว
  | 'done'
  | 'error'

/**
 * เวลาสำรองล่าสุดที่เชื่อถือได้
 * เครื่องที่นาฬิกาเดินล่วงหน้า (แบตเตอรี BIOS หมด/ตั้งปีผิด) จะบันทึกเวลาอนาคตไว้
 * ถ้าเชื่อค่านั้นตรงๆ ระบบจะคิดว่า "สำรองแล้ว" ไปตลอดจนถึงวันนั้นจริง = ไม่สำรองและไม่เตือนอีกเลย
 */
function validLastBackup(lastBackupAt?: number): number | undefined {
  if (!lastBackupAt) return undefined
  return lastBackupAt > endOfDay() ? undefined : lastBackupAt
}

/**
 * สำรองอัตโนมัติ — วันละครั้ง
 * อ่าน settings สดจากฐานข้อมูลเอง เพื่อให้เรียกซ้ำเป็นระยะได้โดยไม่ต้องส่งค่ามาให้
 * ไม่โยน error ออกไป เพราะไม่ควรทำให้แอปพังเพียงเพราะสำรองไม่สำเร็จ
 */
export async function runAutoBackup(): Promise<AutoBackupResult> {
  try {
    const settings = await db.settings.get(1)
    if (!settings?.autoBackupEnabled) return 'off'
    if (!backupFolderSupported()) return 'unsupported'
    const handle = await getBackupFolder()
    if (!handle) return 'no-folder'
    if (!(await ensureFolderPermission(handle, false))) return 'no-permission'
    // วันละไฟล์พอ — เปิดปิดแอปหลายรอบต่อวันไม่ต้องเขียนซ้ำ
    const last = validLastBackup(settings.lastBackupAt)
    if (last && last >= startOfDay()) return 'not-due'
    await writeBackupToFolder(handle)
    return 'done'
  } catch {
    return 'error'
  }
}

/** กี่วันแล้วที่ไม่ได้สำรอง (ไม่เคยสำรอง / เวลาเพี้ยนเป็นอนาคต = Infinity) */
export function daysSinceBackup(lastBackupAt?: number): number {
  const last = validLastBackup(lastBackupAt)
  if (!last) return Infinity
  return Math.max(0, Math.floor((startOfDay() - startOfDay(last)) / 86400000))
}

/** ถึงเวลาเตือนให้สำรองหรือยัง (ค่าเริ่มต้น 3 วัน, 0 = ปิดการเตือน) */
export function isBackupOverdue(settings: Settings): boolean {
  const every = settings.backupReminderDays ?? 3
  if (every <= 0) return false
  return daysSinceBackup(settings.lastBackupAt) >= every
}
