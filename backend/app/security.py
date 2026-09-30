"""密码哈希（bcrypt）与 JWT 签发/校验。"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import get_settings
from .errors import ApiError

_ACCESS = "access"
_REFRESH = "refresh"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def _create_token(user_id: int, token_type: str, ttl: timedelta) -> str:
    settings = get_settings()
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + ttl,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_access_token(user_id: int) -> str:
    return _create_token(user_id, _ACCESS, timedelta(minutes=get_settings().access_token_minutes))


def create_refresh_token(user_id: int) -> str:
    return _create_token(user_id, _REFRESH, timedelta(days=get_settings().refresh_token_days))


def decode_token(token: str, expected_type: str) -> int:
    """解码并校验 token 类型，成功返回 user_id，失败抛对应业务码。"""
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise ApiError(401, 40101 if expected_type == _ACCESS else 40102, "登录已过期")
    except jwt.InvalidTokenError:
        raise ApiError(401, 40100 if expected_type == _ACCESS else 40102, "凭证无效")
    if payload.get("type") != expected_type:
        raise ApiError(401, 40100 if expected_type == _ACCESS else 40102, "凭证无效")
    return int(payload["sub"])
