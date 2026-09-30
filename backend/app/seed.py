"""种子数据灌入：空表时写入门派/心法、副本/BOSS，幂等可重复执行。"""

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .data_dungeon import BOSSES, DUNGEON
from .data_xinfa import SEED
from .models import Boss, Dungeon, Sect, Xinfa

log = logging.getLogger(__name__)


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
    dungeon = Dungeon(**DUNGEON)
    db.add(dungeon)
    await db.flush()
    for seq, name, gear_req, drop_low, drop_high in BOSSES:
        db.add(
            Boss(
                dungeon_id=dungeon.id,
                seq=seq,
                name=name,
                gear_req=gear_req,
                drop_low=drop_low,
                drop_high=drop_high,
            )
        )
    await db.commit()
    log.info("副本/BOSS 种子数据已写入：%d 副本 %d BOSS", 1, len(BOSSES))
