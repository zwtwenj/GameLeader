import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import { useRaid } from '../stores/raid'

const ROLE_BADGE: Record<string, string> = {
  坦克: 'bg-sky-100 text-sky-700',
  治疗: 'bg-emerald-100 text-emerald-700',
  输出: 'bg-red-100 text-red-700',
}

const TICK_MS = 10_000 // 开发阶段：每 10 秒推进一步

/** 带标题栏的固定高度分区：内容在区域内滚动，区域高度不随内容变化。 */
function Section({
  title,
  count,
  bodyClass,
  bodyRef,
  children,
}: {
  title: string
  count?: number
  bodyClass: string
  bodyRef?: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200">
      <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-2.5 py-1.5">
        <span className="text-xs font-medium text-neutral-500">{title}</span>
        {count !== undefined && <span className="text-xs text-neutral-400">{count}</span>}
      </div>
      <div ref={bodyRef} className={`overflow-y-auto px-2.5 py-2 ${bodyClass}`}>
        {children}
      </div>
    </div>
  )
}

/** 副本悬浮窗：固定右侧，可收起（右缘竖排标签）/展开（固定分区侧栏）。
 * 支持同时多个副本实例：窗内以页签切换，每个进行中的副本各自自动推进。 */
export default function RaidPanel() {
  const raids = useRaid((s) => s.raids)
  const status = useRaid((s) => s.status)
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)

  // 多副本页签：默认选中第一个进行中的，否则最新的
  useEffect(() => {
    if (raids.length === 0) return
    if (activeId === null || !raids.some((r) => r.id === activeId)) {
      const ongoing = raids.find((r) => r.status === '进行中')
      setActiveId((ongoing ?? raids[0]).id)
    }
  }, [raids, activeId])

  const raid = raids.find((r) => r.id === activeId) ?? null
  const ongoingCount = raids.filter((r) => r.status === '进行中').length

  if (status !== 'idle' || raids.length === 0) return null

  // ---- 收起态：右缘竖排标签 ----
  if (!open) {
    return (
      <button
        className="fixed right-0 top-1/3 z-40 rounded-l-lg bg-neutral-900/90 px-1.5 py-4 text-xs tracking-widest text-white [writing-mode:vertical-rl] hover:bg-neutral-800"
        onClick={() => setOpen(true)}
      >
        副本×{raids.length}
      </button>
    )
  }

  // ---- 展开态 ----
  return (
    <div className="fixed right-4 top-20 z-40 max-h-[85vh] w-[560px] space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-lg ring-1 ring-neutral-200">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {raids.map((r) => (
            <button
              key={r.id}
              className={
                'rounded-lg px-2.5 py-1 text-xs font-medium transition ' +
                (r.id === activeId
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200')
              }
              onClick={() => setActiveId(r.id)}
            >
              {r.dungeon.name}
              {r.status === '进行中' && ' ·'}
            </button>
          ))}
        </div>
        <button
          className="text-xs text-neutral-400 hover:text-neutral-900"
          onClick={() => setOpen(false)}
        >
          收起
        </button>
      </div>

      {raid && <RaidDetail raid={raid} />}

      {ongoingCount > 1 && (
        <p className="text-center text-xs text-neutral-400">
          {ongoingCount} 个副本同时进行中，每个独立推进
        </p>
      )}
    </div>
  )
}

/** 单个副本的详情分块（进行中自动推进；结束保持展示）。 */
function RaidDetail({ raid }: { raid: import('../stores/raid').RaidInfo }) {
  const { tick, abandonRaid, load } = useRaid()
  const [abandoning, setAbandoning] = useState(false)
  const [ticking, setTicking] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  const raidId = raid.id
  const raidStatus = raid.status
  const logLength = raid.log.length
  const chatLength = raid.chat.length

  // 进行中每 10 秒自动推进一步（每个副本实例独立 interval）
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

  // 记录/聊天追加时自动滚到底部
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLength])
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chatLength])

  async function handleAbandon() {
    if (abandoning) return
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
    if (busyRef.current || raid.status !== '进行中') return
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

  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg bg-neutral-50 py-1.5">
          <p className="text-xs text-neutral-400">步数</p>
          <p className="font-medium">
            {raid.steps.done}/{raid.steps.total}
          </p>
        </div>
        <div className="rounded-lg bg-neutral-50 py-1.5">
          <p className="text-xs text-neutral-400">进度</p>
          <p className="font-medium">
            {raid.progress.killed}/{raid.progress.total}
          </p>
        </div>
        <div className="rounded-lg bg-neutral-50 py-1.5">
          <p className="text-xs text-neutral-400">剩余重试</p>
          <p className="font-medium text-amber-600">{raid.retries_left}</p>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
      )}

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
        <div className="rounded-lg border border-neutral-200">
          <div className="border-b border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-xs font-medium text-neutral-500">
            当前 BOSS
          </div>
          <div className="flex items-center justify-between px-2.5 py-2">
            <div>
              <p className="text-sm font-medium">{raid.current_boss.name}</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                要求装等 {raid.current_boss.gear_req} · 掉落 {raid.current_boss.drop_low}~
                {raid.current_boss.drop_high}
              </p>
            </div>
            <div className="text-right">
              <button
                className="rounded border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-200 disabled:opacity-50"
                onClick={() => void handleTick()}
                disabled={ticking}
              >
                {ticking ? '推进中…' : '推进一步'}
              </button>
              <p className="mt-1 text-[10px] text-neutral-400">每 10 秒自动推进</p>
            </div>
          </div>
        </div>
      )}

      {raid.chat.length > 0 && (
        <Section title="团队聊天" count={raid.chat.length} bodyClass="h-40 bg-sky-50/60">
          <div ref={chatRef} className="space-y-1.5">
            {raid.chat.map((c, i) => (
              <p key={i} className="text-xs leading-relaxed text-neutral-700">
                <span className="mr-1.5 font-mono text-neutral-400">{c.time}</span>
                <span className="font-medium text-neutral-900">{c.member}：</span>
                {c.message}
              </p>
            ))}
          </div>
        </Section>
      )}

      {raid.log.length > 0 && (
        <Section title="副本记录" count={raid.log.length} bodyClass="h-40">
          <div ref={logRef} className="space-y-1">
            {raid.log.map((entry, i) => (
              <p key={i} className="text-xs leading-relaxed text-neutral-700">
                <span className="mr-1.5 font-mono text-neutral-400">{entry.time}</span>
                {entry.message}
              </p>
            ))}
          </div>
        </Section>
      )}

      {raid.drops.length > 0 && (
        <Section title="掉落物品" count={raid.drops.length} bodyClass="max-h-32">
          <div className="space-y-1">
            {raid.drops.map((d) => (
              <p key={d.id} className="text-xs leading-relaxed text-neutral-700">
                {d.text}
              </p>
            ))}
          </div>
        </Section>
      )}

      <Section title="进本成员" count={raid.members.length} bodyClass="max-h-28">
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
      </Section>

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
    </>
  )
}
