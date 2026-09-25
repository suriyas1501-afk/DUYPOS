import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import QRCode from 'qrcode'
import { db, DEFAULT_SETTINGS } from '../db/db'
import { useCurrentShift, useSettings } from '../db/hooks'
import type { BusinessMode, Sale, SaleItem, Settings as AppSettings } from '../db/types'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Icon,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
  Toggle,
  toast,
  type IconName,
} from '../components/ui'
import {
  BACKUP_KEEP,
  backupFolderSupported,
  clearAllData,
  exportBackup,
  getBackupFolder,
  importBackup,
  markBackedUp,
  pickBackupFolder,
  writeBackupToFolder,
} from '../lib/backup'
import { ensureOwnerStaff, seedSampleData } from '../db/seed'
import { resizeImage } from '../lib/image'
import { printKitchenSlip, printReceipt } from '../lib/receipt'
import {
  PROMPTPAY_ID_HINT,
  buildPromptpayPayload,
  parsePromptpayId,
} from '../lib/promptpay'
import { HEAD_OFFICE, shopTaxReadiness } from '../lib/taxInvoice'
import { baht, fmtDateTime, r2 } from '../lib/format'

/* ===== ตัวช่วย ===== */

const toNum = (s: string, fallback = 0) => {
  const v = Number(s)
  return Number.isFinite(v) && v >= 0 ? r2(v) : fallback
}

/** แปลงไบต์เป็น MB สำหรับแสดงพื้นที่จัดเก็บ */
const mbText = (n?: number) =>
  n == null ? '—' : `${(n / 1048576).toLocaleString('th-TH', { maximumFractionDigits: 1 })} MB`

/** ตัวเลือกเวลาล็อกหน้าจออัตโนมัติ (นาที — 0 = ไม่ล็อก) */
const AUTO_LOCK_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'ไม่ล็อก' },
  { value: 1, label: '1 นาที' },
  { value: 3, label: '3 นาที' },
  { value: 5, label: '5 นาที' },
  { value: 10, label: '10 นาที' },
  { value: 30, label: '30 นาที' },
]

/** ตัวเลือกเวลาเตือนออเดอร์ค้างบนจอครัว (นาที — 0 = ไม่เตือน) */
const KITCHEN_ALERT_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'ไม่เตือน' },
  { value: 5, label: '5 นาที' },
  { value: 10, label: '10 นาที' },
  { value: 15, label: '15 นาที' },
  { value: 20, label: '20 นาที' },
]

/** แยกค่า branchTaxCode ('สำนักงานใหญ่' / 'สาขาที่ 00001') เป็นตัวเลือก + เลขสาขา */
function parseBranchTaxCode(code: string | undefined): { head: boolean; no: string } {
  const s = (code ?? '').trim()
  if (!s || !s.includes('สาขา')) return { head: true, no: '' }
  return { head: false, no: s.replace(/\D/g, '') }
}

/** สถานะพื้นที่จัดเก็บของเบราว์เซอร์ (null = เบราว์เซอร์ไม่รองรับ) */
interface StorageInfo {
  persisted: boolean
  usage?: number
  quota?: number
}

/** สร้างบิลตัวอย่างสำหรับพิมพ์ทดสอบ (ทุก field ครบตาม type Sale) */
function buildSampleSale(s: AppSettings): Sale {
  const items: SaleItem[] = [
    {
      productId: 0,
      name: 'อเมริกาโน่',
      price: 65,
      qty: 1,
      options: ['เย็น', 'หวานน้อย'],
      manualDiscount: 0,
      promoDiscount: 0,
      cost: 18,
      total: 65,
    },
    {
      productId: 0,
      name: 'ครัวซองต์เนยสด',
      price: 45,
      qty: 2,
      manualDiscount: 0,
      promoDiscount: 0,
      cost: 20,
      total: 90,
    },
    {
      productId: 0,
      name: 'น้ำดื่ม 600 มล.',
      price: 7,
      qty: 1,
      manualDiscount: 0,
      promoDiscount: 0,
      cost: 4.5,
      total: 7,
    },
  ]
  const subtotal = r2(items.reduce((sum, it) => sum + it.total, 0))
  let vatAmount = 0
  let total = subtotal
  if (s.vatRate > 0) {
    if (s.vatIncluded) {
      vatAmount = r2((subtotal * s.vatRate) / (100 + s.vatRate))
    } else {
      vatAmount = r2((subtotal * s.vatRate) / 100)
      total = r2(subtotal + vatAmount)
    }
  }
  const received = Math.ceil(total / 100) * 100
  // ตัวอย่างบิลจ่ายผสม (โอน 100 + เงินสดส่วนที่เหลือ) — ถ้ายอดน้อยเกินไปใช้เงินสดก้อนเดียว
  const payments: NonNullable<Sale['payments']> =
    received > 100
      ? [
          { method: 'transfer', amount: 100 },
          { method: 'cash', amount: r2(received - 100) },
        ]
      : [{ method: 'cash', amount: received }]
  return {
    receiptNo: 'TEST-000001',
    kind: 'sale',
    items,
    subtotal,
    itemDiscount: 0,
    promoDiscount: 0,
    billDiscount: 0,
    couponDiscount: 0,
    pointDiscount: 0,
    redeemedPoints: 0,
    vatRate: s.vatRate,
    vatIncluded: s.vatIncluded,
    vatAmount,
    total,
    paymentMethod: 'cash',
    payments,
    received,
    change: r2(received - total),
    earnedPoints: s.bahtPerPoint > 0 ? Math.floor(total / s.bahtPerPoint) : 0,
    appliedPromos: [],
    queueNo: s.queueEnabled ? 7 : undefined,
    status: 'completed',
    createdAt: Date.now(),
  }
}

/* ===== การ์ดเลือกโหมดธุรกิจ ===== */

function ModeCard({
  icon,
  title,
  desc,
  active,
  onClick,
}: {
  icon: IconName
  title: string
  desc: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex cursor-pointer flex-col gap-2 rounded-2xl border-2 p-4 text-left transition-colors ${
        active
          ? 'border-emerald-500 bg-emerald-50'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {active && (
        <span className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Icon name="check" size={14} />
        </span>
      )}
      <span
        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${
          active ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
        }`}
      >
        <Icon name={icon} size={22} />
      </span>
      <span className={`text-sm font-bold ${active ? 'text-emerald-800' : 'text-slate-700'}`}>
        {title}
      </span>
      <span className="text-xs leading-relaxed text-slate-500">{desc}</span>
    </button>
  )
}

/* ===== หัวการ์ดพร้อมไอคอน (หมวดพนักงาน / กะ / ใบกำกับภาษี) ===== */

function CardTitle({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <Icon name={icon} size={16} className="text-emerald-600" />
      {children}
    </span>
  )
}

/* ===== แถวการจัดการข้อมูล ===== */

function DataRow({
  icon,
  title,
  desc,
  action,
  tone = 'border-slate-200',
  iconTone = 'bg-slate-100 text-slate-500',
}: {
  icon: IconName
  title: string
  desc: ReactNode
  action: ReactNode
  /** สีขอบ (ใช้เน้นแถวสถานะพื้นที่จัดเก็บ) */
  tone?: string
  iconTone?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-3.5 ${tone}`}>
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconTone}`}
      >
        <Icon name={icon} size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-700">{title}</div>
        <div className="text-xs text-slate-400">{desc}</div>
      </div>
      {action}
    </div>
  )
}

/* ===== หน้าตั้งค่า ===== */

export default function Settings() {
  const settings = useSettings()
  const navigate = useNavigate()

  // ----- local state ของแต่ละการ์ด -----
  const [shopName, setShopName] = useState(settings.shopName)
  const [branch, setBranch] = useState(settings.branch)
  const [address, setAddress] = useState(settings.address)
  const [phone, setPhone] = useState(settings.phone)
  const [taxId, setTaxId] = useState(settings.taxId)
  const [logo, setLogo] = useState<string | undefined>(settings.logo)

  const [vatRate, setVatRate] = useState(String(settings.vatRate))
  const [vatIncluded, setVatIncluded] = useState(settings.vatIncluded)
  const [bahtPerPoint, setBahtPerPoint] = useState(String(settings.bahtPerPoint))
  const [redeemValue, setRedeemValue] = useState(String(settings.redeemValue))

  const [receiptWidth, setReceiptWidth] = useState<'58' | '80'>(settings.receiptWidth)
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter)
  const [queueEnabled, setQueueEnabled] = useState(settings.queueEnabled ?? false)
  const [kitchenPrintEnabled, setKitchenPrintEnabled] = useState(
    settings.kitchenPrintEnabled ?? false,
  )

  const [promptpayId, setPromptpayId] = useState(settings.promptpayId ?? '')
  const [qrPreview, setQrPreview] = useState<string | null>(null)

  // ----- โหมดบริการด่วน (จอครัว + ด่านตรวจการชำระเงิน) -----
  const [quickServiceEnabled, setQuickServiceEnabled] = useState(
    settings.quickServiceEnabled ?? false,
  )
  const [requirePaymentVerify, setRequirePaymentVerify] = useState(
    settings.requirePaymentVerify ?? true,
  )
  const [kitchenAutoPrint, setKitchenAutoPrint] = useState(settings.kitchenAutoPrint ?? true)
  const [kitchenAlertMinutes, setKitchenAlertMinutes] = useState(
    String(settings.kitchenAlertMinutes ?? 10),
  )
  const [quickBusy, setQuickBusy] = useState(false)

  // ----- รับออเดอร์ที่โต๊ะ (มือถือพนักงาน) -----
  const [tableOrderEnabled, setTableOrderEnabled] = useState(settings.tableOrderEnabled ?? false)
  const [tableCount, setTableCount] = useState(String(settings.tableCount ?? 20))
  const [tableBusy, setTableBusy] = useState(false)
  /** ยืนยันก่อนปิดด่านตรวจสลิป (ปิดแล้วเสี่ยงทำอาหารทิ้งจากสลิปปลอม) */
  const [verifyOffOpen, setVerifyOffOpen] = useState(false)

  // ----- พนักงาน & ความปลอดภัย (staffEnabled บันทึกทันทีเมื่อสลับ) -----
  const [autoLockMinutes, setAutoLockMinutes] = useState(String(settings.autoLockMinutes ?? 0))
  const [staffOnOpen, setStaffOnOpen] = useState(false)
  const [staffBusy, setStaffBusy] = useState(false)
  const [securityBusy, setSecurityBusy] = useState(false)

  // ----- กะ & ลิ้นชักเงินสด -----
  const [shiftEnabled, setShiftEnabled] = useState(settings.shiftEnabled ?? false)
  const [requireShiftToSell, setRequireShiftToSell] = useState(settings.requireShiftToSell ?? false)
  const [defaultOpeningCash, setDefaultOpeningCash] = useState(
    String(settings.defaultOpeningCash ?? 0),
  )
  const [shiftBusy, setShiftBusy] = useState(false)

  // ----- ใบกำกับภาษีเต็มรูป -----
  const [vatRegistered, setVatRegistered] = useState(settings.vatRegistered ?? false)
  const [branchIsHead, setBranchIsHead] = useState(
    () => parseBranchTaxCode(settings.branchTaxCode).head,
  )
  const [branchNo, setBranchNo] = useState(() => parseBranchTaxCode(settings.branchTaxCode).no)
  const [taxInvoiceSigner, setTaxInvoiceSigner] = useState(settings.taxInvoiceSigner ?? '')
  const [taxInvoiceNote, setTaxInvoiceNote] = useState(settings.taxInvoiceNote ?? '')
  const [taxInvBusy, setTaxInvBusy] = useState(false)

  // เลขสาขาตามทะเบียน VAT ที่จะบันทึก (5 หลัก) — ว่าง = สำนักงานใหญ่
  const branchDigits = branchNo.replace(/\D/g, '')
  const branchTaxCode =
    branchIsHead || branchDigits === '' ? HEAD_OFFICE : `สาขาที่ ${branchDigits.padStart(5, '0')}`

  // ----- จำนวนพนักงาน (reactive) + กะที่เปิดอยู่ -----
  // active เป็น boolean จึง index ไม่ได้ใน IndexedDB — อ่านทั้งตารางแล้วนับในหน่วยความจำ
  const staffStat = useLiveQuery(async () => {
    const rows = await db.staff.toArray()
    return { total: rows.length, active: rows.filter((s) => s.active).length }
  }, [])
  const { shift: openShift } = useCurrentShift()

  // ----- สถานะพื้นที่จัดเก็บ (null = เบราว์เซอร์ไม่รองรับ) -----
  const [storage, setStorage] = useState<StorageInfo | null>(null)

  // ----- โมดัลยืนยัน -----
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [seedOpen, setSeedOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearText, setClearText] = useState('')
  const [busy, setBusy] = useState(false)

  const logoInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // sync local state ครั้งเดียวเมื่อ settings โหลดจาก IndexedDB เสร็จ
  // (useSettings คืน DEFAULT_SETTINGS ตัวเดิมระหว่างโหลด — เทียบ reference ได้)
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current || settings === DEFAULT_SETTINGS) return
    hydrated.current = true
    setShopName(settings.shopName)
    setBranch(settings.branch)
    setAddress(settings.address)
    setPhone(settings.phone)
    setTaxId(settings.taxId)
    setLogo(settings.logo)
    setVatRate(String(settings.vatRate))
    setVatIncluded(settings.vatIncluded)
    setBahtPerPoint(String(settings.bahtPerPoint))
    setRedeemValue(String(settings.redeemValue))
    setReceiptWidth(settings.receiptWidth)
    setReceiptFooter(settings.receiptFooter)
    setQueueEnabled(settings.queueEnabled ?? false)
    setKitchenPrintEnabled(settings.kitchenPrintEnabled ?? false)
    setPromptpayId(settings.promptpayId ?? '')
    setQuickServiceEnabled(settings.quickServiceEnabled ?? false)
    setRequirePaymentVerify(settings.requirePaymentVerify ?? true)
    setKitchenAutoPrint(settings.kitchenAutoPrint ?? true)
    setKitchenAlertMinutes(String(settings.kitchenAlertMinutes ?? 10))
    setTableOrderEnabled(settings.tableOrderEnabled ?? false)
    setTableCount(String(settings.tableCount ?? 20))
    setAutoLockMinutes(String(settings.autoLockMinutes ?? 0))
    setShiftEnabled(settings.shiftEnabled ?? false)
    setRequireShiftToSell(settings.requireShiftToSell ?? false)
    setDefaultOpeningCash(String(settings.defaultOpeningCash ?? 0))
    setVatRegistered(settings.vatRegistered ?? false)
    const br = parseBranchTaxCode(settings.branchTaxCode)
    setBranchIsHead(br.head)
    setBranchNo(br.no)
    setTaxInvoiceSigner(settings.taxInvoiceSigner ?? '')
    setTaxInvoiceNote(settings.taxInvoiceNote ?? '')
  }, [settings])

  // ----- ตัวอย่าง QR พร้อมเพย์ (สร้างจากรหัสที่กรอกอยู่ ยอด 100 บาท) -----
  const ppTarget = parsePromptpayId(promptpayId)
  useEffect(() => {
    let alive = true
    const payload = buildPromptpayPayload(promptpayId, 100)
    if (!payload) {
      setQrPreview(null)
      return
    }
    QRCode.toDataURL(payload, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (alive) setQrPreview(url)
      })
      .catch(() => {
        if (alive) setQrPreview(null)
      })
    return () => {
      alive = false
    }
  }, [promptpayId])

  // ----- อ่านสถานะพื้นที่จัดเก็บ (ครอบ try/catch เผื่อเบราว์เซอร์ไม่รองรับ) -----
  const readStorage = async () => {
    try {
      if (!navigator.storage) {
        setStorage(null)
        return
      }
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false
      let usage: number | undefined
      let quota: number | undefined
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate()
        usage = est.usage
        quota = est.quota
      }
      setStorage({ persisted, usage, quota })
    } catch {
      setStorage(null)
    }
  }

  useEffect(() => {
    void readStorage()
  }, [])

  const askPersist = async () => {
    try {
      const ok = (await navigator.storage?.persist?.()) ?? false
      await readStorage()
      if (ok) toast.success('ขอสิทธิ์สำเร็จ — ข้อมูลถูกกันไม่ให้ลบอัตโนมัติแล้ว')
      else
        toast.error(
          'เบราว์เซอร์ยังไม่ให้สิทธิ์ — ลองติดตั้งแอปนี้ลงเครื่อง (Add to Home screen) แล้วขอใหม่',
        )
    } catch {
      toast.error('เบราว์เซอร์นี้ไม่รองรับการกันข้อมูลหาย — แนะนำให้สำรองข้อมูลเป็นไฟล์ JSON')
    }
  }

  // ----- บันทึกแต่ละการ์ด -----

  const saveShop = async () => {
    if (!shopName.trim()) {
      toast.error('กรุณากรอกชื่อร้าน')
      return
    }
    await db.settings.update(1, {
      shopName: shopName.trim(),
      branch: branch.trim(),
      address: address.trim(),
      phone: phone.trim(),
      taxId: taxId.trim(),
      logo,
    })
    toast.success('บันทึกข้อมูลร้านค้าแล้ว')
  }

  const chooseMode = async (mode: BusinessMode) => {
    if (mode === settings.mode) return
    await db.settings.update(1, { mode })
    toast.success(
      mode === 'retail' ? 'เปลี่ยนเป็นโหมดค้าปลีก / มินิมาร์ทแล้ว' : 'เปลี่ยนเป็นโหมดร้านอาหาร / คาเฟ่แล้ว',
    )
  }

  const saveTax = async () => {
    await db.settings.update(1, {
      vatRate: toNum(vatRate),
      vatIncluded,
      bahtPerPoint: toNum(bahtPerPoint),
      redeemValue: toNum(redeemValue),
    })
    toast.success('บันทึกภาษีและแต้มสะสมแล้ว')
  }

  const saveReceipt = async () => {
    await db.settings.update(1, {
      receiptWidth,
      receiptFooter,
      queueEnabled,
      kitchenPrintEnabled,
    })
    toast.success('บันทึกการตั้งค่าใบเสร็จแล้ว')
  }

  const savePromptpay = async () => {
    const raw = promptpayId.trim()
    if (raw && !parsePromptpayId(raw)) {
      toast.error(`รหัสพร้อมเพย์ไม่ถูกต้อง — ต้องเป็น${PROMPTPAY_ID_HINT}`)
      return
    }
    await db.settings.update(1, { promptpayId: raw })
    toast.success(raw ? 'บันทึกรหัสพร้อมเพย์แล้ว' : 'ล้างรหัสพร้อมเพย์แล้ว (ปิดการสร้าง QR)')
  }

  // ----- โหมดบริการด่วน -----

  const saveQuickService = async () => {
    if (quickBusy) return
    setQuickBusy(true)
    try {
      await db.settings.update(1, {
        quickServiceEnabled,
        // ปิดโหมดบริการด่วนแล้ว ตัวเลือกย่อยไม่มีผล — เก็บค่าเดิมไว้ให้ครบตามที่เห็นบนจอ
        requirePaymentVerify,
        kitchenAutoPrint,
        kitchenAlertMinutes: toNum(kitchenAlertMinutes),
      })
      toast.success('บันทึกการตั้งค่าบริการด่วนแล้ว')
    } finally {
      setQuickBusy(false)
    }
  }

  // ----- รับออเดอร์ที่โต๊ะ -----

  const saveTableOrder = async () => {
    if (tableBusy) return
    const n = Math.floor(toNum(tableCount))
    const valid = n >= 1 && n <= 200
    if (tableOrderEnabled && !valid) {
      toast.error('จำนวนโต๊ะต้องอยู่ระหว่าง 1 ถึง 200')
      return
    }
    setTableBusy(true)
    try {
      // ปิดสวิตช์อยู่ = ช่องจำนวนโต๊ะถูก disabled แก้ไม่ได้
      // ห้ามเขียนทับด้วยค่าเริ่มต้นเงียบๆ ไม่งั้นร้าน 40 โต๊ะจะเหลือ 20 โดยไม่มีใครรู้
      await db.settings.update(1, {
        tableOrderEnabled,
        ...(valid ? { tableCount: n } : {}),
      })
      toast.success('บันทึกการตั้งค่าออเดอร์ที่โต๊ะแล้ว')
    } finally {
      setTableBusy(false)
    }
  }

  // ----- พนักงาน & ความปลอดภัย -----

  /** เปิดระบบพนักงาน — ต้องมีบัญชีที่ใช้งานอยู่ก่อน ไม่งั้นจะเข้าระบบไม่ได้เลย */
  const enableStaffSystem = async () => {
    if (staffBusy) return
    setStaffBusy(true)
    try {
      const hadStaff = (await db.staff.count()) > 0
      await ensureOwnerStaff() // สร้างบัญชีเจ้าของร้านให้ถ้ายังไม่มีใครเลย
      const rows = await db.staff.toArray()
      const actives = rows.filter((s) => s.active)
      if (actives.length === 0) {
        toast.error(
          'ยังไม่มีพนักงานที่เปิดใช้งาน — กรุณาเพิ่มหรือเปิดใช้งานพนักงานที่หน้าพนักงานก่อน',
        )
        return
      }
      await db.settings.update(1, { staffEnabled: true })
      if (!hadStaff) {
        toast.success(
          'เปิดระบบพนักงานแล้ว — บัญชีเริ่มต้น: เจ้าของร้าน (E01) PIN 1234 — กรุณาเปลี่ยน PIN ที่หน้าพนักงาน',
        )
      } else {
        toast.success('เปิดระบบพนักงานแล้ว — ครั้งต่อไปที่เปิดแอปต้องเข้าสู่ระบบด้วย PIN')
      }
    } finally {
      setStaffBusy(false)
    }
  }

  const disableStaffSystem = async () => {
    if (staffBusy) return
    setStaffBusy(true)
    try {
      await db.settings.update(1, { staffEnabled: false })
      toast.success('ปิดระบบพนักงานแล้ว — ใช้งานได้ทุกเมนูโดยไม่ต้องใส่ PIN')
    } finally {
      setStaffBusy(false)
    }
  }

  const saveSecurity = async () => {
    if (securityBusy) return
    setSecurityBusy(true)
    try {
      await db.settings.update(1, { autoLockMinutes: toNum(autoLockMinutes) })
      toast.success('บันทึกการตั้งค่าความปลอดภัยแล้ว')
    } finally {
      setSecurityBusy(false)
    }
  }

  // ----- กะ & ลิ้นชักเงินสด -----

  const saveShiftSettings = async () => {
    if (shiftBusy) return
    setShiftBusy(true)
    try {
      await db.settings.update(1, {
        shiftEnabled,
        // ปิดระบบกะแล้วบังคับเปิดกะก่อนขายไม่ได้ (ไม่งั้นจะขายไม่ได้เลย)
        requireShiftToSell: shiftEnabled && requireShiftToSell,
        defaultOpeningCash: toNum(defaultOpeningCash),
      })
      toast.success('บันทึกการตั้งค่ากะแล้ว')
    } finally {
      setShiftBusy(false)
    }
  }

  // ----- ใบกำกับภาษีเต็มรูป -----

  const saveTaxInvoice = async () => {
    if (taxInvBusy) return
    if (!branchIsHead && (branchDigits === '' || branchDigits.length > 5)) {
      toast.error('เลขที่สาขาต้องเป็นตัวเลข 1–5 หลัก เช่น 00001')
      return
    }
    setTaxInvBusy(true)
    try {
      await db.settings.update(1, {
        vatRegistered,
        branchTaxCode,
        taxInvoiceSigner: taxInvoiceSigner.trim(),
        taxInvoiceNote: taxInvoiceNote.trim(),
      })
      if (!branchIsHead) setBranchNo(branchDigits.padStart(5, '0'))
      toast.success('บันทึกการตั้งค่าใบกำกับภาษีแล้ว')
    } finally {
      setTaxInvBusy(false)
    }
  }

  // ----- โลโก้ -----

  const onPickLogo = async (file: File | undefined) => {
    if (!file) return
    try {
      setLogo(await resizeImage(file, 128))
    } catch {
      toast.error('อ่านไฟล์รูปไม่สำเร็จ')
    }
  }

  // ----- พิมพ์ทดสอบ (ใช้ค่าที่กรอกอยู่บนหน้าจอ เพื่อดูผลก่อนบันทึก) -----

  const mergedSettings = (): AppSettings => ({
    ...settings,
    shopName: shopName.trim() || settings.shopName,
    branch: branch.trim(),
    address: address.trim(),
    phone: phone.trim(),
    taxId: taxId.trim(),
    logo,
    vatRate: toNum(vatRate),
    vatIncluded,
    bahtPerPoint: toNum(bahtPerPoint),
    receiptWidth,
    receiptFooter,
    queueEnabled,
    kitchenPrintEnabled,
    promptpayId: promptpayId.trim(),
    vatRegistered,
    branchTaxCode,
    taxInvoiceSigner: taxInvoiceSigner.trim(),
    taxInvoiceNote: taxInvoiceNote.trim(),
  })

  // ความพร้อมออกใบกำกับภาษี — คิดจากค่าที่กรอกอยู่บนหน้าจอ (เห็นผลก่อนกดบันทึก)
  const taxNotReady = shopTaxReadiness(mergedSettings())

  const testPrint = () => {
    const merged = mergedSettings()
    printReceipt(buildSampleSale(merged), merged)
  }

  const testKitchenPrint = () => {
    const merged = mergedSettings()
    printKitchenSlip(buildSampleSale(merged), merged)
  }

  /* ----- สำรองอัตโนมัติ -----
     handle ของโฟลเดอร์อยู่ในตาราง appState (แปลงเป็น JSON ไม่ได้) จึงอ่านชื่อมาแสดงแยก
     การเลือกโฟลเดอร์/ขอสิทธิ์ต้องเกิดจากการกดของผู้ใช้เท่านั้น เรียกเองตอนโหลดหน้าไม่ได้ */
  const backupSupported = backupFolderSupported()
  const [backupFolder, setBackupFolder] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  /** ถามยืนยันหลังดาวน์โหลดไฟล์ (เบราว์เซอร์ที่บอกไม่ได้ว่าผู้ใช้กดยกเลิกหรือไม่) */
  const [askSavedOpen, setAskSavedOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getBackupFolder().then((h) => {
      if (!cancelled) setBackupFolder(h?.name ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const chooseBackupFolder = async () => {
    if (backupBusy) return
    setBackupBusy(true)
    try {
      const name = await pickBackupFolder()
      setBackupFolder(name)
      await db.settings.update(1, { autoBackupEnabled: true })
      const handle = await getBackupFolder()
      if (handle) {
        const file = await writeBackupToFolder(handle)
        toast.success(`เปิดสำรองอัตโนมัติแล้ว — เขียนไฟล์แรก ${file} ลงโฟลเดอร์ ${name}`)
      }
    } catch (e) {
      // ผู้ใช้กดยกเลิกหน้าต่างเลือกโฟลเดอร์ = AbortError ไม่ต้องแจ้งเตือน
      if (e instanceof DOMException && e.name === 'AbortError') return
      toast.error(e instanceof Error ? e.message : 'เลือกโฟลเดอร์ไม่สำเร็จ')
    } finally {
      setBackupBusy(false)
    }
  }

  const toggleAutoBackup = async (on: boolean) => {
    if (on && !backupFolder) {
      toast.error('เลือกโฟลเดอร์ที่จะเก็บไฟล์สำรองก่อน')
      return
    }
    await db.settings.update(1, { autoBackupEnabled: on })
    toast.success(on ? 'เปิดสำรองอัตโนมัติแล้ว' : 'ปิดสำรองอัตโนมัติแล้ว')
  }

  const setReminderDays = async (days: number) => {
    await db.settings.update(1, { backupReminderDays: days })
  }

  // ----- จัดการข้อมูล -----

  const doExport = async () => {
    try {
      const how = await exportBackup()
      if (how === 'saved') {
        toast.success('บันทึกไฟล์สำรองข้อมูลเรียบร้อย')
      } else {
        // ดาวน์โหลดผ่านลิงก์: ไม่รู้ว่าผู้ใช้กดยกเลิกหรือไม่ จึงต้องให้ยืนยันก่อนนับว่าสำรองแล้ว
        setAskSavedOpen(true)
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      toast.error('สำรองข้อมูลไม่สำเร็จ')
    }
  }

  const doImport = async () => {
    if (!importFile) return
    setBusy(true)
    try {
      await importBackup(importFile)
      toast.success('นำเข้าข้อมูลเรียบร้อย กำลังรีโหลด...')
      setTimeout(() => location.reload(), 700)
    } catch (err) {
      setBusy(false)
      toast.error(err instanceof Error ? err.message : 'นำเข้าข้อมูลไม่สำเร็จ')
    }
  }

  const doSeed = async () => {
    try {
      // seedSampleData เพิ่มเฉพาะตารางที่ยังว่าง แล้วคืนสรุปว่าเพิ่ม/ข้ามอะไร
      const { added, skipped } = await seedSampleData()
      if (added.length === 0) {
        toast.error(
          skipped.length > 0
            ? `มีข้อมูลอยู่แล้วทุกส่วน จึงไม่เพิ่มอะไร (ข้าม: ${skipped.join(', ')})`
            : 'ไม่มีข้อมูลตัวอย่างที่ต้องเพิ่ม',
        )
        return
      }
      toast.success(
        `เพิ่ม: ${added.join(', ')}` +
          (skipped.length > 0 ? ` / ข้าม (มีข้อมูลอยู่แล้ว): ${skipped.join(', ')}` : ''),
      )
    } catch {
      toast.error('โหลดข้อมูลตัวอย่างไม่สำเร็จ')
    }
  }

  const doClear = async () => {
    setBusy(true)
    try {
      await clearAllData(true)
      toast.success('ล้างข้อมูลเรียบร้อย กำลังรีโหลด...')
      setTimeout(() => location.reload(), 700)
    } catch {
      setBusy(false)
      toast.error('ล้างข้อมูลไม่สำเร็จ')
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="ตั้งค่า"
          subtitle="ข้อมูลร้าน ภาษี ใบเสร็จ พร้อมเพย์ พนักงาน กะ ใบกำกับภาษี และการจัดการข้อมูล"
        />

        <div className="space-y-5">
          {/* ===== 1. ข้อมูลร้านค้า ===== */}
          <Card title="ข้อมูลร้านค้า">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ชื่อร้าน *">
                <Input
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="เช่น ร้านกาแฟบ้านสวน"
                />
              </Field>
              <Field label="สาขา">
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="เช่น สาขาหลัก"
                />
              </Field>
              <Field label="ที่อยู่" className="sm:col-span-2">
                <Textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="ที่อยู่ร้าน (แสดงบนหัวใบเสร็จ)"
                />
              </Field>
              <Field label="เบอร์โทร">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="เช่น 081-234-5678"
                />
              </Field>
              <Field label="เลขประจำตัวผู้เสียภาษี">
                <Input
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="13 หลัก (ถ้ามี)"
                />
              </Field>
            </div>

            <div className="mt-4">
              <span className="mb-1 block text-sm font-medium text-slate-600">โลโก้ร้าน</span>
              <div className="flex items-center gap-4">
                {logo ? (
                  <img
                    src={logo}
                    alt="โลโก้ร้าน"
                    className="h-16 w-16 rounded-full border border-slate-200 object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 text-slate-300">
                    <Icon name="home" size={24} />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="upload"
                    onClick={() => logoInputRef.current?.click()}
                  >
                    อัปโหลดโลโก้
                  </Button>
                  {logo && (
                    <Button variant="ghost" size="sm" icon="trash" onClick={() => setLogo(undefined)}>
                      ลบโลโก้
                    </Button>
                  )}
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void onPickLogo(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </div>
              <span className="mt-1 block text-xs text-slate-400">
                แสดงบนหัวใบเสร็จ — รูปจะถูกย่อขนาดอัตโนมัติ
              </span>
            </div>

            <div className="mt-5 flex justify-end">
              <Button icon="check" onClick={() => void saveShop()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 2. โหมดธุรกิจ ===== */}
          <Card title="โหมดธุรกิจ">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ModeCard
                icon="box"
                title="ค้าปลีก / มินิมาร์ท"
                desc="เน้นบาร์โค้ดและความเร็ว เหมาะกับร้านที่สแกนสินค้าขาย"
                active={settings.mode === 'retail'}
                onClick={() => void chooseMode('retail')}
              />
              <ModeCard
                icon="coffee"
                title="ร้านอาหาร / คาเฟ่"
                desc="ปุ่มใหญ่ เหมาะจอสัมผัส รองรับตัวเลือกสินค้า เช่น ความหวาน"
                active={settings.mode === 'cafe'}
                onClick={() => void chooseMode('cafe')}
              />
            </div>
            <p className="mt-3 text-xs text-slate-400">บันทึกทันทีเมื่อเลือกโหมด</p>
          </Card>

          {/* ===== 3. ภาษี & แต้มสะสม ===== */}
          <Card title="ภาษี & แต้มสะสม">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="อัตราภาษีมูลค่าเพิ่ม (%)" hint="0 = ไม่คิดภาษี">
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  value={vatRate}
                  onChange={(e) => setVatRate(e.target.value)}
                />
              </Field>
              <div className="flex flex-col justify-center gap-1 pt-1 sm:pt-6">
                <Toggle
                  checked={vatIncluded}
                  onChange={setVatIncluded}
                  label="ราคาสินค้ารวม VAT แล้ว"
                />
                <span className="text-xs text-slate-400">
                  ปิด = ระบบจะบวก VAT เพิ่มท้ายบิล
                </span>
              </div>
              <Field
                label="ยอดซื้อต่อ 1 แต้ม (บาท)"
                hint="ยอดซื้อกี่บาทได้ 1 แต้ม — 0 = ปิดระบบแต้ม"
              >
                <Input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="decimal"
                  value={bahtPerPoint}
                  onChange={(e) => setBahtPerPoint(e.target.value)}
                />
              </Field>
              <Field label="มูลค่าแต้ม (บาท)" hint="1 แต้มแลกได้กี่บาท">
                <Input
                  type="number"
                  min={0}
                  step={0.25}
                  inputMode="decimal"
                  value={redeemValue}
                  onChange={(e) => setRedeemValue(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-5 flex justify-end">
              <Button icon="check" onClick={() => void saveTax()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 4. ใบเสร็จ ===== */}
          <Card title="ใบเสร็จ">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ความกว้างกระดาษ">
                <Select
                  value={receiptWidth}
                  onChange={(e) => setReceiptWidth(e.target.value as '58' | '80')}
                >
                  <option value="80">80 มม. (มาตรฐาน)</option>
                  <option value="58">58 มม. (ขนาดเล็ก)</option>
                </Select>
              </Field>
              <Field label="ข้อความท้ายใบเสร็จ" className="sm:col-span-2">
                <Textarea
                  rows={2}
                  value={receiptFooter}
                  onChange={(e) => setReceiptFooter(e.target.value)}
                  placeholder="เช่น ขอบคุณที่อุดหนุนครับ/ค่ะ"
                />
              </Field>
            </div>

            {/* ----- เลขคิว & สลิปครัว ----- */}
            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Toggle
                  checked={queueEnabled}
                  onChange={setQueueEnabled}
                  label="แสดงเลขคิวบนใบเสร็จ"
                />
                <span className="text-xs text-slate-400">
                  เหมาะกับร้านกาแฟ/ร้านอาหารที่ลูกค้ารอรับ — ระบบออกเลขคิวใหม่ทุกวัน
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <Toggle
                  checked={kitchenPrintEnabled}
                  onChange={setKitchenPrintEnabled}
                  label="เปิดปุ่มพิมพ์สลิปครัว/บาร์"
                />
                <span className="text-xs text-slate-400">
                  พิมพ์เฉพาะรายการ+ตัวเลือก ไม่มีราคา ส่งให้คนชง/ครัว
                </span>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {kitchenPrintEnabled && (
                <Button variant="secondary" icon="printer" onClick={testKitchenPrint}>
                  ทดสอบสลิปครัว
                </Button>
              )}
              <Button variant="secondary" icon="printer" onClick={testPrint}>
                พิมพ์ทดสอบ
              </Button>
              <Button icon="check" onClick={() => void saveReceipt()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 5. บริการด่วน (Quick Service) ===== */}
          <Card title={<CardTitle icon="coffee">บริการด่วน (Quick Service)</CardTitle>}>
            <div className="flex flex-col gap-1">
              <Toggle
                checked={quickServiceEnabled}
                onChange={setQuickServiceEnabled}
                label="เปิดใช้โหมดบริการด่วน (จอครัว / คิวออเดอร์)"
              />
              <span className="text-xs leading-relaxed text-slate-400">
                เปิดแล้วจะมีเมนู "จอครัว / คิว" ให้คนชง/ครัวดูออเดอร์ และหลังชำระเงินที่หน้าขาย
                จะเพิ่มขั้นตอน{' '}
                <span className="font-medium text-slate-600">ตรวจการชำระเงิน → ส่งเข้าครัว</span>{' '}
                ออเดอร์จึงจะขึ้นบนจอครัวและเดินสถานะ คิว → กำลังทำ → พร้อมเสิร์ฟ → ส่งลูกค้าแล้ว
              </span>
            </div>

            {/* ----- ตัวเลือกย่อย: ใช้ได้เมื่อเปิดโหมดบริการด่วนแล้วเท่านั้น ----- */}
            <div
              className={`mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 ${
                quickServiceEnabled ? '' : 'opacity-50'
              }`}
            >
              <div className="flex flex-col gap-1">
                <div className={quickServiceEnabled ? '' : 'pointer-events-none'}>
                  <Toggle
                    checked={requirePaymentVerify}
                    onChange={(v) => {
                      if (!quickServiceEnabled) return
                      // ปิดด่านตรวจ = ยอมให้ครัวทำอาหารก่อนเห็นเงิน ต้องยืนยันก่อนเสมอ
                      if (v) setRequirePaymentVerify(true)
                      else setVerifyOffOpen(true)
                    }}
                    label="บังคับตรวจสลิปก่อนส่งเข้าครัว (โอน / บัตร)"
                  />
                </div>
                <span className="text-xs leading-relaxed text-slate-400">
                  เงินสดไม่ต้องตรวจ เพราะเงินอยู่ในมือและทอนไปแล้ว — เฉพาะโอน/QR และบัตร
                  ที่ต้องมีคนกดยืนยันว่าเห็นเงินเข้าจริงก่อน ครัวจึงจะได้ออเดอร์
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <div className={quickServiceEnabled ? '' : 'pointer-events-none'}>
                  <Toggle
                    checked={kitchenAutoPrint}
                    onChange={(v) => {
                      if (quickServiceEnabled) setKitchenAutoPrint(v)
                    }}
                    label="พิมพ์สลิปครัวอัตโนมัติเมื่อกดส่งเข้าครัว"
                  />
                </div>
                <span className="text-xs leading-relaxed text-slate-400">
                  ปิดไว้ = ครัวดูออเดอร์จากหน้าจอ "จอครัว / คิว" อย่างเดียว ไม่ต้องใช้กระดาษ
                </span>
              </div>
              <Field
                label="เตือนเมื่อออเดอร์ค้างในครัวนานเกิน"
                hint="ออเดอร์ที่ยังไม่ส่งลูกค้าและค้างเกินเวลานี้จะถูกไฮไลต์เตือนบนจอครัว"
              >
                <Select
                  value={kitchenAlertMinutes}
                  onChange={(e) => setKitchenAlertMinutes(e.target.value)}
                  disabled={!quickServiceEnabled}
                >
                  {KITCHEN_ALERT_OPTIONS.map((o) => (
                    <option key={o.value} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* ----- เตือนว่าตอนนี้ปิดด่านตรวจสลิปไว้ ----- */}
            {quickServiceEnabled && !requirePaymentVerify && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                <span>
                  ปิดการบังคับตรวจสลิปอยู่ — ออเดอร์ที่จ่ายด้วยการโอนจะส่งเข้าครัวได้ทันที
                  โดยไม่มีใครตรวจว่าเงินเข้าจริง เสี่ยงทำอาหารทิ้งจากสลิปปลอมหรือโอนไม่สำเร็จ
                </span>
              </div>
            )}

            {/* ----- แนะนำให้เปิดเลขคิวคู่กัน ----- */}
            {quickServiceEnabled && !settings.queueEnabled && (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs leading-relaxed text-sky-800">
                <Icon name="clock" size={16} className="mt-0.5 shrink-0" />
                <span>
                  แนะนำให้เปิด "แสดงเลขคิวบนใบเสร็จ" ที่การ์ด "ใบเสร็จ" ด้านบนด้วย —
                  ลูกค้าจะได้รู้ว่าคิวไหนเป็นของตัวเองตอนครัวเรียกรับของ
                </span>
              </div>
            )}

            {!quickServiceEnabled && (
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                ปิดอยู่ = ขายแล้วจบที่การพิมพ์ใบเสร็จเหมือนเดิม ไม่มีเมนูจอครัวและไม่มีสถานะออเดอร์
                (เหมาะกับร้านค้าปลีกที่ลูกค้าหยิบของแล้วจ่ายเงินกลับได้เลย)
              </p>
            )}

            <div className="mt-5 flex justify-end">
              <Button icon="check" disabled={quickBusy} onClick={() => void saveQuickService()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 5.1 รับออเดอร์ที่โต๊ะ ===== */}
          <Card title={<CardTitle icon="pencil">รับออเดอร์ที่โต๊ะ (มือถือพนักงาน)</CardTitle>}>
            <div className="flex flex-col gap-1">
              <Toggle
                checked={tableOrderEnabled}
                onChange={setTableOrderEnabled}
                label="เปิดใช้การรับออเดอร์ที่โต๊ะ"
              />
              <span className="text-xs leading-relaxed text-slate-400">
                เปิดแล้วจะมีเมนู "ออเดอร์ที่โต๊ะ" ให้พนักงานถือมือถือเดินรับออเดอร์
                เลือกโต๊ะ กดรายการ แล้วสรุปยอด{' '}
                <span className="font-medium text-slate-600">
                  ตอนนี้ทำได้ถึงขั้นสรุปยอดเท่านั้น
                </span>{' '}
                ส่วนการกาง QR ให้ลูกค้าจ่าย ถ่ายรูปสลิป และส่งเข้าเครื่องกลาง ยังสร้างไม่เสร็จ
              </span>
            </div>

            <div
              className={`mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 ${
                tableOrderEnabled ? '' : 'opacity-50'
              }`}
            >
              <Field label="จำนวนโต๊ะ" hint="โต๊ะจะถูกตั้งชื่อเป็น 1 ถึงเลขนี้ (สูงสุด 200)">
                <Input
                  value={tableCount}
                  inputMode="numeric"
                  disabled={!tableOrderEnabled}
                  onChange={(e) => setTableCount(e.target.value)}
                />
              </Field>
            </div>

            {tableOrderEnabled && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs leading-relaxed text-sky-800">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                <span>
                  ที่โต๊ะจะยังไม่มีส่วนลด คูปอง แลกแต้ม และใบกำกับภาษี —
                  ลูกค้าที่ขอต้องไปที่เคาน์เตอร์ · การรับเงินสดที่โต๊ะปิดไว้
                  เพราะยังไม่มีขั้นตอนนำเงินส่งลิ้นชัก ถ้าเปิดตอนนี้ปิดกะจะขาดทุกวัน
                </span>
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <Button icon="check" disabled={tableBusy} onClick={() => void saveTableOrder()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 6. พร้อมเพย์ (QR รับเงิน) ===== */}
          <Card title="พร้อมเพย์ (QR รับเงิน)">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <Field label="รหัสพร้อมเพย์ของร้าน" hint={PROMPTPAY_ID_HINT}>
                  <Input
                    value={promptpayId}
                    onChange={(e) => setPromptpayId(e.target.value)}
                    placeholder="เช่น 0812345678"
                    inputMode="numeric"
                  />
                </Field>

                {promptpayId.trim() !== '' && !ppTarget && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                    <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                    <span>
                      รูปแบบรหัสไม่ถูกต้อง — ต้องเป็น{PROMPTPAY_ID_HINT} (ยังสร้าง QR ไม่ได้)
                    </span>
                  </div>
                )}
                {ppTarget && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0" />
                    <span>
                      ใช้ได้ —{' '}
                      {ppTarget.kind === 'phone'
                        ? 'เบอร์โทร'
                        : ppTarget.kind === 'nationalId'
                          ? 'เลขบัตรประชาชน / ผู้เสียภาษี'
                          : 'e-Wallet'}
                    </span>
                  </div>
                )}

                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  ใช้ตอนลูกค้าเลือกจ่ายแบบ "โอน / QR" ที่หน้าขาย — ระบบจะสร้าง QR
                  ที่ฝังยอดเงินของบิลนั้นให้ลูกค้าสแกนได้ทันที ทำงานออฟไลน์ 100%
                  (ไม่ต้องต่ออินเทอร์เน็ต) เว้นว่างไว้ = ปิดการสร้าง QR
                </p>
              </div>

              {/* ตัวอย่าง QR ที่สร้างได้จริงจากรหัสที่กรอก */}
              <div className="flex flex-col items-center gap-2">
                {qrPreview ? (
                  <>
                    <img
                      src={qrPreview}
                      alt="ตัวอย่าง QR พร้อมเพย์ ยอด 100 บาท"
                      className="h-40 w-40 rounded-xl border border-slate-200 bg-white p-1"
                    />
                    <span className="text-xs text-slate-500">ตัวอย่าง QR ยอด 100 บาท</span>
                  </>
                ) : (
                  <>
                    <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-300">
                      <Icon name="qr" size={32} />
                    </div>
                    <span className="text-xs text-slate-400">
                      กรอกรหัสให้ถูกต้องเพื่อดูตัวอย่าง QR
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <Button icon="check" onClick={() => void savePromptpay()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 7. พนักงาน & ความปลอดภัย ===== */}
          <Card title={<CardTitle icon="shield">พนักงาน &amp; ความปลอดภัย</CardTitle>}>
            <div className="flex flex-col gap-1">
              <Toggle
                checked={settings.staffEnabled ?? false}
                onChange={(v) => {
                  if (staffBusy) return
                  if (v) setStaffOnOpen(true)
                  else void disableStaffSystem()
                }}
                label="เปิดใช้ระบบพนักงาน (ต้องเข้าสู่ระบบด้วย PIN)"
              />
              <span className="text-xs leading-relaxed text-slate-400">
                เปิดแล้วทุกครั้งที่เปิดแอปต้องเลือกชื่อพนักงานและใส่ PIN ก่อนใช้งาน
                ทุกบิลจะบันทึกชื่อผู้ขายไว้ และเมนูจะแสดงตามสิทธิ์ของแต่ละคน —
                สวิตช์นี้บันทึกทันทีเมื่อสลับ
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <Field
                label="ล็อกหน้าจออัตโนมัติ"
                hint="ไม่มีการใช้งานครบเวลานี้แล้วล็อกหน้าจอ — ปลดล็อกด้วย PIN"
              >
                <Select
                  value={autoLockMinutes}
                  onChange={(e) => setAutoLockMinutes(e.target.value)}
                  disabled={!settings.staffEnabled}
                >
                  {AUTO_LOCK_OPTIONS.map((o) => (
                    <option key={o.value} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-col justify-center gap-2 sm:pt-1">
                <span className="text-sm text-slate-600">
                  พนักงานที่ใช้งานอยู่{' '}
                  <span className="font-bold text-slate-800">
                    {staffStat ? baht(staffStat.active) : '—'}
                  </span>{' '}
                  คน
                  {staffStat && staffStat.total > staffStat.active && (
                    <span className="text-xs text-slate-400">
                      {' '}
                      (ปิดใช้งานอยู่ {baht(staffStat.total - staffStat.active)} คน)
                    </span>
                  )}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="users"
                  className="self-start"
                  onClick={() => navigate('/staff')}
                >
                  ไปหน้าจัดการพนักงาน
                </Button>
              </div>
            </div>

            {!settings.staffEnabled && (
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                ปิดอยู่ = ใช้งานได้ทุกเมนูโดยไม่ต้องใส่ PIN (เหมาะกับร้านที่เจ้าของขายคนเดียว)
                — การล็อกหน้าจออัตโนมัติจะทำงานเมื่อเปิดระบบพนักงานแล้วเท่านั้น
              </p>
            )}

            <div className="mt-5 flex justify-end">
              <Button icon="check" disabled={securityBusy} onClick={() => void saveSecurity()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 8. กะ & ลิ้นชักเงินสด ===== */}
          <Card title={<CardTitle icon="cash">กะ &amp; ลิ้นชักเงินสด</CardTitle>}>
            {openShift && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
                <Icon name="clock" size={15} className="shrink-0" />
                <span>มีกะที่เปิดอยู่</span>
                <Badge color="green">{openShift.docNo}</Badge>
                <span className="text-emerald-600">
                  เปิดเมื่อ {fmtDateTime(openShift.openedAt)}
                  {openShift.openedByName ? ` โดย ${openShift.openedByName}` : ''}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Toggle checked={shiftEnabled} onChange={setShiftEnabled} label="เปิดใช้ระบบกะ" />
                <span className="text-xs leading-relaxed text-slate-400">
                  เปิดแล้วจะมีเมนู "กะ / ลิ้นชัก" สำหรับเปิด-ปิดกะและนับเงินในลิ้นชัก
                  ทุกบิลจะถูกผูกกับกะเพื่อกระทบยอดเงินสดตอนปิดกะ
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {/* ปิดระบบกะอยู่ → สวิตช์นี้กดไม่ได้ (บังคับเปิดกะก่อนขายไม่มีความหมาย) */}
                <div className={shiftEnabled ? '' : 'pointer-events-none opacity-50'}>
                  <Toggle
                    checked={shiftEnabled && requireShiftToSell}
                    onChange={(v) => {
                      if (shiftEnabled) setRequireShiftToSell(v)
                    }}
                    label="ต้องเปิดกะก่อนจึงจะขายได้"
                  />
                </div>
                <span className="text-xs leading-relaxed text-slate-400">
                  ถ้าเปิดไว้แล้วยังไม่เปิดกะ จะปิดบิลไม่ได้ —
                  พนักงานต้องกดเปิดกะพร้อมนับเงินทอนตั้งต้นก่อนเริ่มขาย
                </span>
              </div>
              <Field
                label="เงินทอนตั้งต้นที่เสนอตอนเปิดกะ (บาท)"
                hint="ค่าที่เติมให้อัตโนมัติในหน้าเปิดกะ — แก้ไขได้ตอนเปิดกะจริง"
              >
                <Input
                  type="number"
                  min={0}
                  step={100}
                  inputMode="decimal"
                  value={defaultOpeningCash}
                  onChange={(e) => setDefaultOpeningCash(e.target.value)}
                />
              </Field>
            </div>

            {settings.shiftEnabled && settings.requireShiftToSell && !openShift && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                <span>
                  ตอนนี้ยังไม่มีกะที่เปิดอยู่ และตั้งค่าให้ "ต้องเปิดกะก่อนจึงจะขายได้" —
                  หน้าขายจะปิดบิลไม่ได้จนกว่าจะเปิดกะที่เมนู "กะ / ลิ้นชัก"
                </span>
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <Button icon="check" disabled={shiftBusy} onClick={() => void saveShiftSettings()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 9. ใบกำกับภาษีเต็มรูป ===== */}
          <Card title={<CardTitle icon="invoice">ใบกำกับภาษีเต็มรูป</CardTitle>}>
            <div className="flex flex-col gap-1">
              <Toggle
                checked={vatRegistered}
                onChange={setVatRegistered}
                label="ร้านจดทะเบียนภาษีมูลค่าเพิ่ม (ออกใบกำกับภาษีเต็มรูปได้)"
              />
              <span className="text-xs leading-relaxed text-slate-400">
                เปิดเมื่อร้านจด VAT แล้วเท่านั้น — ร้านที่ยังไม่จดทะเบียนออกใบกำกับภาษีไม่ได้
                ตามกฎหมาย
              </span>
            </div>

            {/* ----- สถานะความพร้อม ----- */}
            {!vatRegistered ? (
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                ปิดอยู่ — ปุ่มออกใบกำกับภาษีที่หน้า "ประวัติการขาย" จะถูกซ่อนไว้
              </p>
            ) : taxNotReady ? (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                <span>
                  {taxNotReady}
                  <br />
                  กรอกเลขประจำตัวผู้เสียภาษี (13 หลัก) และที่อยู่ร้านที่การ์ด "ข้อมูลร้าน"
                  ด้านบนสุด แล้วกดบันทึกของการ์ดนั้นก่อน
                </span>
              </div>
            ) : (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
                <Icon name="check" size={16} className="mt-0.5 shrink-0" />
                <span>ข้อมูลร้านครบ — พร้อมออกใบกำกับภาษีเต็มรูปและใบลดหนี้</span>
              </div>
            )}

            {vatRegistered && toNum(vatRate) === 0 && (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                <span>
                  อัตราภาษีมูลค่าเพิ่มตั้งไว้ 0% — บิลจะไม่มี VAT จึงออกใบกำกับภาษีไม่ได้
                  ตั้งอัตราภาษีที่การ์ด "ภาษี &amp; แต้มสะสม" ด้านบน
                </span>
              </div>
            )}

            {/* ----- สาขาตามทะเบียน VAT ----- */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <span className="mb-1 block text-sm font-medium text-slate-600">
                สาขาตามทะเบียนภาษีมูลค่าเพิ่ม
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-xl border border-slate-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setBranchIsHead(true)}
                    className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      branchIsHead
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    สำนักงานใหญ่
                  </button>
                  <button
                    type="button"
                    onClick={() => setBranchIsHead(false)}
                    className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      !branchIsHead
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    สาขาที่
                  </button>
                </div>
                {!branchIsHead && (
                  <Input
                    value={branchNo}
                    onChange={(e) => setBranchNo(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="00001"
                    inputMode="numeric"
                    className="w-28"
                  />
                )}
              </div>
              <span className="mt-1 block text-xs text-slate-400">
                จะพิมพ์บนใบกำกับภาษีว่า "{branchTaxCode}" — ต้องตรงกับที่จดทะเบียนไว้กับสรรพากร
              </span>
            </div>

            {/* ----- ผู้ลงนาม + ข้อความท้ายใบ ----- */}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ชื่อผู้มีอำนาจลงนาม" hint="พิมพ์ใต้ช่องลายเซ็นบนใบกำกับภาษี">
                <Input
                  value={taxInvoiceSigner}
                  onChange={(e) => setTaxInvoiceSigner(e.target.value)}
                  placeholder="เช่น นายสมชาย ใจดี"
                />
              </Field>
              <Field label="ข้อความท้ายใบกำกับภาษี" className="sm:col-span-2">
                <Textarea
                  rows={2}
                  value={taxInvoiceNote}
                  onChange={(e) => setTaxInvoiceNote(e.target.value)}
                  placeholder="เช่น กรุณาชำระเงินภายในกำหนด / เอกสารออกเป็นชุด"
                />
              </Field>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              ออกใบกำกับภาษีได้จากหน้า "ประวัติการขาย" (ปุ่มในแถวของบิลนั้น) และดูทะเบียนใบทั้งหมด
              พิมพ์ซ้ำ หรือส่งออก CSV ได้ที่ บัญชี › ใบกำกับภาษี
            </p>

            <div className="mt-5 flex justify-end">
              <Button icon="check" disabled={taxInvBusy} onClick={() => void saveTaxInvoice()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 10. ข้อมูล ===== */}
          <Card title="ข้อมูล">
            <div className="space-y-3">
              {/* ----- สถานะพื้นที่จัดเก็บของเบราว์เซอร์ ----- */}
              {storage === null ? (
                <DataRow
                  icon="alert"
                  title="สถานะพื้นที่จัดเก็บ"
                  desc="เบราว์เซอร์นี้ไม่รองรับการตรวจสอบพื้นที่จัดเก็บ — แนะนำให้สำรองข้อมูลเป็นไฟล์ JSON สม่ำเสมอ"
                  tone="border-slate-200"
                  action={null}
                />
              ) : storage.persisted ? (
                <DataRow
                  icon="check"
                  title="สถานะพื้นที่จัดเก็บ"
                  desc={
                    <>
                      <span className="font-medium text-emerald-700">
                        ข้อมูลถูกกันไม่ให้ลบอัตโนมัติแล้ว
                      </span>
                      {' — ใช้พื้นที่ '}
                      {mbText(storage.usage)}
                      {storage.quota != null && ` จากโควตา ${mbText(storage.quota)}`}
                    </>
                  }
                  tone="border-emerald-200 bg-emerald-50"
                  iconTone="bg-emerald-100 text-emerald-700"
                  action={
                    <Button variant="ghost" size="sm" icon="refresh" onClick={() => void readStorage()}>
                      ตรวจสอบใหม่
                    </Button>
                  }
                />
              ) : (
                <DataRow
                  icon="alert"
                  title="สถานะพื้นที่จัดเก็บ"
                  desc={
                    <>
                      <span className="font-medium text-amber-700">
                        เบราว์เซอร์อาจลบข้อมูลอัตโนมัติเมื่อพื้นที่เครื่องเหลือน้อย
                      </span>
                      {' — ใช้พื้นที่ '}
                      {mbText(storage.usage)}
                      {storage.quota != null && ` จากโควตา ${mbText(storage.quota)}`}
                    </>
                  }
                  tone="border-amber-200 bg-amber-50"
                  iconTone="bg-amber-100 text-amber-700"
                  action={
                    <Button variant="secondary" icon="check" onClick={() => void askPersist()}>
                      ขอสิทธิ์กันข้อมูลหาย
                    </Button>
                  }
                />
              )}
              <DataRow
                icon="download"
                title="สำรองข้อมูล"
                desc="ดาวน์โหลดข้อมูลทั้งหมดเป็นไฟล์ JSON เก็บไว้กู้คืนภายหลัง"
                action={
                  <Button variant="secondary" icon="download" onClick={() => void doExport()}>
                    สำรองข้อมูล (ดาวน์โหลด JSON)
                  </Button>
                }
              />
              <DataRow
                icon="shield"
                title="สำรองอัตโนมัติลงโฟลเดอร์"
                tone={
                  settings.autoBackupEnabled && !backupFolder
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-slate-200'
                }
                desc={
                  !backupSupported ? (
                    'เบราว์เซอร์นี้ยังเขียนไฟล์ลงโฟลเดอร์เองไม่ได้ (ใช้ Chrome หรือ Edge บนคอมพิวเตอร์) — ระหว่างนี้ระบบจะเตือนให้กดสำรองเองแทน'
                  ) : (
                    <>
                      เลือกโฟลเดอร์ไว้ครั้งเดียว จากนั้นระบบจะเขียนไฟล์สำรองให้เองวันละครั้งตอนเปิดแอป
                      (เก็บย้อนหลัง {BACKUP_KEEP} ไฟล์)
                      {backupFolder && (
                        <>
                          {' — โฟลเดอร์ปัจจุบัน: '}
                          <span className="font-medium text-slate-600">{backupFolder}</span>
                        </>
                      )}
                      {settings.lastBackupAt && (
                        <>
                          {' · สำรองล่าสุด '}
                          <span className="font-medium text-slate-600">
                            {fmtDateTime(settings.lastBackupAt)}
                          </span>
                        </>
                      )}
                    </>
                  )
                }
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    {backupSupported && (
                      <>
                        <Button
                          variant="secondary"
                          icon="box"
                          disabled={backupBusy}
                          onClick={() => void chooseBackupFolder()}
                        >
                          {backupFolder ? 'เปลี่ยนโฟลเดอร์' : 'เลือกโฟลเดอร์'}
                        </Button>
                        <Toggle
                          checked={!!settings.autoBackupEnabled}
                          onChange={(v) => void toggleAutoBackup(v)}
                          label="เปิดสำรองอัตโนมัติ"
                        />
                      </>
                    )}
                  </div>
                }
              />
              <DataRow
                icon="clock"
                title="เตือนเมื่อไม่ได้สำรองนาน"
                desc="ขึ้นแถบเตือนด้านบนของทุกหน้า พร้อมปุ่มสำรองทันที — ข้อมูลอยู่ในเครื่องนี้เท่านั้น ถ้าไม่มีไฟล์สำรองจะกู้ไม่ได้เลย"
                action={
                  <div className="w-44">
                    <Select
                      value={String(settings.backupReminderDays ?? 3)}
                      onChange={(e) => void setReminderDays(Number(e.target.value))}
                    >
                      <option value="0">ไม่เตือน</option>
                      <option value="1">ทุกวัน</option>
                      <option value="3">ทุก 3 วัน</option>
                      <option value="7">ทุก 7 วัน</option>
                      <option value="14">ทุก 14 วัน</option>
                    </Select>
                  </div>
                }
              />
              <DataRow
                icon="upload"
                title="นำเข้าข้อมูล"
                desc="กู้คืนจากไฟล์สำรอง — ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่"
                action={
                  <Button
                    variant="secondary"
                    icon="upload"
                    onClick={() => importInputRef.current?.click()}
                  >
                    นำเข้าข้อมูล
                  </Button>
                }
              />
              <DataRow
                icon="box"
                title="ข้อมูลตัวอย่าง"
                desc="เพิ่มสินค้า หมวดหมู่ โปรโมชัน สมาชิก คูปอง และรายจ่ายตัวอย่าง — เฉพาะส่วนที่ยังไม่มีข้อมูล (ไม่เขียนทับข้อมูลจริง)"
                action={
                  <Button variant="secondary" icon="refresh" onClick={() => setSeedOpen(true)}>
                    โหลดข้อมูลตัวอย่าง
                  </Button>
                }
              />
              <DataRow
                icon="trash"
                title="ล้างข้อมูลทั้งหมด"
                desc="ลบสินค้า การขาย สมาชิก ฯลฯ ทั้งหมด (คงการตั้งค่าไว้) — กู้คืนไม่ได้"
                action={
                  <Button variant="danger" icon="trash" onClick={() => {
                    setClearText('')
                    setClearOpen(true)
                  }}>
                    ล้างข้อมูลทั้งหมด
                  </Button>
                }
              />
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  setImportFile(f)
                  setImportOpen(true)
                }
                e.target.value = ''
              }}
            />
          </Card>

          {/* ===== 11. เกี่ยวกับระบบ ===== */}
          <Card title="เกี่ยวกับระบบ">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm leading-relaxed text-slate-500">
                ระบบ POS นี้ทำงานแบบออฟไลน์ได้ ข้อมูลทั้งหมดเก็บอยู่ในเครื่องของคุณผ่าน IndexedDB
                — แนะนำให้สำรองข้อมูลเป็นไฟล์ JSON อย่างสม่ำเสมอ
              </p>
              <Badge color="green">เวอร์ชัน 0.1.0</Badge>
            </div>
          </Card>
        </div>
      </div>

      {/* ===== ยืนยันปิดด่านตรวจสลิปก่อนส่งเข้าครัว ===== */}
      <ConfirmDialog
        open={verifyOffOpen}
        onClose={() => setVerifyOffOpen(false)}
        title="ปิดการบังคับตรวจสลิป?"
        danger
        confirmLabel="ปิดการบังคับตรวจสลิป"
        message={
          <>
            ปิดแล้วออเดอร์ที่ลูกค้าจ่ายด้วย{' '}
            <span className="font-semibold text-slate-800">การโอน / QR หรือบัตร</span>{' '}
            จะถูกส่งเข้าครัวได้ทันทีโดย
            <span className="font-semibold text-slate-800">ไม่มีใครตรวจว่าเงินเข้าจริง</span> —
            ถ้าลูกค้าโชว์สลิปปลอมหรือโอนไม่สำเร็จ ครัวจะทำอาหารทิ้งไปแล้วและร้านรับความเสียหายเอง
            <br />
            เปิดกลับได้ทุกเมื่อที่การ์ดนี้ (อย่าลืมกดบันทึก)
          </>
        }
        onConfirm={() => setRequirePaymentVerify(false)}
      />

      {/* ===== ยืนยันเปิดระบบพนักงาน ===== */}
      <ConfirmDialog
        open={staffOnOpen}
        onClose={() => setStaffOnOpen(false)}
        title="เปิดใช้ระบบพนักงาน"
        confirmLabel="เปิดใช้ระบบพนักงาน"
        message={
          <>
            เมื่อเปิดแล้ว ทุกครั้งที่เปิดแอปจะต้อง
            <span className="font-semibold text-slate-800">เลือกชื่อพนักงานและใส่ PIN</span>{' '}
            ก่อนใช้งาน เมนูที่เห็นจะขึ้นกับสิทธิ์ของแต่ละคน และทุกบิล/เอกสารจะบันทึกชื่อผู้ทำรายการไว้
            {(staffStat?.total ?? 0) === 0 && (
              <>
                {' '}
                — ยังไม่มีพนักงานในระบบ ระบบจะสร้างบัญชีเริ่มต้นให้{' '}
                <span className="font-semibold text-slate-800">เจ้าของร้าน (E01) PIN 1234</span>{' '}
                ซึ่งควรเปลี่ยน PIN ทันทีที่หน้าพนักงาน
              </>
            )}
            <br />
            ปิดกลับได้ทุกเมื่อที่หน้านี้ ข้อมูลการขายไม่หาย
          </>
        }
        onConfirm={() => void enableStaffSystem()}
      />

      {/* ===== ยืนยันว่าดาวน์โหลดไฟล์สำรองสำเร็จจริง ===== */}
      <ConfirmDialog
        open={askSavedOpen}
        onClose={() => setAskSavedOpen(false)}
        title="บันทึกไฟล์สำรองแล้วหรือยัง?"
        message="ถ้ากดยกเลิกในหน้าต่างดาวน์โหลด ไฟล์สำรองจะไม่ถูกสร้าง — ยืนยันเมื่อเห็นไฟล์ในเครื่องแล้วเท่านั้น"
        confirmLabel="บันทึกไฟล์แล้ว"
        onConfirm={() => {
          void markBackedUp().then(() => toast.success('บันทึกเวลาสำรองล่าสุดแล้ว'))
        }}
      />

      {/* ===== ยืนยันนำเข้าข้อมูล ===== */}
      <ConfirmDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="ยืนยันการนำเข้าข้อมูล"
        danger
        confirmLabel="นำเข้าและแทนที่"
        message={
          <>
            ข้อมูลปัจจุบันทั้งหมด (สินค้า การขาย สมาชิก การตั้งค่า ฯลฯ)
            จะถูกแทนที่ด้วยข้อมูลจากไฟล์{' '}
            <span className="font-semibold text-slate-800">{importFile?.name}</span>{' '}
            และไม่สามารถย้อนกลับได้ ต้องการดำเนินการต่อหรือไม่?
          </>
        }
        onConfirm={() => void doImport()}
      />

      {/* ===== ยืนยันโหลดข้อมูลตัวอย่าง ===== */}
      <ConfirmDialog
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        title="โหลดข้อมูลตัวอย่าง"
        confirmLabel="โหลดข้อมูลตัวอย่าง"
        message={
          <>
            ระบบจะเพิ่มข้อมูลตัวอย่าง (หมวดหมู่ สินค้า โปรโมชัน สมาชิก คูปอง และรายจ่าย){' '}
            <span className="font-semibold text-slate-800">
              เฉพาะส่วนที่ยังไม่มีข้อมูลอยู่ในระบบ
            </span>{' '}
            — ข้อมูลจริงที่มีอยู่แล้วจะไม่ถูกแก้ไขหรือเขียนทับ ต้องการดำเนินการต่อหรือไม่?
          </>
        }
        onConfirm={() => void doSeed()}
      />

      {/* ===== ยืนยันล้างข้อมูลทั้งหมด (พิมพ์ "ลบ") ===== */}
      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="ล้างข้อมูลทั้งหมด"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setClearOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              icon="trash"
              disabled={clearText.trim() !== 'ลบ' || busy}
              onClick={() => void doClear()}
            >
              ล้างข้อมูลทั้งหมด
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-rose-700">
            <Icon name="alert" size={18} className="mt-0.5" />
            <span>
              สินค้า หมวดหมู่ การขาย สมาชิก โปรโมชัน และประวัติทั้งหมดจะถูกลบถาวร
              (คงการตั้งค่าร้านไว้) — ไม่สามารถกู้คืนได้
            </span>
          </div>
          <Field label={'พิมพ์คำว่า "ลบ" เพื่อยืนยัน'}>
            <Input
              value={clearText}
              onChange={(e) => setClearText(e.target.value)}
              placeholder="ลบ"
              autoFocus
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
