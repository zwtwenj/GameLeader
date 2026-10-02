import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import type {
  AssignableMemberInfo,
  WarehouseEquipmentInfo,
} from '../stores/warehouse'
import { useWarehouse } from '../stores/warehouse'
import CraftModal from './CraftModal'

/** 仓库页：材料 / 消耗品 / 装备（仓库中，可分配/分解）+ 制作入口。
 * 数据由 init 装载、进入页签时刷新，本组件纯读 + 触发 store action。 */
export default function WarehouseView() {
  const status = useWarehouse((s) => s.status)
  const data = useWarehouse((s) => s.data)
  const load = useWarehouse((s) => s.load)

  const [showCraft, setShowCraft] = useState(false)
  const [error, setError] = useState('')

  // 进入页签刷新库存
  useEffect(() => {
    load().catch(() => {})
  }, [load])

  if (status === 'loading') {
    return <p className="py-24 text-center text-sm text-neutral-400">加载仓库…</p>
  }
  if (status === 'offline') {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-neutral-600">仓库暂不可用</p>
        <button
          className="mt-3 rounded bg-neutral-800 px-4 py-1.5 text-sm text-white hover:bg-neutral-700"
          onClick={() => load().catch(() => {})}
        >
          重试
        </button>
      </div>
    )
  }

  const d = data ?? {
    materials: [],
    consumables: [],
    equipment: [],
    craft_tiers: [],
    consumable_recipes: [],
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section title="材料" count={d.materials.length}>
          {d.materials.length === 0 ? (
            <EmptyHint />
          ) : (
            d.materials.map((m) => (
              <ItemRow key={m.item_id} name={m.name} desc={m.desc} quantity={m.quantity} />
            ))
          )}
        </Section>

        <Section title="消耗品" count={d.consumables.length}>
          {d.consumables.length === 0 ? (
            <EmptyHint />
          ) : (
            d.consumables.map((c) => (
              <div
                key={c.item_id}
                className="flex items-start justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-neutral-200"
              >
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{c.desc}</p>
                  {c.effect.map((e) => (
                    <p key={e.type} className="mt-0.5 text-xs text-violet-600">
                      ◆ {e.desc}
                    </p>
                  ))}
                </div>
                <span className="text-sm font-medium">×{c.quantity}</span>
              </div>
            ))
          )}
        </Section>

        <Section title="装备" count={d.equipment.length}>
          {d.equipment.length === 0 ? (
            <EmptyHint text="制作装备后会出现在这里" />
          ) : (
            <div className="space-y-2">
              {d.equipment.map((e) => (
                <WarehouseEquipmentRow key={e.id} item={e} onError={setError} />
              ))}
            </div>
          )}
        </Section>
      </div>

      {showCraft && <CraftModal onClose={() => setShowCraft(false)} />}

      <button
        className="fixed bottom-8 right-8 z-30 rounded-full bg-neutral-900 px-6 py-3 text-sm font-medium text-white shadow-lg hover:bg-neutral-800"
        onClick={() => setShowCraft(true)}
      >
        制作
      </button>
    </div>
  )
}

/** 仓库装备行：展开分配时向后端拉可分配名单（属性/门派/部位装等规则在后端
 * 统一判定），选择成员后确认；也可分解为五行石。 */
function WarehouseEquipmentRow({
  item,
  onError,
}: {
  item: WarehouseEquipmentInfo
  onError: (msg: string) => void
}) {
  const { assignEquipment, decomposeEquipment, fetchAssignable } = useWarehouse()
  const [assigning, setAssigning] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [candidates, setCandidates] = useState<AssignableMemberInfo[] | null>(null)
  const [memberChoice, setMemberChoice] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAssign() {
    if (busy || memberChoice === null) return
    setBusy(true)
    try {
      await assignEquipment(item.id, memberChoice)
      setAssigning(false)
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      setAssigning(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleDecompose() {
    if (busy) return
    setBusy(true)
    try {
      await decomposeEquipment(item.id)
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '出了点问题，请重试')
    } finally {
      setBusy(false)
    }
  }

  // 展开分配时向后端拉可分配名单
  async function toggleAssign() {
    if (assigning) {
      setAssigning(false)
      return
    }
    setAssigning(true)
    setCandidates(null)
    setLoadingList(true)
    try {
      setCandidates(await fetchAssignable(item.id))
    } catch {
      setCandidates([])
    } finally {
      setLoadingList(false)
    }
  }

  return (
    <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-neutral-200">
      <p className="text-sm font-medium">{item.text}</p>
      <div className="mt-1.5 flex gap-2">
        <button
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
          onClick={() => void toggleAssign()}
          disabled={busy}
        >
          分配
        </button>
        <button
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
          onClick={handleDecompose}
          disabled={busy}
        >
          分解
        </button>
      </div>
      {assigning && (
        <div className="mt-2 flex items-center gap-2">
          <select
            className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
            value={memberChoice ?? ''}
            onChange={(e) => setMemberChoice(Number(e.target.value) || null)}
          >
            {loadingList ? (
              <option value="">加载成员…</option>
            ) : (candidates?.length ?? 0) === 0 ? (
              <option value="">没有可分配的成员</option>
            ) : (
              <>
                <option value="">选择成员</option>
                {candidates!.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.name}（{m.sect}·{m.xinfa}，该部位 {m.slot_level}）
                  </option>
                ))}
              </>
            )}
          </select>
          <button
            className="rounded bg-neutral-900 px-2.5 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
            onClick={handleAssign}
            disabled={busy || memberChoice === null || loadingList}
          >
            确认
          </button>
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-neutral-100/60 p-4">
      <p className="mb-3 border-b border-neutral-200/70 pb-2 text-sm font-medium text-neutral-500">
        {title}
        {count > 0 && <span className="ml-2 text-xs text-neutral-400">{count} 件</span>}
      </p>
      <div className="space-y-2">
        {count === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-300">暂无物品</p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function EmptyHint({ text = '暂无' }: { text?: string }) {
  return <p className="pt-8 text-center text-xs text-neutral-300">{text}</p>
}

function ItemRow({
  name,
  desc,
  quantity,
}: {
  name: string
  desc: string
  quantity: number
}) {
  return (
    <div className="flex items-start justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-neutral-200">
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{desc}</p>
      </div>
      <span className="text-sm font-medium">×{quantity}</span>
    </div>
  )
}
