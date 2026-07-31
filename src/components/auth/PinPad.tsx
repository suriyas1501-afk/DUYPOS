import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Icon } from '../ui'
import { PIN_MAX } from '../../lib/auth'

/* =========================================================
   แป้นตัวเลขใส่ PIN สำหรับหน้าจอสัมผัส
   ใช้ร่วมกันทั้งหน้าเข้าสู่ระบบ / ล็อกหน้าจอ / ขออนุมัติ
   ========================================================= */

export interface PinPadProps {
  value: string
  onChange: (v: string) => void
  /** เรียกเมื่อกด Enter หรือปุ่มยืนยันบนคีย์บอร์ด (ปุ่มยืนยันบนหน้าจออยู่ที่ผู้เรียก) */
  onSubmit?: () => void
  maxLength?: number
  disabled?: boolean
  className?: string
}

/* ---------- อนิเมชันสั่นเมื่อใส่ PIN ผิด ----------
   ประกาศ keyframes ไว้ที่นี่เพราะ PinPad ถูกเรนเดอร์อยู่ในทุกหน้าจอที่ต้องใช้เอฟเฟกต์นี้
   วิธีใช้: <div className={wrong ? SHAKE_CLASS : ''} onAnimationEnd={() => setWrong(false)}>
   (ต้องเคลียร์ค่าใน onAnimationEnd ไม่งั้นครั้งต่อไปคลาสไม่เปลี่ยน → อนิเมชันไม่เล่นซ้ำ) */
export const SHAKE_CLASS = 'pos-pin-shake'

const SHAKE_CSS = `@keyframes pos-pin-shake{
  10%,90%{transform:translateX(-3px)}
  20%,80%{transform:translateX(4px)}
  30%,50%,70%{transform:translateX(-8px)}
  40%,60%{transform:translateX(8px)}
}
.${SHAKE_CLASS}{animation:pos-pin-shake .45s cubic-bezier(.36,.07,.19,.97) both}`

/* ---------- หน่วงเวลาเมื่อใส่ PIN ผิดซ้ำ ---------- */

/** ผิดครบกี่ครั้งจึงเริ่มหน่วงเวลา */
export const MAX_PIN_ATTEMPTS = 5
/** หน่วงเวลานานกี่วินาที */
export const PIN_LOCK_SECONDS = 30

/**
 * นับจำนวนครั้งที่ใส่ PIN ผิด แล้วปิดการกรอกชั่วคราวเมื่อผิดซ้ำหลายครั้ง
 *
 * `key` ใช้แยกการนับต่อพนักงาน — สลับไปเลือกคนอื่นแล้วยอดผิดของคนเดิมยังอยู่
 * (นับในหน่วยความจำเท่านั้น: รีเฟรชหน้าแล้วเริ่มใหม่ — พอสำหรับกันกดสุ่มมั่ว ไม่ใช่ระบบกันเจาะ)
 */
export function usePinLockout(key: string | number = 'pin'): {
  /** วินาทีที่เหลือก่อนกรอกได้อีกครั้ง (0 = กรอกได้) */
  remain: number
  locked: boolean
  /** บันทึกว่าผิด 1 ครั้ง → คืนจำนวนครั้งที่ผิดสะสม (ใช้แสดง "ครั้งที่ n") */
  fail: () => number
  reset: () => void
} {
  const k = String(key)
  const [fails, setFails] = useState<Record<string, number>>({})
  const [until, setUntil] = useState<Record<string, number>>({})
  const [now, setNow] = useState(() => Date.now())

  const lockUntil = until[k] ?? 0
  const remain = lockUntil > now ? Math.ceil((lockUntil - now) / 1000) : 0

  // เดินนาฬิกาเฉพาะช่วงที่กำลังถูกหน่วงเวลา แล้วหยุดเองเมื่อครบกำหนด (กัน re-render ทิ้ง)
  useEffect(() => {
    if (lockUntil <= Date.now()) return
    const timer = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= lockUntil) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [lockUntil])

  const fail = useCallback(() => {
    const n = (fails[k] ?? 0) + 1
    const hit = n >= MAX_PIN_ATTEMPTS
    // ครบโควตาแล้วเริ่มนับใหม่จาก 0 เพื่อให้หลังพ้นการหน่วงเวลามีโอกาสอีกรอบ
    setFails((m) => ({ ...m, [k]: hit ? 0 : n }))
    if (hit) {
      setUntil((m) => ({ ...m, [k]: Date.now() + PIN_LOCK_SECONDS * 1000 }))
      setNow(Date.now())
    }
    return n
  }, [fails, k])

  const reset = useCallback(() => setFails((m) => ({ ...m, [k]: 0 })), [k])

  return { remain, locked: remain > 0, fail, reset }
}

/* ---------- ตัวแป้นกด ---------- */

const KEY_CLS =
  'cursor-pointer select-none rounded-xl border border-slate-200 bg-white py-4 text-2xl font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:pointer-events-none disabled:opacity-40'

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export default function PinPad({
  value,
  onChange,
  onSubmit,
  maxLength = PIN_MAX,
  disabled = false,
  className = '',
}: PinPadProps) {
  const [reveal, setReveal] = useState(false)

  // เก็บค่าล่าสุดไว้ใน ref เพื่อผูก keydown ครั้งเดียว (ไม่ต้องถอด/ใส่ listener ทุกครั้งที่กดเลข)
  const latest = useRef({ value, onChange, onSubmit, maxLength, disabled })
  latest.current = { value, onChange, onSubmit, maxLength, disabled }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = latest.current
      if (s.disabled) return
      // ข้ามการกดค้างและเครื่องอ่านบาร์โค้ดที่ยิงคีย์รัวๆ (e.repeat) + คีย์ลัดที่มี modifier
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        if (s.value.length >= s.maxLength) return
        s.onChange(s.value + e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        s.onChange(s.value.slice(0, -1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        s.onSubmit?.()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        s.onChange('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const press = (d: string) => {
    if (disabled || value.length >= maxLength) return
    onChange(value + d)
  }

  /** ปุ่มบนแป้นไม่รับโฟกัสจากการคลิก — ไม่งั้นกด Enter ทีหลังจะไปกระตุ้นปุ่มที่เพิ่งกดแทนการยืนยัน */
  const noFocus = (e: MouseEvent) => e.preventDefault()

  return (
    <div className={className}>
      <style>{SHAKE_CSS}</style>

      {/* ช่องแสดงค่า — โชว์เป็นจุดตามจำนวนหลัก */}
      <div className="relative mb-3 flex h-14 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 px-12">
        {value.length === 0 ? (
          <span className="text-sm text-slate-400">ใส่ PIN</span>
        ) : reveal ? (
          <span className="text-2xl font-bold tracking-[0.35em] text-slate-700">{value}</span>
        ) : (
          <div className="flex items-center gap-2.5">
            {Array.from({ length: value.length }, (_, i) => (
              <span key={i} className="h-3 w-3 rounded-full bg-emerald-600" />
            ))}
          </div>
        )}
        {value.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={noFocus}
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'ซ่อน PIN' : 'แสดง PIN'}
            className="absolute right-2 cursor-pointer rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <Icon name="eye" size={18} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {DIGITS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onMouseDown={noFocus}
            onClick={() => press(d)}
            className={KEY_CLS}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || value.length === 0}
          onMouseDown={noFocus}
          onClick={() => onChange('')}
          className={`${KEY_CLS} text-base`}
        >
          ล้าง
        </button>
        <button
          type="button"
          disabled={disabled}
          onMouseDown={noFocus}
          onClick={() => press('0')}
          className={KEY_CLS}
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled || value.length === 0}
          onMouseDown={noFocus}
          onClick={() => onChange(value.slice(0, -1))}
          aria-label="ลบตัวเลขท้ายสุด"
          className={`${KEY_CLS} flex items-center justify-center`}
        >
          <Icon name="backspace" size={24} />
        </button>
      </div>
    </div>
  )
}
