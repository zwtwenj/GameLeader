import TeamCreate from './TeamCreate'
import TeamView from './TeamView'
import RaidPanel from './RaidPanel'
import { loadUserData } from '../init'
import { useAuth } from '../stores/auth'
import { useTeam } from '../stores/team'

export default function Home({ user }: { user: { id: number; username: string } }) {
  const { logout } = useAuth()
  const { status, team } = useTeam()

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
          <TeamView team={team} />
          {/* 副本悬浮窗：fixed 定位，挂在页面层级 */}
          <RaidPanel />
        </>
      )}
    </div>
  )
}
