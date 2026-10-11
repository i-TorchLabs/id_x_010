"""管理员守卫（TASK-013）。

供 Mutation 中所有 admin 类操作（resetUserPassword / setUserAdmin /
addSqlExample 升级版 / savePromptTemplate 等）调用，统一鉴权。
非管理员抛 403；调用方在 strawberry mutation 内部应 try/except 后返回
结构化错误响应（避免 HTTPException 直接转 GraphQL error）。
"""

from typing import Optional

from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.models.x_models import User


class AdminRequiredError(Exception):
    """管理员权限不足异常；mutation 捕获后返回 success=False。"""

    def __init__(self, message: str = "需要管理员权限") -> None:
        super().__init__(message)
        self.message = message


async def require_admin(request) -> Optional[User]:
    """鉴权：返回当前登录管理员 User；非管理员或不登录抛 AdminRequiredError。

    role 为权威字段（admin=管理员 / user=普通用户），is_admin 作为兼容兜底；
    二者任一为管理员即放行，适配老库未回填 role 的过渡期。

    Args:
        request: Litestar Request 对象（由 _get_info_request(info) 拿到）。

    Raises:
        AdminRequiredError: 未登录 / 非管理员 / role 与 is_admin 均缺失。
    """
    if request is None:
        raise AdminRequiredError("请求上下文缺失")

    # 延迟导入避免循环：controllers 既 import middleware 又定义 _get_bearer_user
    from x_models.id_x_010.src.controllers.x_controllers import _get_bearer_user

    user = await _get_bearer_user(request)
    if user is None:
        raise AdminRequiredError("未登录")

    # role 权威，is_admin 兼容兜底；老库 role 缺失视为 "user"
    role = getattr(user, "role", None) or (
        "admin" if getattr(user, "is_admin", False) else "user"
    )
    is_admin_flag = role == "admin" or bool(getattr(user, "is_admin", False))
    if not is_admin_flag:
        logger.warning(
            f"{get_request_id()}require_admin 拒绝非管理员: "
            f"user_id={user.id}, email={user.email}, role={role}"
        )
        raise AdminRequiredError("需要管理员权限")

    # role 与 is_admin 不一致时回填同步（老库过渡期）
    if role == "admin" and not getattr(user, "is_admin", False):
        try:
            user.is_admin = True
        except Exception:
            pass

    return user
