// ===== ชนิดข้อมูลหลักของระบบ POS =====

export interface Category {
  id?: number
  name: string
  sortOrder: number
}

export interface OptionChoice {
  label: string
  priceDelta: number // บวกเพิ่มจากราคาสินค้า (บาท)
}

/** กลุ่มตัวเลือกสินค้า เช่น ความหวาน / เพิ่มช็อต (เลือกได้ 1 ต่อกลุ่ม) */
export interface ProductOption {
  name: string
  choices: OptionChoice[]
}

/** หน่วยขายเพิ่มเติม เช่น แพ็ค 6 / ลัง 24 (นอกเหนือจากหน่วยฐาน) */
export interface ProductUnit {
  name: string
  barcode?: string
  factor: number // 1 หน่วยนี้ = factor หน่วยฐาน (ใช้ตัดสต็อก)
  price: number // ราคาขายต่อ 1 หน่วยนี้
}

export interface Product {
  id?: number
  name: string
  barcode?: string
  categoryId?: number
  price: number
  cost: number
  unit: string
  trackStock: boolean
  stock: number
  lowStockAt?: number
  options?: ProductOption[]
  image?: string // dataURL ย่อขนาดแล้ว
  active: boolean
  createdAt: number
  /** ขายเป็นทศนิยมได้ (สินค้าชั่งน้ำหนัก เช่น 0.5 กก.) */
  allowDecimalQty?: boolean
  /** หน่วยขายเพิ่มเติม (แพ็ค/ลัง) — ตัดสต็อกตาม factor */
  units?: ProductUnit[]
  /** ราคาขายส่ง — ใช้อัตโนมัติเมื่อซื้อครบ wholesaleMinQty (หน่วยฐานเท่านั้น) */
  wholesalePrice?: number
  wholesaleMinQty?: number
}

export interface Member {
  id?: number
  code: string
  name: string
  phone: string
  points: number
  totalSpent: number
  visits: number
  note?: string
  createdAt: number
  /** ข้อมูลออกใบกำกับภาษีเต็มรูป (ลูกค้านิติบุคคล/ขอใบกำกับประจำ) */
  taxId?: string
  taxBranch?: string // 'สำนักงานใหญ่' หรือ 'สาขาที่ 00001'
  address?: string
}

export type PromoType = 'percent' | 'amount' | 'buyxgety'
export type PromoScope = 'bill' | 'products' | 'category'

export interface Promotion {
  id?: number
  name: string
  type: PromoType
  scope: PromoScope
  /** % หรือ บาท (ไม่ใช้กับ buyxgety) */
  value: number
  buyQty?: number
  freeQty?: number
  productIds?: number[]
  categoryId?: number
  minSubtotal?: number
  startsAt?: number
  endsAt?: number
  active: boolean
}

/** คูปองส่วนลด (e-Coupon) — ลูกค้ากรอก/สแกนโค้ดที่หน้าขาย */
export interface Coupon {
  id?: number
  code: string // เก็บเป็นตัวพิมพ์ใหญ่เสมอ
  name: string
  type: 'percent' | 'amount'
  value: number
  minSubtotal?: number
  maxDiscount?: number // เพดานส่วนลด (ใช้กับแบบ %)
  usageLimit?: number // ใช้ได้ทั้งหมดกี่ครั้ง (ไม่กำหนด = ไม่จำกัด)
  usedCount: number
  startsAt?: number
  endsAt?: number
  active: boolean
  createdAt: number
}

export type PaymentMethod = 'cash' | 'transfer' | 'card'

/** การชำระเงิน 1 ก้อน — บิลเดียวจ่ายผสมหลายช่องทางได้ */
export interface Payment {
  method: PaymentMethod
  amount: number
}

export interface SaleItem {
  productId: number // 0 = รายการกำหนดเอง
  name: string
  price: number // ราคาต่อหน่วยที่ขาย (รวมส่วนเพิ่มจากตัวเลือกแล้ว)
  /** จำนวน — ติดลบในเอกสารคืนสินค้า, ทศนิยมได้ถ้าสินค้าตั้งค่าไว้ */
  qty: number
  /** ชื่อหน่วยที่ขาย (ไม่ระบุ = หน่วยฐาน) */
  unitName?: string
  /** ตัวคูณตัดสต็อกของหน่วยที่ขาย (ไม่ระบุ = 1) */
  unitFactor?: number
  options?: string[]
  note?: string
  manualDiscount: number // ส่วนลดต่อบรรทัด (บาท)
  promoDiscount: number // ส่วนลดโปรโมชันต่อบรรทัด (บาท)
  cost: number // ต้นทุนต่อหน่วย (บวกเสมอ)
  total: number // ยอดสุทธิของบรรทัด (ติดลบในเอกสารคืนสินค้า)
  /** จำนวนที่ถูกคืนไปแล้ว (ใช้ในบิลขายเท่านั้น) */
  refundedQty?: number
}

export type SaleStatus = 'completed' | 'voided'

/** ประเภทเอกสาร: บิลขาย หรือ เอกสารคืนสินค้า (ยอดติดลบทั้งใบ) */
export type SaleKind = 'sale' | 'refund'

export interface Sale {
  id?: number
  receiptNo: string
  /** ไม่ระบุ = 'sale' (บิลเก่าก่อนมีระบบคืนสินค้า) */
  kind?: SaleKind
  /** เอกสารคืนสินค้า: อ้างอิงบิลขายต้นทาง */
  refOriginalId?: number
  refOriginalNo?: string
  refundReason?: string
  /** บิลขาย: ยอดที่ถูกคืนไปแล้วทั้งหมด (บวก) */
  refundedTotal?: number
  items: SaleItem[]
  subtotal: number
  itemDiscount: number // ส่วนลดรายการ (กรอกเอง)
  promoDiscount: number // ส่วนลดโปรโมชันรวม (รายการ + ท้ายบิล)
  billDiscount: number // ส่วนลดท้ายบิล (กรอกเอง)
  couponDiscount: number // ส่วนลดจากคูปอง
  couponCode?: string
  pointDiscount: number // ส่วนลดจากการแลกแต้ม
  redeemedPoints: number
  vatRate: number
  vatIncluded: boolean
  vatAmount: number
  total: number // ยอดชำระสุทธิ (ติดลบในเอกสารคืนสินค้า)
  /** ช่องทางหลัก (ก้อนที่มากที่สุด) — คงไว้เพื่อความเข้ากันได้กับบิลเก่า */
  paymentMethod: PaymentMethod
  /** รายการชำระเงินทุกก้อน (ไม่ระบุ = บิลเก่า ใช้ paymentMethod ก้อนเดียว) */
  payments?: Payment[]
  received: number
  change: number
  memberId?: number
  memberName?: string
  earnedPoints: number
  appliedPromos: string[]
  /** เลขคิวประจำวัน (โหมดคาเฟ่/ร้านอาหาร) */
  queueNo?: number
  /** พนักงานผู้ขาย (ระบบพนักงาน) */
  staffId?: number
  staffName?: string
  /** ผู้อนุมัติส่วนลด (เมื่อพนักงานไม่มีสิทธิ์ 'discount' แล้วผู้จัดการใส่ PIN อนุมัติ) */
  discountApprovedById?: number
  discountApprovedByName?: string
  /** กะที่บิลนี้อยู่ (ระบบเปิด/ปิดกะ) */
  shiftId?: number
  status: SaleStatus
  voidReason?: string
  /** ผู้อนุมัติ/ผู้ยกเลิกบิล */
  voidedById?: number
  voidedByName?: string
  /** ใบกำกับภาษีเต็มรูปที่ออกให้บิลนี้ (ใบที่ยังไม่ถูกยกเลิก) */
  taxInvoiceId?: number
  taxInvoiceNo?: string
  createdAt: number
  voidedAt?: number
}

export type StockMoveType = 'sale' | 'void' | 'adjust' | 'receive' | 'refund' | 'count'

export interface StockMove {
  id?: number
  productId: number
  type: StockMoveType
  qty: number // + เพิ่มสต็อก / - ตัดสต็อก (หน่วยฐาน)
  note?: string
  refSaleId?: number
  refDocNo?: string
  createdAt: number
}

export interface HeldBill {
  id?: number
  label: string
  items: unknown[] // CartItem[] — เก็บ snapshot ของตะกร้า
  memberId?: number
  billDiscountType?: 'percent' | 'amount' // ส่วนลดท้ายบิลที่กรอกไว้ตอนพักบิล
  billDiscountValue?: number
  redeemPoints?: number // แต้มที่กดแลกไว้ตอนพักบิล
  couponCode?: string
  /** ผู้อนุมัติส่วนลดของบิลที่พักไว้ — เรียกบิลกลับมาแล้วส่วนลดยังมีผู้รับผิดชอบเดิม */
  discountApprovedById?: number
  discountApprovedByName?: string
  createdAt: number
}

/** รายจ่ายของร้าน (โมดูลบัญชี) */
export interface Expense {
  id?: number
  date: number // วันที่ของรายการ (ms)
  category: string // เช่น ค่าสินค้า/วัตถุดิบ, ค่าเช่า, เงินเดือน
  description: string
  amount: number // ยอดรวมที่จ่ายจริง (รวม VAT ถ้ามี)
  hasVatInvoice: boolean // มีใบกำกับภาษีเต็มรูป (ขอคืนภาษีซื้อได้)
  vatAmount: number // ภาษีซื้อในยอดนี้ (0 ถ้าไม่มีใบกำกับ)
  paymentMethod: PaymentMethod
  note?: string
  /** สร้างอัตโนมัติจากใบรับของเข้า */
  refReceiptDocNo?: string
  /** ผู้บันทึก + กะที่บันทึก (ใช้คิดเงินสดในลิ้นชักของกะนั้น) */
  staffId?: number
  staffName?: string
  shiftId?: number
  createdAt: number
}

/** หมวดรายจ่ายมาตรฐาน (เลือกหรือพิมพ์เองได้) */
export const EXPENSE_CATEGORIES = [
  'ค่าสินค้า / วัตถุดิบ',
  'ค่าเช่า',
  'เงินเดือน / ค่าแรง',
  'ค่าน้ำ / ค่าไฟ / เน็ต',
  'ค่าการตลาด',
  'ค่าอุปกรณ์ / ซ่อมบำรุง',
  'อื่นๆ',
] as const

/** 1 บรรทัดในใบรับของเข้า */
export interface GoodsReceiptItem {
  productId: number
  name: string
  qty: number // จำนวนหน่วยที่รับ (ตามหน่วยที่เลือก)
  unitName?: string
  unitFactor?: number // ตัวคูณเป็นหน่วยฐาน (ไม่ระบุ = 1)
  baseQty: number // จำนวนหน่วยฐานที่เข้าสต็อก = qty × factor
  cost: number // ต้นทุนต่อหน่วยที่รับ
  total: number // qty × cost
}

/** ใบรับของเข้า — รับหลายรายการพร้อมกัน อัปเดตต้นทุนและลงรายจ่ายได้ */
export interface GoodsReceipt {
  id?: number
  docNo: string // GR20260730-0001
  date: number
  supplier?: string
  invoiceNo?: string
  items: GoodsReceiptItem[]
  total: number
  updateCost: boolean // อัปเดตต้นทุนสินค้าตามที่รับเข้า
  expenseId?: number // ลงบัญชีรายจ่ายให้ด้วย
  note?: string
  staffId?: number
  staffName?: string
  createdAt: number
}

/** 1 บรรทัดในใบนับสต็อก */
export interface StockCountItem {
  productId: number
  name: string
  systemQty: number // จำนวนในระบบตอนนับ
  countedQty: number // จำนวนที่นับได้จริง
  diff: number // countedQty - systemQty
  cost: number // ต้นทุนต่อหน่วย
  diffValue: number // มูลค่าผลต่าง = diff × cost
}

/** ใบนับสต็อก (stocktake) — นับจริงเทียบระบบแล้วปรับยอดทีเดียว */
export interface StockCount {
  id?: number
  docNo: string // SC20260730-0001
  date: number
  status: 'draft' | 'committed'
  items: StockCountItem[]
  totalDiffValue: number
  note?: string
  staffId?: number
  staffName?: string
  createdAt: number
  committedAt?: number
}

/* =========================================================
   พนักงาน + สิทธิ์การใช้งาน
   ========================================================= */

export type StaffRole = 'owner' | 'manager' | 'cashier'

/** สิทธิ์ทั้งหมดในระบบ (ป้ายไทย + สิทธิ์ตามบทบาท อยู่ใน src/lib/permissions.ts) */
export type PermissionKey =
  | 'sell' // ขายหน้าร้าน
  | 'discount' // ให้ส่วนลดท้ายบิล / ใช้คูปอง / แลกแต้ม
  | 'void' // ยกเลิกบิล
  | 'refund' // คืนสินค้า / คืนเงิน
  | 'products' // จัดการสินค้า + หมวดหมู่
  | 'stock' // รับของเข้า / ปรับสต็อก / นับสต็อก
  | 'promotions' // โปรโมชัน + คูปอง
  | 'members' // สมาชิก
  | 'reports' // รายงาน + หน้าหลัก
  | 'accounting' // บัญชี / รายจ่าย / ภาษี
  | 'shift' // เปิด-ปิดกะ + นับเงินลิ้นชัก
  | 'taxInvoice' // ออก/ยกเลิกใบกำกับภาษีเต็มรูป
  | 'settings' // ตั้งค่าระบบ + สำรองข้อมูล
  | 'staff' // จัดการพนักงาน

export interface Staff {
  id?: number
  code: string // รหัสพนักงาน เช่น E01 (ไม่ซ้ำ)
  name: string
  role: StaffRole
  /** PIN ที่แฮชแล้ว รูปแบบ '<algo>$<salt>$<hex>' (ดู src/lib/auth.ts — ไม่เก็บ PIN ตรงๆ) */
  pinHash: string
  /** สิทธิ์รายคน — ทับค่าเริ่มต้นของบทบาท (true = ให้, false = ห้าม) */
  perms?: Partial<Record<PermissionKey, boolean>>
  active: boolean
  note?: string
  createdAt: number
  lastLoginAt?: number
}

/* =========================================================
   กะการขาย + นับเงินลิ้นชัก
   ========================================================= */

/** 1 แถวในใบนับเงิน (ธนบัตร/เหรียญ) */
export interface CashCountLine {
  denom: number // ราคาต่อใบ/เหรียญ เช่น 1000, 20, 0.5
  count: number // จำนวนที่นับได้
}

export type CashMoveType = 'in' | 'out'

/** นำเงินเข้า/ออกลิ้นชักระหว่างกะ (เติมเงินทอน / ถอนไปฝากธนาคาร) */
export interface CashMove {
  type: CashMoveType
  amount: number // ค่าบวกเสมอ (ทิศทางอยู่ที่ type)
  reason: string
  at: number
  byId?: number
  byName?: string
}

/** สรุปของกะ — บันทึกเป็น snapshot ตอนปิดกะ (คำนวณใหม่จาก DB ไม่เชื่อค่าจากหน้าจอ) */
export interface ShiftSummary {
  billCount: number // จำนวนบิลขาย (ไม่นับเอกสารคืนสินค้า)
  salesTotal: number // ยอดขายสุทธิ (หักคืนสินค้าแล้ว)
  byMethod: Record<PaymentMethod, number> // ยอดตามช่องทาง (เงินสดหักเงินทอนแล้ว)
  refundCount: number
  refundTotal: number // ค่าบวก
  voidedCount: number
  expenseCash: number // รายจ่ายที่จ่ายด้วยเงินสดในกะนี้
  cashIn: number
  cashOut: number
  /** เงินสดที่ควรมีในลิ้นชัก = ตั้งต้น + ขายเงินสด − รายจ่ายเงินสด + นำเข้า − นำออก */
  expectedCash: number
  countedCash: number
  /** นับได้ − ควรมี (บวก = เกิน, ลบ = ขาด) */
  diff: number
}

export interface Shift {
  id?: number
  docNo: string // SH20260730-0001
  status: 'open' | 'closed'
  openedAt: number
  openedById?: number
  openedByName?: string
  openingCash: number // เงินทอนตั้งต้น
  openNote?: string
  cashMoves: CashMove[]
  closedAt?: number
  closedById?: number
  closedByName?: string
  countedCash?: number
  countLines?: CashCountLine[]
  closeNote?: string
  summary?: ShiftSummary
}

/* =========================================================
   ใบกำกับภาษีเต็มรูป / ใบลดหนี้ (ม.86/4)
   ========================================================= */

/** ข้อมูลผู้ซื้อบนใบกำกับภาษี (snapshot ตอนออกใบ) */
export interface TaxInvoiceCustomer {
  name: string
  taxId: string // 13 หลัก
  taxBranch: string // 'สำนักงานใหญ่' หรือ 'สาขาที่ 00001'
  address: string
  phone?: string
}

export type TaxInvoiceKind = 'invoice' | 'creditNote'

/**
 * ใบกำกับภาษีเต็มรูป (kind='invoice') หรือใบลดหนี้ (kind='creditNote' — ออกจากเอกสารคืนสินค้า)
 * ยอดทุกช่องเก็บเป็น "ค่าบวก" เสมอ ทิศทางอยู่ที่ kind (ใบลดหนี้ = หักออกจากภาษีขาย)
 */
export interface TaxInvoice {
  id?: number
  docNo: string // TX20260730-0001 / CN20260730-0001
  kind: TaxInvoiceKind
  saleId: number
  saleReceiptNo: string
  saleDate: number
  customer: TaxInvoiceCustomer
  netAmount: number // มูลค่าสินค้า/บริการ (ก่อน VAT)
  vatRate: number
  vatAmount: number
  total: number // netAmount + vatAmount
  /** ใบลดหนี้: อ้างอิงใบกำกับภาษีเดิม + เหตุผล */
  refInvoiceNo?: string
  refInvoiceDate?: number
  /** ยอดตามใบกำกับภาษีเดิม (ม.86/10(5) บังคับให้แสดง "มูลค่าตามใบเดิม" และ "มูลค่าที่ถูกต้อง") */
  refNetAmount?: number
  refVatAmount?: number
  refTotal?: number
  reason?: string
  note?: string
  issuedAt: number
  issuedById?: number
  issuedByName?: string
  cancelledAt?: number
  cancelReason?: string
}

export type BusinessMode = 'retail' | 'cafe'

export interface Settings {
  id: number // มีแถวเดียว id = 1
  shopName: string
  branch: string
  address: string
  phone: string
  taxId: string
  logo?: string
  mode: BusinessMode
  vatRate: number
  vatIncluded: boolean // true = ราคาสินค้ารวม VAT แล้ว
  bahtPerPoint: number // ซื้อครบ X บาท ได้ 1 แต้ม (0 = ปิดระบบแต้ม)
  redeemValue: number // 1 แต้ม แลกได้ X บาท
  receiptFooter: string
  receiptWidth: '58' | '80'
  /** พร้อมเพย์: เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก (สร้าง QR ฝังยอด) */
  promptpayId?: string
  /** แสดง/พิมพ์เลขคิวบนใบเสร็จ */
  queueEnabled?: boolean
  /** เปิดปุ่มพิมพ์สลิปครัว/บาร์หลังชำระเงิน */
  kitchenPrintEnabled?: boolean

  /* ----- ระบบพนักงาน ----- */
  /** เปิดใช้ระบบพนักงาน — ต้องเข้าสู่ระบบด้วย PIN ก่อนใช้งาน */
  staffEnabled?: boolean
  /** ล็อกหน้าจออัตโนมัติเมื่อไม่มีการใช้งาน (นาที, 0 = ไม่ล็อก) */
  autoLockMinutes?: number

  /* ----- ระบบกะ ----- */
  shiftEnabled?: boolean
  /** ต้องเปิดกะก่อนจึงจะปิดการขายได้ */
  requireShiftToSell?: boolean
  /** เงินทอนตั้งต้นที่เสนอให้ตอนเปิดกะ */
  defaultOpeningCash?: number

  /* ----- ใบกำกับภาษีเต็มรูป ----- */
  /** ร้านจดทะเบียน VAT — เปิดให้ออกใบกำกับภาษีเต็มรูปได้ */
  vatRegistered?: boolean
  /** สำนักงานใหญ่ / สาขาที่ ... (ตามที่จดทะเบียน VAT) */
  branchTaxCode?: string
  /** ชื่อผู้มีอำนาจลงนามบนใบกำกับภาษี */
  taxInvoiceSigner?: string
  /** ข้อความเพิ่มเติมท้ายใบกำกับภาษี */
  taxInvoiceNote?: string

  /* ----- สำรองข้อมูล ----- */
  /** สำรองอัตโนมัติลงโฟลเดอร์ที่เลือกไว้ (วันละครั้งตอนเปิดแอป) */
  autoBackupEnabled?: boolean
  /** เตือนเมื่อไม่ได้สำรองมากี่วัน (0 = ไม่เตือน, ค่าเริ่มต้น 3) */
  backupReminderDays?: number
  /** เวลาที่สำรองสำเร็จล่าสุด */
  lastBackupAt?: number
}

/**
 * ค่าภายในของแอปที่ไม่ใช่ข้อมูลร้าน และ "ห้าม" ใส่ลงไฟล์สำรอง
 * (ตอนนี้ใช้เก็บ handle ของโฟลเดอร์สำรอง ซึ่งแปลงเป็น JSON ไม่ได้และผูกกับเครื่องนั้นๆ)
 */
export interface AppState {
  key: string
  value: unknown
}
