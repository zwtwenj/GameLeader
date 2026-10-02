import { useState } from 'react'

import { ApiError } from '../api/client'
import type { TeamInfo } from '../stores/team'
import { useTeam } from '../stores/team'
import type { ConsumableCarry, RaidPreviewInfo } from '../stores/raid'
import { useRaid } from '../stores/raid'
import { useWarehouse } from '../stores/warehouse'
import { MemberCard } from './TeamView'

const SIZES = [5, 10, 25] as const

/** 开团弹框：step1 选副本（按人数筛选）→ step2 选成员 → step3 其他配置（携带
 * 消耗品）→ step4 胜率预览确认。整体定高：内容区滚动、底部按钮固定。 */
export default function RaidModal({
  team,
  onClose,
}: {
  team: TeamInfo
  onClose: () => void
}) {
  const { dungeons, createRaid, preview } = useRaid()
  const { consumableStock, fetchStock } = useWarehouse()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [sizeFilter, setSizeFilter] = useState<number | null>(10) // 默认 10 人
  const [dungeonId, setDungeonId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [carried, setCarried] = useState<ConsumableCarry[]>([])
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewInfo, setPreviewInfo] = useState<RaidPreviewInfo | null>(null)

  const filtered = dungeons.filter((d) => sizeFilter === null || d.size === sizeFilter)
  const dungeon = dungeons.find((d) => d.id === dungeonId) ?? null
  const carryTotal = carried.reduce((s, c) => s + c.quantity, 0)
  // 携带消耗品折算的装等增益（与后端 effect 解析同规则）
  const carryBonus = carried.reduce((s, c) => {
    const item = (consumableStock ?? []).find((x) => x.item_id === c.item_id)
    return s + (item?.effect.find((e) => e.type === 'gear_bonus')?.value ?? 0) * c.quantity
  }, 0)

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

  /** 设置某消耗品携带数量（0 = 不携带）；总量超 3 或超库存由按钮禁用兜底 */
  function setCarry(itemId: number, quantity: number) {
    setCarried((prev) => {
      const rest = prev.filter((x) => x.item_id !== itemId)
      return quantity <= 0 ? rest : [...rest, { item_id: itemId, quantity }]
    })
  }

  async function handleToConfig() {
    setError('')
    try {
      await fetchStock('消耗品')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
    }
    setStep(3)
  }

  async function handleToConfirm() {
    if (loading || dungeonId === null) return
    setError('')
    setLoading(true)
    try {
      setPreviewInfo(await preview(dungeonId, [...selected], carried))
      setStep(4)
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
      await createRaid(dungeonId, [...selected], carried)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      {/* 整体定高不滚动：步骤内容区滚动、底部按钮固定（成员列表长也不用滚到底找按钮） */}
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold">
            开团{' '}
            {step === 1
              ? '· 选择副本'
              : step === 2
                ? '· 选择成员'
                : step === 3
                  ? '· 其他配置'
                  : '· 确认开团'}
          </h2>
          <button className="text-sm text-neutral-400 hover:text-neutral-900" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
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
                // 未锁定的排前面，锁定（副本中）的沉底
                .sort((a, b) => Number(a.in_raid_id !== null) - Number(b.in_raid_id !== null))
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

        {step === 3 && (
          <>
            <p className="mb-3 text-sm text-neutral-600">
              其他配置（可选）：携带的消耗品在开团时立即从仓库扣除，效果在本次副本全程生效，解散不退还。
            </p>
            <p className="mb-2 text-xs font-medium text-neutral-400">
              消耗品 · 最多携带 3 个，可重复（已选{' '}
              <span className={carryTotal > 0 ? 'font-semibold text-neutral-900' : ''}>
                {carryTotal}/3
              </span>
              {carryBonus > 0 && <>，全员装等 +{carryBonus}</>}）
            </p>
            {(consumableStock ?? []).length === 0 ? (
              <p className="rounded-lg bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-400">
                仓库中没有消耗品
              </p>
            ) : (
              <div className="grid gap-2">
                {consumableStock!.map((c) => {
                  const qty = carried.find((x) => x.item_id === c.item_id)?.quantity ?? 0
                  // 增加一枚的上限：总量 3 减去其他项已带数量、且不超过自身库存
                  const roomForOne = Math.min(3 - (carryTotal - qty), c.stock)
                  return (
                    <div
                      key={c.item_id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {c.name}
                          <span className="ml-2 text-xs font-normal text-neutral-400">
                            库存 {c.stock}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-500">{c.desc}</p>
                        {c.effect.map((e) => (
                          <p key={e.type} className="mt-0.5 text-xs text-violet-600">
                            ◆ {e.desc}
                          </p>
                        ))}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className="h-7 w-7 rounded-lg bg-neutral-100 text-sm font-medium text-neutral-600 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => setCarry(c.item_id, qty - 1)}
                          disabled={qty === 0}
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-sm font-medium">{qty}</span>
                        <button
                          type="button"
                          className="h-7 w-7 rounded-lg bg-neutral-100 text-sm font-medium text-neutral-600 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => setCarry(c.item_id, qty + 1)}
                          disabled={qty >= roomForOne}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {step === 4 && previewInfo && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat
                label="平均装等"
                value={
                  previewInfo.gear_bonus > 0
                    ? `${previewInfo.avg_gear}（含消耗品+${previewInfo.gear_bonus}）`
                    : String(previewInfo.avg_gear)
                }
              />
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

        </div>

        {error && <p className="mt-3 shrink-0 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex shrink-0 justify-between">
          {step >= 2 ? (
            <button
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
              onClick={() => setStep((step - 1) as 1 | 2 | 3 | 4)}
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
              onClick={() => void handleToConfig()}
              disabled={loading || selected.size !== (dungeon?.size ?? 0)}
            >
              下一步
            </button>
          ) : step === 3 ? (
            <button
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={() => void handleToConfirm()}
              disabled={loading}
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
