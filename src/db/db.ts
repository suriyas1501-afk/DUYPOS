import Dexie, { type Table } from 'dexie'
import type {
  Category,
  Expense,
  HeldBill,
  Member,
  Product,
  Promotion,
  Sale,
  Settings,
  StockMove,
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
  }
}

export const db = new PosDB()
