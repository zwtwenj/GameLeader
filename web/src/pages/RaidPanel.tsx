import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import { useRaid } from '../stores/raid'

const ROLE_BADGE: Record<string, string> = {
  坦克: 'bg-sky-100 text-sky-700',
  治疗: 'bg-emerald-100 text-emerald-700',
  输出: 'bg-red-100 text-red-700',
}

const TICK_MS = 10_000 // 开发阶段：每 10 秒推进一步

/** 副本悬浮窗：固定右侧，可收起（右缘竖排标签）/展开（完整副本信息侧栏）。
 * 副本进行中默认展开；团队成员上方不再占用版面。 */
export default function RaidPanel() {
  const { raid, tick, abandonRaid, load } = useRaid()
  const [abandoning, setAbandoning] = useState(false)
  const [ticking, setTicking] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState(false) // 用户手动收起/展开后不再自动切换
  const busyRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)

  const status = useRaid.getState().status
  const raidId = raid?.id
  const raidStatus = raid?.status
  const logLength = raid?.log.length ?? 0

  // 副本进行中自动展开、结束后自动收起（用户手动操作过则尊重用户选择）
  useEffect(() => {
    if (!manual) setOpen(raidStatus === '进行中')
  }, [raidStatus, manual])

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

  // 展开时副本记录自动滚到底部
  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [open, logLength])

  if (status !== 'idle' || !raid) return null

  async function handleAbandon() {
    if (abandoning || !raid) return
    if (
      !window.confirm(
        raid.status === '进行中' ? '确定解散本次副本？成员将全部解锁' : '确定解散队伍？成员将解锁',
      )
    )
      return
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
    setError('')
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

  // ---- 收起态：右缘竖排标签 ----
  if (!open) {
    return (
      <button
        className="fixed right-0 top-1/3 z-40 rounded-l-lg bg-neutral-900/90 px-1.5 py-4 text-xs tracking-widest text-white [writing-mode:vertical-rl] hover:bg-neutral-800"
        onClick={() => {
          setManual(true)
          setOpen(true)
        }}
      >
        副本 {raid.steps.done}/{raid.steps.total}
      </button>
    )
  }

  // ---- 展开态：右侧悬浮侧栏 ----
  return (
    <div className="fixed right-4 top-20 z-40 max-h-[85vh] w-80 space-y-4 overflow-y-auto rounded-xl bg-white p-4 shadow-lg ring-1 ring-neutral-200">
      {/* 头部：副本名 + 状态 + 收起 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{raid.dungeon.name}</h2>
          <span
            className={
              'rounded px-1.5 py-0.5 text-xs ' +
              (raid.status === '进行中'
                ? 'bg-blue-100 text-blue-700'
                : raid.status === '已通关'
                  ? 'bg-emerald-100 text-emerald-700'
                  : raid.status === '已失败'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-neutral-100 text-neutral-600')
            }
          >
            {raid.status}
          </span>
        </div>
        <button
          className="text-xs text-neutral-400 hover:text-neutral-900"
          onClick={() => {
            setManual(true)
            setOpen(false)
          }}
        >
          收起
        </button>
      </div>

      <div className="space-y-1 text-sm text-neutral-600">
        <p>
          步数 {raid.steps.done}/{raid.steps.total}
          <span className="mx-2 text-neutral-300">|</span>
          进度 {raid.progress.killed}/{raid.progress.total}
        </p>
        {raid.status === '进行中' && (
          <p className="text-amber-600">剩余重试 {raid.retries_left} 次</p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {raid.status === '已失败' && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          重试次数耗尽，散团了。队伍不解散，点击下方按钮解锁成员
        </p>
      )}
      {raid.status === '已通关' && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          副本通关！点击下方按钮解散队伍解锁成员
        </p>
      )}

      {raid.status === '进行中' && raid.current_boss && (
        <div className="rounded-lg bg-neutral-50 p-3">
          <p className="text-sm font-medium">当前 BOSS：{raid.current_boss.name}</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            要求装等 {raid.current_boss.gear_req} · 掉落 {raid.current_boss.drop_low}~
            {raid.current_boss.drop_high}
          </p>
          <p className="mt-2 text-xs text-neutral-400">开发阶段：每 10 秒自动推进一步</p>
          <button
            className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200 disabled:opacity-50"
            onClick={() => void handleTick()}
            disabled={ticking}
          >
            {ticking ? '推进中…' : '推进一步'}
          </button>
        </div>
      )}

      {raid.log.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-500">
            副本记录（{raid.log.length}）
          </p>
          <div
            ref={logRef}
            className="max-h-52 space-y-1 overflow-y-auto rounded-lg bg-neutral-50 p-2.5"
          >
            {raid.log.map((entry, i) => (
              <p key={i} className="text-xs leading-relaxed text-neutral-700">
                <span className="mr-1.5 font-mono text-neutral-400">{entry.time}</span>
                {entry.message}
              </p>
            ))}
          </div>
        </div>
      )}

      {raid.drops.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-500">
            掉落装备（{raid.drops.length} 件）
          </p>
          <div className="flex flex-wrap gap-1">
            {raid.drops.map((d) => (
              <span
                key={d.id}
                className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700"
              >
                {d.desc}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-neutral-500">进本成员（{raid.members.length}）</p>
        <div className="flex flex-wrap gap-1">
          {raid.members.map((m) => (
            <span
              key={m.member_id}
              className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700"
            >
              {m.name}
              <span className={'ml-1 ' + (ROLE_BADGE[m.role] ?? '')}>{m.role}</span>
            </span>
          ))}
        </div>
      </div>

      <button
        className={
          'w-full rounded-lg py-1.5 text-sm disabled:opacity-50 ' +
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
  )
}
