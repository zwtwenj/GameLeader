"""种子数据灌入：空表时写入门派/心法、副本/BOSS、物品与制作档位，幂等可重复执行。

data_* 文件里的引用材料用名称书写（策划可读），灌库时统一解析为 item_id——
掉落表/配方的存储是 ID 引用（策划工具里通过筛选选取，存 id 而非文字）。"""

import json
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .data_dungeon import BOSSES, DUNGEON, DUNGEON_LOOT, BOSS_LOOTS, timeline_json, loot_json
from .data_warehouse import CONSUMABLE_RECIPES, CRAFT_TIERS, EVENT_TEXTS, ITEMS
from .data_xinfa import SEED
from .models import (
    Boss,
    ConsumableRecipe,
    CraftTier,
    Dungeon,
    Item,
    RaidEventText,
    Sect,
    Xinfa,
)

log = logging.getLogger(__name__)


async def seed_items(db: AsyncSession) -> None:
    """物品定义 + 制作档位 + 消耗品配方。

    物品与配方逐条幂等（库里缺哪条补哪条，已有的不覆盖）；配方/档位
    消耗按名称书写，灌库时解析为 item_id（与掉落表同约定）。"""
    existing = set((await db.execute(select(Item.name))).scalars().all())
    added = [
        Item(
            name=name,
            category=category,
            desc=desc,
            effect=json.dumps(effect, ensure_ascii=False),
        )
        for name, category, desc, effect in ITEMS
        if name not in existing
    ]
    if added:
        db.add_all(added)
        await db.commit()
        log.info("物品种子数据新增：%d 件", len(added))

    name_to_id = dict((await db.execute(select(Item.name, Item.id))).all())

    tier_count = (await db.scalar(select(func.count(CraftTier.id)))) or 0
    if tier_count == 0:
        for tier in CRAFT_TIERS:
            cost = [
                {"item_id": name_to_id[e["name"]], "quantity": e["quantity"]}
                for e in tier["cost"]
            ]
            db.add(
                CraftTier(
                    name=tier["name"],
                    level_min=tier["level_min"],
                    level_max=tier["level_max"],
                    cost=json.dumps(cost, ensure_ascii=False),
                )
            )
        await db.commit()
        log.info("制作档位种子数据已写入：%d 档", len(CRAFT_TIERS))

    recipe_items = set(
        (await db.execute(select(ConsumableRecipe.item_id))).scalars().all()
    )
    added_recipes = []
    for rc in CONSUMABLE_RECIPES:
        item_id = name_to_id.get(rc["item"])
        if item_id is None or item_id in recipe_items:
            continue
        cost = [
            {"item_id": name_to_id[e["name"]], "quantity": e["quantity"]}
            for e in rc["cost"]
        ]
        added_recipes.append(
            ConsumableRecipe(
                item_id=item_id,
                cost=json.dumps(cost, ensure_ascii=False),
                wuxing_cost=rc["wuxing_cost"],
            )
        )
    if added_recipes:
        db.add_all(added_recipes)
        await db.commit()
        log.info("消耗品配方种子数据新增：%d 条", len(added_recipes))


async def seed_event_texts(db: AsyncSession) -> None:
    count = (await db.scalar(select(func.count(RaidEventText.id)))) or 0
    if count > 0:
        return
    for event, text in EVENT_TEXTS.items():
        db.add(RaidEventText(event=event, text=text))
    await db.commit()
    log.info("事件文案种子数据已写入：%d 条", len(EVENT_TEXTS))


async def seed_xinfa(db: AsyncSession) -> None:
    count = (await db.scalar(select(func.count(Xinfa.id)))) or 0
    if count > 0:
        return
    for sect_name, xinfas in SEED:
        sect = Sect(name=sect_name)
        db.add(sect)
        await db.flush()  # 拿 sect.id
        for xinfa_name, role, equip_type in xinfas:
            db.add(
                Xinfa(
                    sect_id=sect.id,
                    name=xinfa_name,
                    role=role,
                    equip_type=equip_type,
                )
            )
    await db.commit()
    log.info("门派/心法种子数据已写入：%d 门派 %d 心法", len(SEED), len(SEED) and sum(len(x) for _, x in SEED))


async def seed_dungeon(db: AsyncSession) -> None:
    count = (await db.scalar(select(func.count(Boss.id)))) or 0
    if count > 0:
        return
    name_to_id = dict((await db.execute(select(Item.name, Item.id))).all())

    def material_loot(entries: list[dict]) -> list[dict]:
        return [
            {
                "item_id": name_to_id[e["name"]],
                "min": e["min"],
                "max": e["max"],
                "chance": e["chance"],
            }
            for e in entries
        ]

    dungeon = Dungeon(**DUNGEON, loot=loot_json(material_loot(DUNGEON_LOOT)))
    db.add(dungeon)
    await db.flush()
    boss_ids = []
    for seq, name, gear_req, drop_low, drop_high in BOSSES:
        boss = Boss(
            dungeon_id=dungeon.id,
            seq=seq,
            name=name,
            gear_req=gear_req,
            drop_low=drop_low,
            drop_high=drop_high,
            loot=loot_json(material_loot(BOSS_LOOTS.get(name, []))),
        )
        db.add(boss)
        await db.flush()
        boss_ids.append(boss.id)
    dungeon.timeline = timeline_json(boss_ids)
    await db.commit()
    log.info("副本/BOSS 种子数据已写入：%d 副本 %d BOSS %d 节点", 1, len(BOSSES), len(boss_ids) * 3)
