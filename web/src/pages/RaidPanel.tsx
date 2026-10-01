import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import { useRaid } from '../stores/raid'

const ROLE_BADGE: Record<string, string> = {
  坦克: 'bg-sky-100 text-sky-700',
  治疗: 'bg-emerald-100 text-emerald-700',
  输出: 'bg-red-100 text-red-700',
}

const TICK_MS = 10_000 // 开发阶段：每 10 秒推进一步

/** 副本实例面板：时间线推进（10 秒/步）+ 副本记录 + 掉落 + 解散。 */
export default function RaidPanel() {
  const { raid, tick, abandonRaid, load } = useRaid()
  const [abandoning, setAbandoning] = useState(false)
  const [ticking, setTicking] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)

  const status = useRaid.getState().status
  const raidId = raid?.id
  const raidStatus = raid?.status

  // 进行中每 10 秒自动推进一步
  useEffect(() => {
    if (raidStatus !== '进行中' || !raidId) return
    let cancelled = false
    const id = setInterval(async () => {
      if (busyRef.current || cancelled) return
      busyRef.current = true
      try {
        await tick(raidId)
      } catch {
        /* 单次推进失败等下一轮 */
      } finally {
        busyRef.current = false
      }
    }, TICK_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [raidId, raidStatus, tick])

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
    if (!window.confirm(raid.status === '进行中' ? '确定解散本次副本？成员将全部解锁' : '确定解散队伍？成员将解锁')) return
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

  async function handleTick() {
    if (busyRef.current || !raid || raid.status !== '进行中') return
    busyRef.current = true
    setTicking(true)
    try {
      await tick(raid.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      await load().catch(() => {})
    } finally {
      busyRef.current = false
      setTicking(false)
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
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <span>
            步数 {raid.steps.done}/{raid.steps.total}
          </span>
          <span>
            进度 {raid.progress.killed}/{raid.progress.total}
          </span>
          {raid.status === '进行中' && (
            <span className="text-amber-600">剩余重试 {raid.retries_left}</span>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {raid.status === '已失败' && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          重试次数耗尽，散团了。队伍不解散，点击下方按钮解散队伍解锁成员
        </p>
      )}
      {raid.status === '已通关' && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          副本通关！点击下方按钮解散队伍解锁成员
        </p>
      )}

      {raid.status === '进行中' && (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-neutral-50 p-3">
          <p className="text-sm text-neutral-600">
            开发阶段：每 10 秒自动推进一步
            {raid.current_boss && (
              <span className="ml-2 text-neutral-400">
                （当前 {raid.current_boss.name}）
              </span>
            )}
          </p>
          <button
            className="rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-200 disabled:opacity-50"
            onClick={() => void handleTick()}
            disabled={ticking}
          >
            {ticking ? '推进中…' : '推进一步'}
          </button>
        </div>
      )}

      {raid.log.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-neutral-500">
            副本记录（{raid.log.length} 条）
          </p>
          <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg bg-neutral-50 p-3">
            {raid.log.map((entry, i) => (
              <p key={i} className="text-sm text-neutral-700">
                <span className="mr-2 font-mono text-xs text-neutral-400">
                  {entry.time}
                </span>
                {entry.message}
              </p>
            ))}
          </div>
        </div>
      )}

      {raid.drops.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-neutral-500">
            掉落装备（{raid.drops.length} 件，待竞拍）
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

      <div className="mt-5 border-t border-neutral-100 pt-3 text-center">
        <button
          className={
            'rounded-lg px-4 py-1.5 text-sm disabled:opacity-50 ' +
            (raid.status === '进行中'
              ? 'border border-red-200 text-red-600 hover:bg-red-50'
              : 'bg-neutral-900 text-white hover:bg-neutral-800')
          }
          onClick={() => void handleAbandon()}
          disabled={abandoning}
        >
          {abandoning ? '解散中…' : raid.status === '进行中' ? '解散副本' : '解散队伍'}
        </button>
      </div>
    </div>
  )
}
