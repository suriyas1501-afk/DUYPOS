import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Icon } from './ui'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

const LOG_KEY = 'pos-last-error'

/** กันจอขาวทั้งเครื่อง: จับ error ที่หลุดจาก render แล้วให้ทางออกกับพนักงานหน้าร้าน */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      localStorage.setItem(
        LOG_KEY,
        JSON.stringify({
          at: new Date().toISOString(),
          message: error.message,
          stack: error.stack?.slice(0, 2000),
          componentStack: info.componentStack?.slice(0, 2000),
        }),
      )
    } catch {
      // localStorage เต็มหรือถูกปิด — ไม่ใช่เรื่องคอขาดบาดตาย
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 w-fit rounded-2xl bg-rose-50 p-3 text-rose-600">
            <Icon name="alert" size={28} />
          </div>
          <h1 className="text-lg font-bold text-slate-800">ระบบสะดุดชั่วคราว</h1>
          <p className="mt-1 text-sm text-slate-500">
            ข้อมูลการขายที่บันทึกแล้วยังอยู่ครบในเครื่อง — กดปุ่มด้านล่างเพื่อกลับไปขายต่อได้เลย
          </p>
          <pre className="mt-3 max-h-28 overflow-auto rounded-xl bg-slate-50 p-3 text-left text-xs text-slate-500">
            {error.message}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>
              ลองอีกครั้ง
            </Button>
            <Button icon="refresh" onClick={() => window.location.reload()}>
              โหลดระบบใหม่
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            ถ้าเกิดซ้ำ แนะนำสำรองข้อมูลที่หน้าตั้งค่าแล้วแจ้งผู้ดูแลระบบ
          </p>
        </div>
      </div>
    )
  }
}
