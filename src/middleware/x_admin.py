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

    Args:
        request: Litestar Request 对象（由 _get_info_request(info) 拿到）。

    Raises:
        AdminRequiredError: 未登录 / 非管理员 / is_admin 字段缺失。
    """
    if request is None:
        raise AdminRequiredError("请求上下文缺失")

    # 延迟导入避免循环：controllers 既 import middleware 又定义 _get_bearer_user
    from x_models.id_x_010.src.controllers.x_controllers import _get_bearer_user

    user = await _get_bearer_user(request)
    if user is None:
        raise AdminRequiredError("未登录")

    # is_admin 字段在 TASK-013 才加入；getattr 兜底，老库升级中视为非 admin
    if not getattr(user, "is_admin", False):
        logger.warning(
            f"{get_request_id()}require_admin 拒绝非管理员: user_id={user.id}, email={user.email}"
        )
        raise AdminRequiredError("需要管理员权限")

    return user
