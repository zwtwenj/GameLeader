"""副本实例路由：开团（进本）、推进时间线（tick）、解散、查询当前实例。

时间线状态机：统一分发器（NODE_HANDLERS）按 event 调用各 handler 子函数，
每个节点执行返回 true → 游标进下一个节点；false → 原地重试（消耗全副本
共享的重试次数，耗尽则副本失败散团）。副本记录（log）随每次推进追加，
开发阶段前端按 10 秒/步调用 tick。

掉落（fight_end 胜利后）：3+1 —— 必掉 3 件部位装备（分类随机）+ 50% 概率
额外掉 1 把随机门派武器。每件掉落立即尝试分配给"当前属性重合且该部位
更差"的随机成员（分配即穿，不落库待竞拍）；无人符合则分解为五行石。

团队聊天：副本进行期间，后台任务每 10~20 秒随机让一名进本成员说一句
骚话（jx3api /saohua/random），写入实例 chat 字段；副本结束/解散即停。"""

import asyncio
import json
import random
from dataclasses import dataclass, field
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .db import SessionLocal, get_db
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
from .services.jx3api import client as jx3_client

router = APIRouter(prefix="/api/raid", tags=["raid"])

# ---------- 团队聊天后台任务：副本进行期间随机成员播报骚话 ----------

_chat_tasks: dict[int, asyncio.Task] = {}


def spawn_chat_task(raid_id: int) -> None:
    """为进行中的副本启动聊天后台任务（幂等；服务重启后按进行中副本补启）。"""
    task = _chat_tasks.get(raid_id)
    if task is not None and not task.done():
        return
    _chat_tasks[raid_id] = asyncio.create_task(_chat_loop(raid_id))


def stop_chat_task(raid_id: int) -> None:
    task = _chat_tasks.pop(raid_id, None)
    if task is not None:
        task.cancel()


def stop_all_chat_tasks() -> None:
    for task in _chat_tasks.values():
        task.cancel()
    _chat_tasks.clear()


async def _chat_loop(raid_id: int) -> None:
    """每 10~20 秒：随机一名进本成员说一句骚话（jx3api），写入实例 chat。"""
    try:
        while True:
            await asyncio.sleep(random.uniform(*CHAT_INTERVAL_RANGE))
            async with SessionLocal() as db:
                raid = (
                    await db.execute(select(Raid).where(Raid.id == raid_id))
                ).scalar_one_or_none()
                if raid is None or raid.status != "进行中":
                    return  # 副本已结束，任务自然退出
                names = [
                    r[0]
                    for r in (
                        await db.execute(
                            select(RaidMember.name).where(RaidMember.raid_id == raid_id)
                        )
                    ).all()
                ]
                if not names:
                    return
                try:
                    text = await jx3_client.saohua_random()
                except Exception:
                    continue  # 接口抖动：这一轮不说话，下轮再试
                if not text:
                    continue
                chat = json.loads(raid.chat or "[]")
                chat.append(
                    {
                        "member": random.choice(names),
                        "message": text,
                        "time": datetime.now().strftime("%H:%M:%S"),
                    }
                )
                raid.chat = json.dumps(chat, ensure_ascii=False)
                await db.commit()
    except asyncio.CancelledError:
        pass  # 解散/关服时被取消，正常退出


MAX_RETRIES = 5  # 共享战斗重试次数（全副本所有 BOSS 共享）
WEAPON_DROP_CHANCE = 0.5  # 击败 BOSS 后额外掉落武器的概率（3+1 掉落的"1"）
CHAT_INTERVAL_RANGE = (10, 20)  # 团队聊天间隔（秒，开发阶段）

# 掉落部位 → 成员装备槽字段（戒指两个槽位特殊处理，武器按门派匹配）
SLOT_TO_COLUMN = {
    "帽子": "hat",
    "上衣": "chest",
    "腰带": "belt",
    "护腕": "wrist",
    "下装": "pants",
    "鞋子": "shoes",
    "项链": "necklace",
    "腰坠": "pendant",
    "远程武器": "ranged",
}


def calc_boss_odds(
    boss: Boss, avg_gear: float, roles: list[str], dungeon: Dungeon
) -> dict:
    """计算队伍对单个 BOSS 的胜率构成（纯计算，无副作用，可复用）。

    公式（plan.md）：base = (队伍平均装等 - K) / (BOSS要求装等 - K)，
    X = 构成缺员惩罚（缺坦/缺治/缺输按人数规格扣减），最终概率截断到 [0,1]。
    decide_battle（tick 战斗判定）与开团预览接口共用本函数。"""
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
    return {
        "probability": round(probability, 4),
        "base": round(base, 4),
        "penalties": penalties,
    }


def decide_battle(
    boss: Boss, avg_gear: float, roles: list[str], dungeon: Dungeon
) -> tuple[bool, float, float, list[dict]]:
    """战斗判定：calc_boss_odds 算出胜率后掷点。"""
    odds = calc_boss_odds(boss, avg_gear, roles, dungeon)
    win = random.random() < odds["probability"]
    return win, odds["probability"], odds["base"], odds["penalties"]


# ---------- 时间线节点：统一分发器 + 各事件 handler ----------


@dataclass
class NodeContext:
    """单个节点执行时的上下文（快照数据，节点内只读）。"""

    db: AsyncSession
    team: Team
    raid: Raid
    dungeon: Dungeon
    roles: list[str]  # 进本成员的职业类型（快照）
    avg_gear: float  # 进本成员平均装等（快照）
    members: list[tuple[Member, Xinfa, Sect]]  # 团队存活成员（分配掉落用）
    sect_names: list[str]  # 全部门派名（武器掉落用）


@dataclass
class NodeOutcome:
    """节点执行结果：advance=true 进下一个节点，false 原地重试。"""

    advance: bool
    message: str
    drops: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


async def _get_boss(ctx: NodeContext, params: dict) -> Boss:
    boss = await ctx.db.get(Boss, params.get("boss_id", 0))
    if boss is None:
        raise ApiError(
            422, 42200, f"时间线节点引用了不存在的BOSS（boss_id={params.get('boss_id')}）"
        )
    return boss


async def handle_mob(ctx: NodeContext, params: dict) -> NodeOutcome:
    return NodeOutcome(advance=True, message="正在清理路上的小怪")


async def handle_advance(ctx: NodeContext, params: dict) -> NodeOutcome:
    return NodeOutcome(advance=True, message="正在赶往BOSS位置")


async def handle_rest(ctx: NodeContext, params: dict) -> NodeOutcome:
    return NodeOutcome(advance=True, message="队伍原地休整，恢复状态")


async def handle_fight(ctx: NodeContext, params: dict) -> NodeOutcome:
    boss = await _get_boss(ctx, params)
    return NodeOutcome(advance=True, message=f"正在与{boss.name}作战")


async def create_drop_item(ctx: NodeContext, boss: Boss, weapon: bool) -> EquipmentItem:
    """生成一件掉落：部位装备（随机槽位+分类）或门派武器，装等在 BOSS 区间内。"""
    if weapon:
        slot, equip_type = "武器", random.choice(ctx.sect_names)
    else:
        slot, equip_type = random.choice(DROP_SLOTS), random.choice(DROP_TYPES)
    item = EquipmentItem(
        team_id=ctx.team.id,
        raid_id=ctx.raid.id,
        slot=slot,
        equip_type=equip_type,
        equip_level=random.randint(boss.drop_low, boss.drop_high),
    )
    ctx.db.add(item)
    await ctx.db.flush()
    return item


async def assign_or_decompose(ctx: NodeContext, item: EquipmentItem) -> str:
    """为掉落物寻找符合的成员随机分配（分配即穿），无人符合则分解为五行石。

    符合 = 成员当前属性与装备属性重合（按心法的装备分类；武器按门派），
    且成员该部位装等比这件装备差。返回用于战报的结果描述。"""
    desc = item_desc(item)
    eligible: list[tuple[Member, str]] = []  # (成员, 槽位字段)
    for m, x, s in ctx.members:
        if item.slot == "武器":
            if s.name == item.equip_type and m.weapon_level < item.equip_level:
                eligible.append((m, "weapon"))
        elif item.slot == "戒指":
            if x.equip_type == item.equip_type:
                worse = [
                    c
                    for c in ("ring1", "ring2")
                    if getattr(m, f"{c}_level") < item.equip_level
                ]
                if worse:
                    col = min(worse, key=lambda c: getattr(m, f"{c}_level"))
                    eligible.append((m, col))
        else:
            col = SLOT_TO_COLUMN.get(item.slot)
            if (
                col
                and x.equip_type == item.equip_type
                and getattr(m, f"{col}_level") < item.equip_level
            ):
                eligible.append((m, col))

    if not eligible:
        item.status = "已分解"
        ctx.team.wuxing_stone += 1
        return f"{desc}→分解为五行石"

    m, col = random.choice(eligible)
    setattr(m, f"{col}_level", item.equip_level)
    m.sync_equip_level()
    item.status = "已分配"
    item.owner_member_id = m.id
    return f"{desc}→{m.name}"


async def handle_fight_end(ctx: NodeContext, params: dict) -> NodeOutcome:
    boss = await _get_boss(ctx, params)
    win, probability, base, penalties = decide_battle(
        boss, ctx.avg_gear, ctx.roles, ctx.dungeon
    )
    pct_text = f"{probability:.0%}"
    stats = {
        "probability": probability,
        "base": base,
        "penalties": penalties,
        "avg_gear": ctx.avg_gear,
    }

    if not win:
        ctx.raid.retries_left -= 1
        if ctx.raid.retries_left <= 0:
            ctx.raid.status = "已失败"
            ctx.raid.finished_at = datetime.now()
            return NodeOutcome(
                False,
                f"队伍被团灭了（胜率 {pct_text}），重试次数耗尽，散团了",
                stats=stats,
            )
        return NodeOutcome(
            False,
            f"队伍被团灭了（胜率 {pct_text}，剩余重试 {ctx.raid.retries_left} 次），重新集结进攻",
            stats=stats,
        )

    # 3+1 掉落：必掉 3 件部位装备，50% 概率额外 1 把门派武器
    results: list[str] = []
    drops: list[str] = []
    drop_plan = [False, False, False]
    if random.random() < WEAPON_DROP_CHANCE:
        drop_plan.append(True)
    for weapon in drop_plan:
        item = await create_drop_item(ctx, boss, weapon)
        results.append(await assign_or_decompose(ctx, item))
        drops.append(item_desc(item))
    ctx.raid.current_seq = max(ctx.raid.current_seq, boss.seq + 1)
    return NodeOutcome(
        advance=True,
        message=f"BOSS{boss.name}被打倒了，掉落了{'、'.join(results)}（胜率 {pct_text}）",
        drops=drops,
        stats=stats,
    )


NODE_HANDLERS = {
    "mob": handle_mob,
    "advance": handle_advance,
    "rest": handle_rest,
    "fight": handle_fight,
    "fight_end": handle_fight_end,
}


class RaidCreateIn(BaseModel):
    dungeon_id: int
    member_ids: list[int] = Field(min_length=1, max_length=25)


class RaidPreviewIn(BaseModel):
    dungeon_id: int
    member_ids: list[int] = Field(min_length=1, max_length=25)


@router.post("/preview")
async def preview_raid(
    body: RaidPreviewIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """开团预览：给定副本与成员，计算对时间线上每个 BOSS 的胜率。
    纯计算接口（不校验人数规格/锁定状态），供开团确认弹框与后续复用。"""
    team = (
        await db.execute(select(Team).where(Team.user_id == user.id, Team.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if team is None:
        raise ApiError(404, 40400, "还没有团队")
    dungeon = await db.get(Dungeon, body.dungeon_id)
    if dungeon is None or dungeon.deleted_at is not None:
        raise ApiError(422, 42200, "副本不存在")

    member_ids = list(dict.fromkeys(body.member_ids))
    rows = (
        await db.execute(
            select(Member, Xinfa)
            .join(Xinfa, Member.xinfa_id == Xinfa.id)
            .where(
                Member.id.in_(member_ids),
                Member.team_id == team.id,
                Member.deleted_at.is_(None),
            )
        )
    ).all()
    if len(rows) != len(member_ids):
        raise ApiError(422, 42200, "有成员不存在或不属于你的团队")
    roles = [x.role for _, x in rows]
    avg_gear = round(sum(m.equip_level for m, _ in rows) / len(rows), 1) if rows else 0

    # 预览的 BOSS 列表 = 时间线中出现的 BOSS（按首次出现顺序）；无时间线则退回副本 BOSS 表
    timeline = json.loads(dungeon.timeline or "[]")
    boss_ids: list[int] = []
    for node in timeline:
        bid = node.get("params", {}).get("boss_id")
        if node.get("event") in ("fight", "fight_end") and bid and bid not in boss_ids:
            boss_ids.append(bid)
    if not boss_ids:
        boss_ids = [
            b.id
            for b in (
                await db.execute(
                    select(Boss).where(Boss.dungeon_id == dungeon.id).order_by(Boss.seq)
                )
            ).scalars().all()
        ]

    rule = COMPOSITION_RULES.get(
        dungeon.size,
        {"tank": 0, "heal": 0, "dps": 0, "p_tank": 0.0, "p_heal": 0.0, "p_dps": 0.0},
    )
    have = {
        "坦克": roles.count("坦克"),
        "治疗": roles.count("治疗"),
        "输出": roles.count("输出"),
    }

    bosses = []
    for bid in boss_ids:
        boss = await db.get(Boss, bid)
        if boss is None:
            continue
        odds = calc_boss_odds(boss, avg_gear, roles, dungeon)
        bosses.append(
            {
                "seq": boss.seq,
                "name": boss.name,
                "gear_req": boss.gear_req,
                "drop_low": boss.drop_low,
                "drop_high": boss.drop_high,
                **odds,
            }
        )

    return {
        "size": dungeon.size,
        "balance_k": dungeon.balance_k,
        "requirement": {"坦克": rule["tank"], "治疗": rule["heal"], "输出": rule["dps"]},
        "composition": have,
        "avg_gear": avg_gear,
        "bosses": bosses,
    }


def item_desc(item: EquipmentItem) -> str:
    if item.slot == "武器":
        return f"{item.equip_level}{item.equip_type}武器"
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
        "chat": json.loads(raid.chat or "[]"),
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
            .where(Raid.team_id == team.id, Raid.closed.is_(False))
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

    spawn_chat_task(raid.id)  # 副本开始：启动团队聊天后台任务
    return {"raid": await raid_payload(db, raid)}


@router.post("/{raid_id}/tick")
async def tick_raid(
    raid_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """推进一个时间线节点：执行当前节点，返回 true 进下一个、false 原地重试。

    事件语义（节点可人为编排，顺序不限），每个 event 对应 NODE_HANDLERS 里的
    一个 handler 子函数：
    mob=清理小怪 / advance=赶往BOSS / rest=休整 / fight=开战（params.boss_id）/
    fight_end=结算（params.boss_id）：win→3+1 掉落（3 件部位装备 + 50% 门派武器，
    逐件分配给符合的成员或分解为五行石）返回 true；lose→消耗重试返回 false
    原地重试，重试耗尽副本失败散团（不解散队伍，玩家手动解散）。"""
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

        team_members = (
            await db.execute(
                select(Member, Xinfa, Sect)
                .join(Xinfa, Member.xinfa_id == Xinfa.id)
                .join(Sect, Xinfa.sect_id == Sect.id)
                .where(Member.team_id == team.id, Member.deleted_at.is_(None))
                .order_by(Member.id)
            )
        ).all()
        sect_names = [s for s, in (await db.execute(select(Sect.name))).all()]

        ctx = NodeContext(
            db=db,
            team=team,
            raid=raid,
            dungeon=dungeon,
            roles=roles,
            avg_gear=avg_gear,
            members=team_members,
            sect_names=sect_names,
        )
        handler = NODE_HANDLERS.get(event)
        outcome = (
            await handler(ctx, params)
            if handler is not None
            else NodeOutcome(advance=True, message=f"未知事件 {event}，跳过")
        )
        advance, message = outcome.advance, outcome.message
        drops_desc, stats = outcome.drops, outcome.stats

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
        raid.closed = True  # 玩家已查看结算，/current 不再返回，面板消失
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

    stop_chat_task(raid_id)  # 解散：停止该副本的聊天任务
    return {"raid": await raid_payload(db, raid)}
