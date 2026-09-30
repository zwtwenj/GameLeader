"""数据模型。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
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
    """副本：人数规格与平衡系数 K，BOSS 由前到后 seq 递增。"""

    __tablename__ = "dungeon"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    size: Mapped[int] = mapped_column(nullable=False)  # 人数要求：5/10/25
    balance_k: Mapped[int] = mapped_column(nullable=False)  # 平衡系数 K，与副本绑定
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    bosses: Mapped[list["Boss"]] = relationship(back_populates="dungeon")


class Boss(Base):
    """BOSS：A=要求装等，掉落区间 [B, C]（击倒后在该区间随机掉装备，细节后定）。"""

    __tablename__ = "boss"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    dungeon_id: Mapped[int] = mapped_column(ForeignKey("dungeon.id"), nullable=False)
    seq: Mapped[int] = mapped_column(nullable=False)  # 由前到后，1 起
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    gear_req: Mapped[int] = mapped_column(nullable=False)  # A：要求装等
    drop_low: Mapped[int] = mapped_column(nullable=False)  # B：掉落装等下限
    drop_high: Mapped[int] = mapped_column(nullable=False)  # C：掉落装等上限

    dungeon: Mapped[Dungeon] = relationship(back_populates="bosses")
