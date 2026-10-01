import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import type { TeamInfo } from '../stores/team'
import { useRaid } from '../stores/raid'
import { MemberCard } from './TeamView'

const SIZES = [5, 10, 25] as const

/** 开团弹框：step1 选副本（按人数筛选）→ step2 选成员（人数须等于副本规格）。 */
export default function RaidModal({
  team,
  onClose,
}: {
  team: TeamInfo
  onClose: () => void
}) {
  const { dungeons, fetchDungeons, createRaid } = useRaid()
  const [step, setStep] = useState<1 | 2>(1)
  const [sizeFilter, setSizeFilter] = useState<number | null>(10) // 默认 10 人
  const [dungeonId, setDungeonId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    fetchDungeons().catch(() => setError('副本数据加载失败，请关闭后重试'))
  }, [fetchDungeons])

  const filtered = dungeons.filter((d) => sizeFilter === null || d.size === sizeFilter)
  const dungeon = dungeons.find((d) => d.id === dungeonId) ?? null

  function toggleMember(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleEnter() {
    if (loading || dungeonId === null) return
    setError('')
    setLoading(true)
    try {
      await createRaid(dungeonId, [...selected])
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">开团 {step === 1 ? '· 选择副本' : '· 选择成员'}</h2>
          <button className="text-sm text-neutral-400 hover:text-neutral-900" onClick={onClose}>
            关闭
          </button>
        </div>

        {step === 1 && (
          <>
            <div className="mb-3 flex gap-2">
              <button
                className={
                  'rounded-lg px-3 py-1.5 text-sm ' +
                  (sizeFilter === null
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200')
                }
                onClick={() => setSizeFilter(null)}
              >
                全部
              </button>
              {SIZES.map((s) => (
                <button
                  key={s}
                  className={
                    'rounded-lg px-3 py-1.5 text-sm ' +
                    (sizeFilter === s
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200')
                  }
                  onClick={() => setSizeFilter(s)}
                >
                  {s}人
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <p className="rounded-lg bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-400">
                该人数规格暂无副本
              </p>
            ) : (
              <div className="grid gap-2">
                {filtered.map((d) => (
                  <button
                    type="button"
                    key={d.id}
                    className={
                      'rounded-lg border p-3 text-left transition ' +
                      (dungeonId === d.id
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-neutral-200 hover:border-neutral-500')
                    }
                    onClick={() => setDungeonId(d.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{d.name}</span>
                      <span className="text-xs text-neutral-400">平衡系数 K = {d.balance_k}</span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      BOSS：{d.bosses.map((b) => `${b.name}(${b.gear_req})`).join(' → ')}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === 2 && dungeon && (
          <>
            <p className="mb-3 text-sm text-neutral-600">
              {dungeon.name}：需选择 <span className="font-medium">{dungeon.size}</span> 名成员
              （已选 <span className={selected.size === dungeon.size ? 'text-emerald-600' : 'text-red-500'}>{selected.size}</span>
              /{dungeon.size}），可先查看装备、切换心法
            </p>
            <div className="grid max-h-96 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              {team.members.map((m) => {
                const locked = m.in_raid_id !== null
                return (
                  <div
                    key={m.id}
                    className={'relative' + (locked ? '' : ' cursor-pointer')}
                    onClick={(e) => {
                      // 点按钮/复选框走它们自己的逻辑，点卡片其余区域 = 选中/取消
                      if (locked || (e.target as HTMLElement).closest('button,input')) return
                      toggleMember(m.id)
                    }}
                  >
                    <div className={locked ? 'opacity-50' : ''}>
                      <MemberCard
                        member={m}
                        isLeader={m.id === team.leader_member_id}
                        selectable
                        selected={selected.has(m.id)}
                        onToggleSelected={() => toggleMember(m.id)}
                      />
                    </div>
                    {locked && (
                      <span className="absolute right-2 top-3 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                        副本中
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-between">
          {step === 2 ? (
            <button
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
              onClick={() => setStep(1)}
            >
              上一步
            </button>
          ) : (
            <span />
          )}
          {step === 1 ? (
            <button
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={() => setStep(2)}
              disabled={dungeonId === null}
            >
              下一步
            </button>
          ) : (
            <button
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={() => void handleEnter()}
              disabled={loading || selected.size !== (dungeon?.size ?? 0)}
            >
              {loading ? '进入中…' : '进入副本'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
