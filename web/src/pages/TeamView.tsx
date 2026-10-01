import { useState } from 'react'

import { ApiError } from '../api/client'
import type {
  MemberDetailInfo,
  MemberInfo,
  RecruitOfferInfo,
  TeamInfo,
} from '../stores/team'
import { useTeam } from '../stores/team'
import { useWarehouse } from '../stores/warehouse'
import { useRaid } from '../stores/raid'
import RaidModal from './RaidModal'

const ROLE_BADGE: Record<string, string> = {
  坦克: 'bg-sky-100 text-sky-700',
  治疗: 'bg-emerald-100 text-emerald-700',
  输出: 'bg-red-100 text-red-700',
}

export default function TeamView({ team }: { team: TeamInfo }) {
  const { recruit, acceptRecruit, load } = useTeam()
  const raidStore = useRaid()
  const raidActive = raidStore.raid?.status === '进行中'

  const [candidate, setCandidate] = useState<RecruitOfferInfo | null>(null)
  const [recruiting, setRecruiting] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')
  const [showRaidModal, setShowRaidModal] = useState(false)

  const full = team.members.length >= team.member_cap
  const leader = team.members.find((m) => m.id === team.leader_member_id)

  async function handleRecruit() {
    if (recruiting) return
    setError('')
    setRecruiting(true)
    try {
      setCandidate(await recruit())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
    } finally {
      setRecruiting(false)
    }
  }

  async function handleAccept() {
    if (accepting || !candidate) return
    setError('')
    setAccepting(true)
    try {
      await acceptRecruit(candidate.offer_id)
      setCandidate(null) // 成功后 load() 已刷新团队
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      // 候选可能已被消耗/过期，刷新团队保持一致
      await load().catch(() => {})
      setCandidate(null)
    } finally {
      setAccepting(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* 团队信息卡：团牌 + 货币/资源统计 + 操作 */}
      <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-neutral-200">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold">{team.name}</h1>
            {leader && <span className="text-sm text-neutral-500">团长：{leader.name}</span>}
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={() => void handleRecruit()}
              disabled={recruiting || full}
            >
              {recruiting ? '刷新中…' : full ? '成员已满' : '招募'}
            </button>
            {!raidActive && (
              <button
                className="rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
                onClick={() => setShowRaidModal(true)}
              >
                开团
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="团队资金" value={String(team.fund)} />
          <Stat label="五行石" value={String(useWarehouse((s) => (s.data?.materials.find((m) => m.name === '五行石')?.quantity ?? 0)))} accent />
          <Stat
            label="成员"
            value={`${team.members.length}/${team.member_cap}`}
          />
          <Stat label="副本状态" value={raidActive ? '进行中' : '空闲'} />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {candidate && (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                入团申请
              </span>
              <span className="font-medium">{candidate.name}</span>
              <span
                className={
                  'rounded px-1.5 py-0.5 text-xs ' +
                  (ROLE_BADGE[candidate.role] ?? 'bg-neutral-100 text-neutral-600')
                }
              >
                {candidate.role}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
                onClick={() => void handleAccept()}
                disabled={accepting}
              >
                {accepting ? '处理中…' : '同意'}
              </button>
              <button
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200 disabled:opacity-50"
                onClick={() => setCandidate(null)}
                disabled={accepting}
              >
                拒绝
              </button>
            </div>
          </div>
          <p className="mt-2 text-sm text-neutral-500">
            {candidate.sect} · {candidate.xinfa} · {candidate.equip_type}装备 · 装等 120
          </p>
        </div>
      )}

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-600">成员</h2>
        <span className="text-xs text-neutral-400">
          点击成员卡可查看装备详情 / 切换心法
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {team.members.map((m) => (
          <MemberCard
            key={m.id}
            member={m}
            isLeader={m.id === team.leader_member_id}
          />
        ))}
      </div>

      {showRaidModal && <RaidModal team={team} onClose={() => setShowRaidModal(false)} />}
    </div>
  )
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <p className="text-xs text-neutral-400">{label}</p>
      <p
        className={
          'mt-0.5 text-lg font-semibold ' + (accent ? 'text-violet-600' : 'text-neutral-900')
        }
      >
        {value}
      </p>
    </div>
  )
}

/** 成员卡：通用组件——传成员信息即可在任何页面使用（装备详情/切换心法/移除都可用）。 */
export function MemberCard({
  member: m,
  isLeader,
  selectable = false,
  selected = false,
  onToggleSelected,
}: {
  member: MemberInfo
  isLeader: boolean
  selectable?: boolean
  selected?: boolean
  onToggleSelected?: () => void
}) {
  const { removeMember, switchXinfa, load, sects } = useTeam()
  const [showDetail, setShowDetail] = useState(false)
  const [detail, setDetail] = useState<MemberDetailInfo | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cardError, setCardError] = useState('')

  const locked = m.in_raid_id !== null
  const canSwitch = !locked && (sects.find((s) => s.name === m.sect)?.xinfas.length ?? 0) > 1

  async function run(fn: () => Promise<void>) {
    if (busy) return
    setCardError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setCardError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      await load().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  function handleRemove() {
    if (busy) return
    if (!window.confirm(`确定移除成员「${m.name}」？`)) return
    void run(() => removeMember(m.id))
  }

  async function toggleDetail() {
    if (showDetail) {
      setShowDetail(false)
      return
    }
    setShowDetail(true)
    if (detail) return
    setDetailLoading(true)
    try {
      setDetail(await useTeam.getState().memberDetail(m.id))
    } catch {
      setDetail(null)
      setShowDetail(false)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div
      className={
        'rounded-xl bg-white p-4 shadow-sm ring-1 ' +
        (selected ? 'ring-2 ring-neutral-900' : 'ring-neutral-200')
      }
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {selectable && (
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={selected}
              onChange={() => onToggleSelected?.()}
              disabled={locked}
            />
          )}
          <span className="font-medium">{m.name}</span>
          {isLeader && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
              团长
            </span>
          )}
          {locked && (
            <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
              副本中
            </span>
          )}
        </div>
        <span
          className={
            'rounded px-1.5 py-0.5 text-xs ' +
            (ROLE_BADGE[m.role] ?? 'bg-neutral-100 text-neutral-600')
          }
        >
          {m.role}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-neutral-500">
        <span>
          {m.sect} · {m.xinfa}
        </span>
        <span>装等 {m.equip_level}</span>
      </div>

      <div className="mt-3 flex gap-2 border-t border-neutral-100 pt-2.5">
        <button
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
          onClick={() => void toggleDetail()}
          disabled={detailLoading}
        >
          {detailLoading ? '加载中…' : showDetail ? '收起装备' : '装备详情'}
        </button>
        {canSwitch && (
          <button
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
            onClick={() => setSwitching(!switching)}
            disabled={busy}
          >
            切换心法
          </button>
        )}
        {!isLeader && !locked && (
          <button
            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            onClick={handleRemove}
            disabled={busy}
          >
            移除
          </button>
        )}
      </div>

      {cardError && <p className="mt-2 text-xs text-red-600">{cardError}</p>}

      {showDetail && (
        <div className="mt-2 rounded-lg bg-neutral-50 p-2">
          {detailLoading && <p className="text-xs text-neutral-400">加载中…</p>}
          {detail && (
            <div className="grid grid-cols-3 gap-1.5">
              {detail.slots.map((s) => (
                <div
                  key={s.slot}
                  className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs ring-1 ring-neutral-200"
                >
                  <span className="text-neutral-500">{s.slot}</span>
                  <span className="font-medium text-neutral-900">{s.level}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {switching && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-lg bg-neutral-50 p-2">
          {(sects.find((s) => s.name === m.sect)?.xinfas ?? [])
            .filter((x) => x.name !== m.xinfa)
            .map((x) => (
              <button
                key={x.id}
                className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:border-neutral-900 disabled:opacity-50"
                onClick={() => {
                  setSwitching(false)
                  void run(() => switchXinfa(m.id, x.id))
                }}
                disabled={busy}
              >
                {x.name}（{x.role}）
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
