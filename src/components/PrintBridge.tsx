import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useSettings } from '../db/hooks'
import { printIncomingJob, setRemotePrinter } from '../lib/receipt'
import {
  ackPrintJob,
  isPrintHost,
  probeBridge,
  submitPrintJob,
  waitForPrintJobs,
  type PrintJob,
} from '../lib/printBridge'
import { toast } from './ui'

/* =========================================================
   ตัวเชื่อมสะพานพิมพ์ — ไม่มี UI ของตัวเอง

   เครื่องที่ตั้งเป็น "เครื่องพิมพ์ของร้าน" → วนรอรับงานจากสะพานแล้วสั่งพิมพ์
   เครื่องอื่น (มือถือ) → เปลี่ยนการกดพิมพ์ให้ส่งไปเข้าคิวที่สะพานแทน

   ไม่มีสะพาน (เช่นเปิดจาก GitHub Pages) → ไม่ทำอะไรเลย ทุกอย่างเหมือนเดิม
   ========================================================= */

/** เวลารอระหว่างพิมพ์สองใบติดกัน
 *  printHtml() วาง HTML ลง #print-area แล้วรอ 60ms ค่อยสั่งพิมพ์ — ถ้าวนรัวๆ
 *  ใบที่สองจะทับใบแรกก่อนที่เบราว์เซอร์จะพิมพ์เสร็จ ⇒ ใบแรกหายไปเงียบๆ */
const GAP_MS = 1500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function PrintBridge() {
  const settings = useSettings()
  /* เก็บค่าตั้งค่าไว้ใน ref — ถ้าให้ effect ขึ้นกับ settings ตรงๆ ทุกครั้งที่ค่าตั้งค่า
     เปลี่ยน (หรือ Dexie ส่งผลใหม่) ลูปรอรับงานจะถูกยกเลิกแล้วตั้งใหม่ทั้งตัว
     ซึ่งตัดสายที่ค้างรออยู่ทิ้ง และอาจทำงานพิมพ์ที่เพิ่งรับมาหลุดหาย */
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // ตารางนี้อยู่นอกไฟล์สำรอง ค่าจึงเป็นของเครื่องนี้เท่านั้น
  const host = useLiveQuery(async () => isPrintHost(), [], undefined)

  /* ===== เครื่องที่ไม่ได้เป็นเครื่องพิมพ์: ส่งงานไปเข้าคิวแทนการพิมพ์เอง ===== */
  useEffect(() => {
    if (host !== false) return
    let alive = true

    void (async () => {
      const health = await probeBridge()
      if (!alive || !health) return

      setRemotePrinter((kind, sale, opts) => {
        void submitPrintJob(kind, { sale, opts })
          .then(({ printerReady }) => {
            if (printerReady) {
              toast.success(`ส่ง ${sale.receiptNo} ไปพิมพ์ที่เครื่องเคาน์เตอร์แล้ว`)
            } else {
              // งานยังอยู่ในคิว ไม่ได้หาย แต่ต้องบอกให้รู้ว่าจะยังไม่มีกระดาษออกมา
              toast.error('ส่งเข้าคิวแล้ว แต่เครื่องเคาน์เตอร์ยังไม่ได้เปิดแอปไว้ — ใบเสร็จจะยังไม่ออก')
            }
          })
          .catch(() =>
            toast.error(
              `ส่งไปพิมพ์ไม่สำเร็จ — บิลบันทึกเรียบร้อยแล้ว สั่งพิมพ์ซ้ำได้ที่หน้าประวัติการขาย`,
            ),
          )
        return true
      })
    })()

    return () => {
      alive = false
      setRemotePrinter(null)
    }
  }, [host])

  /* ===== เครื่องพิมพ์ของร้าน: วนรอรับงาน ===== */
  useEffect(() => {
    if (host !== true) return
    const ctl = new AbortController()
    let alive = true

    const run = async () => {
      if (!(await probeBridge())) return // ไม่ได้เปิดผ่านสะพาน ไม่ต้องวน

      while (alive) {
        let jobs: PrintJob[] = []
        try {
          jobs = await waitForPrintJobs(ctl.signal)
        } catch {
          if (!alive) return
          // สะพานล่ม/เน็ตสะดุด — รอแล้วลองใหม่ ห้ามวนรัวจนกินซีพียู
          await sleep(5000)
          continue
        }

        for (const job of jobs) {
          if (!alive) return
          // ใช้ค่าตั้งค่าของเครื่องนี้ (หัวใบเสร็จ โลโก้ ความกว้างกระดาษ เป็นของเครื่องที่พิมพ์จริง)
          printIncomingJob(job.kind, job.payload.sale, settingsRef.current, job.payload.opts)
          await ackPrintJob(job.id)
          await sleep(GAP_MS)
        }
      }
    }

    void run()
    return () => {
      alive = false
      ctl.abort()
    }
  }, [host])

  return null
}
