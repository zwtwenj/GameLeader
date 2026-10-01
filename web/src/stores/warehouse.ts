import { create } from 'zustand'

import { request } from '../api/client'

export interface WarehouseItemInfo {
  item_id: number
  name: string
  desc: string
  quantity: number
  effect: { type: string; value: number; desc: string }[]
}

export interface WarehouseInfo {
  materials: WarehouseItemInfo[]
  consumables: WarehouseItemInfo[]
}

type Status = 'loading' | 'idle' | 'offline'

// 单飞锁：并发 load（如同时多处触发）共享同一次请求
let loadPromise: Promise<void> | null = null

interface WarehouseState {
  status: Status
  data: WarehouseInfo | null
  /** 每次进入仓库页签时调用：拉取最新库存（已有数据时静默刷新） */
  load: () => Promise<void>
}

export const useWarehouse = create<WarehouseState>((set, get) => ({
  status: 'loading',
  data: null,

  load: async () => {
    // 已有数据时静默刷新（不闪加载态），但每次进入都要拉最新——
    // 副本/消耗品使用会随时改变库存
    if (get().data === null) set({ status: 'loading' })
    loadPromise ??= request<WarehouseInfo>('/api/warehouse')
      .then((data) => set({ data, status: 'idle' }))
      .catch((err) => {
        const status = (err as { status?: number }).status
        if (get().data === null) {
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
}))
