import type { MemberInfo, TeamInfo } from '../stores/team'

const ROLE_BADGE: Record<string, string> = {
  坦克: 'bg-sky-100 text-sky-700',
  治疗: 'bg-emerald-100 text-emerald-700',
  输出: 'bg-red-100 text-red-700',
}

export default function TeamView({ team }: { team: TeamInfo }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-neutral-200">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">{team.name}</h1>
          <span className="text-sm text-neutral-500">
            成员 {team.members.length}/{team.member_cap}
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-500">团队资金：{team.fund}</p>
      </div>

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
