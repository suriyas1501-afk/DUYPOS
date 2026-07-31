import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * สถานะการเข้าสู่ระบบของพนักงาน
 *
 * เก็บแค่ staffId — ข้อมูลพนักงาน/สิทธิ์อ่านสดจาก IndexedDB (useCurrentStaff)
 * เพื่อให้แก้สิทธิ์หรือปิดใช้งานพนักงานแล้วมีผลทันทีโดยไม่ต้องออกจากระบบ
 *
 * คงสถานะไว้ใน localStorage เพราะรีเฟรชกลางบิลต้องไม่หลุดออกจากระบบ
 * (เครื่องขายหน้าร้านเป็นเครื่องเฉพาะ — ถ้าต้องการความปลอดภัยเพิ่ม ใช้ล็อกหน้าจออัตโนมัติ)
 */
interface AuthState {
  staffId: number | null
  /** ล็อกหน้าจอ: ยังจำว่าเป็นใคร แต่ต้องใส่ PIN ก่อนใช้งานต่อ */
  locked: boolean
  loginAt: number | null
  /** เวลาที่มีการใช้งานล่าสุด (ใช้กับล็อกหน้าจออัตโนมัติ) */
  lastActiveAt: number
  login(staffId: number): void
  logout(): void
  lock(): void
  unlock(): void
  touch(): void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      staffId: null,
      locked: false,
      loginAt: null,
      lastActiveAt: Date.now(),
      login: (staffId) =>
        set({ staffId, locked: false, loginAt: Date.now(), lastActiveAt: Date.now() }),
      logout: () => set({ staffId: null, locked: false, loginAt: null }),
      lock: () => set({ locked: true }),
      unlock: () => set({ locked: false, lastActiveAt: Date.now() }),
      touch: () => set({ lastActiveAt: Date.now() }),
    }),
    {
      name: 'pos-auth',
      partialize: (s) => ({
        staffId: s.staffId,
        locked: s.locked,
        loginAt: s.loginAt,
      }),
    },
  ),
)
