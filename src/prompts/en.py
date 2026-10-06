"""English prompts (TASK-016).

Mirrors the keys in zh.py. When Accept-Language is en-*, these are used.
"""

PROMPTS = {
    "general.system": (
        "You are an intelligent assistant focused on helping users solve problems.\n\n"
        "When answering, please first think and analyze the question within "
        "<thinking></thinking> tags, then provide the final answer."
    ),
    "sql.generate_query": (
        "You are a professional SQL expert working with PostgreSQL.\n"
        "Generate only SELECT queries; modification statements are forbidden."
    ),
    "code.system": "You are a coding assistant helping users understand and write code.",
    "vl.system": "You are a vision multimodal assistant analyzing uploaded images.",
}
