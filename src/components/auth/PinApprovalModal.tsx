import { useEffect, useState } from 'react'
import PinPad, { SHAKE_CLASS } from './PinPad'
import { Button, Icon, Modal } from '../ui'
import { db } from '../../db/db'
import { validatePin, verifyPin } from '../../lib/auth'
import { PERMISSION_LABELS, hasPerm } from '../../lib/permissions'
import type { PermissionKey, Staff, StaffRole } from '../../db/types'

/* =========================================================
   ขออนุมัติด้วย PIN — พนักงานที่ไม่มีสิทธิ์เรียกผู้จัดการ/เจ้าของร้านมากดอนุมัติแทน
   ========================================================= */

export interface PinApprovalModalProps {
  open: boolean
  perm: PermissionKey
  title?: string
  description?: string
  onClose: () => void
  /** เรียกเมื่อ PIN ตรงกับคนที่มีสิทธิ์ — ผู้เรียกเป็นฝ่ายปิดโมดัลเอง */
  onApprove: (approver: Staff) => void
}

/** ลำดับการค้นหา — ผู้อนุมัติมักเป็นเจ้าของร้าน/ผู้จัดการ ค้นก่อนจะเจอเร็วกว่า (verifyPin ต้องแฮชทีละคน) */
const ROLE_ORDER: Record<StaffRole, number> = { owner: 0, manager: 1, cashier: 2 }

export default function PinApprovalModal({
  open,
  perm,
  title = 'ต้องได้รับอนุมัติ',
  description,
  onClose,
  onApprove,
}: PinApprovalModalProps) {
  const [pin, setPin] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [wrong, setWrong] = useState(false)

  // เคลียร์ทุกครั้งที่เปิดใหม่ — ไม่ให้ PIN/ข้อความผิดพลาดของรอบก่อนค้างอยู่
  useEffect(() => {
    if (!open) return
    setPin('')
    setError('')
    setChecking(false)
    setWrong(false)
  }, [open])

  function reject(message: string) {
    setPin('')
    setError(message)
    setWrong(true)
  }

  async function submit() {
    if (checking) return
    const invalid = validatePin(pin)
    if (invalid) {
      setError(invalid)
      setWrong(true)
      return
    }
    setChecking(true)
    try {
      const candidates = (await db.staff.toArray())
        .filter((s) => s.active)
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])

      let found: Staff | undefined
      for (const s of candidates) {
        if (await verifyPin(pin, s.pinHash)) {
          found = s
          break
        }
      }

      if (!found) {
        reject('PIN ไม่ถูกต้อง')
        return
      }
      if (!hasPerm(found, perm)) {
        reject(`บัญชี ${found.name} ไม่มีสิทธิ์อนุมัติรายการนี้`)
        return
      }
      onApprove(found)
      setPin('')
      setError('')
    } finally {
      setChecking(false)
    }
  }

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
            icon="shield"
            disabled={checking || pin.length === 0}
            onClick={() => void submit()}
          >
            {checking ? 'กำลังตรวจสอบ…' : 'อนุมัติ'}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 p-3.5 text-sm text-amber-800 ring-1 ring-amber-200">
        <Icon name="shield" size={20} className="mt-0.5" />
        <div>
          <p>
            การทำรายการนี้ต้องมีสิทธิ์ “{PERMISSION_LABELS[perm]}” — ให้ผู้จัดการหรือเจ้าของร้านใส่
            PIN เพื่ออนุมัติ
          </p>
          {description && <p className="mt-1.5 text-amber-700">{description}</p>}
        </div>
      </div>

      <div className={wrong ? SHAKE_CLASS : ''} onAnimationEnd={() => setWrong(false)}>
        <PinPad
          value={pin}
          onChange={(v) => {
            setPin(v)
            setError('')
          }}
          onSubmit={submit}
          disabled={checking}
        />
        {error && <p className="mt-3 text-center text-sm font-medium text-rose-600">{error}</p>}
      </div>
    </Modal>
  )
}
