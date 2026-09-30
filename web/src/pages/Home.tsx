import { useAuth } from '../stores/auth'

export default function Home({ user }: { user: { id: number; username: string } }) {
  const { logout } = useAuth()

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">我是团长</h1>
          <p className="mt-1 text-sm text-neutral-500">
            欢迎，{user.username}（#{user.id}）
          </p>
        </div>
        <button
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200"
          onClick={logout}
        >
          退出登录
        </button>
      </div>

      <div className="mt-10 rounded-xl bg-white p-8 text-center text-sm text-neutral-400 shadow-sm ring-1 ring-neutral-200">
        M1 团队功能开发中：创建团队、招募成员、开启副本
      </div>
    </div>
  )
}
