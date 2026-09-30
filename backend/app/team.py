"""团队路由：建团（完整事务流程）与查询自己的团队。"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .db import get_db
from .errors import ApiError
from .member_service import generate_member
from .models import Member, Sect, Team, User, Xinfa

router = APIRouter(prefix="/api/team", tags=["team"])


class TeamCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=16)  # 团牌
    leader_name: str = Field(min_length=1, max_length=6)  # 团长角色名，最多六字
    sect_id: int  # 团长门派


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
    建团队 → 按团长名+门派生成成员 → 设为团长。"""
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
