import { NavLink, Outlet } from 'react-router-dom'
import { useOnline, useSettings } from '../db/hooks'
import { Icon, ToastHost, type IconName } from './ui'

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'หน้าหลัก', icon: 'home', end: true },
  { to: '/pos', label: 'ขายหน้าร้าน', icon: 'cart' },
  { to: '/products', label: 'สินค้า', icon: 'box' },
  { to: '/promotions', label: 'โปรโมชัน', icon: 'tag' },
  { to: '/members', label: 'สมาชิก', icon: 'users' },
  { to: '/sales', label: 'ประวัติการขาย', icon: 'receipt' },
  { to: '/reports', label: 'รายงาน', icon: 'chart' },
  { to: '/accounting', label: 'บัญชี', icon: 'wallet' },
  { to: '/settings', label: 'ตั้งค่า', icon: 'gear' },
]

export default function Layout() {
  const settings = useSettings()
  const online = useOnline()

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
          {NAV.map((item) => (
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

        <div className="border-t border-slate-100 p-3">
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
        </div>
      </aside>

      {/* ===== พื้นที่เนื้อหา ===== */}
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      <ToastHost />
    </div>
  )
}
