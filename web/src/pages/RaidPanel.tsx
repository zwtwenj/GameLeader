import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import { useRaid } from '../stores/raid'

const ROLE_BADGE: Record<string, string> = {
  坦克: 'bg-sky-100 text-sky-700',
  治疗: 'bg-emerald-100 text-emerald-700',
  输出: 'bg-red-100 text-red-700',
}

/** 副本实例面板：展示成员/进度/状态/掉落；进行中可解散（击杀掉落逻辑待定）。 */
export default function RaidPanel() {
  const { raid, abandonRaid, load } = useRaid()
  const [abandoning, setAbandoning] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void load().catch(() => {})
  }, [load])

  const status = useRaid.getState().status
  if (status === 'loading') {
    return <p className="mt-6 text-center text-sm text-neutral-400">加载副本信息…</p>
  }
  if (status === 'offline') {
    return (
      <div className="mt-6 rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-neutral-200">
        <p className="text-sm text-neutral-600">副本信息暂不可用</p>
        <button
          className="mt-2 rounded bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
          onClick={() => void load()}
        >
          重试
        </button>
      </div>
    )
  }

  if (!raid) return null

  async function handleAbandon() {
    if (abandoning || !raid) return
    if (!window.confirm('确定解散本次副本？成员将全部解锁')) return
    setError('')
    setAbandoning(true)
    try {
      await abandonRaid(raid.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      await load().catch(() => {})
    } finally {
      setAbandoning(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-neutral-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{raid.dungeon.name}</h2>
          <span
            className={
              'rounded px-1.5 py-0.5 text-xs ' +
              (raid.status === '进行中'
                ? 'bg-blue-100 text-blue-700'
                : raid.status === '已通关'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-red-100 text-red-700')
            }
          >
            {raid.status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">
            进度 {raid.progress.killed}/{raid.progress.total}
          </span>
          {raid.status === '进行中' && (
            <button
              className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              onClick={() => void handleAbandon()}
              disabled={abandoning}
            >
              {abandoning ? '解散中…' : '解散副本'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {raid.status === '进行中' && raid.current_boss && (
        <div className="mt-4 rounded-lg bg-neutral-50 p-3">
          <p className="text-sm font-medium">
            下一个 BOSS：{raid.current_boss.name}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            要求装等 {raid.current_boss.gear_req} · 掉落 {raid.current_boss.drop_low}~
            {raid.current_boss.drop_high}
          </p>
        </div>
      )}

      <div className="mt-4">
        <p className="mb-1.5 text-xs font-medium text-neutral-500">
          进本成员（{raid.members.length}，副本期间锁定）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {raid.members.map((m) => (
            <span
              key={m.member_id}
              className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700"
            >
              {m.name}
              <span className={'ml-1 ' + (ROLE_BADGE[m.role] ?? '')}>{m.role}</span>
            </span>
          ))}
        </div>
      </div>

      {raid.drops.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-neutral-500">
            掉落装备（{raid.drops.length} 件）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {raid.drops.map((d) => (
              <span
                key={d.id}
                className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700"
              >
                {d.desc}
              </span>
            ))}
          </div>
        </div>
      )}

      {raid.status !== '进行中' && (
        <p className="mt-4 text-center text-xs text-neutral-400">
          本次副本已结束，可点击右上角「开团」开启下一次
        </p>
      )}
    </div>
  )
}
