"""成员生成服务：可复用的原子单元。

约定：只 flush 不 commit——事务边界归调用方。建团、招募等流程把若干
这样的单元包在同一个事务里，要么整体成功要么整体回滚，防止孤儿数据。
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .errors import ApiError
from .models import Member, Xinfa


async def generate_member(
    db: AsyncSession, *, team_id: int, name: str, sect_id: int, equip_level: int = 120
) -> tuple[Member, Xinfa]:
    """根据角色名 + 门派生成成员，心法取该门派的第一个（默认心法规则）。

    返回 (成员, 心法)，供调用方组装响应；失败抛 ApiError，由调用方回滚。
    """
    xinfa = (
        await db.execute(
            select(Xinfa).where(Xinfa.sect_id == sect_id).order_by(Xinfa.id).limit(1)
        )
    ).scalar_one_or_none()
    if xinfa is None:
        raise ApiError(422, 42200, "门派不存在或该门派没有心法")
    member = Member(
        team_id=team_id, xinfa_id=xinfa.id, name=name, equip_level=equip_level
    )
    db.add(member)
    await db.flush()
    return member, xinfa
