import { useEffect, useRef } from 'react'

import Home from './pages/Home'
import Login from './pages/Login'
import { useAuth } from './stores/auth'

export default function App() {
  const { status, user, init } = useAuth()
  const started = useRef(false)

  // 进页恰好一次初始化（ref 防 StrictMode 双调用）
  useEffect(() => {
    if (started.current) return
    started.current = true
    void init()
  }, [init])

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-500">
        加载中…
      </div>
    )
  }

  if (status === 'offline') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-neutral-600">服务暂不可用</p>
        <button
          className="rounded bg-neutral-800 px-4 py-1.5 text-sm text-white hover:bg-neutral-700"
          onClick={() => void init()}
        >
          重试
        </button>
      </div>
    )
  }

  if (status === 'anon') return <Login />
  return <Home user={user!} />
}
