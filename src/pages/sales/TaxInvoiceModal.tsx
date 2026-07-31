import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Sale, TaxInvoice, TaxInvoiceCustomer } from '../../db/types'
import { usePermissions, useSettings } from '../../db/hooks'
import {
  HEAD_OFFICE,
  activeInvoiceOfSale,
  cancelTaxInvoice,
  checkTaxIdDigits,
  issueTaxInvoice,
  memberToCustomer,
  shopTaxReadiness,
  suggestCustomers,
  taxInvoiceAmounts,
  validateCustomer,
} from '../../lib/taxInvoice'
import { printTaxInvoice, printTaxInvoiceBothCopies } from '../../lib/taxInvoiceDoc'
import { bahtText } from '../../lib/bahtText'
import { baht, fmtDate, fmtDateTime } from '../../lib/format'
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Icon,
  Input,
  Modal,
  Textarea,
  toast,
} from '../../components/ui'

/* =========================================================
   โมดัลใบกำกับภาษีเต็มรูป (ม.86/4) / ใบลดหนี้ (ม.86/10)
   - บิลขาย → ใบกำกับภาษี, เอกสารคืนสินค้า → ใบลดหนี้ (issueTaxInvoice เลือกให้อัตโนมัติ)
   - 3 โหมด: ฟอร์มออกใบ → หน้าสำเร็จ (ถามพิมพ์) → ดูใบที่ออกแล้ว (พิมพ์ซ้ำ/ยกเลิก)
   ========================================================= */

type BranchMode = 'head' | 'branch'

/** แปลงข้อความสาขาเป็นโหมด + เลขสาขา เช่น 'สาขาที่ 00012' → ('branch', '00012') */
function parseBranch(v: string | undefined): { mode: BranchMode; no: string } {
  const m = /(\d{1,5})/.exec(v ?? '')
  if (v && v.includes('สาขา') && m) return { mode: 'branch', no: m[1] }
  return { mode: 'head', no: '' }
}

/** ประกอบข้อความสาขาให้อยู่ในรูปมาตรฐาน 'สำนักงานใหญ่' / 'สาขาที่ 00001' */
const buildBranch = (mode: BranchMode, no: string) =>
  mode === 'head' ? HEAD_OFFICE : `สาขาที่ ${no.padStart(5, '0')}`

const digitsOnly = (v: string) => v.replace(/\D/g, '')

/** แถวสรุปยอดในแผงภาษี */
function SumRow({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${big ? 'pt-1' : ''}`}>
      <span className={big ? 'text-sm font-bold text-slate-800' : 'text-slate-500'}>{label}</span>
      <span
        className={big ? 'text-lg font-bold text-emerald-600' : 'font-medium text-slate-700'}
      >
        ฿{value}
      </span>
    </div>
  )
}

/** แถวข้อมูลใบที่ออกแล้ว */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-32 shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-line font-medium text-slate-700">{value}</span>
    </div>
  )
}

interface Props {
  open: boolean
  sale: Sale | null
  onClose: () => void
}

export default function TaxInvoiceModal({ open, sale, onClose }: Props) {
  const settings = useSettings()
  const { can } = usePermissions()
  const allowed = can('taxInvoice')
  const isRefundDoc = sale?.kind === 'refund'
  const kindLabel = isRefundDoc ? 'ใบลดหนี้' : 'ใบกำกับภาษี'

  // ---- ใบที่ยังไม่ถูกยกเลิกของบิลนี้ (ห่อใน object เพื่อแยก "กำลังโหลด" กับ "ไม่มีใบ") ----
  const found = useLiveQuery(
    async () => {
      if (sale?.id == null) return { inv: null }
      return { inv: (await activeInvoiceOfSale(sale.id)) ?? null }
    },
    [sale?.id],
  )
  const activeInv = found?.inv ?? null

  // ---- ฟอร์มผู้ซื้อ ----
  const [name, setName] = useState('')
  const [taxId, setTaxId] = useState('')
  const [branchMode, setBranchMode] = useState<BranchMode>('head')
  const [branchNo, setBranchNo] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [saveToMember, setSaveToMember] = useState(true)
  const [sugQ, setSugQ] = useState('')
  const [sugOpen, setSugOpen] = useState(false)

  const [busy, setBusy] = useState(false)
  /** ล็อกแบบ synchronous — กันกดปุ่มรัวก่อน state busy จะอัปเดต */
  const lock = useRef(false)
  const [issued, setIssued] = useState<TaxInvoice | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  /** กันไดอะล็อกยืนยันปิดตัวเองตอนยังไม่กรอกเหตุผล */
  const keepConfirmOpen = useRef(false)

  // เปลี่ยนบิล / เปิดโมดัลใหม่ → ล้างฟอร์มทุกครั้ง
  useEffect(() => {
    setName('')
    setTaxId('')
    setBranchMode('head')
    setBranchNo('')
    setAddress('')
    setPhone('')
    setNote('')
    setSaveToMember(true)
    setSugQ('')
    setSugOpen(false)
    setIssued(null)
    setCancelOpen(false)
    setCancelReason('')
  }, [open, sale?.id])

  // ---- ผู้ซื้อที่เคยออกใบให้ (กดเลือกเพื่อเติมฟอร์ม) ----
  const suggestions = useLiveQuery(
    async () => (sugOpen ? await suggestCustomers(sugQ) : []),
    [sugOpen, sugQ],
    [] as TaxInvoiceCustomer[],
  )

  const notReady = shopTaxReadiness(settings)
  const amounts = useMemo(() => (sale ? taxInvoiceAmounts(sale) : null), [sale])

  const customer: TaxInvoiceCustomer = {
    name: name.trim(),
    taxId: digitsOnly(taxId),
    taxBranch: buildBranch(branchMode, branchNo),
    address: address.trim(),
    phone: phone.trim() || undefined,
  }
  const taxIdDigits = digitsOnly(taxId)
  const taxIdOk = taxIdDigits.length === 13
  const taxIdChecksum = taxIdOk && checkTaxIdDigits(taxIdDigits)
  const branchOk = branchMode === 'head' || digitsOnly(branchNo).length > 0
  const formOk =
    notReady == null &&
    allowed &&
    name.trim().length > 0 &&
    taxIdOk &&
    branchOk &&
    address.trim().length > 0

  const fillFrom = (c: TaxInvoiceCustomer) => {
    const b = parseBranch(c.taxBranch)
    setName(c.name)
    setTaxId(c.taxId)
    setBranchMode(b.mode)
    setBranchNo(b.no)
    setAddress(c.address)
    setPhone(c.phone ?? '')
    setSugOpen(false)
  }

  /** ดึงข้อมูลภาษีจากสมาชิกของบิล */
  const pullFromMember = async () => {
    if (sale?.memberId == null) return
    const m = await db.members.get(sale.memberId)
    if (!m) {
      toast.error('ไม่พบข้อมูลสมาชิกของบิลนี้')
      return
    }
    fillFrom(memberToCustomer(m))
    if (!m.taxId || !m.address) {
      toast.error('สมาชิกนี้ยังไม่มีข้อมูลภาษีครบ — กรุณากรอกเลขผู้เสียภาษี/ที่อยู่เพิ่ม')
    } else {
      toast.success(`เติมข้อมูลของ ${m.name} แล้ว`)
    }
  }

  // ---- ออกใบ ----
  const doIssue = async () => {
    if (lock.current || busy) return
    if (sale?.id == null) return
    if (!allowed) {
      toast.error('คุณไม่มีสิทธิ์ออกใบกำกับภาษี')
      return
    }
    const invalid = validateCustomer(customer)
    if (invalid) {
      toast.error(invalid)
      return
    }
    lock.current = true
    setBusy(true)
    try {
      const doc = await issueTaxInvoice({
        saleId: sale.id,
        customer,
        note: note.trim() || undefined,
      })
      // จำข้อมูลภาษีไว้กับสมาชิก เพื่อครั้งหน้าไม่ต้องกรอกใหม่
      if (saveToMember && sale.memberId != null) {
        await db.members.update(sale.memberId, {
          taxId: customer.taxId,
          taxBranch: customer.taxBranch,
          address: customer.address,
        })
      }
      toast.success(`ออก${doc.kind === 'creditNote' ? 'ใบลดหนี้' : 'ใบกำกับภาษี'} ${doc.docNo} แล้ว`)
      setIssued(doc)
    } catch (e) {
      // ข้อความจาก issueTaxInvoice เป็นภาษาไทยอยู่แล้ว — แสดงตรงๆ ให้ผู้ใช้แก้ได้
      toast.error(e instanceof Error ? e.message : 'ออกใบกำกับภาษีไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  // ---- ยกเลิกใบ ----
  const doCancel = async (inv: TaxInvoice) => {
    if (lock.current || busy) return
    if (inv.id == null) return
    if (!allowed) {
      toast.error('คุณไม่มีสิทธิ์ยกเลิกใบกำกับภาษี')
      return
    }
    lock.current = true
    setBusy(true)
    try {
      await cancelTaxInvoice(inv.id, cancelReason.trim())
      toast.success(`ยกเลิกเอกสาร ${inv.docNo} แล้ว — เก็บต้นฉบับที่ยกเลิกไว้เป็นหลักฐาน`)
      setCancelOpen(false)
      setIssued(null)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ยกเลิกใบกำกับภาษีไม่สำเร็จ')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const print = (inv: TaxInvoice, mode: 'both' | 'original' | 'copy') => {
    if (!sale) return
    if (mode === 'both') printTaxInvoiceBothCopies(inv, sale, settings)
    else printTaxInvoice(inv, sale, settings, { copy: mode === 'copy' })
  }

  const handleClose = () => {
    if (busy) return // กำลังเขียน DB — กัน Esc / คลิกฉากหลังปิดกลางคัน
    onClose()
  }

  /** ใบที่จะแสดงในโหมด "ออกใบแล้ว" (ใบที่เพิ่งออกมาก่อน) */
  const shown = issued ?? activeInv
  const shownIsCredit = shown?.kind === 'creditNote'

  return (
    <>
      <Modal
        open={open && sale != null}
        onClose={handleClose}
        size="lg"
        title={
          sale ? (
            <span className="flex flex-wrap items-center gap-2">
              <Icon name="invoice" size={18} className="text-sky-600" />
              <span>
                {shown
                  ? `${shownIsCredit ? 'ใบลดหนี้' : 'ใบกำกับภาษี'} ${shown.docNo}`
                  : `ออก${kindLabel}เต็มรูป`}
              </span>
              <Badge color={isRefundDoc ? 'red' : 'slate'}>
                {isRefundDoc ? 'เอกสารคืนสินค้า' : 'บิล'} {sale.receiptNo}
              </Badge>
              <span className="text-xs font-normal text-slate-400">
                {fmtDateTime(sale.createdAt)}
              </span>
            </span>
          ) : undefined
        }
        footer={
          sale ? (
            shown ? (
              <>
                {activeInv != null && (
                  <Button
                    variant="danger"
                    icon="x"
                    className="mr-auto"
                    disabled={busy || !allowed}
                    title={allowed ? undefined : 'ไม่มีสิทธิ์ยกเลิกใบกำกับภาษี'}
                    onClick={() => {
                      setCancelReason('')
                      setCancelOpen(true)
                    }}
                  >
                    ยกเลิกใบกำกับภาษี
                  </Button>
                )}
                <Button variant="secondary" icon="printer" onClick={() => print(shown, 'copy')}>
                  พิมพ์สำเนา
                </Button>
                <Button variant="secondary" icon="printer" onClick={() => print(shown, 'both')}>
                  พิมพ์ต้นฉบับ+สำเนา
                </Button>
                <Button icon="printer" onClick={() => print(shown, 'original')}>
                  พิมพ์ต้นฉบับ
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={handleClose} disabled={busy}>
                  ปิด
                </Button>
                <Button
                  icon="invoice"
                  disabled={busy || !formOk}
                  title={allowed ? undefined : 'ไม่มีสิทธิ์ออกใบกำกับภาษี'}
                  onClick={() => void doIssue()}
                >
                  {busy ? 'กำลังออกเอกสาร…' : `ออก${kindLabel}`}
                </Button>
              </>
            )
          ) : undefined
        }
      >
        {sale && (
          <div className="space-y-4 text-sm">
            {shown ? (
              /* ===================== โหมด: ออกใบแล้ว ===================== */
              <>
                {issued != null && (
                  <div className="flex flex-col items-center gap-2 rounded-2xl bg-emerald-50 py-4 text-center">
                    <div className="rounded-full bg-emerald-100 p-3 text-emerald-600">
                      <Icon name="check" size={32} />
                    </div>
                    <div className="text-base font-bold text-slate-800">
                      ออก{shownIsCredit ? 'ใบลดหนี้' : 'ใบกำกับภาษี'}เรียบร้อย
                    </div>
                    <div className="text-xs text-slate-500">
                      พิมพ์ต้นฉบับให้ลูกค้า และเก็บสำเนาไว้ที่ร้าน
                    </div>
                  </div>
                )}

                {shown.cancelledAt != null && (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-700">
                    <div className="flex items-center gap-2 font-semibold">
                      <Icon name="alert" size={16} />
                      เอกสารนี้ถูกยกเลิกแล้ว
                    </div>
                    <div className="mt-0.5 text-xs">
                      เหตุผล: {shown.cancelReason?.trim() ? shown.cancelReason : '—'} · เมื่อ{' '}
                      {fmtDateTime(shown.cancelledAt)}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <InfoRow label="เลขที่เอกสาร" value={shown.docNo} />
                  <InfoRow label="วันที่ออก" value={fmtDateTime(shown.issuedAt)} />
                  <InfoRow
                    label="อ้างอิงใบเสร็จ"
                    value={`${shown.saleReceiptNo} · ${fmtDateTime(shown.saleDate)}`}
                  />
                  {shownIsCredit && (
                    <>
                      <InfoRow
                        label="ใบกำกับภาษีเดิม"
                        value={`${shown.refInvoiceNo ?? '—'}${
                          shown.refInvoiceDate != null ? ` · ${fmtDate(shown.refInvoiceDate)}` : ''
                        }`}
                      />
                      <InfoRow label="เหตุผลที่ลดหนี้" value={shown.reason ?? '—'} />
                    </>
                  )}
                  <InfoRow label="ผู้ออก" value={shown.issuedByName?.trim() || '—'} />
                  {shown.note && <InfoRow label="หมายเหตุ" value={shown.note} />}
                </div>

                <div className="space-y-1.5 rounded-xl border border-slate-100 px-4 py-3">
                  <div className="mb-1 text-xs font-medium text-slate-400">ผู้ซื้อ</div>
                  <InfoRow label="ชื่อ" value={shown.customer.name} />
                  <InfoRow label="เลขผู้เสียภาษี" value={shown.customer.taxId} />
                  <InfoRow label="สาขา" value={shown.customer.taxBranch || HEAD_OFFICE} />
                  <InfoRow label="ที่อยู่" value={shown.customer.address} />
                  {shown.customer.phone && <InfoRow label="โทรศัพท์" value={shown.customer.phone} />}
                </div>

                <div className="space-y-1.5 rounded-2xl bg-emerald-50/60 px-4 py-3">
                  <SumRow label="มูลค่าสินค้า/บริการ" value={baht(shown.netAmount)} />
                  <SumRow
                    label={`ภาษีมูลค่าเพิ่ม ${shown.vatRate}%`}
                    value={baht(shown.vatAmount)}
                  />
                  <SumRow big label="จำนวนเงินรวมทั้งสิ้น" value={baht(shown.total)} />
                  <div className="border-t border-emerald-100 pt-1.5 text-right text-xs text-slate-500">
                    ({bahtText(shown.total)})
                  </div>
                </div>

                {activeInv != null && (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                    <span className="font-semibold">การยกเลิกใบกำกับภาษี:</span>{' '}
                    ตามระเบียบต้องเรียกต้นฉบับคืนจากลูกค้า เขียนคำว่า “ยกเลิก” แล้วเก็บไว้เป็นหลักฐาน
                    เลขที่เอกสารเดิมจะไม่ถูกนำกลับมาใช้ซ้ำ (ออกใบใหม่จะได้เลขที่ถัดไป)
                  </div>
                )}
              </>
            ) : (
              /* ===================== โหมด: ยังไม่ออกใบ ===================== */
              <>
                {notReady != null && (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-700">
                    <div className="flex items-center gap-2 font-semibold">
                      <Icon name="alert" size={16} />
                      ยังออกใบกำกับภาษีไม่ได้
                    </div>
                    <div className="mt-0.5 text-xs">{notReady}</div>
                  </div>
                )}

                {!allowed && (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                    <span className="font-semibold">ไม่มีสิทธิ์:</span>{' '}
                    บัญชีของคุณไม่มีสิทธิ์ออก/ยกเลิกใบกำกับภาษี — ติดต่อผู้จัดการร้าน
                  </div>
                )}

                {isRefundDoc && (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-700">
                    <div className="flex items-center gap-2 font-semibold">
                      <Icon name="undo" size={16} />
                      เอกสารนี้จะออกเป็น “ใบลดหนี้”
                    </div>
                    <div className="mt-0.5 text-xs">
                      ใบลดหนี้จะอ้างอิงใบกำกับภาษีของบิลต้นทาง
                      {sale.refOriginalNo ? ` (${sale.refOriginalNo})` : ''} ตามมาตรา 86/10 —
                      ถ้าบิลต้นทางยังไม่ได้ออกใบกำกับภาษี ต้องออกใบของบิลขายก่อน
                    </div>
                  </div>
                )}

                {/* ---- ผู้ซื้อที่เคยออกใบให้ / ดึงจากสมาชิก ---- */}
                <div className="flex flex-wrap items-center gap-2">
                  {sale.memberId != null && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="user"
                      onClick={() => void pullFromMember()}
                    >
                      ดึงข้อมูลจากสมาชิก{sale.memberName ? ` (${sale.memberName})` : ''}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="users"
                    onClick={() => setSugOpen((v) => !v)}
                  >
                    เลือกผู้ซื้อที่เคยออกใบให้
                  </Button>
                </div>

                {sugOpen && (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="relative">
                      <Icon
                        name="search"
                        size={15}
                        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
                      />
                      <Input
                        className="pl-9"
                        placeholder="ค้นหาชื่อ หรือเลขประจำตัวผู้เสียภาษี…"
                        value={sugQ}
                        onChange={(e) => setSugQ(e.target.value)}
                      />
                    </div>
                    {suggestions.length === 0 ? (
                      <div className="py-2 text-center text-xs text-slate-400">
                        ยังไม่มีผู้ซื้อที่เคยออกใบกำกับภาษีให้
                      </div>
                    ) : (
                      <div className="max-h-48 space-y-1 overflow-y-auto">
                        {suggestions.map((c, i) => (
                          <button
                            key={`${c.taxId}-${i}`}
                            type="button"
                            onClick={() => fillFrom(c)}
                            className="flex w-full cursor-pointer flex-col items-start rounded-lg bg-white px-3 py-2 text-left transition-colors hover:bg-emerald-50"
                          >
                            <span className="font-medium text-slate-700">{c.name}</span>
                            <span className="text-xs text-slate-400">
                              {c.taxId} · {c.taxBranch || HEAD_OFFICE}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ---- ฟอร์มผู้ซื้อ ---- */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="ชื่อผู้ซื้อ / ชื่อบริษัท *" className="sm:col-span-2">
                    <Input
                      autoFocus
                      placeholder="เช่น บริษัท ตัวอย่าง จำกัด"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>

                  <Field
                    label="เลขประจำตัวผู้เสียภาษี (13 หลัก) *"
                    hint={
                      taxIdDigits.length === 0
                        ? 'ใบกำกับภาษีเต็มรูปต้องมีเลขผู้เสียภาษีของผู้ซื้อ'
                        : !taxIdOk
                          ? `กรอกแล้ว ${taxIdDigits.length}/13 หลัก`
                          : taxIdChecksum
                            ? '✓ เลขถูกต้องตามหลักตรวจสอบ'
                            : '✗ เลขนี้ไม่ผ่านหลักตรวจสอบ — โปรดตรวจทานอีกครั้ง (ยังออกใบได้)'
                    }
                  >
                    <Input
                      inputMode="numeric"
                      maxLength={13}
                      placeholder="0105558123456"
                      className={
                        taxIdOk
                          ? taxIdChecksum
                            ? 'border-emerald-400'
                            : 'border-amber-400'
                          : undefined
                      }
                      value={taxId}
                      onChange={(e) => setTaxId(digitsOnly(e.target.value).slice(0, 13))}
                    />
                  </Field>

                  <Field label="เบอร์โทรศัพท์">
                    <Input
                      inputMode="tel"
                      placeholder="ไม่บังคับ"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </Field>

                  <div className="sm:col-span-2">
                    <span className="mb-1 block text-sm font-medium text-slate-600">
                      สำนักงาน / สาขาของผู้ซื้อ *
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setBranchMode('head')}
                        className={`cursor-pointer rounded-xl border-2 px-4 py-2 text-sm font-medium transition-colors ${
                          branchMode === 'head'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        {HEAD_OFFICE}
                      </button>
                      <button
                        type="button"
                        onClick={() => setBranchMode('branch')}
                        className={`cursor-pointer rounded-xl border-2 px-4 py-2 text-sm font-medium transition-colors ${
                          branchMode === 'branch'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        สาขาที่
                      </button>
                      {branchMode === 'branch' && (
                        <Input
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="00001"
                          className="w-28 text-center"
                          value={branchNo}
                          onChange={(e) => setBranchNo(digitsOnly(e.target.value).slice(0, 5))}
                        />
                      )}
                      <span className="text-xs text-slate-400">
                        จะพิมพ์บนใบว่า “{buildBranch(branchMode, branchNo || '0')}”
                      </span>
                    </div>
                  </div>

                  <Field
                    label="ที่อยู่ผู้ซื้อ *"
                    className="sm:col-span-2"
                    hint="ตามที่จดทะเบียนภาษีมูลค่าเพิ่ม (ขึ้นบรรทัดใหม่ได้)"
                  >
                    <Textarea
                      rows={3}
                      placeholder="เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </Field>

                  <Field label="หมายเหตุบนเอกสาร" className="sm:col-span-2">
                    <Input
                      placeholder="ไม่บังคับ เช่น เลขที่ใบสั่งซื้อ PO-1234"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                </div>

                {sale.memberId != null && (
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-emerald-600"
                      checked={saveToMember}
                      onChange={(e) => setSaveToMember(e.target.checked)}
                    />
                    <span>
                      บันทึกข้อมูลนี้ไว้กับสมาชิก {sale.memberName ?? ''}
                      <span className="block text-xs text-slate-400">
                        ครั้งหน้าจะดึงเลขผู้เสียภาษี สาขา และที่อยู่มาให้อัตโนมัติ
                      </span>
                    </span>
                  </label>
                )}

                {/* ---- สรุปยอดแยก VAT ---- */}
                {amounts && (
                  <div className="space-y-1.5 rounded-2xl bg-emerald-50/60 px-4 py-3">
                    <SumRow label="มูลค่าสินค้า/บริการ" value={baht(amounts.net)} />
                    <SumRow
                      label={`ภาษีมูลค่าเพิ่ม ${sale.vatRate}%`}
                      value={baht(amounts.vat)}
                    />
                    <SumRow big label="จำนวนเงินรวมทั้งสิ้น" value={baht(amounts.total)} />
                    <div className="border-t border-emerald-100 pt-1.5 text-right text-xs text-slate-500">
                      ({bahtText(amounts.total)})
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      {/* ---- ยืนยันยกเลิกใบกำกับภาษี (บังคับกรอกเหตุผล) ---- */}
      <ConfirmDialog
        open={cancelOpen}
        danger
        title={activeInv ? `ยกเลิกเอกสาร ${activeInv.docNo}` : 'ยกเลิกใบกำกับภาษี'}
        confirmLabel={busy ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกเอกสาร'}
        message={
          <div className="space-y-3">
            <p>
              ตามระเบียบของกรมสรรพากร ต้องเรียก<strong>ต้นฉบับ</strong>คืนจากลูกค้า
              เขียนคำว่า “ยกเลิก” บนต้นฉบับ และเก็บไว้เป็นหลักฐานพร้อมสำเนา
              เลขที่เอกสารเดิมจะไม่ถูกนำกลับมาใช้ซ้ำ — หากออกใบใหม่จะได้เลขที่ถัดไป
            </p>
            <Field label="เหตุผลการยกเลิก">
              <Input
                autoFocus
                placeholder="เช่น ข้อมูลผู้ซื้อผิด / ลูกค้าขอแก้ชื่อบริษัท"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </Field>
          </div>
        }
        onConfirm={() => {
          if (!activeInv) return
          if (!cancelReason.trim()) {
            keepConfirmOpen.current = true
            toast.error('กรุณากรอกเหตุผลการยกเลิก')
            return
          }
          void doCancel(activeInv)
        }}
        onClose={() => {
          if (keepConfirmOpen.current) {
            keepConfirmOpen.current = false
            return
          }
          setCancelOpen(false)
        }}
      />
    </>
  )
}
