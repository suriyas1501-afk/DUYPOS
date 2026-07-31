import { useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import Layout, { visibleNav } from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import RequirePerm from './components/RequirePerm'
import LoginScreen from './components/auth/LoginScreen'
import LockScreen from './components/auth/LockScreen'
import { db } from './db/db'
import { initDb } from './db/seed'
import { useCurrentStaff, usePermissions, useSettings } from './db/hooks'
import { useAuth } from './stores/authStore'
import { setActor } from './lib/actor'
import { Spinner, ToastHost, toast } from './components/ui'
import type { PermissionKey } from './db/types'
import Dashboard from './pages/Dashboard'
import Pos from './pages/Pos'
import Products from './pages/Products'
import GoodsReceiptPage from './pages/GoodsReceipt'
import StockCountPage from './pages/StockCount'
import Promotions from './pages/Promotions'
import Coupons from './pages/Coupons'
import Members from './pages/Members'
import Sales from './pages/Sales'
import Reports from './pages/Reports'
import Accounting from './pages/Accounting'
import Settings from './pages/Settings'
import Shift from './pages/Shift'
import Staff from './pages/Staff'

/** เส้นทาง + สิทธิ์ที่ต้องมี (แถบนำทางใน Layout.tsx ใช้ชุดเดียวกัน) */
const ROUTES: { path: string; perm: PermissionKey; element: ReactNode }[] = [
  { path: '/pos', perm: 'sell', element: <Pos /> },
  { path: '/shift', perm: 'shift', element: <Shift /> },
  { path: '/products', perm: 'products', element: <Products /> },
  { path: '/receive', perm: 'stock', element: <GoodsReceiptPage /> },
  { path: '/stock-count', perm: 'stock', element: <StockCountPage /> },
  { path: '/promotions', perm: 'promotions', element: <Promotions /> },
  { path: '/coupons', perm: 'promotions', element: <Coupons /> },
  { path: '/members', perm: 'members', element: <Members /> },
  { path: '/sales', perm: 'sell', element: <Sales /> },
  { path: '/reports', perm: 'reports', element: <Reports /> },
  { path: '/accounting', perm: 'accounting', element: <Accounting /> },
  { path: '/staff', perm: 'staff', element: <Staff /> },
  { path: '/settings', perm: 'settings', element: <Settings /> },
]

function Loading({ text = 'กำลังเตรียมระบบ…' }: { text?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Spinner />
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  )
}

/**
 * ล็อกหน้าจอแบบทับด้านหน้า (ไม่ถอดแอปออก) — ปลดล็อกแล้วกลับมาที่หน้าเดิมกลางบิลได้เลย
 * ตอนขึ้นมาต้องถอดโฟกัสออกจากช่องกรอกที่อยู่ข้างหลังก่อน ไม่งั้นเครื่องยิงบาร์โค้ด
 * จะยังยิงของเข้าตะกร้าหลังฉากล็อกได้
 */
function LockOverlay() {
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  }, [])
  return (
    <div className="fixed inset-0 z-[80] bg-white">
      <LockScreen />
    </div>
  )
}

/** หน้าแรก — พนักงานที่ไม่มีสิทธิ์ดูรายงาน ให้เด้งไปเมนูแรกที่เข้าได้ (เช่นหน้าขาย) */
function HomeRoute() {
  const settings = useSettings()
  const { enabled, can } = usePermissions()
  if (can('reports')) {
    return (
      <ErrorBoundary>
        <Dashboard />
      </ErrorBoundary>
    )
  }
  const first = visibleNav(can, {
    shiftEnabled: !!settings.shiftEnabled,
    staffEnabled: enabled,
  }).find((i) => i.to !== '/')
  return <Navigate to={first?.to ?? '/pos'} replace />
}

export default function App() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    initDb().then(() => setReady(true))
  }, [])

  // รอค่าจริงจากฐานข้อมูลก่อนตัดสินใจว่าต้องเข้าสู่ระบบไหม (กันหน้าจอกระพริบ)
  const settings = useLiveQuery(() => db.settings.get(1), [])
  const staffId = useAuth((s) => s.staffId)
  const locked = useAuth((s) => s.locked)
  const logout = useAuth((s) => s.logout)
  const { staff, loading: staffLoading } = useCurrentStaff()

  // บอกไลบรารีที่ไม่ใช่ React ว่าใครกำลังทำรายการ (บันทึกลงเอกสารทุกใบ)
  useEffect(() => {
    setActor(staff?.id != null ? { id: staff.id, name: staff.name } : {})
  }, [staff])

  // พนักงานถูกลบหรือถูกปิดใช้งานระหว่างเข้าใช้อยู่ → ออกจากระบบทันที
  useEffect(() => {
    if (staffId == null || staffLoading) return
    if (!staff) {
      logout()
      toast.error('บัญชีพนักงานนี้ถูกลบไปแล้ว')
    } else if (!staff.active) {
      logout()
      toast.error(`บัญชี ${staff.name} ถูกปิดใช้งาน`)
    }
  }, [staffId, staff, staffLoading, logout])

  if (!ready || settings === undefined) return <Loading />

  const staffMode = !!settings.staffEnabled
  if (staffMode && staffLoading) return <Loading text="กำลังตรวจสิทธิ์…" />

  if (staffMode && !staff) {
    return (
      <>
        <LoginScreen />
        <ToastHost />
      </>
    )
  }
  return (
    <>
      {/* basename ตามโฟลเดอร์ที่แอปถูกวาง (GitHub Pages = /<repo>/) — ถ้าไม่ใส่ เส้นทางจะไม่ตรงเลย */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomeRoute />} />
            {ROUTES.map((r) => (
              <Route
                key={r.path}
                path={r.path}
                element={
                  <RequirePerm perm={r.perm}>
                    <ErrorBoundary>{r.element}</ErrorBoundary>
                  </RequirePerm>
                }
              />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      {staffMode && locked && <LockOverlay />}
      <ToastHost />
    </>
  )
}
