import Dexie, { type Table } from 'dexie'
import type {
  Category,
  Coupon,
  Expense,
  GoodsReceipt,
  HeldBill,
  Member,
  Product,
  Promotion,
  Sale,
  Settings,
  Shift,
  Staff,
  StockCount,
  StockMove,
  TaxInvoice,
} from './types'

export const DEFAULT_SETTINGS: Settings = {
  id: 1,
  shopName: 'ร้านของฉัน',
  branch: 'สาขาหลัก',
  address: '',
  phone: '',
  taxId: '',
  mode: 'retail',
  vatRate: 7,
  vatIncluded: true,
  bahtPerPoint: 25,
  redeemValue: 1,
  receiptFooter: 'ขอบคุณที่อุดหนุนครับ/ค่ะ',
  receiptWidth: '80',
  promptpayId: '',
  queueEnabled: false,
  kitchenPrintEnabled: false,
  staffEnabled: false,
  autoLockMinutes: 0,
  shiftEnabled: false,
  requireShiftToSell: false,
  defaultOpeningCash: 1000,
  vatRegistered: false,
  branchTaxCode: 'สำนักงานใหญ่',
  taxInvoiceSigner: '',
  taxInvoiceNote: '',
}

class PosDB extends Dexie {
  products!: Table<Product, number>
  categories!: Table<Category, number>
  members!: Table<Member, number>
  promotions!: Table<Promotion, number>
  sales!: Table<Sale, number>
  stockMoves!: Table<StockMove, number>
  heldBills!: Table<HeldBill, number>
  settings!: Table<Settings, number>
  expenses!: Table<Expense, number>
  coupons!: Table<Coupon, number>
  goodsReceipts!: Table<GoodsReceipt, number>
  stockCounts!: Table<StockCount, number>
  staff!: Table<Staff, number>
  shifts!: Table<Shift, number>
  taxInvoices!: Table<TaxInvoice, number>

  constructor() {
    super('pos-db')
    this.version(1).stores({
      products: '++id, name, barcode, categoryId, active',
      categories: '++id, sortOrder',
      members: '++id, code, phone, name',
      promotions: '++id, active',
      sales: '++id, receiptNo, createdAt, memberId, status',
      stockMoves: '++id, productId, createdAt',
      heldBills: '++id, createdAt',
      settings: 'id',
    })
    // v2: โมดูลบัญชี — เพิ่มตารางรายจ่าย (ตารางเดิมคงเดิม อัปเกรดอัตโนมัติ)
    this.version(2).stores({
      expenses: '++id, date, category, createdAt',
    })
    // v3: คูปอง, รับของเข้า, นับสต็อก + เพิ่ม index ให้ sales (kind/refOriginalId) สำหรับเอกสารคืนสินค้า
    this.version(3).stores({
      coupons: '++id, &code, active, createdAt',
      goodsReceipts: '++id, date, createdAt',
      stockCounts: '++id, date, status, createdAt',
      sales: '++id, receiptNo, createdAt, memberId, status, kind, refOriginalId',
    })
    // v4: พนักงาน+PIN, กะ/นับเงินลิ้นชัก, ใบกำกับภาษีเต็มรูป
    //     + เพิ่ม index ให้ sales (shiftId/staffId) สำหรับสรุปยอดต่อกะ/ต่อคน
    // หมายเหตุ: IndexedDB ใช้ boolean เป็นคีย์ไม่ได้ → ห้ามใช้ where('active') กับ staff
    //           (แถวจะไม่เข้า index เลย) ให้อ่านทั้งตารางแล้วกรอง active ใน JS
    this.version(4).stores({
      staff: '++id, &code, active, role, createdAt',
      shifts: '++id, status, openedAt, closedAt',
      taxInvoices: '++id, &docNo, kind, saleId, issuedAt',
      sales: '++id, receiptNo, createdAt, memberId, status, kind, refOriginalId, shiftId, staffId',
      expenses: '++id, date, category, createdAt, shiftId',
    })
  }
}

export const db = new PosDB()
