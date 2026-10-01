import { useWarehouse } from '../stores/warehouse'

/** 仓库页：材料 / 消耗品（装备区占位，合成与获取途径后续接入）。 */
export default function WarehouseView() {
  const warehouse = useWarehouse()

  if (warehouse.status === 'loading') {
    return <p className="py-24 text-center text-sm text-neutral-400">加载仓库…</p>
  }
  if (warehouse.status === 'offline') {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-neutral-600">仓库暂不可用</p>
        <button
          className="mt-3 rounded bg-neutral-800 px-4 py-1.5 text-sm text-white hover:bg-neutral-700"
          onClick={() => void warehouse.load()}
        >
          重试
        </button>
      </div>
    )
  }

  const data = warehouse.data ?? { materials: [], consumables: [] }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section title="材料" count={data.materials.length}>
          {data.materials.map((m) => (
            <ItemRow key={m.item_id} name={m.name} desc={m.desc} quantity={m.quantity} />
          ))}
        </Section>

        <Section title="消耗品" count={data.consumables.length}>
          {data.consumables.map((c) => (
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
          ))}
        </Section>

        <Section title="装备" count={0}>
          <p className="pt-8 text-center text-xs text-neutral-300">
            装备制作与入库功能开发中
          </p>
        </Section>
      </div>
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
        {count > 0 && <span className="ml-2 text-xs text-neutral-400">{count} 种</span>}
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
