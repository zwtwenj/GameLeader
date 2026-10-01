"""GameLeader 后端入口。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .auth import router as auth_router
from .db import Base, SessionLocal, engine
from .errors import ApiError, api_error_handler, validation_error_handler
from .game import router as game_router
from .models import (  # noqa: F401  确保 create_all 时表已注册
    Boss,
    Dungeon,
    EquipmentItem,
    Member,
    Raid,
    RaidMember,
    RecruitOffer,
    Team,
    User,
    Xinfa,
)
from .models import (  # noqa: F401  确保 create_all 时表已注册
    Boss,
    Dungeon,
    EquipmentItem,
    Item,
    Member,
    Raid,
    RaidMember,
    RecruitOffer,
    Team,
    TeamItem,
    User,
    Xinfa,
)
from .raid import router as raid_router, spawn_chat_task, stop_all_chat_tasks
from .seed import seed_dungeon, seed_items, seed_xinfa
from .team import router as team_router
from .warehouse import router as warehouse_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        await seed_xinfa(db)
        await seed_dungeon(db)
        await seed_items(db)
        # 服务（重启）恢复：给仍在进行中的副本补启聊天后台任务
        ongoing = (await db.execute(select(Raid.id).where(Raid.status == "进行中"))).scalars().all()
    for raid_id in ongoing:
        spawn_chat_task(raid_id)
    yield
    stop_all_chat_tasks()
    await engine.dispose()


app = FastAPI(title="GameLeader", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)

app.include_router(auth_router)
app.include_router(game_router)
app.include_router(team_router)
app.include_router(raid_router)
app.include_router(warehouse_router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
