import { create } from 'zustand'

import { ApiError, request } from '../api/client'
import { useAuth } from './auth'
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
  /** 如："王海银掉落了130装等外功帽子，分配给陈三百" */
  text: string
}

export interface RaidLogEntry {
  step: number
  event: string
  message: string
  time: string
}

export interface RaidChatEntry {
  member: string
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
  /** 携带消耗品折算的装等增益（已含在 avg_gear 内） */
  gear_bonus: number
  bosses: BossOddsInfo[]
}

export interface ConsumableCarry {
  item_id: number
  quantity: number
}

export interface RaidInfo {
  id: number
  /** 内容摘要（服务端对整份快照哈希）：轮询时据此跳过无变化数据 */
  revision: string
  status: string
  dungeon: { id: number; name: string; size: number }
  progress: { killed: number; total: number }
  steps: { done: number; total: number }
  retries_left: number
  current_boss: RaidBossInfo | null
  /** 开团携带的消耗品（进本即从仓库扣除） */
  consumables: { items: { item_id: number; name: string; quantity: number }[]; gear_bonus: number }
  log: RaidLogEntry[]
  chat: RaidChatEntry[]
  members: RaidMemberInfo[]
  drops: RaidDropInfo[]
}

type Status = 'loading' | 'idle' | 'offline'

interface RaidState {
  status: Status
  /** 团队全部未关闭的副本实例（支持同时开多个团） */
  raids: RaidInfo[]
  dungeons: DungeonInfo[]
  load: () => Promise<void>
  /** 启动进度轮询（登录态就绪后调用一次，幂等） */
  startPolling: () => void
  stopPolling: () => void
  fetchDungeons: () => Promise<void>
  createRaid: (dungeonId: number, memberIds: number[], consumables: ConsumableCarry[]) => Promise<void>
  /** 开团预览：当前配置对各个 BOSS 的胜率（纯计算） */
  preview: (dungeonId: number, memberIds: number[], consumables: ConsumableCarry[]) => Promise<RaidPreviewInfo>
  /** 推进一个时间线节点（返回 true 进下一个 / false 原地重试） */
  tick: (raidId: number) => Promise<void>
  /** 解散队伍：进行中→已解散；已结束→仅解锁成员（记录与掉落保留） */
  abandonRaid: (raidId: number) => Promise<void>
}

export const useRaid = create<RaidState>((set, get) => ({
  status: 'loading',
  raids: [],
  dungeons: [],

  load: () => {
    // 静默刷新（不闪加载态）；团队可同时有多个未关闭副本。
    // 单飞锁：轮询与开团/解散后的刷新并发时共享同一次请求
    if (inflight) return inflight
    const task = (async () => {
      try {
        const data = await request<{ raids: RaidInfo[] }>('/api/raid/current')
        const next = data.raids
        const cur = get().raids
        // 全部 revision 与 id 一致 → 内容零变化，跳过 set 避免整块面板无谓重渲染
        const unchanged =
          cur.length === next.length &&
          cur.every((r, i) => r.id === next[i].id && r.revision === next[i].revision)
        if (!unchanged || get().status !== 'idle') {
          set({ raids: next, status: 'idle' })
        }
      } catch (err) {
        const status = (err as { status?: number }).status
        if (status === -1) set({ status: 'offline' })
        else throw err
      } finally {
        inflight = null
      }
    })()
    inflight = task
    return task
  },

  startPolling: () => {
    if (polling) return
    polling = true
    pollTimer = setTimeout(() => void pollTick(), POLL_FAST)
  },

  stopPolling: () => {
    polling = false
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  },

  fetchDungeons: async () => {
    if (get().dungeons.length > 0) return
    const dungeons = await request<DungeonInfo[]>('/api/game/dungeons')
    set({ dungeons })
  },

  createRaid: async (dungeonId, memberIds, consumables) => {
    await request('/api/raid', {
      method: 'POST',
      body: JSON.stringify({ dungeon_id: dungeonId, member_ids: memberIds, consumables }),
    })
    await get().load()
    // 进本会锁定成员，团队页面的锁定徽章需要同步刷新
    await useTeam.getState().load()
  },

  preview: (dungeonId, memberIds, consumables) =>
    request<RaidPreviewInfo>('/api/raid/preview', {
      method: 'POST',
      body: JSON.stringify({ dungeon_id: dungeonId, member_ids: memberIds, consumables }),
    }),

  tick: async (raidId) => {
    const data = await request<{ raid: RaidInfo }>(`/api/raid/${raidId}/tick`, {
      method: 'POST',
    })
    // 只更新对应实例，其余副本不受影响
    set((s) => ({
      raids: s.raids.map((r) => (r.id === data.raid.id ? data.raid : r)),
    }))
  },

  abandonRaid: async (raidId) => {
    await request(`/api/raid/${raidId}/abandon`, { method: 'POST' })
    await get().load()
    // 解锁同样影响成员状态
    await useTeam.getState().load()
  },
}))

// ---- 进度轮询：推进由后端任务驱动，前端定时拉取全量快照 ----
// 有进行中的副本走快节拍追进度，空闲走慢节拍保活
const POLL_FAST = 10_000
const POLL_SLOW = 30_000

let inflight: Promise<void> | null = null
let polling = false
let pollTimer: ReturnType<typeof setTimeout> | null = null

async function pollTick(): Promise<void> {
  if (!polling) return
  pollTimer = null
  try {
    await useRaid.getState().load()
  } catch (err) {
    // 后台轮询撞上登录失效（refresh 也过期）→ 直接登出；其余失败下一轮再试
    if (err instanceof ApiError && err.code === 40102) {
      useAuth.getState().logout()
      return
    }
  }
  if (!polling) return
  const interval = useRaid.getState().raids.some((r) => r.status === '进行中')
    ? POLL_FAST
    : POLL_SLOW
  pollTimer = setTimeout(() => void pollTick(), interval)
}
