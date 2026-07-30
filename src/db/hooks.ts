import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS } from './db'
import type { Settings } from './types'

/** อ่านการตั้งค่าแบบ reactive (คืนค่า default ระหว่างโหลด) */
export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get(1), [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS
}

/** สถานะการเชื่อมต่ออินเทอร์เน็ต */
import { useEffect, useState } from 'react'

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
