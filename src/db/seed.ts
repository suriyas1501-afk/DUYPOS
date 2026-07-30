import { db, DEFAULT_SETTINGS } from './db'
import type { Category, Expense, Member, Product, ProductOption, Promotion } from './types'

const now = () => Date.now()
const daysAgo = (n: number) => Date.now() - n * 86400000

const CATEGORIES: Category[] = [
  { id: 1, name: 'เครื่องดื่ม', sortOrder: 1 },
  { id: 2, name: 'กาแฟ / ชา', sortOrder: 2 },
  { id: 3, name: 'เบเกอรี่', sortOrder: 3 },
  { id: 4, name: 'ขนม / อาหาร', sortOrder: 4 },
  { id: 5, name: 'ของใช้', sortOrder: 5 },
]

const DRINK_OPTIONS: ProductOption[] = [
  {
    name: 'อุณหภูมิ',
    choices: [
      { label: 'ร้อน', priceDelta: 0 },
      { label: 'เย็น', priceDelta: 10 },
      { label: 'ปั่น', priceDelta: 15 },
    ],
  },
  {
    name: 'ความหวาน',
    choices: [
      { label: 'ไม่หวาน', priceDelta: 0 },
      { label: 'หวานน้อย', priceDelta: 0 },
      { label: 'หวานปกติ', priceDelta: 0 },
      { label: 'หวานมาก', priceDelta: 0 },
    ],
  },
]

const SHOT_OPTION: ProductOption = {
  name: 'เพิ่มช็อต',
  choices: [
    { label: 'ไม่เพิ่ม', priceDelta: 0 },
    { label: 'เพิ่ม 1 ช็อต', priceDelta: 10 },
  ],
}

const PRODUCTS: Product[] = [
  // ----- ค้าปลีก (มีบาร์โค้ด/สต็อก) -----
  { id: 1, name: 'น้ำดื่ม 600 มล.', barcode: '8850100100017', categoryId: 1, price: 7, cost: 4.5, unit: 'ขวด', trackStock: true, stock: 120, lowStockAt: 24, active: true, createdAt: now() },
  { id: 2, name: 'โคล่า กระป๋อง', barcode: '8850100100024', categoryId: 1, price: 18, cost: 12, unit: 'กระป๋อง', trackStock: true, stock: 48, lowStockAt: 12, active: true, createdAt: now() },
  { id: 3, name: 'นมจืด UHT กล่อง', barcode: '8850100100031', categoryId: 1, price: 15, cost: 11, unit: 'กล่อง', trackStock: true, stock: 36, lowStockAt: 12, active: true, createdAt: now() },
  { id: 4, name: 'บะหมี่กึ่งสำเร็จรูป ต้มยำ', barcode: '8850100100048', categoryId: 4, price: 8, cost: 5.8, unit: 'ซอง', trackStock: true, stock: 90, lowStockAt: 24, active: true, createdAt: now() },
  { id: 5, name: 'มันฝรั่งทอด รสดั้งเดิม', barcode: '8850100100055', categoryId: 4, price: 30, cost: 24, unit: 'ถุง', trackStock: true, stock: 40, lowStockAt: 10, active: true, createdAt: now() },
  { id: 6, name: 'ทิชชู่เปียก 20 แผ่น', barcode: '8850100100062', categoryId: 5, price: 25, cost: 17, unit: 'ห่อ', trackStock: true, stock: 25, lowStockAt: 8, active: true, createdAt: now() },
  { id: 7, name: 'ถ่าน AA (แพ็ค 2)', barcode: '8850100100079', categoryId: 5, price: 45, cost: 32, unit: 'แพ็ค', trackStock: true, stock: 6, lowStockAt: 10, active: true, createdAt: now() },
  // ----- คาเฟ่ (มีตัวเลือก) -----
  { id: 8, name: 'อเมริกาโน่', categoryId: 2, price: 55, cost: 18, unit: 'แก้ว', trackStock: false, stock: 0, options: [...DRINK_OPTIONS, SHOT_OPTION], active: true, createdAt: now() },
  { id: 9, name: 'ลาเต้', categoryId: 2, price: 65, cost: 22, unit: 'แก้ว', trackStock: false, stock: 0, options: [...DRINK_OPTIONS, SHOT_OPTION], active: true, createdAt: now() },
  { id: 10, name: 'ชาไทย', categoryId: 2, price: 50, cost: 15, unit: 'แก้ว', trackStock: false, stock: 0, options: DRINK_OPTIONS, active: true, createdAt: now() },
  { id: 11, name: 'ชาเขียวมัทฉะ', categoryId: 2, price: 70, cost: 28, unit: 'แก้ว', trackStock: false, stock: 0, options: DRINK_OPTIONS, active: true, createdAt: now() },
  { id: 12, name: 'โกโก้', categoryId: 2, price: 55, cost: 20, unit: 'แก้ว', trackStock: false, stock: 0, options: DRINK_OPTIONS, active: true, createdAt: now() },
  { id: 13, name: 'ครัวซองต์เนยสด', categoryId: 3, price: 45, cost: 20, unit: 'ชิ้น', trackStock: true, stock: 12, lowStockAt: 5, active: true, createdAt: now() },
  { id: 14, name: 'บราวนี่', categoryId: 3, price: 40, cost: 16, unit: 'ชิ้น', trackStock: true, stock: 9, lowStockAt: 4, active: true, createdAt: now() },
  { id: 15, name: 'คุกกี้ช็อกโกแลตชิพ', categoryId: 3, price: 25, cost: 10, unit: 'ชิ้น', trackStock: true, stock: 30, lowStockAt: 10, active: true, createdAt: now() },
]

const PROMOTIONS: Promotion[] = [
  { id: 1, name: 'ลด 10% เมื่อซื้อครบ 500.-', type: 'percent', scope: 'bill', value: 10, minSubtotal: 500, active: true },
  { id: 2, name: 'น้ำดื่ม ซื้อ 2 แถม 1', type: 'buyxgety', scope: 'products', value: 0, buyQty: 2, freeQty: 1, productIds: [1], active: true },
  { id: 3, name: 'เบเกอรี่ลด 5.- ต่อชิ้น', type: 'amount', scope: 'category', value: 5, categoryId: 3, active: false },
]

const MEMBERS: Member[] = [
  { id: 1, code: 'M0001', name: 'สมชาย ใจดี', phone: '0812345678', points: 120, totalSpent: 3480, visits: 12, createdAt: now() },
  { id: 2, code: 'M0002', name: 'สมหญิง รักดี', phone: '0898765432', points: 45, totalSpent: 1150, visits: 6, createdAt: now() },
]

// ไม่กำหนด id ตายตัว — ผู้ใช้เดิม (อัปเกรดจาก DB v1) อาจมีรายจ่ายจริง id 1-3 อยู่แล้ว
// การ bulkPut ด้วย id ตายตัวจะเขียนทับข้อมูลจริงของผู้ใช้เงียบๆ
const EXPENSES: Expense[] = [
  { date: daysAgo(2), category: 'ค่าสินค้า / วัตถุดิบ', description: 'สั่งเมล็ดกาแฟ + นม', amount: 1712, hasVatInvoice: true, vatAmount: 112, paymentMethod: 'transfer', createdAt: daysAgo(2) },
  { date: daysAgo(1), category: 'ค่าน้ำ / ค่าไฟ / เน็ต', description: 'ค่าไฟฟ้าประจำเดือน', amount: 980, hasVatInvoice: false, vatAmount: 0, paymentMethod: 'transfer', createdAt: daysAgo(1) },
  { date: daysAgo(0), category: 'ค่าอุปกรณ์ / ซ่อมบำรุง', description: 'แก้วกระดาษ + ฝา 1 ลัง', amount: 535, hasVatInvoice: true, vatAmount: 35, paymentMethod: 'cash', createdAt: daysAgo(0) },
]

/** โหลดข้อมูลตัวอย่าง (เขียนทับรายการ id เดิมถ้ามี — รายจ่ายตัวอย่างเพิ่มเฉพาะเมื่อตารางรายจ่ายว่าง) */
export async function seedSampleData() {
  await db.transaction(
    'rw',
    db.categories,
    db.products,
    db.promotions,
    db.members,
    db.expenses,
    async () => {
      await db.categories.bulkPut(CATEGORIES)
      await db.products.bulkPut(PRODUCTS)
      await db.promotions.bulkPut(PROMOTIONS)
      await db.members.bulkPut(MEMBERS)
      // เพิ่มรายจ่ายตัวอย่างเฉพาะเมื่อยังไม่มีรายจ่ายเลย — ห้ามทับ/ปนกับรายจ่ายจริงของผู้ใช้
      if ((await db.expenses.count()) === 0) {
        await db.expenses.bulkAdd(EXPENSES)
      }
    },
  )
}

/** เรียกตอนเปิดแอป — ตั้งค่าเริ่มต้น + ข้อมูลตัวอย่างในการใช้งานครั้งแรก */
export async function initDb() {
  const existing = await db.settings.get(1)
  if (existing) return
  await db.settings.put(DEFAULT_SETTINGS)
  await seedSampleData()
}
