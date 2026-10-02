import { useEffect } from 'react'

import { initApp, loadUserData, stopRaidPolling } from './init'
import Home from './pages/Home'
import Login from './pages/Login'
import { useAuth } from './stores/auth'

export default function App() {
  const status = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)

  // 启动：恢复登录态
  useEffect(() => {
    void initApp()
  }, [])

  // 登录态就绪（登录成功 / 刷新恢复）后加载业务数据与静态配置；离开登录态则停轮询
  useEffect(() => {
    if (status === 'authed') void loadUserData()
    else stopRaidPolling()
  }, [status])

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
          onClick={() => void initApp()}
        >
          重试
        </button>
      </div>
    )
  }

  if (status === 'anon') return <Login />
  return <Home user={user!} />
}
