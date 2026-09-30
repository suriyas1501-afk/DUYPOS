import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../../db/types'
import type { CartItem } from '../../stores/cartStore'
import { deleteSlip, loadSlip, resizePhoto, saveSlip } from '../../lib/slipPhoto'
import { baht } from '../../lib/format'
import { Button, Icon, Input, Modal, Spinner, toast } from '../../components/ui'
import QrPay from '../pos/QrPay'

/* =========================================================
   ขั้นที่ 4 — กาง QR ให้ลูกค้าสแกนจ่าย แล้วถ่ายรูปสลิปเป็นหลักฐาน

   ลำดับย่อยในหน้านี้สลับไม่ได้ (TABLE-ORDER-PLAN.md §18 ข้อเน้นที่ 2):
     กาง QR → ลูกค้าจ่าย → พนักงานเช็คแอปธนาคาร → **ถ่ายรูปหลังจ่ายแล้ว**
   ถ้าถ่ายก่อนลูกค้าจ่าย รูปนั้นไม่ใช่หลักฐานอะไรเลย ปุ่มกล้องจึงเขียนกำกับไว้ชัด
   ว่ากดเมื่อลูกค้าจ่ายแล้ว และไม่โผล่มาพร้อม QR ตั้งแต่แรก

   **รูปสลิปไม่ใช่หลักฐานตัวจริง** (ถ่ายสลิปเก่าซ้ำได้) ตัวที่ผูกความรับผิด
   คือชื่อคนที่กดยืนยันในขั้นที่ 5 — หน้านี้จึงแค่เก็บรูปไว้ประกอบ
   ========================================================= */

/** เหตุผลที่เลือกได้เมื่อไม่มีสลิป */
const MISSING_REASONS = ['ลูกค้าจ่ายเงินสด', 'สลิปไม่ชัด / ถ่ายไม่ได้', 'ลูกค้าไม่ยอมให้ถ่าย'] as const

export default function PayAndSlip({
  tableLabel,
  items,
  payable,
  settings,
  slipId,
  slipMissingReason,
  onAttachSlip,
  onClearSlip,
  onSetSlipMissing,
  onBack,
  onDiscard,
}: {
  tableLabel: string
  items: CartItem[]
  /** ยอดที่ลูกค้าต้องจ่าย — ตัวเดียวกับที่ฝังใน QR */
  payable: number
  settings: Settings
  slipId?: string
  slipMissingReason?: string
  onAttachSlip: (slipId: string) => void
  onClearSlip: () => void
  onSetSlipMissing: (reason: string) => void
  /** ย้อนกลับไปหน้าสรุป — พ่อจะไม่ส่งมาให้ถ้ามีสลิปแนบแล้ว */
  onBack?: () => void
  /**
   * ทิ้งใบสั่งทั้งใบ — **ต้องมีในหน้านี้ด้วย**
   * ถ้าไม่มี พนักงานที่แนบสลิปแล้วแต่ลูกค้าเดินหนีจะเหลือทางเดียวคือกด "เอาออก"
   * ซึ่งลบรูปทิ้ง = ทำลายร่องรอยว่ารับเงินโต๊ะไหนไปเท่าไร
   * เส้นทางนี้เก็บแถวใน slipQueue ไว้ (ดู discard() ใน TableOrder.tsx)
   */
  onDiscard: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  /** URL ชั่วคราวของรูปที่แนบไว้ (ต้อง revoke ทุกครั้งที่เปลี่ยน ไม่งั้นหน่วยความจำรั่ว) */
  const [preview, setPreview] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const [missingOpen, setMissingOpen] = useState(false)
  const [customReason, setCustomReason] = useState('')

  /* โหลดรูปที่แนบไว้มาแสดง — ดึงจาก slipQueue ไม่ได้เก็บไว้ในดราฟต์ */
  useEffect(() => {
    let url: string | null = null
    let alive = true
    if (slipId == null) {
      setPreview(null)
      return
    }
    void loadSlip(slipId).then((row) => {
      if (!alive || !row) return
      url = URL.createObjectURL(row.blob)
      setPreview(url)
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [slipId])

  const pickPhoto = () => fileRef.current?.click()

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    try {
      const { blob } = await resizePhoto(file)
      const newId = await saveSlip({ blob, tableLabel, amount: payable })
      const old = slipId
      onAttachSlip(newId)
      // ลบใบเก่าหลังแนบใบใหม่สำเร็จแล้วเท่านั้น — ลบก่อนแล้วพลาดจะเหลือศูนย์หลักฐาน
      if (old && old !== newId) await deleteSlip(old)
      toast.success('แนบรูปสลิปแล้ว')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ใช้รูปนี้ไม่ได้ ลองถ่ายใหม่')
    } finally {
      setBusy(false)
      // ล้างค่า input ไม่งั้นเลือกไฟล์เดิมซ้ำจะไม่ยิง onChange
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeSlip = async () => {
    if (!slipId || busy) return
    setBusy(true)
    try {
      const id = slipId
      onClearSlip()
      await deleteSlip(id)
      toast.success('เอารูปสลิปออกแล้ว')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* ===== ยอดที่ต้องเก็บ ===== */}
        <div className="rounded-2xl bg-white p-3.5 shadow-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-base font-bold text-slate-800">โต๊ะ {tableLabel}</span>
            <span className="text-xs text-slate-400">{items.length} บรรทัด</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-sm text-slate-500">ยอดที่ลูกค้าต้องจ่าย</span>
            <span className="text-2xl leading-none font-bold text-slate-900 tabular-nums">
              ฿{baht(payable)}
            </span>
          </div>
        </div>

        {/* ===== QR พร้อมเพย์ฝังยอด ===== */}
        <div className="rounded-2xl bg-white p-3.5 shadow-sm">
          <QrPay
            promptpayId={settings.promptpayId}
            amount={payable}
            shopName={settings.shopName}
          />
        </div>

        {/* ===== ถ่ายรูปสลิป — ต้องหลังลูกค้าจ่ายแล้ว ===== */}
        <div className="rounded-2xl bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Icon name="shield" size={16} className="text-slate-400" />
            หลักฐานการจ่ายเงิน
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            เปิดแอปธนาคารดูว่าเงินเข้าจริงก่อน แล้วค่อยถ่ายรูปสลิป —
            อย่าดูจากสลิปในมือลูกค้าอย่างเดียว สลิปปลอมทำได้ง่าย
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />

          {preview ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setZoom(true)}
                className="block w-full cursor-pointer overflow-hidden rounded-xl border border-slate-200"
              >
                <img src={preview} alt="รูปสลิปที่แนบไว้" className="max-h-56 w-full object-contain" />
              </button>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  icon="refresh"
                  className="flex-1"
                  disabled={busy}
                  onClick={pickPhoto}
                >
                  ถ่ายใหม่
                </Button>
                <Button
                  variant="ghost"
                  icon="trash"
                  className="text-rose-500"
                  disabled={busy}
                  onClick={() => void removeSlip()}
                >
                  เอาออก
                </Button>
              </div>
            </div>
          ) : slipMissingReason ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
                <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                <span>
                  บันทึกว่าไม่มีรูปสลิป เพราะ{' '}
                  <span className="font-medium">{slipMissingReason}</span>
                </span>
              </div>
              <Button variant="secondary" icon="qr" className="w-full" onClick={pickPhoto}>
                ถ่ายรูปสลิปแทน
              </Button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <Button
                size="lg"
                icon="qr"
                className="w-full"
                disabled={busy}
                onClick={pickPhoto}
              >
                {busy ? 'กำลังย่อรูป…' : 'ลูกค้าจ่ายแล้ว — ถ่ายรูปสลิป'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={busy}
                onClick={() => setMissingOpen(true)}
              >
                ไม่มีสลิป (ระบุเหตุผล)
              </Button>
            </div>
          )}

          {busy && (
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <Spinner />
              กำลังย่อรูปและเก็บลงเครื่อง
            </div>
          )}
        </div>

        {/* ขั้นที่ 5-6 ยังไม่ได้สร้าง */}
        <div className="flex items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-xs leading-relaxed text-amber-900">
            <span className="font-medium">ขั้นถัดไปยังสร้างไม่เสร็จ</span> — ปุ่มยืนยันเงินเข้า
            และส่งเข้าเครื่องกลาง (พร้อมการส่งรูปขึ้นคลาวด์) เป็นงานก้อนต่อไป
            ตอนนี้รูปถูกเก็บไว้ในเครื่องนี้เท่านั้น
          </div>
        </div>
      </div>

      {/* ===== แถบล่าง ===== */}
      <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white p-3">
        <div title="ต้องรอขั้นที่ 5">
          <Button size="lg" icon="check" className="w-full" disabled>
            ยืนยันเงินเข้า + ส่งเข้าเครื่องกลาง
          </Button>
        </div>
        {onBack ? (
          <div className="flex gap-2">
            <Button variant="secondary" icon="undo" className="flex-1" onClick={onBack}>
              กลับไปหน้าสรุปยอด
            </Button>
            <Button variant="ghost" icon="trash" className="text-rose-500" onClick={onDiscard}>
              ทิ้งใบสั่ง
            </Button>
          </div>
        ) : (
          <>
            <Button variant="ghost" icon="trash" className="w-full text-rose-500" onClick={onDiscard}>
              ทิ้งใบสั่ง (รูปสลิปยังเก็บไว้เป็นหลักฐาน)
            </Button>
            <p className="text-center text-xs leading-relaxed text-slate-400">
              มีหลักฐานการจ่ายแนบอยู่แล้ว — ถ้าต้องแก้รายการ ให้เอารูปสลิปออกก่อน
              เพื่อไม่ให้ยอดไม่ตรงกับเงินที่รับไปจริง
            </p>
          </>
        )}
      </div>

      {/* ===== ดูรูปเต็ม ===== */}
      <Modal open={zoom} onClose={() => setZoom(false)} title="รูปสลิป">
        {preview && <img src={preview} alt="รูปสลิป" className="max-h-[70vh] w-full object-contain" />}
      </Modal>

      {/* ===== ระบุเหตุผลที่ไม่มีสลิป ===== */}
      <Modal
        open={missingOpen}
        onClose={() => setMissingOpen(false)}
        title="ไม่มีรูปสลิป"
        size="sm"
        footer={
          <Button variant="secondary" onClick={() => setMissingOpen(false)}>
            ปิด
          </Button>
        }
      >
        <p className="text-sm text-slate-600">
          เลือกเหตุผล — จะถูกบันทึกไว้กับบิลเพื่อให้ตามได้ตอนกระทบยอดปลายวัน
        </p>
        <div className="mt-3 space-y-2">
          {MISSING_REASONS.map((r) => (
            <Button
              key={r}
              variant="secondary"
              className="w-full"
              onClick={() => {
                onSetSlipMissing(r)
                setMissingOpen(false)
              }}
            >
              {r}
            </Button>
          ))}
          <div className="flex gap-2 pt-1">
            <Input
              value={customReason}
              maxLength={60}
              placeholder="เหตุผลอื่น"
              onChange={(e) => setCustomReason(e.target.value)}
            />
            <Button
              className="shrink-0"
              disabled={customReason.trim() === ''}
              onClick={() => {
                onSetSlipMissing(customReason)
                setCustomReason('')
                setMissingOpen(false)
              }}
            >
              บันทึก
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
