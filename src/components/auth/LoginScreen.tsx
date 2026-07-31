import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import PinPad, { MAX_PIN_ATTEMPTS, SHAKE_CLASS, usePinLockout } from './PinPad'
import { Button, ConfirmDialog, Icon, Spinner, toast } from '../ui'
import { db } from '../../db/db'
import { useSettings } from '../../db/hooks'
import { ensureOwnerStaff } from '../../db/seed'
import { validatePin, verifyPin } from '../../lib/auth'
import { ROLE_LABEL } from '../../lib/permissions'
import { useAuth } from '../../stores/authStore'
import type { Staff } from '../../db/types'

/* =========================================================
   หน้าเข้าสู่ระบบด้วย PIN (เต็มจอ)
   เรนเดอร์อยู่นอก BrowserRouter → ห้ามใช้ hook ของ react-router ในไฟล์นี้
   ========================================================= */

/** อักษรแรกของชื่อ (ใช้ Array.from เพื่อไม่ตัดอักขระที่ใช้หลาย code unit) */
const initial = (name: string) => Array.from(name.trim())[0] ?? '?'

function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700 ${
        size === 'lg' ? 'h-12 w-12 text-xl' : 'h-10 w-10 text-base'
      }`}
    >
      {initial(name)}
    </span>
  )
}

export default function LoginScreen() {
  const settings = useSettings()

  // อ่านพนักงานทั้งหมดแล้วกรอง active ใน JS — IndexedDB ใช้ boolean เป็นคีย์ไม่ได้
  const rows = useLiveQuery(() => db.staff.orderBy('code').toArray(), [])
  const loadingStaff = rows === undefined
  const list = (rows ?? []).filter((s) => s.active)

  const [pickedId, setPickedId] = useState<number | null>(null)
  const [pin, setPin] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [wrong, setWrong] = useState(false)
  const [askDisable, setAskDisable] = useState(false)

  // ร้านที่มีพนักงานคนเดียว (ค่าเริ่มต้นของระบบ) ข้ามขั้นเลือกคนไปหน้ากด PIN เลย
  const single = list.length === 1
  const picked: Staff | undefined = list.find((s) => s.id === pickedId) ?? (single ? list[0] : undefined)

  const { remain, locked, fail, reset } = usePinLockout(picked?.id ?? 'none')

  function pick(s: Staff) {
    setPickedId(s.id ?? null)
    setPin('')
    setError('')
  }

  function back() {
    setPickedId(null)
    setPin('')
    setError('')
  }

  function reject(message: string) {
    setPin('')
    setError(message)
    setWrong(true)
  }

  async function submit() {
    if (!picked || picked.id == null || checking || locked) return
    const invalid = validatePin(pin)
    if (invalid) {
      setError(invalid)
      setWrong(true)
      return
    }
    setChecking(true)
    try {
      const ok = await verifyPin(pin, picked.pinHash)
      if (!ok) {
        const n = fail()
        reject(
          n >= MAX_PIN_ATTEMPTS
            ? `PIN ไม่ถูกต้อง (ครั้งที่ ${n}) — ระบบพักการกรอกชั่วคราว`
            : `PIN ไม่ถูกต้อง (ครั้งที่ ${n})`,
        )
        return
      }
      reset()
      await db.staff.update(picked.id, { lastLoginAt: Date.now() })
      useAuth.getState().login(picked.id)
    } finally {
      setChecking(false)
    }
  }

  /** ทางออกฉุกเฉิน: กู้บัญชีเจ้าของร้านเมื่อไม่มีใครเข้าระบบได้แล้ว */
  async function recoverOwner() {
    const all = await db.staff.toArray()
    if (all.length === 0) {
      await ensureOwnerStaff()
      toast.success('สร้างบัญชีเจ้าของร้านแล้ว — รหัส E01 / PIN เริ่มต้น 1234')
      return
    }
    // มีพนักงานอยู่แล้วแต่ถูกปิดใช้งานหมด → เปิดใช้งานบัญชีเจ้าของร้านคนแรกที่เจอ (PIN เดิมไม่เปลี่ยน)
    const target = all.find((s) => s.role === 'owner') ?? all[0]
    if (target.id == null) return
    await db.staff.update(target.id, { active: true })
    toast.success(`เปิดใช้งานบัญชี ${target.name} (${target.code}) แล้ว — ใช้ PIN เดิมของบัญชีนี้`)
  }

  async function disableStaffMode() {
    await db.settings.update(1, { staffEnabled: false })
    toast.success('ปิดระบบพนักงานแล้ว — เข้าใช้งานได้ทันทีโดยไม่ต้องใส่ PIN')
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-gradient-to-br from-emerald-50 via-slate-50 to-sky-100 p-4">
      <div className="w-full max-w-md py-6">
        {/* โลโก้ + ชื่อร้าน */}
        <div className="mb-5 flex flex-col items-center gap-3">
          {settings.logo ? (
            <img
              src={settings.logo}
              alt=""
              className="h-16 w-16 rounded-2xl bg-white object-contain p-1 shadow-sm"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-3xl font-bold text-white shadow-sm">
              ฿
            </div>
          )}
          <div className="text-center">
            <h1 className="text-xl font-bold text-slate-800">{settings.shopName}</h1>
            {settings.branch && <p className="mt-0.5 text-sm text-slate-500">{settings.branch}</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {loadingStaff ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <Spinner />
              <p className="text-sm text-slate-500">กำลังโหลดรายชื่อพนักงาน…</p>
            </div>
          ) : list.length === 0 ? (
            /* ---------- ไม่มีพนักงานที่ใช้งานได้เลย: ทางออกฉุกเฉิน ---------- */
            <div>
              <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 p-3.5 text-amber-800 ring-1 ring-amber-200">
                <Icon name="alert" size={20} className="mt-0.5" />
                <div className="text-sm">
                  <p className="font-bold">ไม่มีบัญชีพนักงานที่ใช้งานได้</p>
                  <p className="mt-1 text-amber-700">
                    ระบบพนักงานเปิดอยู่แต่ไม่มีใครเข้าสู่ระบบได้ เลือกวิธีกู้คืนด้านล่าง
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button size="lg" icon="shield" onClick={recoverOwner}>
                  {(rows ?? []).length > 0
                    ? 'เปิดใช้งานบัญชีเจ้าของร้านอีกครั้ง'
                    : 'สร้างบัญชีเจ้าของร้าน (PIN 1234)'}
                </Button>
                <Button size="lg" variant="secondary" icon="unlock" onClick={() => setAskDisable(true)}>
                  ปิดระบบพนักงาน
                </Button>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                ปิดระบบพนักงาน = ใช้งานได้ทุกเมนูโดยไม่ต้องใส่ PIN เปิดใหม่ได้ที่หน้าตั้งค่า
              </p>
            </div>
          ) : !picked ? (
            /* ---------- ขั้นที่ 1: เลือกพนักงาน ---------- */
            <div>
              <div className="mb-3 text-center">
                <h2 className="text-base font-bold text-slate-800">เลือกพนักงาน</h2>
                <p className="mt-0.5 text-sm text-slate-500">แตะชื่อของคุณเพื่อใส่ PIN</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pick(s)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    <Avatar name={s.name} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-800">
                        {s.name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {ROLE_LABEL[s.role]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ---------- ขั้นที่ 2: ใส่ PIN ---------- */
            <div>
              <div className="mb-4 flex items-center gap-3">
                <Avatar name={picked.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-slate-800">{picked.name}</p>
                  <p className="text-xs text-slate-500">
                    {ROLE_LABEL[picked.role]} · {picked.code}
                  </p>
                </div>
                {!single && (
                  <Button variant="ghost" size="sm" icon="users" onClick={back}>
                    เปลี่ยนผู้ใช้
                  </Button>
                )}
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
                {checking ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={askDisable}
        title="ปิดระบบพนักงาน"
        message="ทุกคนจะเข้าใช้งานได้ทุกเมนูโดยไม่ต้องใส่ PIN และไม่มีการบันทึกว่าใครทำรายการ เปิดใช้อีกครั้งได้ที่หน้าตั้งค่า"
        confirmLabel="ปิดระบบพนักงาน"
        danger
        onConfirm={() => void disableStaffMode()}
        onClose={() => setAskDisable(false)}
      />
    </div>
  )
}
