import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermissions } from '../db/hooks'
import { PERMISSION_LABELS, ROLE_LABEL } from '../lib/permissions'
import type { PermissionKey } from '../db/types'
import { Button, Icon } from './ui'

/**
 * ห่อหน้าที่ต้องมีสิทธิ์ — ไม่มีสิทธิ์จะเห็นการ์ดแจ้งเตือนแทนเนื้อหา
 * (แถบนำทางซ่อนเมนูที่ไม่มีสิทธิ์อยู่แล้ว อันนี้กันการพิมพ์ URL ตรงๆ)
 */
export default function RequirePerm({
  perm,
  children,
}: {
  perm: PermissionKey
  children: ReactNode
}) {
  const { staff, can } = usePermissions()
  const navigate = useNavigate()

  if (can(perm)) return <>{children}</>

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rounded-2xl bg-amber-50 p-4 text-amber-600">
        <Icon name="alert" size={30} />
      </div>
      <div>
        <h2 className="text-lg font-bold text-slate-800">ไม่มีสิทธิ์เข้าถึงหน้านี้</h2>
        <p className="mt-1 text-sm text-slate-500">
          ต้องมีสิทธิ์ “{PERMISSION_LABELS[perm]}”
          {staff && ` — บัญชี ${staff.name} (${ROLE_LABEL[staff.role]}) ยังไม่ได้รับสิทธิ์นี้`}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          ให้เจ้าของร้านเพิ่มสิทธิ์ที่หน้า “พนักงาน” หรือเข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์
        </p>
      </div>
      <Button variant="secondary" icon="home" onClick={() => navigate('/')}>
        กลับหน้าแรก
      </Button>
    </div>
  )
}
