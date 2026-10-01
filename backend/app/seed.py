"""种子数据灌入：空表时写入门派/心法、副本/BOSS、物品，幂等可重复执行。"""

import json
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .data_dungeon import BOSSES, DUNGEON, BOSS_LOOTS, timeline_json, loot_json
from .data_warehouse import CRAFT_TIERS, ITEMS
from .data_xinfa import SEED
from .models import Boss, CraftTier, Dungeon, Item, Sect, Xinfa

log = logging.getLogger(__name__)


async def seed_items(db: AsyncSession) -> None:
    """物品定义与制作档位：按名称/档位名幂等补种（可持续追加新条目）。"""
    count = (await db.scalar(select(func.count(Item.id)))) or 0
    if count == 0:
        for name, category, desc, effect in ITEMS:
            db.add(
                Item(
                    name=name,
                    category=category,
                    desc=desc,
                    effect=json.dumps(effect, ensure_ascii=False),
                )
            )
        await db.commit()
        log.info("物品种子数据已写入：%d 件", len(ITEMS))

    tier_count = (await db.scalar(select(func.count(CraftTier.id)))) or 0
    if tier_count == 0:
        for tier in CRAFT_TIERS:
            db.add(
                CraftTier(
                    name=tier["name"],
                    level_min=tier["level_min"],
                    level_max=tier["level_max"],
                    cost=json.dumps(tier["cost"], ensure_ascii=False),
                )
            )
        await db.commit()
        log.info("制作档位种子数据已写入：%d 档", len(CRAFT_TIERS))


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
    dungeon = Dungeon(**DUNGEON, loot=loot_json(DUNGEON_LOOT))
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
            loot=loot_json(BOSS_LOOTS.get(name, [])),
        )
        db.add(boss)
        await db.flush()
        boss_ids.append(boss.id)
    dungeon.timeline = timeline_json(boss_ids)
    await db.commit()
    log.info("副本/BOSS 种子数据已写入：%d 副本 %d BOSS %d 节点", 1, len(BOSSES), len(boss_ids) * 3)
