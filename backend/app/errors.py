"""错误信封 {code, detail}：成功响应不带 code，前端按码分流而非解析文案。

业务码：40100 未登录 / 40101 access 过期 / 40102 refresh 失效 / 40103 封禁
      42200 校验失败 / 40900 资源冲突（如用户名已存在）
"""

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: int, detail: str):
        self.status = status
        self.code = code
        self.detail = detail
        super().__init__(detail)


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"code": exc.code, "detail": exc.detail})


async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    detail = "；".join(
        f"{'.'.join(str(x) for x in e['loc'][1:])}: {e['msg']}" for e in exc.errors()
    )
    return JSONResponse(status_code=422, content={"code": 42200, "detail": detail})
