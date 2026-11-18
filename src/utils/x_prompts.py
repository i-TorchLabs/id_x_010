"""Prompt 模板加载器（TASK-018）。

**三个 Agent 各自独立调用 ``load_prompt(key, **vars)``，不引入联动**——
模块文件头注释明确指出这一点。任何 Agent 不应通过本模块间接调用其它 Agent。

设计：
- 优先从 ``prompt_templates`` 表读 ``is_active=True`` 的最高 version；
- 表无数据时回退到 DEFAULTS 字典（与改造前行为一致）；
- 默认语言由 ``lang_var`` contextvar 决定（controllers 入口写入），
  ``load_prompt`` 内部把 DEFAULTS 按 lang 选择对应语言版本（TASK-016）；
- ``.format(**vars)`` 失败则返回未格式化的原始 content，避免 KeyError 阻塞主链路。
"""

from contextvars import ContextVar
from typing import Optional

from sqlalchemy import select
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.models.x_models import PromptTemplate, get_session
from x_models.id_x_010.src.prompts import load_prompt_lang

# 当前请求语言（"zh-CN" / "en-US"），由 stream_chat 入口从 Accept-Language 解析写入。
# 没有设置时视为 zh-CN，与改造前行为一致。
lang_var: ContextVar[str] = ContextVar("lang", default="zh-CN")

# 默认 prompt 副本——保持与各 Agent 原硬编码 prompt 一致；
# 实际各 Agent 内的 prompt 字符串保留作 fallback，load_prompt 仅在 PromptTemplate 表
# 有 is_active 行时覆盖。改造时把 DEFAULTS 各项填上原 prompt 内容（注释说明来源）
DEFAULTS = {
    # 来自 x_general_agent.DEFAULT_SYSTEM_PROMPT
    "general.system": (
        "你是一个智能助手，专注于帮助用户解决问题。\n\n"
        "在回答问题时，请先在 <thinking></thinking> 标签中思考和分析问题，"
        "然后再给出最终答案。"
    ),
    # 来自 x_sql_agent.GENERATE_QUERY_SYSTEM_PROMPT（精简版，完整版见 sql_agent.py）
    "sql.generate_query": (
        "你是一个专业的 SQL 专家，负责与 PostgreSQL 数据库交互。\n"
        "只生成 SELECT 查询语句，禁止修改数据。"
    ),
    "sql.intent_analysis": "",
    "code.system": (
        "你是一个代码助手，帮助用户理解和编写代码。"
    ),
    "vl.system": "你是视觉多模态助手，分析用户上传的图片并回答问题。",
}


async def load_prompt(key: str, **vars) -> str:
    """加载 prompt 模板并应用 vars 格式化。

    Args:
        key: prompt key，需在 DEFAULTS 中存在或 PromptTemplate 表中有对应行。
        **vars: 模板变量；若有则调 .format(**vars)。

    Returns:
        格式化后的 prompt 文本；表无数据时用 DEFAULTS。
    """
    content: Optional[str] = None
    try:
        async with get_session()() as session:
            tpl = (
                await session.execute(
                    select(PromptTemplate)
                    .where(
                        PromptTemplate.key == key,
                        PromptTemplate.is_active.is_(True),
                    )
                    .order_by(PromptTemplate.version.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if tpl is not None:
                content = tpl.content
    except Exception as e:
        logger.warning(
            f"{get_request_id()}load_prompt 读取失败 key={key}: "
            f"{type(e).__name__}: {e}"
        )

    if content is None:
        # 表无数据：返回空串，让调用方使用自己持有的完整版 prompt 兜底。
        #
        # 【性能/准确性修复】此前这里回退到 DEFAULTS/语言包的"精简版"文案——
        # 例如 sql.generate_query 的精简版只有两行，不含 {top_k}/{intent_guidance}
        # 占位符，导致 _generate_query_node 里精心设计的完整版
        # GENERATE_QUERY_SYSTEM_PROMPT（含 top_k 限制、意图塑形规则）永远不被
        # 使用：意图识别节点的 LLM 调用结果被静默丢弃，生成规则全部失效。
        # 精简版仅保留给"调用方自身没有 fallback"的场景（目前所有调用方
        # ——sql/general/code/vl agent——都有各自的完整硬编码 prompt）。
        try:
            lang = lang_var.get()
            fallback = load_prompt_lang(key, lang)
        except Exception:
            fallback = ""
        if not fallback:
            fallback = DEFAULTS.get(key, "")
        # 显式判定：仅当调用方没有传模板变量（说明它不需要占位符版 prompt）
        # 时才返回静态降级文案；带变量调用（如 sql.generate_query 的
        # top_k/intent_guidance）一律返回空串，强制走调用方完整版。
        if vars:
            return ""
        content = fallback
        if not content:
            return ""

    if not vars:
        return content

    try:
        return content.format(**vars)
    except (KeyError, IndexError) as e:
        # 变量缺失时不抛错，返回未格式化文本（调用方按需补 fallback）
        logger.warning(
            f"{get_request_id()}load_prompt format 失败 key={key}: "
            f"{type(e).__name__}: {e}"
        )
        return content


async def save_prompt_template(
    key: str,
    content: str,
    variables: Optional[dict],
    created_by: Optional[int],
) -> PromptTemplate:
    """新建一个版本并入库；自动 +1 版本号，旧版本 is_active 置 False。"""
    from sqlalchemy import func, update
    from x_models.id_x_010.src.models.x_models import PromptTemplate as _PT

    async with get_session()() as session:
        # 取该 key 当前最大版本号
        max_ver = (
            await session.execute(
                select(func.max(_PT.version)).where(_PT.key == key)
            )
        ).scalar_one()
        new_ver = (max_ver or 0) + 1

        # 旧版本全部置 inactive
        await session.execute(
            update(_PT)
            .where(_PT.key == key)
            .values(is_active=False)
        )

        tpl = _PT(
            key=key,
            version=new_ver,
            content=content,
            variables=variables,
            is_active=True,
            created_by=created_by,
        )
        session.add(tpl)
        await session.commit()
        await session.refresh(tpl)
        logger.info(
            f"{get_request_id()}save_prompt_template: key={key} version={new_ver} "
            f"created_by={created_by}"
        )
        return tpl
