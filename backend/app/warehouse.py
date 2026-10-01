"""团队仓库：材料/消耗品的库存查询（P1 只做渲染数据源；获取途径与使用后续接入）。

库存走统一堆叠表 team_item，物品定义在 item；装备类走 equipment_item（未接入）。
"""

import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .db import get_db
from .errors import ApiError
from .models import Item, TeamItem
from .team import get_my_team

router = APIRouter(prefix="/api/warehouse", tags=["warehouse"])


@router.get("")
async def warehouse_overview(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """仓库总览：按类别返回材料/消耗品库存（含物品定义与消耗品效果）。"""
    team = await get_my_team(db, user.id)
    if team is None:
        raise ApiError(404, 40400, "还没有团队")

    rows = (
        await db.execute(
            select(TeamItem, Item)
            .join(Item, TeamItem.item_id == Item.id)
            .where(TeamItem.team_id == team.id, TeamItem.quantity > 0)
            .order_by(Item.category, Item.id)
        )
    ).all()

    grouped: dict[str, list] = {"材料": [], "消耗品": []}
    for tm, item in rows:
        grouped.setdefault(item.category, []).append(
            {
                "item_id": item.id,
                "name": item.name,
                "desc": item.desc,
                "quantity": tm.quantity,
                "effect": json.loads(item.effect or "[]"),
            }
        )

    return {
        "materials": grouped["材料"],
        "consumables": grouped["消耗品"],
    }
