"""游戏数据接口：门派/心法、副本/BOSS 等静态配置。"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .auth import get_current_user
from .db import get_db
from .models import Dungeon, Sect

router = APIRouter(prefix="/api/game", tags=["game"])


@router.get("/sects")
async def list_sects(
    _: object = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """门派与心法列表（建团选职业、招募展示用）。"""
    sects = (
        await db.execute(
            select(Sect).options(selectinload(Sect.xinfas)).order_by(Sect.id)
        )
    ).scalars().all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "xinfas": [
                {
                    "id": x.id,
                    "name": x.name,
                    "role": x.role,
                    "equip_type": x.equip_type,
                }
                for x in s.xinfas
            ],
        }
        for s in sects
    ]


@router.get("/dungeons")
async def list_dungeons(
    _: object = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """副本与 BOSS 列表（选本开荒用）。"""
    dungeons = (
        await db.execute(
            select(Dungeon).options(selectinload(Dungeon.bosses)).order_by(Dungeon.id)
        )
    ).scalars().all()
    return [
        {
            "id": d.id,
            "name": f"{d.size}人{d.name}",
            "size": d.size,
            "balance_k": d.balance_k,
            "bosses": [
                {
                    "seq": b.seq,
                    "name": b.name,
                    "gear_req": b.gear_req,
                    "drop_low": b.drop_low,
                    "drop_high": b.drop_high,
                }
                for b in sorted(d.bosses, key=lambda x: x.seq)
            ],
        }
        for d in dungeons
    ]
