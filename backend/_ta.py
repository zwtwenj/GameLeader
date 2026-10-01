import asyncio
import httpx


async def main():
    async with httpx.AsyncClient(timeout=30, base_url="http://127.0.0.1:8100") as c:
        r = await c.post(
            "/api/auth/login", json={"username": "t_u2", "password": "test123456"}
        )
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = await c.get("/api/team/me", headers=h)
        for m in r.json()["team"]["members"]:
            print(m["id"], m["name"], m["sect"], m["xinfa"], "| 装等", m["equip_level"])


asyncio.run(main())
