"""团队路由：建团（完整事务流程）、招募、查询自己的团队。"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .data_names import pick_random_name
from .db import get_db
from .errors import ApiError
from .member_service import generate_member
from .models import MEMBER_SLOTS, Member, RecruitOffer, Sect, Team, User, Xinfa

router = APIRouter(prefix="/api/team", tags=["team"])


class TeamCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=16)  # 团牌
    leader_name: str = Field(min_length=1, max_length=6)  # 团长角色名，最多六字
    sect_id: int  # 团长门派


class XinfaSwitchIn(BaseModel):
    xinfa_id: int


async def get_my_team(db: AsyncSession, user_id: int) -> Team | None:
    return (
        await db.execute(
            select(Team).where(Team.user_id == user_id, Team.deleted_at.is_(None))
        )
    ).scalar_one_or_none()


def member_out(member: Member, xinfa: Xinfa, sect_name: str) -> dict:
    return {
        "id": member.id,
        "name": member.name,
        "sect": sect_name,
        "xinfa": xinfa.name,
        "role": xinfa.role,
        "equip_level": member.equip_level,
    }


@router.post("", status_code=201)
async def create_team(
    body: TeamCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """建团完整流程（单事务，任一步失败整体回滚）：
    建团队 → 按团长名+门派生成成员 → 设为团长。团长心法取该门派第一个。"""
    if await get_my_team(db, user.id) is not None:
        raise ApiError(409, 40900, "你已拥有团队")
    name_taken = (
        await db.execute(
            select(Team).where(Team.name == body.name, Team.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if name_taken:
        raise ApiError(409, 40900, "团牌已被使用")

    try:
        team = Team(user_id=user.id, name=body.name)
        db.add(team)
        await db.flush()

        leader, xinfa = await generate_member(
            db, team_id=team.id, name=body.leader_name, sect_id=body.sect_id
        )

        team.leader_member_id = leader.id
        sect_name = (
            await db.scalar(select(Sect.name).where(Sect.id == body.sect_id))
        ) or ""
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, 40900, "团牌已被使用或你已拥有团队")
    except BaseException:
        await db.rollback()  # 任一步失败：整体回滚，不留孤儿数据
        raise

    return {
        "id": team.id,
        "name": team.name,
        "fund": team.fund,
        "member_cap": team.member_cap,
        "leader": member_out(leader, xinfa, sect_name),
    }


@router.get("/me")
async def my_team(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """我的团队（含全部成员）。没有团队返回 {team: null}，前端据此引导建团。"""
    team = await get_my_team(db, user.id)
    if team is None:
        return {"team": None}

    rows = (
        await db.execute(
            select(Member, Xinfa, Sect)
            .join(Xinfa, Member.xinfa_id == Xinfa.id)
            .join(Sect, Xinfa.sect_id == Sect.id)
            .where(Member.team_id == team.id, Member.deleted_at.is_(None))
            .order_by(Member.id)
        )
    ).all()
    return {
        "team": {
            "id": team.id,
            "name": team.name,
            "fund": team.fund,
            "member_cap": team.member_cap,
            "leader_member_id": team.leader_member_id,
            "members": [member_out(m, x, s.name) for m, x, s in rows],
        }
    }


async def get_team_member_count(db: AsyncSession, team_id: int) -> int:
    return (
        await db.scalar(
            select(func.count(Member.id)).where(
                Member.team_id == team_id, Member.deleted_at.is_(None)
            )
        )
    ) or 0


@router.post("/recruit", status_code=201)
async def draw_recruit(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """刷新招募：服务端随机抽一个候选（名字不与现有成员重复 + 随机门派），
    存为临时数据返回 offer_id。每队同时最多一个有效候选，旧的自动作废。"""
    team = await get_my_team(db, user.id)
    if team is None:
        raise ApiError(404, 40400, "还没有团队")
    if await get_team_member_count(db, team.id) >= team.member_cap:
        raise ApiError(409, 40900, "团队成员已满")

    # 旧候选作废：保证每队最多一个有效招募
    old = (
        await db.execute(
            select(RecruitOffer).where(
                RecruitOffer.team_id == team.id, RecruitOffer.accepted_at.is_(None)
            )
        )
    ).scalars().all()
    for offer in old:
        await db.delete(offer)

    names = set(
        (
            await db.execute(
                select(Member.name).where(
                    Member.team_id == team.id, Member.deleted_at.is_(None)
                )
            )
        ).scalars()
    )
    name = pick_random_name(names)
    sect = (
        await db.execute(select(Sect).order_by(func.rand()).limit(1))
    ).scalar_one()
    xinfa = (
        await db.execute(
            select(Xinfa)
            .where(Xinfa.sect_id == sect.id)
            .order_by(Xinfa.id)
            .limit(1)
        )
    ).scalar_one()  # 与 generate_member 同规则，预览即所得

    offer = RecruitOffer(
        team_id=team.id,
        name=name,
        sect_id=sect.id,
        expires_at=datetime.now() + timedelta(minutes=10),
    )
    db.add(offer)
    await db.commit()
    await db.refresh(offer)

    return {
        "offer_id": offer.id,
        "name": offer.name,
        "sect": sect.name,
        "xinfa": xinfa.name,
        "role": xinfa.role,
        "equip_type": xinfa.equip_type,
        "expires_in": 600,
    }


@router.post("/recruit/{offer_id}/accept", status_code=201)
async def accept_recruit(
    offer_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """同意招募：消耗候选（行锁防重放），调用生成成员服务。拒绝无接口——
    不调用即可，候选由下次招募作废或自然过期。"""
    team = await get_my_team(db, user.id)
    if team is None:
        raise ApiError(404, 40400, "还没有团队")

    try:
        offer = (
            await db.execute(
                select(RecruitOffer)
                .where(RecruitOffer.id == offer_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if offer is None or offer.team_id != team.id:
            raise ApiError(404, 40400, "招募不存在")
        if offer.accepted_at is not None:
            raise ApiError(409, 40900, "该招募已被处理")
        if offer.expires_at <= datetime.now():
            raise ApiError(409, 40900, "招募已过期，重新招募即可")
        if await get_team_member_count(db, team.id) >= team.member_cap:
            raise ApiError(409, 40900, "团队成员已满")
        dup = (
            await db.execute(
                select(Member.id).where(
                    Member.team_id == team.id,
                    Member.name == offer.name,
                    Member.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if dup is not None:
            raise ApiError(409, 40900, "已有同名成员")

        member, xinfa = await generate_member(
            db, team_id=team.id, name=offer.name, sect_id=offer.sect_id
        )
        offer.accepted_at = datetime.now()
        sect_name = (await db.scalar(select(Sect.name).where(Sect.id == offer.sect_id))) or ""
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, 40900, "招募处理冲突，请重试")
    except BaseException:
        await db.rollback()  # 成员与消耗候选必须同生共死
        raise

    return member_out(member, xinfa, sect_name)


async def get_my_member(
    db: AsyncSession, team_id: int, member_id: int
) -> Member | None:
    return (
        await db.execute(
            select(Member).where(
                Member.id == member_id,
                Member.team_id == team_id,
                Member.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()


@router.get("/members/{member_id}")
async def member_detail(
    member_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """成员详情：含 12 槽位装等（列表接口不带，详情才返回）。"""
    team = await get_my_team(db, user.id)
    if team is None:
        raise ApiError(404, 40400, "还没有团队")
    member = await get_my_member(db, team.id, member_id)
    if member is None:
        raise ApiError(404, 40400, "成员不存在")
    xinfa = await db.get(Xinfa, member.xinfa_id)
    sect_name = (
        await db.scalar(select(Sect.name).where(Sect.id == xinfa.sect_id))
    ) or ""
    return {
        **member_out(member, xinfa, sect_name),
        "slots": [
            {"slot": label, "level": getattr(member, f"{key}_level")}
            for key, label in MEMBER_SLOTS
        ],
    }


@router.delete("/members/{member_id}")
async def remove_member(
    member_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """移除成员（软删除）。团长是团队锚点，不允许移除。"""
    team = await get_my_team(db, user.id)
    if team is None:
        raise ApiError(404, 40400, "还没有团队")
    try:
        member = (
            await db.execute(
                select(Member)
                .where(Member.id == member_id, Member.deleted_at.is_(None))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if member is None or member.team_id != team.id:
            raise ApiError(404, 40400, "成员不存在")
        if member.id == team.leader_member_id:
            raise ApiError(409, 40900, "团长不能移除")
        member.deleted_at = datetime.now()
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    return {"ok": True}


@router.put("/members/{member_id}/xinfa")
async def switch_xinfa(
    member_id: int,
    body: XinfaSwitchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """切换成员心法：仅限同门派内切换（能否切换由该门派心法数决定，无需
    门派表冗余字段）。职业类型与装备分类随 xinfa 自动变化。"""
    team = await get_my_team(db, user.id)
    if team is None:
        raise ApiError(404, 40400, "还没有团队")
    try:
        member = (
            await db.execute(
                select(Member)
                .where(Member.id == member_id, Member.deleted_at.is_(None))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if member is None or member.team_id != team.id:
            raise ApiError(404, 40400, "成员不存在")
        target = await db.get(Xinfa, body.xinfa_id)
        if target is None:
            raise ApiError(422, 42200, "心法不存在")
        current = await db.get(Xinfa, member.xinfa_id)
        if target.sect_id != current.sect_id:
            raise ApiError(409, 40900, "只能切换同门派心法")
        if target.id == current.id:
            raise ApiError(409, 40900, "已是当前心法")
        member.xinfa_id = target.id
        sect_name = (
            await db.scalar(select(Sect.name).where(Sect.id == target.sect_id))
        ) or ""
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    return member_out(member, target, sect_name)
