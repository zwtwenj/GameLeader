import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ApiError } from '../api/client'
import { useTeam } from '../stores/team'

export default function TeamCreate() {
  const { sects, fetchSects, createTeam } = useTeam()
  const [name, setName] = useState('')
  const [leaderName, setLeaderName] = useState('')
  const [sectId, setSectId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const started = useRef(false)

  // 门派是静态配置，进页取一次（ref 防 StrictMode 双调用）
  useEffect(() => {
    if (started.current) return
    started.current = true
    fetchSects().catch(() => setError('门派数据加载失败，请刷新重试'))
  }, [fetchSects])

  const selectedSect = sects.find((s) => s.id === sectId) ?? null
  const defaultXinfa = selectedSect?.xinfas[0] ?? null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading || sectId === null) return
    setError('')
    setLoading(true)
    try {
      await createTeam(name, leaderName, sectId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold">创建团队</h1>
      <p className="mt-1 text-sm text-neutral-500">
        建立你的公会，团长将作为第一名成员入团
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-6 space-y-5 rounded-xl bg-white p-6 shadow-sm ring-1 ring-neutral-200"
      >
        <div>
          <label className="mb-1 block text-sm text-neutral-600">团队名（团牌）</label>
          <input
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-600">
            团长名 <span className="text-neutral-400">最多六个字</span>
          </label>
          <input
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            value={leaderName}
            onChange={(e) => setLeaderName(e.target.value)}
            maxLength={6}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-neutral-600">团长门派</label>
          {sects.length === 0 ? (
            <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-sm text-neutral-400">
              门派数据加载中…
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {sects.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => setSectId(s.id)}
                  className={
                    'rounded-lg border px-2 py-2 text-sm transition ' +
                    (sectId === s.id
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-300 text-neutral-700 hover:border-neutral-500')
                  }
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {defaultXinfa && (
          <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
            团长心法（默认取该门派第一个）：
            <span className="font-medium text-neutral-900">{defaultXinfa.name}</span>
            <span className="mx-1">·</span>
            {defaultXinfa.role}
            <span className="mx-1">·</span>
            {defaultXinfa.equip_type}装备
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || sectId === null}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? '创建中…' : '确定建团'}
        </button>
      </form>
    </div>
  )
}
