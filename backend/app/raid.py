"""副本实例路由：开团（进本）、解散、查询当前实例。

副本实例记录成员/进度/状态/掉落（equipment_item 表，暂无写入逻辑——
击杀与掉落判定规则待定），解散实例会解锁全部进本成员。
"""

import random
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .db import get_db
from .errors import ApiError
from .models import (
    Boss,
    Dungeon,
    EquipmentItem,
    Member,
    Raid,
    RaidMember,
    Sect,
    Team,
    User,
    Xinfa,
)

router = APIRouter(prefix="/api/raid", tags=["raid"])


class RaidCreateIn(BaseModel):
    dungeon_id: int
    member_ids: list[int] = Field(min_length=1, max_length=25)


def item_desc(item: EquipmentItem) -> str:
    return f"{item.equip_level}装等{item.equip_type}{item.slot}"


async def raid_payload(db: AsyncSession, raid: Raid) -> dict:
    dungeon = await db.get(Dungeon, raid.dungeon_id)
    bosses = (
        await db.execute(
            select(Boss)
            .where(Boss.dungeon_id == raid.dungeon_id)
            .order_by(Boss.seq)
        )
    ).scalars().all()

    rows = (
        await db.execute(
            select(RaidMember, Xinfa, Sect)
            .join(Xinfa, RaidMember.xinfa_id == Xinfa.id)
            .join(Sect, Xinfa.sect_id == Sect.id)
            .where(RaidMember.raid_id == raid.id)
            .order_by(RaidMember.id)
        )
    ).all()
    drops = (
        await db.execute(
            select(EquipmentItem).where(EquipmentItem.raid_id == raid.id)
        )
    ).scalars().all()

    current_boss = None
    if raid.status == "进行中":
        boss = next((b for b in bosses if b.seq == raid.current_seq), None)
        if boss is not None:
            current_boss = {
                "seq": boss.seq,
                "name": boss.name,
                "gear_req": boss.gear_req,
                "drop_low": boss.drop_low,
                "drop_high": boss.drop_high,
            }

    return {
        "id": raid.id,
        "status": raid.status,
        "dungeon": {"id": dungeon.id, "name": f"{dungeon.size}人{dungeon.name}", "size": dungeon.size},
        "progress": {"killed": raid.current_seq - 1, "total": len(bosses)},
        "current_boss": current_boss,
        "members": [
            {
                "member_id": rm.member_id,
                "name": rm.name,
                "sect": s.name,
                "xinfa": x.name,
                "role": x.role,
                "equip_level": rm.equip_level,
            }
            for rm, x, s in rows
        ],
        "drops": [
            {"id": it.id, "desc": item_desc(it), "slot": it.slot,
             "equip_type": it.equip_type, "equip_level": it.equip_level}
            for it in drops
        ],
    }


@router.get("/current")
async def current_raid(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """我团队的最近一个副本实例（进行中或最近结束的），无则 {raid: null}。"""
    team = (
        await db.execute(select(Team).where(Team.user_id == user.id, Team.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if team is None:
        return {"raid": None}
    raid = (
        await db.execute(
            select(Raid)
            .where(Raid.team_id == team.id)
            .order_by(Raid.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if raid is None:
        return {"raid": None}
    return {"raid": await raid_payload(db, raid)}


@router.post("", status_code=201)
async def create_raid(
    body: RaidCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """开团进本：创建副本实例 + 成员快照 + 锁定成员（单事务）。"""
    team = (
        await db.execute(select(Team).where(Team.user_id == user.id, Team.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if team is None:
        raise ApiError(404, 40400, "还没有团队")

    ongoing = (
        await db.execute(
            select(Raid).where(Raid.team_id == team.id, Raid.status == "进行中")
        )
    ).scalar_one_or_none()
    if ongoing is not None:
        raise ApiError(409, 40900, "已有进行中的副本，先打完或等它结束")

    dungeon = await db.get(Dungeon, body.dungeon_id)
    if dungeon is None or dungeon.deleted_at is not None:
        raise ApiError(422, 42200, "副本不存在")

    member_ids = list(dict.fromkeys(body.member_ids))  # 去重保序
    if len(member_ids) != len(body.member_ids):
        raise ApiError(422, 42200, "成员不能重复")
    if len(member_ids) != dungeon.size:
        raise ApiError(422, 42200, f"{dungeon.size}人副本需要正好选择 {dungeon.size} 名成员")

    try:
        members = (
            await db.execute(
                select(Member).where(
                    Member.id.in_(member_ids),
                    Member.team_id == team.id,
                    Member.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        if len(members) != len(member_ids):
            raise ApiError(422, 42200, "有成员不存在或不属于你的团队")
        locked = [m.name for m in members if m.in_raid_id is not None]
        if locked:
            raise ApiError(409, 40900, f"成员 {'、'.join(locked)} 已在副本中")

        raid = Raid(team_id=team.id, dungeon_id=dungeon.id)
        db.add(raid)
        await db.flush()

        for m in members:
            db.add(
                RaidMember(
                    raid_id=raid.id,
                    member_id=m.id,
                    name=m.name,
                    xinfa_id=m.xinfa_id,
                    equip_level=m.equip_level,
                )
            )
            m.in_raid_id = raid.id  # 锁定
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, 40900, "开团冲突，请重试")
    except BaseException:
        await db.rollback()  # 实例、快照、锁定同生共死
        raise

    return {"raid": await raid_payload(db, raid)}


@router.post("/{raid_id}/abandon")
async def abandon_raid(
    raid_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """解散副本实例：状态置为已解散并解锁全部进本成员。
    击杀与掉落判定规则待定，先提供退出通道防止成员永久锁定。"""
    team = (
        await db.execute(select(Team).where(Team.user_id == user.id, Team.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if team is None:
        raise ApiError(404, 40400, "还没有团队")
    try:
        raid = (
            await db.execute(select(Raid).where(Raid.id == raid_id).with_for_update())
        ).scalar_one_or_none()
        if raid is None or raid.team_id != team.id:
            raise ApiError(404, 40400, "副本实例不存在")
        if raid.status != "进行中":
            raise ApiError(409, 40900, "该副本已结束")

        raid.status = "已解散"
        raid.finished_at = datetime.now()
        members = (
            await db.execute(
                select(Member).where(Member.in_raid_id == raid.id, Member.team_id == team.id)
            )
        ).scalars().all()
        for m in members:
            m.in_raid_id = None
        await db.commit()
    except BaseException:
        await db.rollback()  # 状态与解锁同生共死
        raise

    return {"raid": await raid_payload(db, raid)}
