import { useState } from 'react'

import { ApiError } from '../api/client'
import type { MemberInfo, RecruitOfferInfo, TeamInfo } from '../stores/team'
import { useTeam } from '../stores/team'

const ROLE_BADGE: Record<string, string> = {
  坦克: 'bg-sky-100 text-sky-700',
  治疗: 'bg-emerald-100 text-emerald-700',
  输出: 'bg-red-100 text-red-700',
}

export default function TeamView({ team }: { team: TeamInfo }) {
  const { recruit, acceptRecruit, load } = useTeam()
  const [candidate, setCandidate] = useState<RecruitOfferInfo | null>(null)
  const [recruiting, setRecruiting] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')
  const full = team.members.length >= team.member_cap

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
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-neutral-200">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{team.name}</h1>
            <p className="mt-1 text-sm text-neutral-500">
              团队资金：{team.fund}
            </p>
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
          <MemberCard key={m.id} member={m} isLeader={m.id === team.leader_member_id} />
        ))}
      </div>
    </div>
  )
}

function MemberCard({ member: m, isLeader }: { member: MemberInfo; isLeader: boolean }) {
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
        <span className={'rounded px-1.5 py-0.5 text-xs ' + (ROLE_BADGE[m.role] ?? 'bg-neutral-100 text-neutral-600')}>
          {m.role}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-neutral-500">
        <span>
          {m.sect} · {m.xinfa}
        </span>
        <span>装等 {m.equip_level}</span>
      </div>
    </div>
  )
}
