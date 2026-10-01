import { useEffect, useRef, useState } from 'react'

import TeamCreate from './TeamCreate'
import TeamView from './TeamView'
import WarehouseView from './WarehouseView'
import RaidPanel from './RaidPanel'
import { loadUserData } from '../init'
import { useAuth } from '../stores/auth'
import { useTeam } from '../stores/team'

type Tab = 'members' | 'warehouse'

export default function Home({ user }: { user: { id: number; username: string } }) {
  const { logout } = useAuth()
  const { status, team } = useTeam()
  const [tab, setTab] = useState<Tab>('members')
  const started = useRef(false)

  // 登录态就绪后由 App 触发一次数据装载；此处不再重复请求
  useEffect(() => {
    if (started.current) return
    started.current = true
    void loadUserData()
  }, [])

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="font-semibold">我是团长</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-500">{user.username}</span>
            <button
              className="text-neutral-500 hover:text-neutral-900"
              onClick={logout}
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {status === 'loading' && (
        <p className="py-24 text-center text-sm text-neutral-400">加载团队信息…</p>
      )}
      {status === 'offline' && (
        <div className="py-24 text-center">
          <p className="text-sm text-neutral-600">服务暂不可用</p>
          <button
            className="mt-3 rounded bg-neutral-800 px-4 py-1.5 text-sm text-white hover:bg-neutral-700"
            onClick={() => void loadUserData()}
          >
            重试
          </button>
        </div>
      )}
      {status === 'empty' && <TeamCreate />}
      {status === 'ready' && team && (
        <>
          {/* 功能页签：成员 / 仓库 */}
          <div className="mx-auto max-w-6xl px-4 pt-4">
            <div className="flex w-fit gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-neutral-200">
              {(
                [
                  ['members', '成员'],
                  ['warehouse', '仓库'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={
                    'rounded-md px-5 py-1.5 text-sm font-medium transition ' +
                    (tab === key
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-600 hover:bg-neutral-100')
                  }
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {tab === 'members' && <TeamView team={team} />}
          {tab === 'warehouse' && <WarehouseView />}

          {/* 副本悬浮窗：fixed 定位，挂在页面层级 */}
          <RaidPanel />
        </>
      )}
    </div>
  )
}
