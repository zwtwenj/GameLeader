"""GameLeader 后端入口。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from .auth import router as auth_router
from .db import Base, SessionLocal, engine
from .errors import ApiError, api_error_handler, validation_error_handler
from .game import router as game_router
from .models import (  # noqa: F401  确保 create_all 时表已注册
    Boss,
    Dungeon,
    Member,
    RecruitOffer,
    Team,
    User,
    Xinfa,
)
from .seed import seed_dungeon, seed_xinfa
from .team import router as team_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        await seed_xinfa(db)
        await seed_dungeon(db)
    yield
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


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
