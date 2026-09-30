import { create } from 'zustand'

import { request } from '../api/client'

export interface MemberInfo {
  id: number
  name: string
  sect: string
  xinfa: string
  role: string
  equip_level: number
}

export interface TeamInfo {
  id: number
  name: string
  fund: number
  member_cap: number
  leader_member_id: number | null
  members: MemberInfo[]
}

export interface XinfaInfo {
  id: number
  name: string
  role: string
  equip_type: string
}

export interface SectInfo {
  id: number
  name: string
  xinfas: XinfaInfo[]
}

export interface RecruitOfferInfo {
  offer_id: number
  name: string
  sect: string
  xinfa: string
  role: string
  equip_type: string
}

export interface MemberDetailInfo extends MemberInfo {
  slots: { slot: string; level: number }[]
}

type Status = 'loading' | 'empty' | 'ready' | 'offline'

interface TeamState {
  status: Status
  team: TeamInfo | null
  /** 门派是静态配置，首次取一次后缓存 */
  sects: SectInfo[]
  load: () => Promise<void>
  fetchSects: () => Promise<void>
  createTeam: (name: string, leaderName: string, sectId: number) => Promise<void>
  /** 刷新招募：服务端抽候选，前端只持有 offer_id */
  recruit: () => Promise<RecruitOfferInfo>
  /** 同意招募：消耗候选并生成成员（名字/门派以服务端临时数据为准） */
  acceptRecruit: (offerId: number) => Promise<void>
  /** 移除成员（软删除，团长不可移除） */
  removeMember: (memberId: number) => Promise<void>
  /** 切换成员心法（限同门派） */
  switchXinfa: (memberId: number, xinfaId: number) => Promise<void>
  /** 成员详情（含 12 槽位装等） */
  memberDetail: (memberId: number) => Promise<MemberDetailInfo>
}

export const useTeam = create<TeamState>((set, get) => ({
  status: 'loading',
  team: null,
  sects: [],

  load: async () => {
    set({ status: 'loading' })
    try {
      const data = await request<{ team: TeamInfo | null }>('/api/team/me')
      set({ team: data.team, status: data.team ? 'ready' : 'empty' })
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === -1) set({ status: 'offline' })
      else throw err
    }
  },

  fetchSects: async () => {
    if (get().sects.length > 0) return
    const sects = await request<SectInfo[]>('/api/game/sects')
    set({ sects })
  },

  createTeam: async (name, leaderName, sectId) => {
    await request('/api/team', {
      method: 'POST',
      body: JSON.stringify({ name, leader_name: leaderName, sect_id: sectId }),
    })
    // 以服务端为准刷新团队数据
    await get().load()
  },

  recruit: async () =>
    request<RecruitOfferInfo>('/api/team/recruit', { method: 'POST' }),

  acceptRecruit: async (offerId) => {
    await request(`/api/team/recruit/${offerId}/accept`, { method: 'POST' })
    await get().load()
  },

  removeMember: async (memberId) => {
    await request(`/api/team/members/${memberId}`, { method: 'DELETE' })
    await get().load()
  },

  switchXinfa: async (memberId, xinfaId) => {
    await request(`/api/team/members/${memberId}/xinfa`, {
      method: 'PUT',
      body: JSON.stringify({ xinfa_id: xinfaId }),
    })
    await get().load()
  },

  memberDetail: (memberId) =>
    request<MemberDetailInfo>(`/api/team/members/${memberId}`),
}))
