import { create } from 'zustand'

import { request } from '../api/client'
import { useTeam } from './team'

export interface RaidBossInfo {
  seq: number
  name: string
  gear_req: number
  drop_low: number
  drop_high: number
}

export interface DungeonInfo {
  id: number
  name: string
  size: number
  balance_k: number
  bosses: RaidBossInfo[]
}

export interface RaidMemberInfo {
  member_id: number
  name: string
  sect: string
  xinfa: string
  role: string
  equip_level: number
}

export interface RaidDropInfo {
  id: number
  desc: string
  slot: string
  equip_type: string
  equip_level: number
}

export interface RaidLogEntry {
  step: number
  event: string
  message: string
  time: string
}

export interface BossOddsInfo {
  seq: number
  name: string
  gear_req: number
  drop_low: number
  drop_high: number
  probability: number
  base: number
  penalties: { role: string; missing: number; percent: number }[]
}

export interface RaidPreviewInfo {
  size: number
  balance_k: number
  requirement: { 坦克: number; 治疗: number; 输出: number }
  composition: { 坦克: number; 治疗: number; 输出: number }
  avg_gear: number
  bosses: BossOddsInfo[]
}

export interface RaidInfo {
  id: number
  status: string
  dungeon: { id: number; name: string; size: number }
  progress: { killed: number; total: number }
  steps: { done: number; total: number }
  retries_left: number
  current_boss: RaidBossInfo | null
  log: RaidLogEntry[]
  members: RaidMemberInfo[]
  drops: RaidDropInfo[]
}

type Status = 'loading' | 'idle' | 'offline'

interface RaidState {
  status: Status
  raid: RaidInfo | null
  dungeons: DungeonInfo[]
  load: () => Promise<void>
  fetchDungeons: () => Promise<void>
  createRaid: (dungeonId: number, memberIds: number[]) => Promise<void>
  /** 开团预览：当前配置对各个 BOSS 的胜率（纯计算） */
  preview: (dungeonId: number, memberIds: number[]) => Promise<RaidPreviewInfo>
  /** 推进一个时间线节点（返回 true 进下一个 / false 原地重试） */
  tick: (raidId: number) => Promise<void>
  /** 解散队伍：进行中→已解散；已结束→仅解锁成员（记录与掉落保留） */
  abandonRaid: (raidId: number) => Promise<void>
}

export const useRaid = create<RaidState>((set, get) => ({
  status: 'loading',
  raid: null,
  dungeons: [],

  load: async () => {
    // 同 team.load：静默刷新，避免挂载面板时的卸载/挂载循环
    if (get().raid === null && get().status !== 'idle') set({ status: 'loading' })
    try {
      const data = await request<{ raid: RaidInfo | null }>('/api/raid/current')
      set({ raid: data.raid, status: 'idle' })
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === -1) set({ status: 'offline' })
      else throw err
    }
  },

  fetchDungeons: async () => {
    if (get().dungeons.length > 0) return
    const dungeons = await request<DungeonInfo[]>('/api/game/dungeons')
    set({ dungeons })
  },

  createRaid: async (dungeonId, memberIds) => {
    await request('/api/raid', {
      method: 'POST',
      body: JSON.stringify({ dungeon_id: dungeonId, member_ids: memberIds }),
    })
    await get().load()
    // 进本会锁定成员，团队页面的锁定徽章需要同步刷新
    await useTeam.getState().load()
  },

  preview: (dungeonId, memberIds) =>
    request<RaidPreviewInfo>('/api/raid/preview', {
      method: 'POST',
      body: JSON.stringify({ dungeon_id: dungeonId, member_ids: memberIds }),
    }),

  tick: async (raidId) => {
    const data = await request<{ raid: RaidInfo }>(`/api/raid/${raidId}/tick`, {
      method: 'POST',
    })
    set({ raid: data.raid })
  },

  abandonRaid: async (raidId) => {
    await request(`/api/raid/${raidId}/abandon`, { method: 'POST' })
    await get().load()
    // 解锁同样影响成员状态
    await useTeam.getState().load()
  },
}))
