"""数据模型。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


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
