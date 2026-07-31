import { useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'
import { buildPromptpayPayload, parsePromptpayId } from '../../lib/promptpay'
import { baht } from '../../lib/format'
import { Icon, Spinner } from '../../components/ui'

interface Props {
  /** รหัสพร้อมเพย์ของร้าน (จากหน้าตั้งค่า) */
  promptpayId?: string
  /** ยอดที่ฝังลงใน QR (บาท) — 0 = QR ไม่ระบุยอด ให้ลูกค้ากรอกเอง */
  amount: number
  shopName: string
  className?: string
}

/** QR ที่สร้างเสร็จแล้ว (จำยอดที่ใช้สร้างไว้ กันแสดง QR ยอดเก่าค้าง) */
interface QrImage {
  amount: number
  url: string
}

const KIND_LABEL = {
  phone: 'เบอร์โทร',
  nationalId: 'เลขบัตร / ผู้เสียภาษี',
  ewallet: 'e-Wallet',
} as const

/** QR พร้อมเพย์ฝังยอด — สร้างในเครื่อง ไม่ต้องต่อเน็ต */
export default function QrPay({ promptpayId, amount, shopName, className = '' }: Props) {
  const [qr, setQr] = useState<QrImage | null>(null)
  const [error, setError] = useState('')

  const id = (promptpayId ?? '').trim()
  const target = parsePromptpayId(id)
  const ready = target != null

  useEffect(() => {
    if (!ready) {
      setQr(null)
      setError('')
      return
    }
    const payload = buildPromptpayPayload(id, amount > 0 ? amount : undefined)
    if (!payload) {
      setQr(null)
      setError('สร้าง QR ไม่สำเร็จ — ตรวจรหัสพร้อมเพย์ที่หน้าตั้งค่า')
      return
    }
    let alive = true
    setError('')
    toDataURL(payload, { width: 320, margin: 1 })
      .then((url) => {
        if (alive) setQr({ amount, url })
      })
      .catch(() => {
        if (alive) setError('สร้าง QR ไม่สำเร็จ — รับเงินโอนตามปกติได้เลย')
      })
    return () => {
      alive = false
    }
  }, [id, amount, ready])

  // ยังไม่ได้ตั้งพร้อมเพย์ / รหัสไม่ถูกต้อง — ยังจ่ายแบบโอนได้ตามปกติ
  if (!ready) {
    return (
      <div className={`rounded-2xl bg-slate-100 px-4 py-5 text-center ${className}`}>
        <Icon name="qr" size={30} className="mx-auto text-slate-400" />
        <div className="mt-2 text-sm font-semibold text-slate-600">ยังไม่ได้ตั้งพร้อมเพย์</div>
        <div className="mt-0.5 text-xs text-slate-400">
          ตั้งรหัสพร้อมเพย์ได้ที่หน้าตั้งค่า — รับเงินโอนแบบเดิมได้ตามปกติ
        </div>
      </div>
    )
  }

  const stale = qr != null && qr.amount !== amount

  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 ${className}`}
    >
      <div className="text-base font-bold text-slate-800">
        สแกนเพื่อจ่าย {amount > 0 ? `฿${baht(amount)}` : '(ไม่ระบุยอด)'}
      </div>

      <div className="relative flex h-60 w-60 max-w-full items-center justify-center">
        {qr ? (
          <img
            src={qr.url}
            alt="QR พร้อมเพย์"
            className={`h-full w-full ${stale ? 'opacity-20' : ''}`}
          />
        ) : error ? (
          <div className="px-2 text-center text-sm font-medium text-rose-600">{error}</div>
        ) : (
          <Spinner />
        )}
        {qr && stale && <Spinner className="absolute" />}
      </div>

      <div className="text-center">
        <div className="text-sm font-semibold text-slate-700">{shopName}</div>
        <div className="text-xs text-slate-400">
          พร้อมเพย์ ({KIND_LABEL[target.kind]}) {id}
        </div>
      </div>

      {qr && error && <div className="text-xs font-medium text-rose-600">{error}</div>}
    </div>
  )
}
