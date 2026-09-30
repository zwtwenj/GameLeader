"""游戏数据接口：门派/心法等静态配置。"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .auth import get_current_user
from .db import get_db
from .models import Sect

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
