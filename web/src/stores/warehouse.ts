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

interface WarehouseState {
  status: Status
  data: WarehouseInfo | null
  load: () => Promise<void>
}

export const useWarehouse = create<WarehouseState>((set, get) => ({
  status: 'loading',
  data: null,

  load: async () => {
    if (get().data !== null) return // 静默刷新：已有数据不闪加载态
    set({ status: 'loading' })
    try {
      const data = await request<WarehouseInfo>('/api/warehouse')
      set({ data, status: 'idle' })
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === -1) set({ status: 'offline' })
      else throw err
    }
  },
}))
