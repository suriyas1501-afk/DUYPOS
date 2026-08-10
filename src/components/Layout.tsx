import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useCurrentShift, useOnline, usePermissions, useSettings } from '../db/hooks'
import { useAuth } from '../stores/authStore'
import { ROLE_LABEL } from '../lib/permissions'
import {
  daysSinceBackup,
  ensureFolderPermission,
  exportBackup,
  getBackupFolder,
  isBackupOverdue,
  markBackedUp,
  writeBackupToFolder,
} from '../lib/backup'
import { dayKey } from '../lib/format'
import type { PermissionKey } from '../db/types'
import { Button, ConfirmDialog, Icon, toast, type IconName } from './ui'

interface NavItem {
  to: string
  label: string
  icon: IconName
  perm: PermissionKey
  end?: boolean
  /** แสดงเฉพาะเมื่อเปิดใช้ฟีเจอร์นั้น */
  requires?: 'shift' | 'staff' | 'quickService'
}

const NAV: NavItem[] = [
  { to: '/', label: 'หน้าหลัก', icon: 'home', perm: 'reports', end: true },
  { to: '/pos', label: 'ขายหน้าร้าน', icon: 'cart', perm: 'sell' },
  {
    to: '/kitchen',
    label: 'จอครัว / คิว',
    icon: 'coffee',
    perm: 'kitchen',
    requires: 'quickService',
  },
  { to: '/shift', label: 'กะ / ลิ้นชัก', icon: 'clock', perm: 'shift', requires: 'shift' },
  { to: '/products', label: 'สินค้า', icon: 'box', perm: 'products' },
  { to: '/receive', label: 'รับของเข้า', icon: 'truck', perm: 'stock' },
  { to: '/stock-count', label: 'นับสต็อก', icon: 'clipboard', perm: 'stock' },
  { to: '/promotions', label: 'โปรโมชัน', icon: 'tag', perm: 'promotions' },
  { to: '/coupons', label: 'คูปอง', icon: 'ticket', perm: 'promotions' },
  { to: '/members', label: 'สมาชิก', icon: 'users', perm: 'members' },
  { to: '/sales', label: 'ประวัติการขาย', icon: 'receipt', perm: 'sell' },
  { to: '/reports', label: 'รายงาน', icon: 'chart', perm: 'reports' },
  { to: '/accounting', label: 'บัญชี', icon: 'wallet', perm: 'accounting' },
  { to: '/staff', label: 'พนักงาน', icon: 'user', perm: 'staff', requires: 'staff' },
  { to: '/settings', label: 'ตั้งค่า', icon: 'gear', perm: 'settings' },
]

/** เมนูที่ผู้ใช้คนนี้เข้าถึงได้ (ใช้ทั้งกับแถบนำทางและการเด้งหน้าแรก) */
export function visibleNav(
  can: (p: PermissionKey) => boolean,
  opts: { shiftEnabled: boolean; staffEnabled: boolean; quickServiceEnabled?: boolean },
): NavItem[] {
  return NAV.filter((item) => {
    if (item.requires === 'shift' && !opts.shiftEnabled) return false
    if (item.requires === 'staff' && !opts.staffEnabled) return false
    if (item.requires === 'quickService' && !opts.quickServiceEnabled) return false
    return can(item.perm)
  })
}

/**
 * แถบเตือนให้สำรองข้อมูล — ขึ้นเมื่อไม่ได้สำรองนานเกินที่ตั้งไว้
 * ข้อมูลอยู่ในเครื่องล้วน ถ้าเบราว์เซอร์ถูกล้างแล้วไม่มีไฟล์สำรอง = ข้อมูลหายถาวร
 * ปุ่มในแถบนี้เป็น "การกดของผู้ใช้" จึงขอสิทธิ์เขียนโฟลเดอร์ได้ (ตอนเปิดแอปเองขอไม่ได้)
 */
function BackupReminder() {
  /* อ่าน settings เองแทนรับมาทาง props เพราะ useSettings() คืน DEFAULT_SETTINGS
     (ซึ่งไม่มี lastBackupAt) ระหว่างที่ยังอ่าน DB ไม่เสร็จ → แถบ "ยังไม่เคยสำรองเลย"
     จะกระพริบทุกครั้งที่เปิดแอป แม้ร้านจะเพิ่งสำรองไปเมื่อวาน */
  const settings = useLiveQuery(() => db.settings.get(1), [])
  /* ปิดแถบ = ปิด "เฉพาะวันนี้" ไม่ใช่ปิดถาวรทั้งเซสชัน
     เครื่องหน้าร้านเปิดค้างเป็นสัปดาห์ ถ้าปิดถาวรจะไม่เตือนอีกเลยจนกว่าจะรีเฟรช */
  const [hiddenDay, setHiddenDay] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [askSaved, setAskSaved] = useState(false)

  const today = dayKey(Date.now())
  if (!settings || hiddenDay === today || !isBackupOverdue(settings)) {
    // ยังต้องเรนเดอร์ไดอะล็อกยืนยันไว้ ถ้าเพิ่งกดดาวน์โหลดแล้วแถบหายไปก่อน
    return askSaved ? (
      <BackupSavedConfirm open onClose={() => setAskSaved(false)} />
    ) : null
  }

  const days = daysSinceBackup(settings.lastBackupAt)

  const backupNow = async () => {
    if (busy) return
    setBusy(true)
    try {
      const handle = await getBackupFolder()
      if (handle && (await ensureFolderPermission(handle, true))) {
        const name = await writeBackupToFolder(handle)
        toast.success(`สำรองข้อมูลลงโฟลเดอร์ ${handle.name} แล้ว (${name})`)
        setHiddenDay(today)
        return
      }
      // ไม่มีโฟลเดอร์/ไม่ได้สิทธิ์ → บันทึกเป็นไฟล์แทน
      const how = await exportBackup()
      if (how === 'saved') {
        toast.success('บันทึกไฟล์สำรองเรียบร้อย')
        setHiddenDay(today)
      } else {
        // ดาวน์โหลดผ่านลิงก์: ไม่รู้ว่าผู้ใช้กดยกเลิกหรือไม่ ต้องให้ยืนยันก่อนถือว่าสำรองแล้ว
        setAskSaved(true)
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      toast.error('สำรองข้อมูลไม่สำเร็จ กรุณาลองใหม่ที่หน้าตั้งค่า')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
      <Icon name="alert" size={17} className="shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1">
        {days === Infinity
          ? 'ยังไม่เคยสำรองข้อมูลเลย'
          : `ไม่ได้สำรองข้อมูลมา ${days} วันแล้ว`}{' '}
        — ข้อมูลเก็บอยู่ในเครื่องนี้เท่านั้น ถ้าเครื่องเสียหรือล้างเบราว์เซอร์จะกู้ไม่ได้
      </span>
      <Button size="sm" icon="download" disabled={busy} onClick={() => void backupNow()}>
        {busy ? 'กำลังสำรอง…' : 'สำรองตอนนี้'}
      </Button>
      <button
        type="button"
        title="ซ่อนไว้ก่อน (จะเตือนอีกครั้งพรุ่งนี้)"
        onClick={() => setHiddenDay(today)}
        className="cursor-pointer rounded-lg p-1 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700"
      >
        <Icon name="x" size={16} />
      </button>
      <BackupSavedConfirm open={askSaved} onClose={() => setAskSaved(false)} />
    </div>
  )
}

/**
 * ยืนยันว่าไฟล์ที่ดาวน์โหลดถูกบันทึกจริง — ใช้เฉพาะเบราว์เซอร์ที่ไม่มี showSaveFilePicker
 * เพราะการดาวน์โหลดผ่านลิงก์ไม่มีสัญญาณกลับมาว่าผู้ใช้กด "ยกเลิก" ในหน้าต่างเลือกที่เก็บ
 * ถ้าเหมาว่าสำเร็จ แถบเตือนจะหายทั้งที่ไม่มีไฟล์สำรองจริง
 */
function BackupSavedConfirm({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      title="บันทึกไฟล์สำรองแล้วหรือยัง?"
      message="ถ้ากดยกเลิกในหน้าต่างดาวน์โหลด ไฟล์สำรองจะไม่ถูกสร้าง — ยืนยันเมื่อเห็นไฟล์ในเครื่องแล้วเท่านั้น"
      confirmLabel="บันทึกไฟล์แล้ว"
      onConfirm={() => {
        void markBackedUp().then(() => toast.success('บันทึกเวลาสำรองล่าสุดแล้ว'))
      }}
      onClose={onClose}
    />
  )
}

export default function Layout() {
  const settings = useSettings()
  const online = useOnline()
  const navigate = useNavigate()
  const { enabled: staffEnabled, staff, can } = usePermissions()
  const { shift } = useCurrentShift()
  const { lock, logout, touch } = useAuth()

  const shiftEnabled = !!settings.shiftEnabled
  const items = visibleNav(can, {
    shiftEnabled,
    staffEnabled,
    quickServiceEnabled: !!settings.quickServiceEnabled,
  })

  /* ===== ล็อกหน้าจออัตโนมัติเมื่อไม่มีการใช้งาน ===== */
  const autoLockMs = (settings.autoLockMinutes ?? 0) * 60_000
  useEffect(() => {
    if (!staffEnabled || autoLockMs <= 0) return
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    const onActivity = () => touch()
    for (const e of events) window.addEventListener(e, onActivity, { passive: true })
    const timer = window.setInterval(() => {
      if (Date.now() - useAuth.getState().lastActiveAt >= autoLockMs) lock()
    }, 15_000)
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity)
      window.clearInterval(timer)
    }
  }, [staffEnabled, autoLockMs, lock, touch])

  return (
    <div className="flex h-full">
      {/* ===== แถบนำทางซ้าย ===== */}
      <aside className="flex w-16 shrink-0 flex-col border-r border-slate-200 bg-white lg:w-56">
        <div className="flex items-center gap-2.5 px-3 py-4 lg:px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-lg font-bold text-white">
            ฿
          </div>
          <div className="hidden min-w-0 lg:block">
            <div className="truncate text-sm font-bold text-slate-800">{settings.shopName}</div>
            <div className="truncate text-xs text-slate-400">{settings.branch}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2 lg:px-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                `flex items-center justify-center gap-2.5 rounded-xl px-2 py-2.5 text-sm transition-colors lg:justify-start lg:px-3 ${
                  isActive
                    ? 'bg-emerald-50 font-semibold text-emerald-700'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                }`
              }
            >
              <Icon name={item.icon} size={19} />
              <span className="hidden lg:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="space-y-2 border-t border-slate-100 p-3">
          {/* สถานะกะ */}
          {shiftEnabled && (
            <button
              type="button"
              onClick={() => navigate('/shift')}
              title={shift ? `กะ ${shift.docNo} เปิดอยู่` : 'ยังไม่เปิดกะ'}
              className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-2 py-2 text-xs font-medium transition-colors lg:justify-start lg:px-3 ${
                shift
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              <Icon name="clock" size={15} />
              <span className="hidden truncate lg:inline">
                {shift ? `กะ ${shift.docNo}` : 'ยังไม่เปิดกะ'}
              </span>
            </button>
          )}

          {/* สถานะการเชื่อมต่อ */}
          <div
            className={`flex items-center justify-center gap-2 rounded-xl px-2 py-2 text-xs font-medium lg:justify-start lg:px-3 ${
              online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
            title={online ? 'ออนไลน์' : 'ออฟไลน์ — ขายต่อได้ ข้อมูลบันทึกลงเครื่อง'}
          >
            <Icon name={online ? 'wifi' : 'wifioff'} size={15} />
            <span className="hidden lg:inline">
              {online ? 'ออนไลน์' : 'ออฟไลน์ — ขายต่อได้'}
            </span>
          </div>

          {/* ผู้ใช้ที่เข้าสู่ระบบ */}
          {staffEnabled && staff && (
            <div className="rounded-xl bg-slate-50 px-2 py-2 lg:px-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-xs font-bold text-white">
                  {staff.name.trim().charAt(0) || '?'}
                </span>
                <div className="hidden min-w-0 flex-1 lg:block">
                  <div className="truncate text-xs font-semibold text-slate-700">{staff.name}</div>
                  <div className="truncate text-[11px] text-slate-400">
                    {ROLE_LABEL[staff.role]}
                  </div>
                </div>
              </div>
              <div className="mt-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={lock}
                  title="ล็อกหน้าจอ"
                  className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium text-slate-500 hover:bg-white hover:text-slate-700"
                >
                  <Icon name="lock" size={13} />
                  <span className="hidden lg:inline">ล็อก</span>
                </button>
                <button
                  type="button"
                  onClick={logout}
                  title="ออกจากระบบ / สลับผู้ใช้"
                  className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium text-slate-500 hover:bg-white hover:text-rose-600"
                >
                  <Icon name="logout" size={13} />
                  <span className="hidden lg:inline">ออก</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ===== พื้นที่เนื้อหา ===== */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <BackupReminder />
        <div className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
