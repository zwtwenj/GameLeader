import { useState } from 'react'

import { ApiError } from '../api/client'
import { useWarehouse } from '../stores/warehouse'
import type { ConsumableRecipeInfo } from '../stores/warehouse'
import { useTeam } from '../stores/team'

const SLOTS = [
  '帽子',
  '上衣',
  '腰带',
  '护腕',
  '下装',
  '鞋子',
  '项链',
  '腰坠',
  '戒指',
  '远程武器',
  '武器',
]
const TYPES = ['外功', '内功', '体质', '治疗']

function Chip({
  label,
  sub,
  active,
  disabled,
  onClick,
}: {
  label: string
  sub?: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        'rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ' +
        (active
          ? 'bg-neutral-900 text-white'
          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200')
      }
    >
      {label}
      {sub && <span className="ml-1 text-xs opacity-70">{sub}</span>}
    </button>
  )
}

/** 制作弹框：tab 装备（默认，等级段×部位×属性任选）/ 消耗品。 */
export default function CraftModal({ onClose }: { onClose: () => void }) {
  const { data, craftEquipment } = useWarehouse()
  const sects = useTeam((s) => s.sects)
  const [catTab, setCatTab] = useState<'equipment' | 'consumable'>('equipment')
  const [tierId, setTierId] = useState<number | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const [equipType, setEquipType] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const tiers = data?.craft_tiers ?? []
  const tier = tiers.find((t) => t.id === tierId) ?? null
  const isWeapon = slot === '武器'

  const canCraft =
    tier !== null && slot !== null && equipType !== null

  async function handleCraft() {
    if (loading || tierId === null || !canCraft) return
    setError('')
    setLoading(true)
    try {
      const type = isWeapon ? equipType! : equipType!
      await craftEquipment(tierId, slot!, type)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex w-fit gap-1 rounded-lg bg-neutral-100 p-1">
            <button
              className={
                'rounded-md px-4 py-1 text-sm font-medium ' +
                (catTab === 'equipment'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-200')
              }
              onClick={() => setCatTab('equipment')}
            >
              装备
            </button>
            <button
              className={
                'rounded-md px-4 py-1 text-sm font-medium ' +
                (catTab === 'consumable'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-200')
              }
              onClick={() => setCatTab('consumable')}
            >
              消耗品
            </button>
          </div>
          <button className="text-sm text-neutral-400 hover:text-neutral-900" onClick={onClose}>
            关闭
          </button>
        </div>

        {catTab === 'equipment' && (
          <>
            <p className="mb-2 text-xs font-medium text-neutral-400">装备等级段</p>
            <div className="mb-4 flex gap-2">
              {tiers.map((t) => (
                <Chip
                  key={t.id}
                  label={t.name}
                  active={tierId === t.id}
                  onClick={() => setTierId(t.id)}
                />
              ))}
              {tiers.length === 0 && (
                <p className="text-sm text-neutral-400">暂无制作档位</p>
              )}
            </div>

            <p className="mb-2 text-xs font-medium text-neutral-400">部位</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {SLOTS.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={slot === s}
                  onClick={() => {
                    setSlot(s)
                    setEquipType(null)
                  }}
                />
              ))}
            </div>

            {slot !== null && !isWeapon && (
              <>
                <p className="mb-2 text-xs font-medium text-neutral-400">属性类型</p>
                <div className="mb-4 flex gap-2">
                  {TYPES.map((t) => (
                    <Chip
                      key={t}
                      label={t}
                      active={equipType === t}
                      onClick={() => setEquipType(t)}
                    />
                  ))}
                </div>
              </>
            )}

            {slot !== null && isWeapon && (
              <>
                <p className="mb-2 text-xs font-medium text-neutral-400">门派（武器专属）</p>
                <div className="mb-4 flex flex-wrap gap-2">
                  {sects.map((s) => (
                    <Chip
                      key={s.id}
                      label={s.name}
                      active={equipType === s.name}
                      onClick={() => setEquipType(s.name)}
                    />
                  ))}
                </div>
              </>
            )}

            {tier && (
              <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
                <p className="text-neutral-600">
                  消耗：五行石×{tier.cost.find((c) => c.name === '五行石')?.quantity ?? 0}
                  ，猫眼石×{tier.cost.find((c) => c.name === '猫眼石')?.quantity ?? 0}
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  产出：{tier.level_min}~{tier.level_max} 装等的{slot}（装等区间内随机）
                </p>
              </div>
            )}
          </>
        )}

        {catTab === 'consumable' && (
          <div className="space-y-3">
            {(data?.consumable_recipes ?? []).length === 0 ? (
              <p className="rounded-lg bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-400">
                暂无消耗品配方
              </p>
            ) : (
              data!.consumable_recipes.map((rc) => (
                <ConsumableRecipeCard key={rc.id} recipe={rc} onSuccess={onClose} onError={setError} />
              ))
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {catTab === 'equipment' && (
          <div className="mt-5 flex justify-end">
            <button
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={() => void handleCraft()}
              disabled={loading || tierId === null}
            >
              {loading ? '制作中…' : '确认制作'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 消耗品配方卡：展示产物/效果/消耗（含当前库存 have/need），每卡独立制作。
 * 库存数据来自服务端随配方返回，制作成功后整单刷新，卡片数字实时更新。 */
function ConsumableRecipeCard({
  recipe,
  onSuccess,
  onError,
}: {
  recipe: ConsumableRecipeInfo
  onSuccess: () => void
  onError: (msg: string) => void
}) {
  const { craftConsumable } = useWarehouse()
  const [busy, setBusy] = useState(false)
  const enough = recipe.cost.every((c) => c.stock >= c.quantity)

  async function handleCraft() {
    if (busy) return
    setBusy(true)
    try {
      await craftConsumable(recipe.id)
      onSuccess()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '出了点问题，请重试')
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {recipe.name}
            <span className="ml-1.5 text-xs font-normal text-neutral-400">每次制作 ×1</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">{recipe.desc}</p>
          {recipe.effect.map((e) => (
            <p key={e.type} className="mt-0.5 text-xs text-violet-600">
              ◆ {e.desc}
            </p>
          ))}
          <p className="mt-1.5 text-xs text-neutral-600">
            消耗：
            {recipe.cost.map((c, i) => (
              <span key={c.item_id} className={c.stock >= c.quantity ? '' : 'text-red-500'}>
                {i > 0 && '，'}
                {c.name} {c.stock}/{c.quantity}
              </span>
            ))}
            {recipe.wuxing_cost > 0 && <span>，五行石 {recipe.wuxing_cost}</span>}
          </p>
        </div>
        <button
          className="shrink-0 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void handleCraft()}
          disabled={busy || !enough}
        >
          {busy ? '制作中…' : '制作'}
        </button>
      </div>
    </div>
  )
}
