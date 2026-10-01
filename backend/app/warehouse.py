"""团队仓库：材料/消耗品库存、装备制作（档位任选）、手工分配与分解。

库存走统一堆叠表 team_item（材料/消耗品/五行石），装备走实例表
equipment_item：副本掉落直接分配/分解；合成产出 status='仓库中'，
由玩家在仓库页手工分配（属性重合且部位更高才可穿）或分解为五行石。"""

import json
import random

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .db import get_db
from .errors import ApiError
from .models import (
    SLOT_TO_COLUMN,
    CraftTier,
    EquipmentItem,
    Item,
    Member,
    Sect,
    TeamItem,
    Xinfa,
)
from .team import get_my_team

router = APIRouter(prefix="/api/warehouse", tags=["warehouse"])

CRAFTABLE_SLOTS = [
    "帽子",
    "上衣",
    "腰带",
    "护腕",
    "下装",
    "鞋子",
    "项链",
    "腰坠",
    "戒指",
    "远程武器",
]
EQUIP_TYPES = ["外功", "内功", "体质", "治疗"]


async def get_stock(
    db: AsyncSession, team_id: int, item_name: str
) -> tuple[TeamItem | None, Item]:
    """取团队某物品的库存行与定义（无库存行时仍返回定义，数量按 0 处理）。"""
    item = (await db.execute(select(Item).where(Item.name == item_name))).scalar_one()
    tm = (
        await db.execute(
            select(TeamItem).where(
                TeamItem.team_id == team_id, TeamItem.item_id == item.id
            )
        )
    ).scalar_one_or_none()
    return tm, item


def item_desc(item: EquipmentItem) -> str:
    if item.slot == "武器":
        return f"{item.equip_level}{item.equip_type}武器"
    return f"{item.equip_level}装等{item.equip_type}{item.slot}"


@router.get("")
async def warehouse_overview(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """仓库总览：材料/消耗品库存 + 装备（仓库中）+ 制作档位及其消耗。"""
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

    equipment = (
        await db.execute(
            select(EquipmentItem)
            .where(
                EquipmentItem.team_id == team.id,
                EquipmentItem.status == "仓库中",
            )
            .order_by(EquipmentItem.id)
        )
    ).scalars().all()

    tiers = (
        await db.execute(select(CraftTier).order_by(CraftTier.level_min))
    ).scalars().all()

    return {
        "materials": grouped["材料"],
        "consumables": grouped["消耗品"],
        "equipment": [
            {
                "id": it.id,
                "text": item_desc(it),
                "slot": it.slot,
                "equip_type": it.equip_type,
                "equip_level": it.equip_level,
                "source": it.source,
            }
            for it in equipment
        ],
        "craft_tiers": [
            {
                "id": t.id,
                "name": t.name,
                "level_min": t.level_min,
                "level_max": t.level_max,
                "cost": json.loads(t.cost or "[]"),
            }
            for t in tiers
        ],
    }


class CraftIn(BaseModel):
    tier_id: int
    slot: str = Field(max_length=8)
    equip_type: str = Field(max_length=8)  # 属性类型；武器制作为门派名


@router.post("/craft", status_code=201)
async def craft_equipment(
    body: CraftIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """制作装备：任选 等级段×部位×属性类型，按档位统一消耗扣料，
    产出装等在档位区间内随机的装备实例（进仓库待分配）。"""
    team = await get_my_team(db, user.id)
    if team is None:
        raise ApiError(404, 40400, "还没有团队")
    if body.slot == "武器":
        # 武器制作：equip_type 为门派名（武器按门派专属）
        sect = (
            await db.execute(select(Sect).where(Sect.name == body.equip_type))
        ).scalar_one_or_none()
        if sect is None:
            raise ApiError(422, 42200, "门派无效")
    elif body.equip_type not in EQUIP_TYPES:
        raise ApiError(422, 42200, "属性类型无效")

    tier = await db.get(CraftTier, body.tier_id)
    if tier is None:
        raise ApiError(422, 42200, "制作档位不存在")
    cost = json.loads(tier.cost or "[]")

    # 校验并扣减材料（含五行石——已归类为材料，走统一库存）
    stocks: dict[str, tuple[TeamItem | None, Item]] = {}
    for entry in cost:
        tm, item = await get_stock(db, team.id, entry["name"])
        have = tm.quantity if tm else 0
        if have < entry["quantity"]:
            raise ApiError(
                409,
                40900,
                f"「{entry['name']}」数量不足（{have}/{entry['quantity']}）",
            )
        stocks[entry["name"]] = (tm, item)
    for entry in cost:
        tm, _ = stocks[entry["name"]]
        tm.quantity -= entry["quantity"]

    item = EquipmentItem(
        team_id=team.id,
        raid_id=None,  # 合成获得，无副本来源
        slot=body.slot,
        equip_type=body.equip_type,
        equip_level=random.randint(tier.level_min, tier.level_max),
        status="仓库中",
        source="合成",
        boss_name="",
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    return {
        "id": item.id,
        "text": f"制作成功：{item_desc(item)}（已放入仓库）",
        "level": item.equip_level,
    }


class AssignIn(BaseModel):
    member_id: int


@router.post("/items/{item_id}/assign")
async def assign_warehouse_item(
    item_id: int,
    body: AssignIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """仓库装备手工分配：属性类型需与成员当前属性重合（武器按门派），
    且目标部位装等更高；副本中的成员暂不可分配（保持进本快照一致）。"""
    team = await get_my_team(db, user.id)
    if team is None:
        raise ApiError(404, 40400, "还没有团队")
    try:
        item = (
            await db.execute(
                select(EquipmentItem)
                .where(EquipmentItem.id == item_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if item is None or item.team_id != team.id:
            raise ApiError(404, 40400, "装备不存在")
        if item.status != "仓库中":
            raise ApiError(409, 40900, "该装备已分配")
        member = (
            await db.execute(
                select(Member)
                .where(Member.id == body.member_id, Member.deleted_at.is_(None))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if member is None or member.team_id != team.id:
            raise ApiError(404, 40400, "成员不存在")
        if member.in_raid_id is not None:
            raise ApiError(409, 40900, "成员在副本中，无法分配装备")

        xinfa = await db.get(Xinfa, member.xinfa_id)
        if item.slot == "武器":
            sect_name = (await db.get(Sect, xinfa.sect_id)).name
            if item.equip_type != sect_name:
                raise ApiError(409, 40900, f"该武器为{item.equip_type}门派专属")
        elif item.equip_type != xinfa.equip_type:
            raise ApiError(
                409,
                40900,
                f"成员当前为{xinfa.equip_type}装备，与这件{item.equip_type}装备不符",
            )

        col = "weapon" if item.slot == "武器" else SLOT_TO_COLUMN.get(item.slot)
        if col is None:
            raise ApiError(422, 42200, "未知的装备槽位")
        if getattr(member, f"{col}_level") >= item.equip_level:
            raise ApiError(409, 40900, "成员该部位当前装等不低于这件装备")

        setattr(member, f"{col}_level", item.equip_level)
        member.sync_equip_level()
        item.status = "已分配"
        item.owner_member_id = member.id
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    return {"ok": True, "equip_level": member.equip_level}


@router.post("/items/{item_id}/decompose")
async def decompose_warehouse_item(
    item_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """分解仓库装备：获得五行石×1（入团队材料库存）。"""
    team = await get_my_team(db, user.id)
    if team is None:
        raise ApiError(404, 40400, "还没有团队")
    try:
        item = (
            await db.execute(
                select(EquipmentItem)
                .where(EquipmentItem.id == item_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if item is None or item.team_id != team.id:
            raise ApiError(404, 40400, "装备不存在")
        if item.status != "仓库中":
            raise ApiError(409, 40900, "该装备已分配")

        item.status = "已分解"
        tm, wuxing_item = await get_stock(db, team.id, "五行石")
        if tm is None:
            tm = TeamItem(team_id=team.id, item_id=wuxing_item.id, quantity=0)
            db.add(tm)
            await db.flush()
        tm.quantity += 1
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    return {"ok": True, "wuxing_stone": tm.quantity}
