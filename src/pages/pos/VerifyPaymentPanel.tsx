import { useRef, useState } from 'react'
import type { Sale, Settings } from '../../db/types'
import { usePermissions } from '../../db/hooks'
import {
  amountNeedingVerify,
  canSendToKitchen,
  methodsNeedingVerify,
  sendToKitchen,
  verifyPayment,
} from '../../lib/quickService'
import { PAY_LABEL, printKitchenSlip, printReceipt } from '../../lib/receipt'
import { baht, fmtTime } from '../../lib/format'
import { Button, Icon, Input, toast } from '../../components/ui'

interface Props {
  /** บิลที่บันทึกแล้ว (หน้าสำเร็จของโมดัลชำระเงิน) */
  sale: Sale
  settings: Settings
  /** กำลังเขียน DB อยู่ — พ่อเป็นคนถือ state นี้ เพราะต้องกันปิดโมดัลด้วย */
  busy: boolean
  onBusy: (v: boolean) => void
  /** ส่ง Sale ตัวใหม่กลับให้พ่อ เพื่อให้ UI สะท้อนสถานะทันทีโดยไม่ต้องอ่าน DB ซ้ำ */
  onSaleChange: (sale: Sale) => void
  /** จบการขาย เริ่มบิลใหม่ (เคลียร์ตะกร้า) */
  onDone: () => void
  /** ผู้ใช้กด "ขายรายการถัดไป" ทั้งที่ยังไม่ได้ส่งเข้าครัว — ให้พ่อขึ้นกล่องยืนยันก่อน */
  onSkipRequest: () => void
}

/**
 * ด่านตรวจการชำระเงินก่อนส่งออเดอร์เข้าครัว (โหมดบริการด่วน)
 *
 * กติกา: เงินสด = เห็นเงินอยู่ในมือ ถือว่าตรวจแล้วในตัว / โอน-QR และบัตร = ต้องมีคนกดยืนยันก่อน
 * ปุ่ม "ส่งเข้าครัว" จะกดไม่ได้จนกว่าจะผ่าน canSendToKitchen() และ sendToKitchen()
 * ยังตรวจกติกาเดิมซ้ำในทรานแซกชันอีกชั้น — ซ่อน/ปิดปุ่มอย่างเดียวไม่ถือเป็นการกัน
 */
export default function VerifyPaymentPanel({
  sale,
  settings,
  busy,
  onBusy,
  onSaleChange,
  onDone,
  onSkipRequest,
}: Props) {
  const { can } = usePermissions()
  const allowed = can('kitchen')
  const [refNo, setRefNo] = useState('')
  /** กันกดรัวๆ ก่อน busy จาก state ของพ่อจะทันอัปเดตกลับมา */
  const running = useRef(false)

  const sent = sale.orderStatus != null
  const methods = methodsNeedingVerify(sale)
  const methodText = methods.map((m) => PAY_LABEL[m]).join(' + ')
  const verifiedAt = sale.paymentVerifiedAt
  const gate = canSendToKitchen(sale, settings)
  /** ยังมีโอน/บัตรที่ไม่มีใครกดยืนยัน — ต้องขึ้นด่านตรวจ */
  const awaitingVerify = !sent && methods.length > 0 && verifiedAt == null
  const queueText = sale.queueNo != null ? ` · คิว ${sale.queueNo}` : ''

  /** เหตุผลที่กดส่งเข้าครัวไม่ได้ (undefined = ส่งได้) */
  const blockReason = !allowed
    ? 'ไม่มีสิทธิ์จอครัว — ให้ผู้จัดการเป็นคนกดส่งเข้าครัว'
    : gate.ok
      ? undefined
      : gate.reason

  const doVerify = async () => {
    if (running.current || busy || !allowed || sale.id == null) return
    running.current = true
    onBusy(true)
    try {
      const next = await verifyPayment(sale.id, { ref: refNo })
      onSaleChange(next)
      toast.success('บันทึกการตรวจการชำระเงินแล้ว')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกการตรวจไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      running.current = false
      onBusy(false)
    }
  }

  const doSend = async () => {
    if (running.current || busy || sale.id == null) return
    // เช็คซ้ำที่จุดกด ไม่ใช่แค่ตอน render — สถานะอาจเปลี่ยนไปแล้ว
    if (!allowed) {
      toast.error('ไม่มีสิทธิ์ส่งออเดอร์เข้าครัว')
      return
    }
    const now = canSendToKitchen(sale, settings)
    if (!now.ok) {
      toast.error(now.reason)
      return
    }
    running.current = true
    onBusy(true)
    try {
      const next = await sendToKitchen(sale.id)
      onSaleChange(next)
      // พิมพ์สลิปครัวให้เลย (ค่าเริ่มต้นเปิด) — ครัวจะได้เห็นออเดอร์บนกระดาษด้วย ไม่ใช่แค่บนจอ
      if (settings.kitchenAutoPrint !== false) printKitchenSlip(next, settings)
      toast.success(`ส่งเข้าครัวแล้ว${queueText}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งเข้าครัวไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      running.current = false
      onBusy(false)
    }
  }

  return (
    <div className="w-full space-y-3 text-left">
      {sent ? (
        /* ----- ส่งเข้าครัวแล้ว ----- */
        <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
          <span className="mt-0.5 rounded-full bg-emerald-600 p-1 text-white">
            <Icon name="check" size={16} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-emerald-800">ส่งเข้าครัวแล้ว{queueText}</div>
            <div className="mt-0.5 text-xs text-emerald-700">
              ครัวเห็นออเดอร์นี้แล้ว — ติดตามสถานะต่อได้ที่จอครัว
            </div>
          </div>
        </div>
      ) : awaitingVerify ? (
        /* ----- ยังไม่ได้ตรวจ: โอน/QR หรือบัตร ----- */
        <div className="space-y-3">
          <div className="rounded-2xl bg-amber-50 px-4 py-3 ring-2 ring-amber-400">
            <div className="flex items-center gap-2 text-amber-900">
              <Icon name="alert" size={18} />
              <span className="text-sm font-bold">ยังไม่ได้ตรวจการชำระเงิน</span>
            </div>
            <div className="mt-2 text-sm text-amber-900">
              ต้องตรวจ <span className="text-lg font-black">฿{baht(amountNeedingVerify(sale))}</span>{' '}
              ทาง <span className="font-bold">{methodText}</span>
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-amber-800">
              เปิดแอปธนาคารดูยอดเข้าจริง อย่าดูจากสลิปในมือลูกค้าอย่างเดียว — สลิปปลอมทำได้ง่าย
              ถ้าเงินยังไม่เข้า อย่าเพิ่งส่งเข้าครัว
            </div>
            {gate.ok && (
              <div className="mt-2 border-t border-amber-200 pt-2 text-xs text-amber-700">
                ร้านนี้ปิด "บังคับตรวจก่อนส่งเข้าครัว" ไว้ จึงส่งได้เลย — แต่แนะนำให้กดยืนยันไว้
                จะได้ตามกลับได้ว่าใครเป็นคนตรวจ
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600">
              เลขอ้างอิง / 4 ตัวท้ายสลิป <span className="text-slate-400">(ไม่บังคับ)</span>
            </span>
            <Input
              value={refNo}
              maxLength={40}
              placeholder="เช่น 1234 หรือเลขอนุมัติบัตร"
              disabled={busy || !allowed}
              onChange={(e) => setRefNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.repeat) void doVerify()
              }}
            />
          </label>

          <Button
            icon="shield"
            className="w-full py-3 text-base"
            disabled={busy || !allowed}
            onClick={() => void doVerify()}
          >
            {busy ? 'กำลังบันทึก…' : 'ตรวจแล้ว ยอดเงินเข้าตรง'}
          </Button>
          {!allowed && (
            <div className="text-xs font-medium text-amber-700">
              ไม่มีสิทธิ์จอครัว — ให้ผู้จัดการเป็นคนกดยืนยันการตรวจ
            </div>
          )}
        </div>
      ) : (
        /* ----- ตรวจแล้ว หรือ เงินสดล้วน: ส่งเข้าครัวได้เลย ----- */
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
          <div className="flex items-center gap-2 text-emerald-800">
            <Icon name="check" size={18} />
            <span className="text-sm font-bold">
              {methods.length === 0
                ? 'รับเงินสดครบแล้ว — ส่งเข้าครัวได้เลย'
                : 'ตรวจการชำระเงินแล้ว — ส่งเข้าครัวได้เลย'}
            </span>
          </div>
          {verifiedAt != null && (
            <div className="mt-1 text-xs text-emerald-700">
              {/* ร้านที่ปิดระบบพนักงานจะไม่มีชื่อผู้ตรวจ — แสดงแค่เวลา ดีกว่าขึ้นคำว่า "ไม่ระบุ" */}
              {sale.paymentVerifiedByName?.trim()
                ? `ตรวจโดย ${sale.paymentVerifiedByName.trim()} · ${fmtTime(verifiedAt)}`
                : `ตรวจเมื่อ ${fmtTime(verifiedAt)}`}
              {sale.paymentRef ? ` · อ้างอิง ${sale.paymentRef}` : ''}
            </div>
          )}
        </div>
      )}

      {/* ปุ่มหลัก: ส่งเข้าครัว (ยังไม่ส่ง) — ห่อ div ไว้เพราะปุ่มที่ disabled ไม่โชว์ title */}
      {!sent && (
        <div title={blockReason}>
          <Button
            size="lg"
            icon="coffee"
            className="w-full"
            disabled={busy || blockReason != null}
            onClick={() => void doSend()}
          >
            {busy ? 'กำลังส่ง…' : `ส่งเข้าครัว${queueText}`}
          </Button>
        </div>
      )}
      {!sent && blockReason && (
        <div className="flex items-start gap-1.5 text-xs font-medium text-amber-700">
          <Icon name="alert" size={14} className="mt-px" />
          <span>{blockReason}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {/* ใบเสร็จพิมพ์ได้เสมอ — เป็นหลักฐานให้ลูกค้า ไม่ใช่คำสั่งครัว */}
        <Button variant="secondary" icon="printer" onClick={() => printReceipt(sale, settings)}>
          พิมพ์ใบเสร็จ
        </Button>
        {/* สลิปครัว = คำสั่งทำอาหาร ต้องผ่านด่านเดียวกับปุ่มส่งเข้าครัว
            ไม่งั้นพนักงานพิมพ์สลิปยื่นให้ครัวได้ทั้งที่เงินยังไม่เข้า */}
        <div title={!sent && blockReason ? blockReason : undefined}>
          <Button
            variant="secondary"
            icon="coffee"
            className="w-full"
            disabled={busy || (!sent && blockReason != null)}
            onClick={() => printKitchenSlip(sale, settings)}
          >
            พิมพ์สลิปครัว
          </Button>
        </div>
      </div>

      <Button
        variant={sent ? 'primary' : 'ghost'}
        icon="cart"
        className="w-full"
        disabled={busy}
        onClick={sent ? onDone : onSkipRequest}
      >
        ขายรายการถัดไป
      </Button>
    </div>
  )
}
