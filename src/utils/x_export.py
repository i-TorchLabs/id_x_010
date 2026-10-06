"""数据导出工具（TASK-014）。

提供 CSV / XLSX / JSON 三种格式的同步导出能力。所有函数均返回 bytes，
由 controller 套上 base64 后通过 GraphQL 返回，前端 a.click() 触发下载。
"""

import csv
import io
import json
from typing import Dict, List


def export_csv(rows: List[Dict], columns: List[str]) -> bytes:
    """导出 CSV。用 utf-8-sig BOM 让 Excel 正确识别中文。"""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns)
    writer.writeheader()
    for r in rows:
        writer.writerow({c: _coerce_cell(r.get(c, "")) for c in columns})
    return buf.getvalue().encode("utf-8-sig")


def export_xlsx(rows: List[Dict], columns: List[str]) -> bytes:
    """导出 XLSX。延迟 import openpyxl 避免冷启动开销。"""
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(columns)
    for r in rows:
        ws.append([_coerce_cell(r.get(c, "")) for c in columns])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def export_json(rows: List[Dict]) -> bytes:
    """导出 JSON。default=str 兜底非可序列化类型（如 datetime）。"""
    return json.dumps(
        rows, default=str, ensure_ascii=False, indent=2
    ).encode("utf-8")


def _coerce_cell(value) -> str:
    """单元格值统一转字符串；None→空串，dict/list 转 JSON 文本。"""
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return str(value)
