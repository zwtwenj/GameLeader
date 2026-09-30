import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import type {
  MemberDetailInfo,
  MemberInfo,
  RecruitOfferInfo,
  TeamInfo,
  XinfaInfo,
} from '../stores/team'
import { useTeam } from '../stores/team'

const ROLE_BADGE: Record<string, string> = {
  坦克: 'bg-sky-100 text-sky-700',
  治疗: 'bg-emerald-100 text-emerald-700',
  输出: 'bg-red-100 text-red-700',
}

export default function TeamView({ team }: { team: TeamInfo }) {
  const { recruit, acceptRecruit, removeMember, switchXinfa, load, sects, fetchSects } =
    useTeam()
  const [candidate, setCandidate] = useState<RecruitOfferInfo | null>(null)
  const [recruiting, setRecruiting] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [switchingId, setSwitchingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const started = useRef(false)

  // 切换心法需要门派的心法列表；缓存为空时取一次
  useEffect(() => {
    if (started.current) return
    started.current = true
    fetchSects().catch(() => {})
  }, [fetchSects])

  const full = team.members.length >= team.member_cap

  async function run(fn: () => Promise<void>) {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      await load().catch(() => {}) // 失败后以服务端为准刷新，防状态漂移
    } finally {
      setBusy(false)
    }
  }

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

  function handleRemove(m: MemberInfo) {
    if (busy) return
    if (!window.confirm(`确定移除成员「${m.name}」？`)) return
    void run(() => removeMember(m.id))
  }

  function handleSwitch(m: MemberInfo, xinfaId: number) {
    setSwitchingId(null)
    void run(() => switchXinfa(m.id, xinfaId))
  }

  function xinfasOf(sectName: string): XinfaInfo[] {
    return sects.find((s) => s.name === sectName)?.xinfas ?? []
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-neutral-200">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{team.name}</h1>
            <p className="mt-1 text-sm text-neutral-500">团队资金：{team.fund}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-neutral-500">
              成员 {team.members.length}/{team.member_cap}
            </p>
            <button
              className="mt-1.5 rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={() => void handleRecruit()}
              disabled={recruiting || full}
            >
              {recruiting ? '刷新中…' : full ? '成员已满' : '招募'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
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
            {candidate.sect} · {candidate.xinfa} · {candidate.equip_type}装备 ·
            装等 120
          </p>
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-medium text-neutral-600">成员</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {team.members.map((m) => (
          <MemberCard
            key={m.id}
            member={m}
            isLeader={m.id === team.leader_member_id}
            xinfas={xinfasOf(m.sect)}
            switching={switchingId === m.id}
            busy={busy}
            onToggleSwitch={() =>
              setSwitchingId(switchingId === m.id ? null : m.id)
            }
            onSwitch={(xinfaId) => handleSwitch(m, xinfaId)}
            onRemove={() => handleRemove(m)}
          />
        ))}
      </div>
    </div>
  )
}

function MemberCard({
  member: m,
  isLeader,
  xinfas,
  switching,
  busy,
  onToggleSwitch,
  onSwitch,
  onRemove,
}: {
  member: MemberInfo
  isLeader: boolean
  xinfas: XinfaInfo[]
  switching: boolean
  busy: boolean
  onToggleSwitch: () => void
  onSwitch: (xinfaId: number) => void
  onRemove: () => void
}) {
  const { memberDetail } = useTeam()
  const [showDetail, setShowDetail] = useState(false)
  const [detail, setDetail] = useState<MemberDetailInfo | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const canSwitch = xinfas.length > 1

  async function toggleDetail() {
    if (showDetail) {
      setShowDetail(false)
      return
    }
    setShowDetail(true)
    if (detail) return
    setDetailLoading(true)
    try {
      setDetail(await memberDetail(m.id))
    } catch {
      setDetail(null)
      setShowDetail(false)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{m.name}</span>
          {isLeader && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
              团长
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
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
          onClick={() => void toggleDetail()}
        >
          {detailLoading ? '加载中…' : showDetail ? '收起装备' : '装备详情'}
        </button>
        {canSwitch && (
          <button
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
            onClick={onToggleSwitch}
            disabled={busy}
          >
            切换心法
          </button>
        )}
        {!isLeader && (
          <button
            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            onClick={onRemove}
            disabled={busy}
          >
            移除
          </button>
        )}
      </div>

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
          {xinfas
            .filter((x) => x.name !== m.xinfa)
            .map((x) => (
              <button
                key={x.id}
                className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:border-neutral-900 disabled:opacity-50"
                onClick={() => onSwitch(x.id)}
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
