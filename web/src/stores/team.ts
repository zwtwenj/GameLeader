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

type Status = 'loading' | 'empty' | 'ready' | 'offline'

interface TeamState {
  status: Status
  team: TeamInfo | null
  /** 门派是静态配置，首次取一次后缓存 */
  sects: SectInfo[]
  load: () => Promise<void>
  fetchSects: () => Promise<void>
  createTeam: (name: string, leaderName: string, sectId: number) => Promise<void>
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
}))
