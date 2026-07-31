import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useCurrentShift, useOnline, usePermissions, useSettings } from '../db/hooks'
import { useAuth } from '../stores/authStore'
import { ROLE_LABEL } from '../lib/permissions'
import type { PermissionKey } from '../db/types'
import { Icon, type IconName } from './ui'

interface NavItem {
  to: string
  label: string
  icon: IconName
  perm: PermissionKey
  end?: boolean
  /** แสดงเฉพาะเมื่อเปิดใช้ฟีเจอร์นั้น */
  requires?: 'shift' | 'staff'
}

const NAV: NavItem[] = [
  { to: '/', label: 'หน้าหลัก', icon: 'home', perm: 'reports', end: true },
  { to: '/pos', label: 'ขายหน้าร้าน', icon: 'cart', perm: 'sell' },
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
  opts: { shiftEnabled: boolean; staffEnabled: boolean },
): NavItem[] {
  return NAV.filter((item) => {
    if (item.requires === 'shift' && !opts.shiftEnabled) return false
    if (item.requires === 'staff' && !opts.staffEnabled) return false
    return can(item.perm)
  })
}

export default function Layout() {
  const settings = useSettings()
  const online = useOnline()
  const navigate = useNavigate()
  const { enabled: staffEnabled, staff, can } = usePermissions()
  const { shift } = useCurrentShift()
  const { lock, logout, touch } = useAuth()

  const shiftEnabled = !!settings.shiftEnabled
  const items = visibleNav(can, { shiftEnabled, staffEnabled })

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
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
