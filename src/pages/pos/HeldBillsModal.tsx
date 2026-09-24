import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { HeldBill } from '../../db/types'
import { useCart, type CartItem } from '../../stores/cartStore'
import { fmtDateTime } from '../../lib/format'
import { Button, ConfirmDialog, EmptyState, Icon, Modal, toast } from '../../components/ui'

/** โมดัลรายการบิลที่พักไว้: โหลดกลับเข้าตะกร้า / ลบทิ้ง */
export default function HeldBillsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const bills = useLiveQuery(() => db.heldBills.orderBy('createdAt').reverse().toArray(), [])
  const cartCount = useCart((s) => s.items.length)
  const [pending, setPending] = useState<HeldBill | null>(null)
  /** บิลที่รอยืนยันการลบ — ลบบิลพักกู้คืนไม่ได้ ห้ามลบทันทีจากการกดปุ่มเดียว */
  const [pendingDelete, setPendingDelete] = useState<HeldBill | null>(null)

  const doLoad = (b: HeldBill) => {
    useCart.getState().load(b.items as CartItem[], b.memberId, {
      billDiscountType: b.billDiscountType,
      billDiscountValue: b.billDiscountValue,
      redeemPoints: b.redeemPoints,
      couponCode: b.couponCode,
      // ผู้อนุมัติส่วนลดกลับเข้าตะกร้าพร้อมตัวเลขส่วนลดเสมอ — ผู้จัดการอนุมัติบิลใบนี้ไว้แล้ว
      // ตอนพักบิล จึงไม่ต้องขออนุมัติซ้ำ (บิลเก่าที่ไม่มีผู้อนุมัติจะถูก CartPanel ล้างส่วนลดให้)
      discountApprovedById: b.discountApprovedById,
      discountApprovedByName: b.discountApprovedByName,
    })
    if (b.id != null) void db.heldBills.delete(b.id)
    toast.success('เรียกบิลกลับเข้าตะกร้าแล้ว')
    onClose()
  }

  const tryLoad = (b: HeldBill) => {
    if (cartCount > 0) setPending(b)
    else doLoad(b)
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="บิลที่พักไว้">
        {!bills || bills.length === 0 ? (
          <EmptyState
            icon="pause"
            title="ไม่มีบิลที่พักไว้"
            hint="กดปุ่ม “พักบิล” ที่ตะกร้าเพื่อเก็บบิลไว้ขายต่อภายหลัง"
          />
        ) : (
          <div className="divide-y divide-slate-50">
            {bills.map((b) => {
              const count = (b.items as CartItem[]).length
              return (
                <div key={b.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <Icon name="pause" size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-700">{b.label}</div>
                    <div className="text-xs text-slate-400">
                      {fmtDateTime(b.createdAt)} · {count} รายการ
                      {b.couponCode ? ` · คูปอง ${b.couponCode}` : ''}
                    </div>
                  </div>
                  <Button size="sm" icon="cart" onClick={() => tryLoad(b)}>
                    โหลด
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    className="text-rose-500"
                    title="ลบบิลที่พักไว้"
                    onClick={() => setPendingDelete(b)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={pending != null}
        title="โหลดบิลที่พักไว้"
        message="ตะกร้าปัจจุบันมีรายการอยู่ — โหลดบิลนี้จะแทนที่ตะกร้าทั้งหมด ต้องการดำเนินการต่อหรือไม่?"
        confirmLabel="โหลดบิล"
        onConfirm={() => {
          if (pending) doLoad(pending)
        }}
        onClose={() => setPending(null)}
      />

      <ConfirmDialog
        open={pendingDelete != null}
        danger
        title="ลบบิลที่พักไว้"
        message={
          pendingDelete
            ? `ลบ “${pendingDelete.label}” ทิ้งถาวร — รายการในบิลนี้จะหายทั้งหมด กู้คืนไม่ได้`
            : ''
        }
        confirmLabel="ลบทิ้ง"
        onConfirm={() => {
          const id = pendingDelete?.id
          if (id == null) return
          // pendingDelete เป็น snapshot — อีกแท็บอาจโหลดบิลใบนี้กลับเข้าตะกร้าไปแล้ว
          // (doLoad ลบแถวทิ้งทันที) ต้องอ่านผลจริงก่อนแจ้ง ไม่ใช่แจ้งสำเร็จไว้ก่อน
          void db
            .transaction('rw', db.heldBills, async () => {
              if (!(await db.heldBills.get(id))) return false
              await db.heldBills.delete(id)
              return true
            })
            .then((ok) =>
              ok
                ? toast.success('ลบบิลที่พักไว้แล้ว')
                : toast.error('บิลนี้ถูกเรียกใช้หรือถูกลบไปแล้ว'),
            )
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  )
}
