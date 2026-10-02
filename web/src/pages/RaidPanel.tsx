import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import { useRaid } from '../stores/raid'

const ROLE_BADGE: Record<string, string> = {
  坦克: 'bg-sky-100 text-sky-700',
  治疗: 'bg-emerald-100 text-emerald-700',
  输出: 'bg-red-100 text-red-700',
}

/** 带标题栏的功能分区：作为田字格单元格使用，标题栏固定、内容在区域内滚动。 */
function Section({
  title,
  count,
  bodyRef,
  children,
}: {
  title: string
  count?: number
  bodyRef?: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 bg-neutral-50 px-2.5 py-1.5">
        <span className="text-xs font-semibold text-neutral-600">{title}</span>
        {count !== undefined && <span className="text-xs text-neutral-400">{count}</span>}
      </div>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {children}
      </div>
    </div>
  )
}

/** 副本悬浮窗：固定右侧，可收起（右缘竖排标签）/展开（固定分区侧栏）。
 * 支持同时多个副本实例：窗内以页签切换；推进由后端任务驱动，本组件纯展示。 */
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

  // 进行中自动展开 / 全部结束自动收起；仅在状态过渡时动作，手动开关不受打扰
  const ongoing = raids.some((r) => r.status === '进行中')
  const prevOngoing = useRef(false)
  useEffect(() => {
    if (ongoing !== prevOngoing.current) {
      setOpen(ongoing)
      prevOngoing.current = ongoing
    }
  }, [ongoing])

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

  // ---- 展开态：整体定高不滚动——页签/统计/横幅固定，田字格四分区各自内部滚动，解散按钮沉底 ----
  return (
    <div className="fixed bottom-4 right-4 top-20 z-40 flex w-[560px] flex-col gap-3 rounded-xl bg-neutral-100 p-4 shadow-lg ring-1 ring-neutral-200">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {raids.map((r) => (
            <button
              key={r.id}
              className={
                'rounded-lg px-2.5 py-1 text-xs font-medium transition ' +
                (r.id === activeId
                  ? 'bg-neutral-900 text-white'
                  : 'bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50')
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
    </div>
  )
}

/** 空分区的占位提示：固定分区布局下，四块区域无论有无内容都保持可见。 */
function EmptyHint({ text }: { text: string }) {
  return <p className="flex h-full items-center justify-center text-xs text-neutral-300">{text}</p>
}

/** 单个副本的详情分块：展示 + 解散。推进由后端任务驱动，本组件纯展示。 */
function RaidDetail({ raid }: { raid: import('../stores/raid').RaidInfo }) {
  const { abandonRaid, load } = useRaid()
  const [abandoning, setAbandoning] = useState(false)
  const [error, setError] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  const logLength = raid.log.length
  const chatLength = raid.chat.length

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg border border-neutral-200 bg-white py-1.5">
          <p className="text-xs text-neutral-400">步数</p>
          <p className="font-medium">
            {raid.steps.done}/{raid.steps.total}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white py-1.5">
          <p className="text-xs text-neutral-400">进度</p>
          <p className="font-medium">
            {raid.progress.killed}/{raid.progress.total}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white py-1.5">
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
        <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-xs font-semibold text-neutral-600">
            当前 BOSS（推进由后端任务驱动）
          </div>
          <div className="flex items-center justify-between px-2.5 py-2">
            <div>
              <p className="text-sm font-medium">{raid.current_boss.name}</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                要求装等 {raid.current_boss.gear_req} · 掉落 {raid.current_boss.drop_low}~
                {raid.current_boss.drop_high}
              </p>
            </div>

          </div>
        </div>
      )}

      {/* 田字格：记录 / 聊天 / 掉落 / 成员，四块均分剩余高度、各自内部滚动 */}
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3">
        <Section title="副本记录" count={raid.log.length}>
          {raid.log.length > 0 ? (
            <div ref={logRef} className="space-y-1">
              {raid.log.map((entry, i) => (
                <p key={i} className="text-xs leading-relaxed text-neutral-700">
                  <span className="mr-1.5 font-mono text-neutral-400">{entry.time}</span>
                  {entry.message}
                </p>
              ))}
            </div>
          ) : (
            <EmptyHint text="开团后每 10 秒推进一步，记录实时更新" />
          )}
        </Section>

        <Section title="团队聊天" count={raid.chat.length}>
          {raid.chat.length > 0 ? (
            <div ref={chatRef} className="space-y-1.5">
              {raid.chat.map((c, i) => (
                <p key={i} className="text-xs leading-relaxed text-neutral-700">
                  <span className="mr-1.5 font-mono text-neutral-400">{c.time}</span>
                  <span className="font-medium text-neutral-900">{c.member}：</span>
                  {c.message}
                </p>
              ))}
            </div>
          ) : (
            <EmptyHint text="副本进行中，成员会不时冒泡" />
          )}
        </Section>

        <Section title="掉落物品" count={raid.drops.length}>
          {raid.drops.length > 0 ? (
            <div className="space-y-1">
              {raid.drops.map((d) => (
                <p key={d.id} className="text-xs leading-relaxed text-neutral-700">
                  {d.text}
                </p>
              ))}
            </div>
          ) : (
            <EmptyHint text="击杀 BOSS 后掉落展示在这里" />
          )}
        </Section>

        <Section title="队伍成员" count={raid.members.length}>
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
      </div>

      <button
        className={
          'w-full shrink-0 rounded-lg py-1.5 text-sm disabled:opacity-50 ' +
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
