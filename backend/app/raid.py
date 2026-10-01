"""副本实例路由：开团（进本）、推进时间线（tick）、解散、查询当前实例。

时间线状态机：当前节点执行返回 true → 游标进下一个节点；返回 false →
原地重试（消耗全副本共享的重试次数，耗尽则副本失败散团）。副本记录（log）
随每次推进追加，开发阶段前端按 10 秒/步调用 tick。
"""

import json
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
    COMPOSITION_RULES,
    DROP_SLOTS,
    DROP_TYPES,
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

MAX_RETRIES = 5  # 共享战斗重试次数（全副本所有 BOSS 共享）


def decide_battle(
    boss: Boss, avg_gear: float, roles: list[str], dungeon: Dungeon
) -> tuple[bool, float, float, list[dict]]:
    """战斗判定（plan.md 公式）：base = (队伍平均装等 - K) / (BOSS要求装等 - K)，
    X = 构成缺员惩罚（缺坦/缺治/缺输按人数规格扣减），最终概率截断到 [0,1]。

    返回 (是否击败, 最终胜率, 基准胜率, 惩罚明细)。"""
    rule = COMPOSITION_RULES.get(
        dungeon.size,
        {"tank": 0, "heal": 0, "dps": 0, "p_tank": 0.0, "p_heal": 0.0, "p_dps": 0.0},
    )
    have = {
        "坦克": roles.count("坦克"),
        "治疗": roles.count("治疗"),
        "输出": roles.count("输出"),
    }
    penalties: list[dict] = []
    x_penalty = 0.0
    for role_name, need_key, rate_key in (
        ("坦克", "tank", "p_tank"),
        ("治疗", "heal", "p_heal"),
        ("输出", "dps", "p_dps"),
    ):
        missing = max(0, rule[need_key] - have[role_name])
        if missing > 0 and rule[rate_key] > 0:
            percent = -rule[rate_key] * missing
            penalties.append({"role": role_name, "missing": missing, "percent": percent})
            x_penalty += percent

    if boss.gear_req > dungeon.balance_k:
        base = (avg_gear - dungeon.balance_k) / (boss.gear_req - dungeon.balance_k)
    else:
        base = 10.0  # 需求装等不高于 K：稳过
    probability = max(0.0, min(1.0, base + x_penalty))
    win = random.random() < probability
    return win, round(probability, 4), round(base, 4), penalties


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

    timeline = json.loads(dungeon.timeline or "[]")
    current_boss = None
    if raid.status == "进行中" and raid.node_index < len(timeline):
        node = timeline[raid.node_index]
        if node.get("event") in ("fight", "fight_end"):
            boss = await db.get(Boss, node.get("params", {}).get("boss_id", 0))
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
        "steps": {"done": raid.node_index, "total": len(timeline)},
        "retries_left": raid.retries_left,
        "current_boss": current_boss,
        "log": json.loads(raid.log or "[]"),
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


@router.post("/{raid_id}/tick")
async def tick_raid(
    raid_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """推进一个时间线节点：执行当前节点，返回 true 进下一个、false 原地重试。

    事件语义（节点可人为编排，顺序不限）：
    mob=清理小怪 / advance=赶往BOSS / rest=休整 / fight=开战（params.boss_id）/
    fight_end=结算（params.boss_id）：win→掉3件装备返回 true；lose→消耗重试
    返回 false 原地重试，重试耗尽副本失败散团（不解散队伍，玩家手动解散）。"""
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

        dungeon = await db.get(Dungeon, raid.dungeon_id)
        timeline = json.loads(dungeon.timeline or "[]")
        if not timeline:
            raise ApiError(422, 42200, "该副本没有编排时间线")
        if raid.node_index >= len(timeline):
            # 上一 win 已推进到末尾（防御分支）
            raid.status = "已通关"
            raid.finished_at = datetime.now()
            await db.commit()
            return {"raid": await raid_payload(db, raid)}

        node = timeline[raid.node_index]
        event = node.get("event")
        params = node.get("params") or {}
        advance = True
        drops_desc: list[str] = []
        stats: dict = {}

        rows = (
            await db.execute(
                select(RaidMember, Xinfa)
                .join(Xinfa, RaidMember.xinfa_id == Xinfa.id)
                .where(RaidMember.raid_id == raid.id)
            )
        ).all()
        snapshots = [rm for rm, _ in rows]
        roles = [x.role for _, x in rows]
        avg_gear = round(sum(rm.equip_level for rm in snapshots) / len(snapshots), 1) if snapshots else 0

        if event == "mob":
            message = "正在清理路上的小怪"
        elif event == "advance":
            message = "正在赶往BOSS位置"
        elif event == "rest":
            message = "队伍原地休整，恢复状态"
        elif event == "fight":
            boss = await db.get(Boss, params.get("boss_id", 0))
            if boss is None:
                raise ApiError(422, 42200, f"时间线节点引用了不存在的BOSS（boss_id={params.get('boss_id')}）")
            message = f"正在与{boss.name}作战"
        elif event == "fight_end":
            boss = await db.get(Boss, params.get("boss_id", 0))
            if boss is None:
                raise ApiError(422, 42200, f"时间线节点引用了不存在的BOSS（boss_id={params.get('boss_id')}）")
            win, probability, base, penalties = decide_battle(boss, avg_gear, roles, dungeon)
            stats = {
                "probability": probability,
                "base": base,
                "penalties": penalties,
                "avg_gear": avg_gear,
            }
            pct_text = f"{probability:.0%}"
            if win:
                for _ in range(3):
                    item = EquipmentItem(
                        team_id=team.id,
                        raid_id=raid.id,
                        slot=random.choice(DROP_SLOTS),
                        equip_type=random.choice(DROP_TYPES),
                        equip_level=random.randint(boss.drop_low, boss.drop_high),
                    )
                    db.add(item)
                    await db.flush()
                    drops_desc.append(item_desc(item))
                message = f"BOSS{boss.name}被打倒了，掉落了{'、'.join(drops_desc)}（胜率 {pct_text}）"
                raid.current_seq = max(raid.current_seq, boss.seq + 1)
            else:
                advance = False
                raid.retries_left -= 1
                if raid.retries_left <= 0:
                    message = f"队伍被团灭了（胜率 {pct_text}），重试次数耗尽，散团了"
                    raid.status = "已失败"
                    raid.finished_at = datetime.now()
                else:
                    message = f"队伍被团灭了（胜率 {pct_text}，剩余重试 {raid.retries_left} 次），重新集结进攻"
        else:
            message = f"未知事件 {event}，跳过"

        if advance:
            raid.node_index += 1
            if raid.node_index >= len(timeline) and raid.status == "进行中":
                raid.status = "已通关"
                raid.finished_at = datetime.now()
                message = message or "副本通关"

        log = json.loads(raid.log or "[]")
        log.append(
            {
                "step": raid.node_index if advance else raid.node_index + 1,
                "event": event,
                "message": message,
                "time": datetime.now().strftime("%H:%M:%S"),
            }
        )
        raid.log = json.dumps(log, ensure_ascii=False)
        raid_status = raid.status
        await db.commit()
    except BaseException:
        await db.rollback()  # 掉落/游标/重试/记录同生共死
        raise

    return {
        "message": message,
        "advance": advance,
        "drops": drops_desc,
        "raid_status": raid_status,
        "stats": stats,
        "raid": await raid_payload(db, raid),
    }


@router.post("/{raid_id}/abandon")
async def abandon_raid(
    raid_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """解散队伍：进行中的副本置为已解散；已结束（通关/失败）的副本仅解锁
    全部进本成员——副本记录与掉落保留。"""
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
        if raid.status == "进行中":
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
