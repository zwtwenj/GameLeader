import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import type { TeamInfo } from '../stores/team'
import { useTeam } from '../stores/team'
import type { RaidPreviewInfo } from '../stores/raid'
import { useRaid } from '../stores/raid'
import { MemberCard } from './TeamView'

const SIZES = [5, 10, 25] as const

/** 开团弹框：step1 选副本（按人数筛选）→ step2 选成员 → step3 胜率预览确认。 */
export default function RaidModal({
  team,
  onClose,
}: {
  team: TeamInfo
  onClose: () => void
}) {
  const { dungeons, fetchDungeons, createRaid, preview } = useRaid()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [sizeFilter, setSizeFilter] = useState<number | null>(10) // 默认 10 人
  const [dungeonId, setDungeonId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewInfo, setPreviewInfo] = useState<RaidPreviewInfo | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    fetchDungeons().catch(() => setError('副本数据加载失败，请关闭后重试'))
  }, [fetchDungeons])

  const filtered = dungeons.filter((d) => sizeFilter === null || d.size === sizeFilter)
  const dungeon = dungeons.find((d) => d.id === dungeonId) ?? null

  function toggleMember(id: number) {
    setHint('')
    if (selected.has(id)) {
      const next = new Set(selected)
      next.delete(id)
      setSelected(next)
      return
    }
    if (dungeon && selected.size >= dungeon.size) {
      setHint(`最多选择 ${dungeon.size} 名成员，先取消一名再更换`)
      return
    }
    const next = new Set(selected)
    next.add(id)
    setSelected(next)
  }

  async function handleToConfirm() {
    if (loading || dungeonId === null) return
    setError('')
    setLoading(true)
    try {
      setPreviewInfo(await preview(dungeonId, [...selected]))
      setStep(3)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
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
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            开团 {step === 1 ? '· 选择副本' : step === 2 ? '· 选择成员' : '· 确认开团'}
          </h2>
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
            <SelectedComposition team={team} selected={selected} />

            <div className="mb-3 flex gap-2">
              {([null, '坦克', '治疗', '输出'] as const).map((r) => (
                <button
                  key={r ?? 'all'}
                  className={
                    'rounded-lg px-3 py-1 text-sm ' +
                    (roleFilter === r
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200')
                  }
                  onClick={() => setRoleFilter(r)}
                >
                  {r ?? '全部'}
                  {r !== null && ` ${team.members.filter((m) => m.role === r).length}`}
                </button>
              ))}
            </div>

            {hint && <p className="mb-3 text-sm text-amber-600">{hint}</p>}

            <div className="grid gap-3 sm:grid-cols-2">
              {team.members
                .filter((m) => roleFilter === null || m.role === roleFilter)
                .map((m) => {
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

        {step === 3 && previewInfo && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="平均装等" value={String(previewInfo.avg_gear)} />
              <Stat
                label="构成（坦/治/输）"
                value={`${previewInfo.composition['坦克']}/${previewInfo.composition['治疗']}/${previewInfo.composition['输出']}`}
              />
              <Stat
                label="人数需求"
                value={`${previewInfo.requirement['坦克']}/${previewInfo.requirement['治疗']}/${previewInfo.requirement['输出']}`}
              />
              <Stat label="平衡系数 K" value={String(previewInfo.balance_k)} />
            </div>

            {previewInfo.bosses.some((b) => b.penalties.length > 0) && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                构成不足：
                {previewInfo.bosses[0].penalties
                  .map((p) => `缺${p.role} ${p.missing} 名（${p.percent * 100}%）`)
                  .join('、')}
              </p>
            )}

            <div className="overflow-hidden rounded-lg ring-1 ring-neutral-200">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">BOSS</th>
                    <th className="px-3 py-2 text-left font-medium">要求装等</th>
                    <th className="px-3 py-2 text-left font-medium">掉落区间</th>
                    <th className="px-3 py-2 text-right font-medium">胜率</th>
                  </tr>
                </thead>
                <tbody>
                  {previewInfo.bosses.map((b) => (
                    <tr key={b.seq} className="border-t border-neutral-100">
                      <td className="px-3 py-2">{b.name}</td>
                      <td className="px-3 py-2 text-neutral-500">{b.gear_req}</td>
                      <td className="px-3 py-2 text-neutral-500">
                        {b.drop_low}~{b.drop_high}
                      </td>
                      <td
                        className={
                          'px-3 py-2 text-right font-medium ' +
                          (b.probability >= 0.7
                            ? 'text-emerald-600'
                            : b.probability >= 0.4
                              ? 'text-amber-600'
                              : 'text-red-600')
                        }
                      >
                        {Math.round(b.probability * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-between">
          {step >= 2 ? (
            <button
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
              onClick={() => setStep(step === 3 ? 2 : 1)}
            >
              上一步
            </button>
          ) : (
            <span />
          )}
          {step === 1 ? (
            <button
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={() => {
                // 换了人数更少的副本时，旧选择可能超员——清空重选
                if (dungeon && selected.size > dungeon.size) {
                  setSelected(new Set())
                  setHint(`已选 ${selected.size} 人超过该副本的 ${dungeon.size} 人上限，请重新选择`)
                }
                setStep(2)
              }}
              disabled={dungeonId === null}
            >
              下一步
            </button>
          ) : step === 2 ? (
            <button
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={() => void handleToConfirm()}
              disabled={loading || selected.size !== (dungeon?.size ?? 0)}
            >
              {loading ? '计算中…' : '查看胜率'}
            </button>
          ) : (
            <button
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={() => void handleConfirm()}
              disabled={loading}
            >
              {loading ? '进入中…' : '确认开团'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-0.5 font-semibold text-neutral-900">{value}</p>
    </div>
  )
}

/** 已选成员的构成统计：职业类型（坦克/治疗/输出）与功法（外功/内功）。 */
function SelectedComposition({
  team,
  selected,
}: {
  team: TeamInfo
  selected: Set<number>
}) {
  const chosen = team.members.filter((m) => selected.has(m.id))
  const counts: Record<string, number> = { 坦克: 0, 治疗: 0, 输出: 0, 外功: 0, 内功: 0 }
  for (const m of chosen) {
    if (m.role in counts) counts[m.role]++
    const xinfa = useTeam
      .getState()
      .sects.find((s) => s.name === m.sect)
      ?.xinfas.find((x) => x.name === m.xinfa)
    if (xinfa && (xinfa.equip_type === '外功' || xinfa.equip_type === '内功'))
      counts[xinfa.equip_type]++
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm">
      <span className="text-xs text-neutral-400">已选构成</span>
      <span className="text-sky-700">坦克 {counts['坦克']}</span>
      <span className="text-emerald-700">治疗 {counts['治疗']}</span>
      <span className="text-red-700">输出 {counts['输出']}</span>
      <span className="text-neutral-300">|</span>
      <span className="text-amber-700">外功 {counts['外功']}</span>
      <span className="text-violet-700">内功 {counts['内功']}</span>
    </div>
  )
}
