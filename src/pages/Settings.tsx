import { useEffect, useRef, useState, type ReactNode } from 'react'
import { db, DEFAULT_SETTINGS } from '../db/db'
import { useSettings } from '../db/hooks'
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
import { clearAllData, exportBackup, importBackup } from '../lib/backup'
import { seedSampleData } from '../db/seed'
import { resizeImage } from '../lib/image'
import { printReceipt } from '../lib/receipt'
import { r2 } from '../lib/format'

/* ===== ตัวช่วย ===== */

const toNum = (s: string, fallback = 0) => {
  const v = Number(s)
  return Number.isFinite(v) && v >= 0 ? r2(v) : fallback
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
  return {
    receiptNo: 'TEST-000001',
    items,
    subtotal,
    itemDiscount: 0,
    promoDiscount: 0,
    billDiscount: 0,
    pointDiscount: 0,
    redeemedPoints: 0,
    vatRate: s.vatRate,
    vatIncluded: s.vatIncluded,
    vatAmount,
    total,
    paymentMethod: 'cash',
    received,
    change: r2(received - total),
    earnedPoints: s.bahtPerPoint > 0 ? Math.floor(total / s.bahtPerPoint) : 0,
    appliedPromos: [],
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

/* ===== แถวการจัดการข้อมูล ===== */

function DataRow({
  icon,
  title,
  desc,
  action,
}: {
  icon: IconName
  title: string
  desc: string
  action: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
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
  }, [settings])

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
    await db.settings.update(1, { receiptWidth, receiptFooter })
    toast.success('บันทึกการตั้งค่าใบเสร็จแล้ว')
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

  const testPrint = () => {
    const merged: AppSettings = {
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
    }
    printReceipt(buildSampleSale(merged), merged)
  }

  // ----- จัดการข้อมูล -----

  const doExport = async () => {
    try {
      await exportBackup()
      toast.success('ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว')
    } catch {
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
      await seedSampleData()
      toast.success('โหลดข้อมูลตัวอย่างเรียบร้อยแล้ว')
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
        <PageHeader title="ตั้งค่า" subtitle="ข้อมูลร้าน ภาษี ใบเสร็จ และการจัดการข้อมูล" />

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
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" icon="printer" onClick={testPrint}>
                พิมพ์ทดสอบ
              </Button>
              <Button icon="check" onClick={() => void saveReceipt()}>
                บันทึก
              </Button>
            </div>
          </Card>

          {/* ===== 5. ข้อมูล ===== */}
          <Card title="ข้อมูล">
            <div className="space-y-3">
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
                desc="เพิ่มสินค้า หมวดหมู่ โปรโมชัน และสมาชิกตัวอย่างสำหรับทดลองใช้"
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

          {/* ===== 6. เกี่ยวกับระบบ ===== */}
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
        message="ระบบจะเพิ่มสินค้า หมวดหมู่ โปรโมชัน สมาชิก และรายจ่ายตัวอย่างลงในระบบ (รายการตัวอย่างเดิมที่มีอยู่จะถูกเขียนทับ ส่วนรายจ่ายตัวอย่างจะเพิ่มเฉพาะเมื่อยังไม่มีรายจ่ายในระบบ) ต้องการดำเนินการต่อหรือไม่?"
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
