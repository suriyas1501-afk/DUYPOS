import { db, DEFAULT_SETTINGS } from './db'
import { hashPin } from '../lib/auth'
import type {
  Category,
  Coupon,
  Expense,
  Member,
  Product,
  ProductOption,
  Promotion,
} from './types'

const now = () => Date.now()
const daysAgo = (n: number) => Date.now() - n * 86400000

const CATEGORIES: Category[] = [
  { name: 'เครื่องดื่ม', sortOrder: 1 },
  { name: 'กาแฟ / ชา', sortOrder: 2 },
  { name: 'เบเกอรี่', sortOrder: 3 },
  { name: 'ขนม / อาหาร', sortOrder: 4 },
  { name: 'ของใช้', sortOrder: 5 },
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

/** สินค้าตัวอย่าง — categoryId อ้างตามลำดับหมวดที่สร้าง (เติมภายหลังใน seedSampleData) */
const PRODUCTS: (Omit<Product, 'categoryId'> & { catIndex: number })[] = [
  // ----- ค้าปลีก (มีบาร์โค้ด/สต็อก) -----
  {
    name: 'น้ำดื่ม 600 มล.',
    barcode: '8850100100017',
    catIndex: 0,
    price: 7,
    cost: 4.5,
    unit: 'ขวด',
    trackStock: true,
    stock: 120,
    lowStockAt: 24,
    // ขายยกแพ็คได้ (ตัดสต็อก 6 ขวด) และมีราคาส่งเมื่อซื้อครบ 12 ขวด
    units: [{ name: 'แพ็ค 6 ขวด', barcode: '8850100100116', factor: 6, price: 39 }],
    wholesalePrice: 6,
    wholesaleMinQty: 12,
    active: true,
    createdAt: now(),
  },
  { name: 'โคล่า กระป๋อง', barcode: '8850100100024', catIndex: 0, price: 18, cost: 12, unit: 'กระป๋อง', trackStock: true, stock: 48, lowStockAt: 12, active: true, createdAt: now() },
  { name: 'นมจืด UHT กล่อง', barcode: '8850100100031', catIndex: 0, price: 15, cost: 11, unit: 'กล่อง', trackStock: true, stock: 36, lowStockAt: 12, active: true, createdAt: now() },
  { name: 'บะหมี่กึ่งสำเร็จรูป ต้มยำ', barcode: '8850100100048', catIndex: 3, price: 8, cost: 5.8, unit: 'ซอง', trackStock: true, stock: 90, lowStockAt: 24, active: true, createdAt: now() },
  { name: 'มันฝรั่งทอด รสดั้งเดิม', barcode: '8850100100055', catIndex: 3, price: 30, cost: 24, unit: 'ถุง', trackStock: true, stock: 40, lowStockAt: 10, active: true, createdAt: now() },
  { name: 'ทิชชู่เปียก 20 แผ่น', barcode: '8850100100062', catIndex: 4, price: 25, cost: 17, unit: 'ห่อ', trackStock: true, stock: 25, lowStockAt: 8, active: true, createdAt: now() },
  { name: 'ถ่าน AA (แพ็ค 2)', barcode: '8850100100079', catIndex: 4, price: 45, cost: 32, unit: 'แพ็ค', trackStock: true, stock: 6, lowStockAt: 10, active: true, createdAt: now() },
  // ----- สินค้าชั่งน้ำหนัก -----
  {
    name: 'กล้วยหอม (ชั่งกิโล)',
    barcode: '8850100100086',
    catIndex: 3,
    price: 45,
    cost: 28,
    unit: 'กก.',
    trackStock: true,
    stock: 18,
    lowStockAt: 3,
    allowDecimalQty: true,
    active: true,
    createdAt: now(),
  },
  // ----- คาเฟ่ (มีตัวเลือก) -----
  { name: 'อเมริกาโน่', catIndex: 1, price: 55, cost: 18, unit: 'แก้ว', trackStock: false, stock: 0, options: [...DRINK_OPTIONS, SHOT_OPTION], active: true, createdAt: now() },
  { name: 'ลาเต้', catIndex: 1, price: 65, cost: 22, unit: 'แก้ว', trackStock: false, stock: 0, options: [...DRINK_OPTIONS, SHOT_OPTION], active: true, createdAt: now() },
  { name: 'ชาไทย', catIndex: 1, price: 50, cost: 15, unit: 'แก้ว', trackStock: false, stock: 0, options: DRINK_OPTIONS, active: true, createdAt: now() },
  { name: 'ชาเขียวมัทฉะ', catIndex: 1, price: 70, cost: 28, unit: 'แก้ว', trackStock: false, stock: 0, options: DRINK_OPTIONS, active: true, createdAt: now() },
  { name: 'โกโก้', catIndex: 1, price: 55, cost: 20, unit: 'แก้ว', trackStock: false, stock: 0, options: DRINK_OPTIONS, active: true, createdAt: now() },
  { name: 'ครัวซองต์เนยสด', catIndex: 2, price: 45, cost: 20, unit: 'ชิ้น', trackStock: true, stock: 12, lowStockAt: 5, active: true, createdAt: now() },
  { name: 'บราวนี่', catIndex: 2, price: 40, cost: 16, unit: 'ชิ้น', trackStock: true, stock: 9, lowStockAt: 4, active: true, createdAt: now() },
  { name: 'คุกกี้ช็อกโกแลตชิพ', catIndex: 2, price: 25, cost: 10, unit: 'ชิ้น', trackStock: true, stock: 30, lowStockAt: 10, active: true, createdAt: now() },
]

const MEMBERS: Member[] = [
  { code: 'M0001', name: 'สมชาย ใจดี', phone: '0812345678', points: 120, totalSpent: 3480, visits: 12, createdAt: now() },
  { code: 'M0002', name: 'สมหญิง รักดี', phone: '0898765432', points: 45, totalSpent: 1150, visits: 6, createdAt: now() },
]

const COUPONS: Coupon[] = [
  { code: 'WELCOME50', name: 'ส่วนลดต้อนรับ 50 บาท', type: 'amount', value: 50, minSubtotal: 300, usageLimit: 100, usedCount: 0, active: true, createdAt: now() },
  { code: 'SAVE10', name: 'ลด 10% สูงสุด 100 บาท', type: 'percent', value: 10, maxDiscount: 100, usedCount: 0, active: true, createdAt: now() },
]

const EXPENSES: Expense[] = [
  { date: daysAgo(2), category: 'ค่าสินค้า / วัตถุดิบ', description: 'สั่งเมล็ดกาแฟ + นม', amount: 1712, hasVatInvoice: true, vatAmount: 112, paymentMethod: 'transfer', createdAt: daysAgo(2) },
  { date: daysAgo(1), category: 'ค่าน้ำ / ค่าไฟ / เน็ต', description: 'ค่าไฟฟ้าประจำเดือน', amount: 980, hasVatInvoice: false, vatAmount: 0, paymentMethod: 'transfer', createdAt: daysAgo(1) },
  { date: daysAgo(0), category: 'ค่าอุปกรณ์ / ซ่อมบำรุง', description: 'แก้วกระดาษ + ฝา 1 ลัง', amount: 535, hasVatInvoice: true, vatAmount: 35, paymentMethod: 'cash', createdAt: daysAgo(0) },
]

/**
 * โหลดข้อมูลตัวอย่าง — เพิ่มเฉพาะตารางที่ยังว่างอยู่
 * (ห้ามเขียนทับสินค้า/สมาชิก/รายจ่ายจริงของร้านที่ใช้งานอยู่แล้ว)
 */
export async function seedSampleData(): Promise<{ added: string[]; skipped: string[] }> {
  const added: string[] = []
  const skipped: string[] = []

  await db.transaction(
    'rw',
    [db.categories, db.products, db.promotions, db.members, db.coupons, db.expenses],
    async () => {
      // ----- หมวดหมู่ + สินค้า (ผูก categoryId จากหมวดที่เพิ่ง/มีอยู่) -----
      if ((await db.products.count()) === 0) {
        let cats = await db.categories.toArray()
        if (cats.length === 0) {
          await db.categories.bulkAdd(CATEGORIES)
          cats = await db.categories.orderBy('sortOrder').toArray()
          added.push('หมวดหมู่')
        }
        const catId = (i: number) => cats[i]?.id
        await db.products.bulkAdd(
          PRODUCTS.map(({ catIndex, ...p }) => ({ ...p, categoryId: catId(catIndex) })),
        )
        added.push('สินค้า')
      } else {
        skipped.push('สินค้า')
      }

      // ----- โปรโมชัน (ผูกกับสินค้า/หมวดที่มีอยู่จริง) -----
      if ((await db.promotions.count()) === 0) {
        const water = await db.products.where('barcode').equals('8850100100017').first()
        const bakery = (await db.categories.toArray()).find((c) => c.name === 'เบเกอรี่')
        const promos: Promotion[] = [
          { name: 'ลด 10% เมื่อซื้อครบ 500.-', type: 'percent', scope: 'bill', value: 10, minSubtotal: 500, active: true },
        ]
        if (water?.id != null) {
          promos.push({ name: 'น้ำดื่ม ซื้อ 2 แถม 1', type: 'buyxgety', scope: 'products', value: 0, buyQty: 2, freeQty: 1, productIds: [water.id], active: true })
        }
        if (bakery?.id != null) {
          promos.push({ name: 'เบเกอรี่ลด 5.- ต่อชิ้น', type: 'amount', scope: 'category', value: 5, categoryId: bakery.id, active: false })
        }
        await db.promotions.bulkAdd(promos)
        added.push('โปรโมชัน')
      } else {
        skipped.push('โปรโมชัน')
      }

      if ((await db.members.count()) === 0) {
        await db.members.bulkAdd(MEMBERS)
        added.push('สมาชิก')
      } else {
        skipped.push('สมาชิก')
      }

      if ((await db.coupons.count()) === 0) {
        await db.coupons.bulkAdd(COUPONS)
        added.push('คูปอง')
      } else {
        skipped.push('คูปอง')
      }

      if ((await db.expenses.count()) === 0) {
        await db.expenses.bulkAdd(EXPENSES)
        added.push('รายจ่าย')
      } else {
        skipped.push('รายจ่าย')
      }
    },
  )

  return { added, skipped }
}

/**
 * สร้างบัญชีเจ้าของร้านให้ 1 คนถ้ายังไม่มีพนักงานเลย (PIN เริ่มต้น 1234)
 * เรียกทุกครั้งที่เปิดแอป เพื่อไม่ให้เปิดระบบพนักงานแล้วเข้าใช้งานไม่ได้
 */
export async function ensureOwnerStaff(): Promise<void> {
  if ((await db.staff.count()) > 0) return
  await db.staff.add({
    code: 'E01',
    name: 'เจ้าของร้าน',
    role: 'owner',
    pinHash: await hashPin('1234'),
    active: true,
    note: 'บัญชีเริ่มต้นของระบบ — กรุณาเปลี่ยน PIN',
    createdAt: Date.now(),
  })
}

/** เรียกตอนเปิดแอป — ตั้งค่าเริ่มต้น + ข้อมูลตัวอย่างในการใช้งานครั้งแรก */
export async function initDb() {
  // ขอให้เบราว์เซอร์กันข้อมูลไม่ให้ถูกลบอัตโนมัติเมื่อพื้นที่ตึง
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    // เบราว์เซอร์ไม่รองรับ — ข้ามไป (หน้าตั้งค่ามีปุ่มสำรองข้อมูลอยู่แล้ว)
  }

  await ensureOwnerStaff()

  const existing = await db.settings.get(1)
  if (existing) return
  await db.settings.put(DEFAULT_SETTINGS)
  await seedSampleData()
}
