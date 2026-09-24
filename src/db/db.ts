import Dexie, { type Table } from 'dexie'
import type {
  AppState,
  Category,
  Coupon,
  Expense,
  GoodsReceipt,
  HeldBill,
  Member,
  OrderTicket,
  Product,
  Promotion,
  Sale,
  Settings,
  Shift,
  SlipQueueItem,
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
  autoBackupEnabled: false,
  backupReminderDays: 3,
  quickServiceEnabled: false,
  requirePaymentVerify: true,
  kitchenAutoPrint: true,
  kitchenAlertMinutes: 10,
  tableOrderEnabled: false,
  tableCount: 20,
  // ปิดไว้ตามที่เจ้าของร้านสั่ง — เปิดได้เมื่อมีขั้นตอน 'นำเงินส่งลิ้นชัก' แล้ว
  tableCashEnabled: false,
  slipKeepDays: 90,
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
  appState!: Table<AppState, string>
  /** กล่องขาเข้าใบสั่งจากมือถือ (เครื่องกลาง) — key เป็น ticketUid กันบิลซ้ำ */
  orderTickets!: Table<OrderTicket, string>
  /** คิวรูปสลิปรอส่งขึ้นคลาวด์ (เครื่องพนักงาน) — ห้ามเข้าไฟล์สำรอง */
  slipQueue!: Table<SlipQueueItem, string>

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
    // v5: ค่าภายในของแอป (ตอนนี้เก็บ handle โฟลเดอร์สำรองอัตโนมัติ)
    //     ตารางนี้ไม่อยู่ในไฟล์สำรองและไม่ถูกล้างตอนล้างข้อมูล — ดู src/lib/backup.ts
    this.version(5).stores({
      appState: 'key',
    })
    // v6: โหมดบริการด่วน — index orderStatus เพื่อให้จอครัวดึงเฉพาะออเดอร์ที่ยังไม่เสิร์ฟได้เร็ว
    this.version(6).stores({
      sales:
        '++id, receiptNo, createdAt, memberId, status, kind, refOriginalId, shiftId, staffId, orderStatus',
    })
    // v7: รับออเดอร์ที่โต๊ะ
    //  - orderTickets = กล่องขาเข้าของเครื่องกลาง, primary key เป็น ticketUid ที่มือถือสร้าง
    //    **primary key อย่างเดียวยังไม่กันบิลซ้ำ** — ตัวที่กันคือตอนรับใบสั่งต้องเช็ค state
    //    ในทรานแซกชันเดียวกับ finalizeSale: ถ้า state เป็น 'billed' แล้วให้คืนบิลใบเดิม
    //    ห้ามออกใบใหม่ (ยังไม่ได้เขียนโค้ดส่วนนี้ — ดู TABLE-ORDER-PLAN.md ขั้นที่ 5-6)
    //  - slipQueue = คิวรูปสลิปบนมือถือ รอส่งขึ้นคลาวด์
    //  **ห้ามใส่ 2 ตารางนี้ใน TABLES ของ src/lib/backup.ts** — เก็บไฟล์รูป ไฟล์สำรองจะบวมจนพัง
    //  index orderChannel เพิ่มที่ sales เพื่อแยกรายงานยอดขายโต๊ะ/เคาน์เตอร์ได้ภายหลัง
    this.version(7).stores({
      orderTickets: 'ticketUid, state, createdAt, saleId',
      slipQueue: 'slipId, state, createdAt',
      sales:
        '++id, receiptNo, createdAt, memberId, status, kind, refOriginalId, shiftId, staffId, orderStatus, orderChannel',
    })
  }
}

export const db = new PosDB()
