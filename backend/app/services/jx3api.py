"""jx3api（www.jx3api.com）精简客户端：本仓库目前只用到免费骚话接口。

与 jx3 机器人项目里的同名客户端无关——那是完整版（token/名片/时间线等）。"""

import httpx


class Jx3ApiError(RuntimeError):
    """jx3api 业务错误（HTTP 失败或 code != 200）。"""


class Jx3ApiClient:
    BASE = "https://www.jx3api.com"

    def __init__(self) -> None:
        self._http = httpx.AsyncClient(timeout=15)

    async def close(self) -> None:
        await self._http.aclose()

    async def saohua_random(self) -> str:
        """随机骚话：返回一条骚话文本（免费接口，无需 token）。"""
        resp = await self._http.get(self.BASE + "/saohua/random")
        resp.raise_for_status()
        body = resp.json()
        text = (body.get("data") or {}).get("text", "") if isinstance(body.get("data"), dict) else ""
        if body.get("code") != 200 or not text:
            raise Jx3ApiError(f"saohua/random: {body.get('msg')}")
        return str(text)


# 进程级单例
client = Jx3ApiClient()
