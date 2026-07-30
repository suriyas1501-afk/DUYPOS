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

export type PaymentMethod = 'cash' | 'transfer' | 'card'

export interface SaleItem {
  productId: number // 0 = รายการกำหนดเอง
  name: string
  price: number // ราคาต่อหน่วย (รวมส่วนเพิ่มจากตัวเลือกแล้ว)
  qty: number
  options?: string[]
  note?: string
  manualDiscount: number // ส่วนลดต่อบรรทัด (บาท)
  promoDiscount: number // ส่วนลดโปรโมชันต่อบรรทัด (บาท)
  cost: number // ต้นทุนต่อหน่วย
  total: number // ยอดสุทธิของบรรทัด
}

export type SaleStatus = 'completed' | 'voided'

export interface Sale {
  id?: number
  receiptNo: string
  items: SaleItem[]
  subtotal: number
  itemDiscount: number // ส่วนลดรายการ (กรอกเอง)
  promoDiscount: number // ส่วนลดโปรโมชันรวม (รายการ + ท้ายบิล)
  billDiscount: number // ส่วนลดท้ายบิล (กรอกเอง)
  pointDiscount: number // ส่วนลดจากการแลกแต้ม
  redeemedPoints: number
  vatRate: number
  vatIncluded: boolean
  vatAmount: number
  total: number // ยอดชำระสุทธิ
  paymentMethod: PaymentMethod
  received: number
  change: number
  memberId?: number
  memberName?: string
  earnedPoints: number
  appliedPromos: string[]
  status: SaleStatus
  voidReason?: string
  createdAt: number
  voidedAt?: number
}

export type StockMoveType = 'sale' | 'void' | 'adjust' | 'receive'

export interface StockMove {
  id?: number
  productId: number
  type: StockMoveType
  qty: number // + เพิ่มสต็อก / - ตัดสต็อก
  note?: string
  refSaleId?: number
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
}
