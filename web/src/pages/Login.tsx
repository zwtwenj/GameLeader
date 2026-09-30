import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/client'
import { useAuth } from '../stores/auth'

type Mode = 'login' | 'register'

export default function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, register } = useAuth()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      if (mode === 'register') {
        await register(username, password)
      }
      await login(username, password)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('出了点问题，请重试')
      }
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="w-90 rounded-xl bg-white p-8 shadow-sm ring-1 ring-neutral-200"
      >
        <h1 className="mb-1 text-xl font-semibold">我是团长</h1>
        <p className="mb-6 text-sm text-neutral-500">
          {mode === 'login' ? '登录你的团长账号' : '注册一个团长账号'}
        </p>

        <label className="mb-1 block text-sm text-neutral-600">用户名</label>
        <input
          className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={32}
          required
        />

        <label className="mb-1 block text-sm text-neutral-600">密码</label>
        <input
          type="password"
          className="mb-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          maxLength={64}
          required
        />
        {mode === 'register' && (
          <p className="mb-2 text-xs text-neutral-400">密码至少 6 位</p>
        )}

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>

        <button
          type="button"
          className="mt-3 w-full text-center text-sm text-neutral-500 hover:text-neutral-900"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError('')
          }}
        >
          {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
        </button>
      </form>
    </div>
  )
}
