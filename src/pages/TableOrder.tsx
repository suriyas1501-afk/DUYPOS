import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useSettings } from '../db/hooks'
import {
  DEFAULT_TABLE_COUNT,
  draftPersistence,
  hasTableDraft,
  tableItemCount,
  useTableOrder,
} from '../stores/tableOrderStore'
import { Button, ConfirmDialog, Icon, Modal, Spinner, toast } from '../components/ui'
import TablePicker from './table/TablePicker'
import ItemPicker from './table/ItemPicker'
import OrderSummary from './table/OrderSummary'

/* =========================================================
   รับออเดอร์ที่โต๊ะ — ขั้นที่ 1-3 ของ TABLE-ORDER-PLAN.md §18

   ขั้นที่แสดงอยู่ derive จาก store ทั้งหมด ไม่เก็บ step แยก
   เพราะดราฟต์ถูก persist ลง localStorage — เปิดแอปใหม่แล้วต้องกลับมา
   ที่ขั้นเดิมได้เอง (iOS ตัดหน้าเว็บทิ้งได้ทุกเมื่อ ดู §12)

      ไม่มี tableLabel          → ขั้นที่ 1 เลือกโต๊ะ
      มี tableLabel, ยังไม่ล็อก  → ขั้นที่ 2 กดรายการ
      ล็อกแล้ว                  → ขั้นที่ 3 สรุปยอด
   ========================================================= */

export default function TableOrder() {
  const settings = useSettings()
  const draft = useTableOrder()
  const {
    tableLabel,
    items,
    locked,
    start,
    changeTable,
    addProduct,
    setQty,
    setNote,
    removeItem,
    lock,
    unlock,
    clear,
  } = draft

  /**
   * เก็บดราฟต์ลงเครื่องได้ไหม — ต้องอ่านแบบ subscribe เพราะเขียนพลาดกลางทางได้
   * (พื้นที่เครื่องเต็ม / ผู้ใช้ปิดการเก็บข้อมูลเว็บระหว่างใช้งาน)
   */
  const persistOk = useSyncExternalStore(
    draftPersistence.subscribe,
    () => draftPersistence.ok,
    () => true,
  )
  /** เตือนครั้งเดียวในจังหวะที่เพิ่งเขียนพลาด ไม่ใช่แค่แถบนิ่งๆ ที่อ่านข้าม */
  const warnedPersist = useRef(false)
  useEffect(() => {
    if (persistOk || warnedPersist.current) return
    warnedPersist.current = true
    toast.error('เก็บใบสั่งค้างไว้ในเครื่องไม่ได้ — อย่าสลับไปแอปอื่น ให้ทำจนจบทีเดียว')
  }, [persistOk])

  /** ถามครั้งเดียวตอนเข้าหน้า ห้ามเงียบ (§17 ข้อ 2) */
  const asked = useRef(false)
  const [resumeAsk, setResumeAsk] = useState<{ label: string; count: number } | null>(null)
  const [discardAsk, setDiscardAsk] = useState(false)
  /** เปิดหน้าเลือกโต๊ะทั้งที่มีใบสั่งอยู่แล้ว = กำลังย้ายโต๊ะ (ไม่ใช่เริ่มใหม่) */
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (asked.current) return
    asked.current = true
    if (hasTableDraft({ tableLabel, items })) {
      setResumeAsk({ label: tableLabel!, count: tableItemCount(items) })
    }
    // ตั้งใจให้รันครั้งเดียวตอน mount — ค่าที่อ่านคือดราฟต์ที่ rehydrate มาแล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!settings.tableOrderEnabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="rounded-2xl bg-slate-100 p-3 text-slate-400">
          <Icon name="pencil" size={26} />
        </span>
        <div>
          <h2 className="font-medium text-slate-700">ยังไม่ได้เปิดโหมดรับออเดอร์ที่โต๊ะ</h2>
          <p className="mt-1 text-sm text-slate-500">
            เปิดสวิตช์ในหน้าตั้งค่าก่อน แล้วกลับมาที่หน้านี้
          </p>
        </div>
        <Link to="/settings">
          <Button icon="gear">ไปที่หน้าตั้งค่า</Button>
        </Link>
      </div>
    )
  }

  const discard = () => {
    clear()
    setDiscardAsk(false)
    toast.success('ทิ้งใบสั่งแล้ว')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      {/* เก็บดราฟต์ลงเครื่องไม่ได้ (Safari โหมดส่วนตัว / เบราว์เซอร์บล็อกข้อมูลเว็บ)
          ต้องเตือน ไม่ใช่ปล่อยให้พนักงานเชื่อว่าปลอดภัยแล้วออเดอร์หายทั้งใบ */}
      {!persistOk && (
        <div className="flex shrink-0 items-start gap-2 bg-rose-50 px-3 py-2.5 text-rose-800 ring-1 ring-rose-200">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <div className="text-xs leading-relaxed">
            <span className="font-medium">เครื่องนี้เก็บใบสั่งค้างไว้ไม่ได้</span> —
            ถ้าสลับไปแอปอื่นแล้วกลับมา ใบสั่งอาจหายทั้งใบ ให้ทำจนจบทีเดียว
            (มักเกิดจากเปิดในโหมดส่วนตัว)
          </div>
        </div>
      )}

      {tableLabel == null || picking ? (
        <TablePicker
          tableCount={settings.tableCount ?? DEFAULT_TABLE_COUNT}
          movingFrom={picking ? tableLabel : undefined}
          onPick={(label) => {
            // มีใบสั่งอยู่แล้ว = ย้ายโต๊ะ ต้องเก็บรายการและรหัสใบสั่งเดิมไว้
            if (tableLabel == null) start(label)
            else changeTable(label)
            setPicking(false)
          }}
          onCancel={picking ? () => setPicking(false) : undefined}
        />
      ) : locked ? (
        <OrderSummary
          tableLabel={tableLabel}
          items={items}
          settings={settings}
          onBack={unlock}
          onDiscard={() => setDiscardAsk(true)}
        />
      ) : (
        <ItemPicker
          tableLabel={tableLabel}
          items={items}
          onAdd={addProduct}
          onSetQty={setQty}
          onSetNote={setNote}
          onRemove={removeItem}
          onSummary={lock}
          onChangeTable={() => setPicking(true)}
          onDiscard={() => setDiscardAsk(true)}
        />
      )}

      {/* มีดราฟต์ค้างอยู่ตอนเปิดหน้า — ต้องถาม ไม่ใช่เดาให้ (§17 ข้อ 2)

          ใช้ Modal ไม่ใช่ ConfirmDialog เพราะ ConfirmDialog มีปุ่ม "ยกเลิก" ติดมาด้วย
          ซึ่งในกล่องนี้ให้ผลเหมือนปุ่ม "ทำต่อ" เป๊ะ — ปุ่มที่กดแล้วไม่เกิดอะไร
          ทำให้คนเลิกอ่านกล่องยืนยันทั้งระบบ ที่นี่จึงให้ทางเลือกจริง 2 ทาง
          และ "ทิ้ง" ต้องมาจากการกดปุ่มนั้นตรงๆ เท่านั้น
          (Esc / คลิกพื้นหลัง = ทำต่อ ห้ามลบข้อมูลจากท่าทางที่กดพลาดได้) */}
      <Modal
        open={resumeAsk != null}
        onClose={() => setResumeAsk(null)}
        title="มีใบสั่งค้างอยู่"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              icon="trash"
              className="text-rose-600"
              onClick={() => {
                setResumeAsk(null)
                setDiscardAsk(true)
              }}
            >
              ทิ้งแล้วเริ่มใหม่
            </Button>
            <Button icon="check" onClick={() => setResumeAsk(null)}>
              ทำต่อ
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">
          {resumeAsk
            ? `โต๊ะ ${resumeAsk.label} มี ${resumeAsk.count.toLocaleString('th-TH')} รายการที่ยังไม่ได้ส่ง`
            : ''}
        </p>
      </Modal>

      <ConfirmDialog
        open={discardAsk}
        danger
        title="ทิ้งใบสั่งนี้"
        message={
          tableLabel
            ? `รายการของโต๊ะ ${tableLabel} จะหายทั้งหมด กู้คืนไม่ได้ ต้องการทิ้งไหม?`
            : ''
        }
        confirmLabel="ทิ้งใบสั่ง"
        onConfirm={discard}
        onClose={() => setDiscardAsk(false)}
      />
    </div>
  )
}
