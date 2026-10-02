import { create } from 'zustand'

import { request } from '../api/client'

export interface WarehouseItemInfo {
  item_id: number
  name: string
  desc: string
  quantity: number
  effect: { type: string; value: number; desc: string }[]
}

export interface CraftTierInfo {
  id: number
  name: string
  level_min: number
  level_max: number
  cost: { name: string; quantity: number }[]
}

export interface WarehouseEquipmentInfo {
  id: number
  text: string
  slot: string
  equip_type: string
  equip_level: number
  source: string
}

export interface AssignableMemberInfo {
  member_id: number
  name: string
  sect: string
  xinfa: string
  slot_level: number
}

export interface ConsumableCostInfo {
  item_id: number
  name: string
  quantity: number
  /** 当前团队库存（服务端随配方一并返回） */
  stock: number
}

export interface ConsumableRecipeInfo {
  id: number
  item_id: number
  name: string
  desc: string
  effect: { type: string; value: number; desc: string }[]
  wuxing_cost: number
  cost: ConsumableCostInfo[]
}

export interface ConsumableStockInfo {
  item_id: number
  name: string
  desc: string
  effect: { type: string; value: number; desc: string }[]
  /** 团队当前库存（含 0） */
  stock: number
}

export interface WarehouseInfo {
  materials: WarehouseItemInfo[]
  consumables: WarehouseItemInfo[]
  equipment: WarehouseEquipmentInfo[]
  craft_tiers: CraftTierInfo[]
  consumable_recipes: ConsumableRecipeInfo[]
}

type Status = 'loading' | 'idle' | 'offline'

// 单飞锁：并发 load 共享同一次请求
let loadPromise: Promise<void> | null = null

interface WarehouseState {
  status: Status
  data: WarehouseInfo | null
  /** 按类别查物品定义与库存（含 0 库存），供挑选/配置类界面 */
  consumableStock: ConsumableStockInfo[] | null
  /** 每次进入仓库页签时调用：拉取最新库存（已有数据时静默刷新） */
  load: () => Promise<void>
  fetchStock: (category: string) => Promise<void>
  /** 制作装备：扣材料/五行石，产出装备实例进仓库 */
  craftEquipment: (tierId: number, slot: string, equipType: string) => Promise<void>
  /** 制作消耗品：按配方扣材料，产出堆叠入仓库 */
  craftConsumable: (recipeId: number) => Promise<void>
  /** 手工分配仓库装备给成员 */
  assignEquipment: (itemId: number, memberId: number) => Promise<void>
  /** 分解仓库装备（五行石+1） */
  decomposeEquipment: (itemId: number) => Promise<void>
  /** 可分配该装备的成员名单（后端按属性/门派/部位装等算好） */
  fetchAssignable: (itemId: number) => Promise<AssignableMemberInfo[]>
}

export const useWarehouse = create<WarehouseState>((set, get) => ({
  status: 'loading',
  data: null,
  consumableStock: null,

  fetchStock: async (category) => {
    const list = await request<ConsumableStockInfo[]>(
      `/api/warehouse/items?category=${encodeURIComponent(category)}`,
    )
    set({ consumableStock: list })
  },

  load: async () => {
    // 已有数据时静默刷新（不闪加载态），但每次进入都要拉最新——
    // 副本掉落/制作/分配会随时改变库存
    if (get().data === null) set({ status: 'loading' })
    loadPromise ??= request<WarehouseInfo>('/api/warehouse')
      .then((data) => set({ data, status: 'idle' }))
      .catch((err) => {
        if (get().data === null) {
          const status = (err as { status?: number }).status
          if (status === -1) set({ status: 'offline' })
          else throw err
        } else {
          throw err
        }
      })
      .finally(() => {
        loadPromise = null
      })
    await loadPromise
  },

  craftEquipment: async (tierId, slot, equipType) => {
    await request('/api/warehouse/craft', {
      method: 'POST',
      body: JSON.stringify({ tier_id: tierId, slot, equip_type: equipType }),
    })
    await get().load()
  },

  craftConsumable: async (recipeId) => {
    await request('/api/warehouse/craft-consumable', {
      method: 'POST',
      body: JSON.stringify({ recipe_id: recipeId }),
    })
    await get().load()
  },

  assignEquipment: async (itemId, memberId) => {
    await request(`/api/warehouse/items/${itemId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ member_id: memberId }),
    })
    await get().load()
  },

  decomposeEquipment: async (itemId) => {
    await request(`/api/warehouse/items/${itemId}/decompose`, { method: 'POST' })
    await get().load()
  },

  fetchAssignable: (itemId) =>
    request<AssignableMemberInfo[]>(`/api/warehouse/items/${itemId}/assignable`),
}))
