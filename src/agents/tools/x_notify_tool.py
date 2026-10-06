"""通知工具（General Agent 专用，不暴露给其它 Agent）。

本期为占位实现：仅返回"通知已发送（占位）"字符串。后续接入邮件/企业微信时
替换函数体即可，工具签名不变。
"""

from langchain_core.tools import tool


@tool
def notify_tool(message: str, channel: str = "email") -> str:
    """发送通知消息（占位实现）。后续接入邮件 / 企业 webhook 后替换函数体。

    Args:
        message: 通知正文。
        channel: 通道，"email" 或 "wechat"；默认 email。

    Returns:
        占位响应字符串。
    """
    # 占位实现：不接外部系统，仅记录意图；任务编排可参考 TASK-012 的 WebSocket
    # 审批与 TASK-014 的定时报告中的实际通知出口。
    return f"通知已发送（占位）channel={channel}, message_len={len(message)}"
