"""数据模型。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# 12 装备槽位：(字段前缀, 显示名)，戒指两个槽位
MEMBER_SLOTS = [
    ("hat", "帽子"),
    ("chest", "上衣"),
    ("belt", "腰带"),
    ("wrist", "护腕"),
    ("pants", "下装"),
    ("shoes", "鞋子"),
    ("necklace", "项链"),
    ("pendant", "腰坠"),
    ("ring1", "戒指1"),
    ("ring2", "戒指2"),
    ("weapon", "武器"),
    ("ranged", "远程武器"),
]


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Sect(Base):
    """门派。武器装备按门派独立，相关字段等装备系统时再加。"""

    __tablename__ = "sect"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)

    xinfas: Mapped[list["Xinfa"]] = relationship(back_populates="sect")


class Xinfa(Base):
    """心法：游戏逻辑的最小单位。职业类型与装备分类都挂在心法上
    （天策两心法一坦克一体质、一输出一外功），成员表将来挂 xinfa_id。"""

    __tablename__ = "xinfa"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sect_id: Mapped[int] = mapped_column(ForeignKey("sect.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(4), nullable=False)  # 坦克/治疗/输出
    equip_type: Mapped[str] = mapped_column(String(4), nullable=False)  # 体质/治疗/外功/内功

    sect: Mapped[Sect] = relationship(back_populates="xinfas")


class Team(Base):
    """团队：玩家游玩的主体。会长不是独立字段，指向团队内的一名成员
    （leader_member_id），成员是团队的附属资产。"""

    __tablename__ = "team"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)  # 团牌
    # use_alter：team↔member 循环外键，建表时延后用 ALTER 创建
    leader_member_id: Mapped[int | None] = mapped_column(
        ForeignKey("member.id", use_alter=True), nullable=True
    )
    fund: Mapped[int] = mapped_column(default=0, nullable=False)  # 团队资金
    wuxing_stone: Mapped[int] = mapped_column(default=0, nullable=False)  # 五行石（装备分解产物，团队货币）
    member_cap: Mapped[int] = mapped_column(default=40, nullable=False)  # 成员上限
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Member(Base):
    """成员：团队的附属资产（团长或 NPC）。门派/职业类型经 xinfa 关联取得。

    装备按 plan.md 的 12 槽位各存一个装等（不存分类，"130外功帽子"里的
    分类只用于竞拍过滤）；成员装等 = 各槽平均向下取整，槽位变动后调
    sync_equip_level()。切心法不影响槽位装等。"""

    __tablename__ = "member"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), nullable=False)
    xinfa_id: Mapped[int] = mapped_column(ForeignKey("xinfa.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(16), nullable=False)  # 角色名最多六字
    equip_level: Mapped[int] = mapped_column(default=120, nullable=False)  # 最低120
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # 12 装备槽位装等（与 MEMBER_SLOTS 对应）
    hat_level: Mapped[int] = mapped_column(default=120, nullable=False)
    chest_level: Mapped[int] = mapped_column(default=120, nullable=False)
    belt_level: Mapped[int] = mapped_column(default=120, nullable=False)
    wrist_level: Mapped[int] = mapped_column(default=120, nullable=False)
    pants_level: Mapped[int] = mapped_column(default=120, nullable=False)
    shoes_level: Mapped[int] = mapped_column(default=120, nullable=False)
    necklace_level: Mapped[int] = mapped_column(default=120, nullable=False)
    pendant_level: Mapped[int] = mapped_column(default=120, nullable=False)
    ring1_level: Mapped[int] = mapped_column(default=120, nullable=False)
    ring2_level: Mapped[int] = mapped_column(default=120, nullable=False)
    weapon_level: Mapped[int] = mapped_column(default=120, nullable=False)
    ranged_level: Mapped[int] = mapped_column(default=120, nullable=False)

    # 成员锁：非空表示正在该副本实例中（不可切心法/移除/再进其他本），副本结束置空
    in_raid_id: Mapped[int | None] = mapped_column(default=None, nullable=True)

    def sync_equip_level(self) -> None:
        """槽位装等变动后重算成员装等（平均向下取整）。"""
        self.equip_level = sum(getattr(self, f"{key}_level") for key, _ in MEMBER_SLOTS) // len(MEMBER_SLOTS)


class RecruitOffer(Base):
    """招募临时数据：服务端抽出的候选成员。前端只拿 offer_id 来创建，
    名字/门派不可由客户端指定；同意后消耗（accepted_at），拒绝后由下次
    招募作废或自然过期。每队同时最多一个有效候选。"""

    __tablename__ = "recruit_offer"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(16), nullable=False)
    sect_id: Mapped[int] = mapped_column(ForeignKey("sect.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Dungeon(Base):
    """副本：人数规格与平衡系数 K，BOSS 由前到后 seq 递增。

    timeline 是人为编排的节点数组（JSON）：[{event: 'mob'|'advance'|'rest'|
    'fight'|'fight_end', params?: {...}}, ...]，节点执行返回 true 进下一个、
    false 原地重试，整个副本的推进顺序完全由这份编排决定。
    loot 是副本通用材料掉落池（JSON 数组）：[{"name": "天外陨铁", "min": 1,
    "max": 1, "chance": 1}, ...]，副本内每个 BOSS 击败后都会 roll 一遍。"""

    __tablename__ = "dungeon"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    size: Mapped[int] = mapped_column(nullable=False)  # 人数要求：5/10/25
    balance_k: Mapped[int] = mapped_column(nullable=False)  # 平衡系数 K，与副本绑定
    timeline: Mapped[str | None] = mapped_column(Text, default="[]", nullable=True)
    loot: Mapped[str | None] = mapped_column(Text, default="[]", nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    bosses: Mapped[list["Boss"]] = relationship(back_populates="dungeon")


class Boss(Base):
    """BOSS：A=要求装等，掉落区间 [B, C]；loot 为 BOSS 专属掉落表（JSON 数组，
    格式同副本通用池，击败后与副本通用池合并 roll）。"""

    __tablename__ = "boss"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    dungeon_id: Mapped[int] = mapped_column(ForeignKey("dungeon.id"), nullable=False)
    seq: Mapped[int] = mapped_column(nullable=False)  # 由前到后，1 起
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    gear_req: Mapped[int] = mapped_column(nullable=False)  # A：要求装等
    drop_low: Mapped[int] = mapped_column(nullable=False)  # B：掉落装等下限
    drop_high: Mapped[int] = mapped_column(nullable=False)  # C：掉落装等上限
    loot: Mapped[str | None] = mapped_column(Text, default="[]", nullable=True)

    dungeon: Mapped[Dungeon] = relationship(back_populates="bosses")


# 掉落装备的槽位与分类（武器每门派独立，掉落先不做武器）
DROP_SLOTS = ["帽子", "上衣", "腰带", "护腕", "下装", "鞋子", "项链", "腰坠", "戒指", "远程武器"]
DROP_TYPES = ["体质", "治疗", "外功", "内功"]

# 各人数规格的开荒构成要求与缺员惩罚（plan.md：缺坦/缺治/缺输 每少 1 的 X 减免）
COMPOSITION_RULES = {
    5: {"tank": 0, "heal": 1, "dps": 1, "p_tank": 0.0, "p_heal": 0.2, "p_dps": 0.2},
    10: {"tank": 1, "heal": 1, "dps": 4, "p_tank": 0.4, "p_heal": 0.4, "p_dps": 0.2},
    25: {"tank": 2, "heal": 5, "dps": 10, "p_tank": 0.4, "p_heal": 0.2, "p_dps": 0.2},
}


class Raid(Base):
    """副本实例：每次进本创建，与网游相同——进度/状态/掉落都挂在实例上，
    副本表只是模板。node_index 是时间线游标，retries_left 是全副本共享的
    战斗重试次数（节点返回 false 时消耗），log 是副本记录（JSON 数组）。"""

    __tablename__ = "raid"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), nullable=False)
    dungeon_id: Mapped[int] = mapped_column(ForeignKey("dungeon.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(8), default="进行中", nullable=False)  # 进行中/已通关/已失败/已解散
    current_seq: Mapped[int] = mapped_column(default=1, nullable=False)  # 已击败的 BOSS 数
    node_index: Mapped[int] = mapped_column(default=0, nullable=False)  # 时间线游标（已完成节点数）
    retries_left: Mapped[int] = mapped_column(default=5, nullable=False)  # 共享重试次数
    log: Mapped[str | None] = mapped_column(Text, default="[]", nullable=True)  # 副本记录
    # 团队聊天（JSON）：后端定时调 jx3api 骚话接口、随机成员播报，前端只展示
    chat: Mapped[str | None] = mapped_column(Text, default="[]", nullable=True)
    # 材料掉落明细（JSON）：[{"boss": "王海银", "name": "天外陨铁", "qty": 1}]——
    # 材料不在 equipment_item 表，面板掉落列表由本字段合并输出
    material_drops: Mapped[str | None] = mapped_column(Text, default="[]", nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 玩家已点解散（结算查看完毕）：置位后 /current 不再返回，面板从页面消失
    closed: Mapped[bool] = mapped_column(default=False, nullable=False)


class RaidMember(Base):
    """进本成员快照：进本时定格，副本期间移除成员/切心法不影响实例数据。"""

    __tablename__ = "raid_member"
    __table_args__ = (UniqueConstraint("raid_id", "member_id", name="uq_raid_member"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    raid_id: Mapped[int] = mapped_column(ForeignKey("raid.id"), nullable=False)
    member_id: Mapped[int] = mapped_column(ForeignKey("member.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(16), nullable=False)  # 快照
    xinfa_id: Mapped[int] = mapped_column(ForeignKey("xinfa.id"), nullable=False)  # 快照
    equip_level: Mapped[int] = mapped_column(nullable=False)  # 快照


class EquipmentItem(Base):
    """装备实例：副本掉落与合成装备共用本表。

    - source：'副本掉落' / '合成'；合成装备 raid_id 为空、boss_name 为空串
    - status：'仓库中'（合成产出待分配）/ '已分配'（成员穿上）/ '已分解'
    - 掉落路径在 fight_end 中直接 assign_or_decompose（分配即穿或分解），
      合成路径先进仓库，由玩家在仓库页手工分配"""

    __tablename__ = "equipment_item"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), nullable=False)
    raid_id: Mapped[int | None] = mapped_column(ForeignKey("raid.id"), nullable=True)
    slot: Mapped[str] = mapped_column(String(8), nullable=False)
    equip_type: Mapped[str] = mapped_column(String(4), nullable=False)
    equip_level: Mapped[int] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(8), default="仓库中", nullable=False)
    boss_name: Mapped[str] = mapped_column(String(32), default="", nullable=False)  # 掉落它的 BOSS
    source: Mapped[str] = mapped_column(String(8), default="副本掉落", nullable=False)
    owner_member_id: Mapped[int | None] = mapped_column(default=None, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Item(Base):
    """物品定义（非装备类）：category 区分材料/消耗品，可持续添加新类别条目。

    装备不走本表——装备每件装等/槽位不同不可堆叠，走 equipment_item 实例表。
    消耗品的 effect 为 JSON 数组（效果数据驱动），例如：
      [{"type": "odds", "value": 0.1, "desc": "下一场战斗全队胜率+10%"},
       {"type": "retry", "value": 1, "desc": "本副本额外+1次重试"}]"""

    __tablename__ = "item"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(8), nullable=False)  # 材料/消耗品
    desc: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    effect: Mapped[str] = mapped_column(Text, default="[]", nullable=False)


class TeamItem(Base):
    """团队物品库存：材料与消耗品共用，按（团队, 物品）堆叠计数。"""

    __tablename__ = "team_item"
    __table_args__ = (UniqueConstraint("team_id", "item_id", name="uq_team_item"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(default=0, nullable=False)


class Recipe(Base):
    """合成配方：消耗材料（item）与五行石，产出指定槽位/分类/装等的装备（进仓库）。

    materials 为 JSON 数组：[{"item_id": 1, "quantity": 5}, ...]——配方
    数量级很小，JSON 足够；将来配方需要复杂管理时再拆子表。"""

    __tablename__ = "recipe"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    slot: Mapped[str] = mapped_column(String(8), nullable=False)
    equip_type: Mapped[str] = mapped_column(String(4), nullable=False)
    equip_level: Mapped[int] = mapped_column(nullable=False)
    wuxing_cost: Mapped[int] = mapped_column(default=0, nullable=False)
    materials: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
