import { useState } from 'react'
import PinPad, { MAX_PIN_ATTEMPTS, SHAKE_CLASS, usePinLockout } from './PinPad'
import { Button, Icon, Spinner } from '../ui'
import { useCurrentStaff, useSettings } from '../../db/hooks'
import { validatePin, verifyPin } from '../../lib/auth'
import { ROLE_LABEL } from '../../lib/permissions'
import { useAuth } from '../../stores/authStore'

/* =========================================================
   ล็อกหน้าจอ — ยังจำว่าเป็นใคร ใส่ PIN แล้วใช้งานต่อได้เลย
   เรนเดอร์อยู่นอก BrowserRouter → ห้ามใช้ hook ของ react-router ในไฟล์นี้
   ========================================================= */

export default function LockScreen() {
  const settings = useSettings()
  const { staff, loading } = useCurrentStaff()
  const logout = useAuth((s) => s.logout)

  const [pin, setPin] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [wrong, setWrong] = useState(false)
  const { remain, locked, fail, reset } = usePinLockout(staff?.id ?? 'lock')

  async function submit() {
    if (!staff || checking || locked) return
    const invalid = validatePin(pin)
    if (invalid) {
      setError(invalid)
      setWrong(true)
      return
    }
    setChecking(true)
    try {
      const ok = await verifyPin(pin, staff.pinHash)
      if (!ok) {
        const n = fail()
        setPin('')
        setWrong(true)
        setError(
          n >= MAX_PIN_ATTEMPTS
            ? `PIN ไม่ถูกต้อง (ครั้งที่ ${n}) — ระบบพักการกรอกชั่วคราว`
            : `PIN ไม่ถูกต้อง (ครั้งที่ ${n})`,
        )
        return
      }
      reset()
      useAuth.getState().unlock()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-gradient-to-br from-slate-100 via-slate-50 to-emerald-50 p-4">
      <div className="w-full max-w-sm py-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* หัวการ์ด: ไอคอนกุญแจ + ชื่อร้าน */}
          <div className="mb-4 flex flex-col items-center gap-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <Icon name="lock" size={26} />
            </div>
            <h1 className="text-base font-bold text-slate-800">หน้าจอถูกล็อก</h1>
            <p className="text-sm text-slate-500">ใส่ PIN เพื่อใช้งานต่อ</p>
            <p className="text-xs text-slate-400">{settings.shopName}</p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Spinner />
              <p className="text-sm text-slate-500">กำลังตรวจสอบบัญชี…</p>
            </div>
          ) : !staff ? (
            /* บัญชีถูกลบระหว่างล็อกอยู่ → ปลดล็อกไม่ได้ ต้องออกจากระบบไปเข้าใหม่ */
            <div>
              <p className="rounded-xl bg-rose-50 p-3.5 text-sm text-rose-700 ring-1 ring-rose-200">
                บัญชีพนักงานที่ใช้งานอยู่ถูกลบไปแล้ว กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่
              </p>
              <Button size="lg" className="mt-4 w-full" icon="logout" onClick={logout}>
                ออกจากระบบ
              </Button>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-700">
                  {Array.from(staff.name.trim())[0] ?? '?'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-800">
                    {staff.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {ROLE_LABEL[staff.role]} · {staff.code}
                  </span>
                </span>
              </div>

              <div className={wrong ? SHAKE_CLASS : ''} onAnimationEnd={() => setWrong(false)}>
                <PinPad
                  value={pin}
                  onChange={(v) => {
                    setPin(v)
                    setError('')
                  }}
                  onSubmit={submit}
                  disabled={checking || locked}
                />
                {error && (
                  <p className="mt-3 text-center text-sm font-medium text-rose-600">{error}</p>
                )}
              </div>

              {locked && (
                <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-sm font-medium text-rose-600">
                  <Icon name="clock" size={16} />
                  ลองใหม่ได้ในอีก {remain} วินาที
                </p>
              )}

              <Button
                size="lg"
                className="mt-4 w-full"
                icon={checking ? undefined : 'unlock'}
                disabled={checking || locked || pin.length === 0}
                onClick={submit}
              >
                {checking ? 'กำลังตรวจสอบ…' : 'ปลดล็อก'}
              </Button>

              <Button variant="ghost" size="sm" className="mt-2 w-full" icon="logout" onClick={logout}>
                สลับผู้ใช้ / ออกจากระบบ
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
