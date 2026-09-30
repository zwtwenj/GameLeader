# 游戏会长（GameLeader）

公会模拟经营小游戏：玩家扮演会长，招募 NPC 成员、开启副本、竞拍装备、提升团队装等。玩法与数值设计见 [plan.md](./plan.md)、副本数值见 [副本.md](./副本.md)。

## 结构

```
backend/   FastAPI + SQLAlchemy(async) + MySQL + JWT（端口 8100）
web/       Vite + React + TS + zustand + Tailwind v4（端口 5173）
```

## 启动

```bash
# 后端（首次：复制 backend/.env.example 为 backend/.env 并填库和 JWT 密钥）
cd backend && python -m venv venv && venv/Scripts/pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
venv/Scripts/python -m uvicorn app.main:app --port 8100

# 前端
cd web && npm install && npm run dev
```

表结构首次启动自动 create_all。接口约定：统一错误信封 `{code, detail}`（40100 未登录 / 40101 access 过期 / 40102 refresh 失效 / 42200 校验 / 40900 冲突）。

## 进度

- [x] 用户登录模块（JWT 双 token、静默续期、软删除）
- [ ] M1 团队功能：建团 / 招募成员 / 开启副本
