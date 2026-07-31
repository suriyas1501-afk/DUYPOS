import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { create } from 'zustand'
import { useAuth } from '../stores/authStore'

/* =========================================================
   ไอคอน (เส้น stroke สไตล์ lucide)
   ========================================================= */

const ICON_PATHS = {
  home: 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
  cart: 'M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6 M10 21a1 1 0 1 1-2 0 1 1 0 0 1 2 0 M21 21a1 1 0 1 1-2 0 1 1 0 0 1 2 0',
  box: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96 12 12.01l8.73-5.05 M12 22.08V12',
  tag: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  receipt: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8',
  chart: 'M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3',
  gear: 'M21 4h-7 M10 4H3 M21 12h-9 M8 12H3 M21 20h-5 M12 20H3 M14 2v4 M8 10v4 M16 18v4',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
  x: 'M18 6 6 18 M6 6l12 12',
  search: 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0 M21 21l-4.35-4.35',
  pencil: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  printer: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z',
  wifi: 'M5 12.55a11 11 0 0 1 14.08 0 M1.42 9a16 16 0 0 1 21.16 0 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01',
  wifioff: 'M1 1l22 22 M16.72 11.06A10.94 10.94 0 0 1 19 12.55 M5 12.55a10.94 10.94 0 0 1 5.17-2.39 M10.71 5.05A16 16 0 0 1 22.58 9 M1.42 9a15.91 15.91 0 0 1 4.7-2.88 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01',
  check: 'M20 6 9 17l-5-5',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 8l5-5 5 5 M12 3v12',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2',
  cash: 'M2 6h20v12H2z M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M6 12h.01 M18 12h.01',
  qr: 'M3 3h5v5H3z M16 3h5v5h-5z M3 16h5v5H3z M13 13h2v2h-2z M18 13h3v3h-3z M13 18h3v3h-3z',
  card: 'M2 5h20v14H2z M2 10h20',
  pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
  history: 'M3 3v5h5 M3.05 13A9 9 0 1 0 6 5.3L3 8 M12 7v5l4 2',
  coffee: 'M17 8h1a4 4 0 1 1 0 8h-1 M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z M6 1v3 M10 1v3 M14 1v3',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  refresh: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5',
  wallet: 'M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4z',
  truck: 'M1 3h15v13H1z M16 8h4l3 3v5h-7V8 M5.5 18.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M20.5 18.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  clipboard:
    'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6v4H9z M9 12l2 2 4-4',
  ticket:
    'M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6 M13 5v14',
  undo: 'M3 7v6h6 M3.51 13a9 9 0 1 0 2.13-9.36L3 7',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4 M12 15v2',
  unlock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 7.6-1.6 M12 15v2',
  shield: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z M9 12l2 2 4-4',
  invoice:
    'M4 3h16v18l-3-2-2 2-2-2-2 2-2-2-3 2z M8 7h8 M8 11h8 M8 15h5',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  backspace: 'M21 5H8l-6 7 6 7h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z M17 9l-6 6 M11 9l6 6',
} as const

export type IconName = keyof typeof ICON_PATHS

export function Icon({
  name,
  size = 20,
  className = '',
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

/* =========================================================
   ปุ่ม
   ========================================================= */

const BTN_VARIANTS = {
  primary: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm',
  secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300',
  danger: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm',
  ghost: 'hover:bg-slate-100 text-slate-600',
} as const

const BTN_SIZES = {
  sm: 'px-2.5 py-1.5 text-sm rounded-lg gap-1.5',
  md: 'px-4 py-2 text-sm rounded-xl gap-2',
  lg: 'px-5 py-3 text-base rounded-xl gap-2',
} as const

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BTN_VARIANTS
  size?: keyof typeof BTN_SIZES
  icon?: IconName
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${BTN_VARIANTS[variant]} ${BTN_SIZES[size]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 18} />}
      {children}
    </button>
  )
}

/* =========================================================
   ฟอร์ม
   ========================================================= */

export const INPUT_CLS =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50 disabled:text-slate-400'

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${INPUT_CLS} ${className}`} {...rest} />
}

export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${INPUT_CLS} ${className}`} {...rest} />
}

export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${INPUT_CLS} ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2"
    >
      <span
        className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
      {label && <span className="text-sm text-slate-700">{label}</span>}
    </button>
  )
}

/* =========================================================
   โมดัล
   ========================================================= */

const MODAL_SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const

/** สแต็กโมดัลที่เปิดอยู่ — ให้ Esc ปิดเฉพาะตัวบนสุดเมื่อมีโมดัลซ้อนกัน */
const modalStack: symbol[] = []

/**
 * มีโมดัลเปิดอยู่หรือไม่ — ให้คีย์ลัด/ช่องยิงบาร์โค้ดของหน้าจอด้านหลังหยุดรับคีย์
 * (กันเคสยิงบาร์โค้ดต่อเนื่องแล้วคีย์ตกไปที่หน้าหลังโมดัล)
 */
export const isModalOpen = () => modalStack.length > 0

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: keyof typeof MODAL_SIZES
}) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const id = Symbol('modal')
    modalStack.push(id)
    // ดึงโฟกัสเข้าโมดัลถ้าไม่มีช่องไหนถูกโฟกัสไว้ (autoFocus) — กันคีย์/บาร์โค้ดที่ยิงต่อเนื่อง
    // ตกลงไปที่ช่องค้นหาของหน้าจอด้านหลัง แล้วสั่งงานหน้านั้นโดยไม่ตั้งใจ
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) panel.focus()
    const onKey = (e: KeyboardEvent) => {
      // หน้าจอถูกล็อกอยู่ (ฉากล็อกทับด้านหน้า) — คีย์ต้องไม่ทะลุไปสั่งงานโมดัลที่ค้างอยู่ข้างหลัง
      if (useAuth.getState().locked) return
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      const i = modalStack.indexOf(id)
      if (i >= 0) modalStack.splice(i, 1)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal
        className={`relative flex max-h-[92vh] w-full flex-col rounded-2xl bg-white shadow-2xl outline-none ${MODAL_SIZES[size]}`}
      >
        {title != null && (
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="text-base font-bold text-slate-800">{title}</h3>
            <button
              onClick={onClose}
              className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">{footer}</div>
        )}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'ยืนยัน',
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600">{message}</div>
    </Modal>
  )
}

/* =========================================================
   องค์ประกอบทั่วไป
   ========================================================= */

const BADGE_COLORS = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
} as const

export function Badge({
  color = 'slate',
  children,
  className = '',
}: {
  color?: keyof typeof BADGE_COLORS
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${BADGE_COLORS[color]} ${className}`}
    >
      {children}
    </span>
  )
}

export function Card({
  title,
  actions,
  children,
  className = '',
  padded = true,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title != null || actions) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-bold text-slate-700">{title}</h3>
          {actions}
        </div>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  icon = 'box',
  title,
  hint,
}: {
  icon?: IconName
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 rounded-2xl bg-slate-100 p-4 text-slate-400">
        <Icon name={icon} size={28} />
      </div>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent ${className}`}
    />
  )
}

/* =========================================================
   Toast
   ========================================================= */

interface ToastItem {
  id: number
  type: 'success' | 'error'
  message: string
}

interface ToastState {
  toasts: ToastItem[]
  push(type: ToastItem['type'], message: string): void
  remove(id: number): void
}

let toastId = 0

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push(type, message) {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3200)
  },
  remove(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
}

export function ToastHost() {
  const { toasts, remove } = useToastStore()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => remove(t.id)}
          className={`pointer-events-auto flex cursor-pointer items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            t.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
          }`}
        >
          <Icon name={t.type === 'success' ? 'check' : 'alert'} size={17} />
          {t.message}
        </div>
      ))}
    </div>
  )
}
