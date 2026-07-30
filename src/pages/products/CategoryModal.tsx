import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { Category } from '../../db/types'
import { Button, ConfirmDialog, EmptyState, Input, Modal, toast } from '../../components/ui'

/** โมดัลจัดการหมวดหมู่ — แก้ชื่อ inline, ลบ, เพิ่มใหม่ */
export default function CategoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), [])
  const productCounts = useLiveQuery(async () => {
    const counts = new Map<number, number>()
    await db.products.each((p) => {
      if (p.categoryId != null) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1)
    })
    return counts
  }, [])

  const [newName, setNewName] = useState('')
  const [deleting, setDeleting] = useState<Category | null>(null)

  const rename = async (cat: Category, value: string) => {
    if (cat.id == null) return
    const name = value.trim()
    if (!name || name === cat.name) return
    await db.categories.update(cat.id, { name })
    toast.success('เปลี่ยนชื่อหมวดหมู่แล้ว')
  }

  const remove = async (cat: Category) => {
    if (cat.id == null) return
    // สินค้าในหมวดนี้จะกลายเป็น "ไม่ระบุหมวดหมู่"
    await db.products.where('categoryId').equals(cat.id).modify({ categoryId: undefined })
    await db.categories.delete(cat.id)
    toast.success(`ลบหมวดหมู่ “${cat.name}” แล้ว`)
  }

  const add = async () => {
    const name = newName.trim()
    if (!name) {
      toast.error('กรุณากรอกชื่อหมวดหมู่')
      return
    }
    const maxOrder = (categories ?? []).reduce((m, c) => Math.max(m, c.sortOrder), 0)
    await db.categories.add({ name, sortOrder: maxOrder + 1 })
    setNewName('')
    toast.success(`เพิ่มหมวดหมู่ “${name}” แล้ว`)
  }

  const deletingCount =
    deleting?.id != null ? (productCounts?.get(deleting.id) ?? 0) : 0

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="จัดการหมวดหมู่"
        footer={
          <Button variant="secondary" onClick={onClose}>
            ปิด
          </Button>
        }
      >
        <div className="space-y-4">
          {/* รายการหมวดหมู่ */}
          {!categories || categories.length === 0 ? (
            <EmptyState icon="tag" title="ยังไม่มีหมวดหมู่" hint="เพิ่มหมวดหมู่แรกได้จากช่องด้านล่าง" />
          ) : (
            <div className="space-y-2">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      key={`${c.id}-${c.name}`}
                      defaultValue={c.name}
                      onBlur={(e) => void rename(c, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs text-slate-400">
                    {c.id != null ? (productCounts?.get(c.id) ?? 0) : 0} สินค้า
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    title="ลบหมวดหมู่"
                    className="text-rose-500 hover:bg-rose-50"
                    onClick={() => setDeleting(c)}
                  />
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-400">แก้ชื่อได้ในช่องโดยตรง ระบบบันทึกให้อัตโนมัติ</p>

          {/* เพิ่มหมวดใหม่ */}
          <div className="border-t border-slate-100 pt-4">
            <span className="mb-1 block text-sm font-medium text-slate-600">เพิ่มหมวดหมู่ใหม่</span>
            <div className="flex gap-2">
              <Input
                placeholder="เช่น เครื่องดื่ม"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void add()
                }}
              />
              <Button icon="plus" onClick={add}>
                เพิ่ม
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting != null}
        title="ลบหมวดหมู่"
        message={
          <>
            ต้องการลบหมวดหมู่ <b>“{deleting?.name}”</b> ใช่ไหม?
            {deletingCount > 0 && (
              <>
                <br />
                สินค้า {deletingCount} รายการในหมวดนี้จะกลายเป็น “ไม่ระบุหมวดหมู่”
              </>
            )}
          </>
        }
        confirmLabel="ลบหมวดหมู่"
        danger
        onConfirm={() => {
          if (deleting) void remove(deleting)
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
