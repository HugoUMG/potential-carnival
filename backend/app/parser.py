from __future__ import annotations

import re
from uuid import uuid4

from .domain import ActivityData, WorksheetData

SUPPORTED_BLOCKS = {
    "fillblank",
    "multiplechoice",
    "textbox",
    "matching",
    "speaking",
    "reading",
    "imagequestion",
}


class WorksheetScriptError(ValueError):
    """Raised when WorksheetScript cannot be parsed into validated worksheet JSON."""


def _strip_quotes(value: str) -> str:
    value = value.strip()
    if value.startswith('"""') and value.endswith('"""'):
        return value[3:-3].strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return value[1:-1]
    return value


def _extract_block(source: str, keyword: str) -> str:
    match = re.search(rf"\b{keyword}\s*{{", source)
    if not match:
        raise WorksheetScriptError(f"Missing required {keyword} block")

    start = match.end()
    depth = 1
    cursor = start
    while cursor < len(source):
        char = source[cursor]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start:cursor]
        cursor += 1

    raise WorksheetScriptError(f"Unclosed {keyword} block")


def _find_activity_blocks(source: str) -> list[tuple[str, str]]:
    blocks: list[tuple[str, str]] = []
    cursor = 0
    while cursor < len(source):
        match = re.search(r"\b([a-z]+)\s*{", source[cursor:])
        if not match:
            break
        activity_type = match.group(1)
        absolute_start = cursor + match.start()
        if activity_type not in SUPPORTED_BLOCKS:
            cursor = absolute_start + len(activity_type)
            continue
        body_start = cursor + match.end()
        depth = 1
        index = body_start
        while index < len(source) and depth:
            if source[index] == "{":
                depth += 1
            elif source[index] == "}":
                depth -= 1
            index += 1
        if depth:
            raise WorksheetScriptError(f"Unclosed {activity_type} block")
        blocks.append((activity_type, source[body_start : index - 1]))
        cursor = index
    return blocks


def _get_scalar(body: str, key: str, default: str | None = None) -> str | None:
    multiline = re.search(rf"^\s*{key}:\s*\"\"\"(.*?)\"\"\"", body, re.MULTILINE | re.DOTALL)
    if multiline:
        return multiline.group(1).strip()
    match = re.search(rf"^\s*{key}:\s*(.+)$", body, re.MULTILINE)
    if match:
        return _strip_quotes(match.group(1))
    return default


def _get_list(body: str, key: str) -> list[str]:
    match = re.search(rf"^\s*{key}:\s*\n((?:\s*-\s*.+\n?)+)", body, re.MULTILINE)
    if not match:
        return []
    return [_strip_quotes(line.split("-", 1)[1]) for line in match.group(1).splitlines() if line.strip().startswith("-")]


def parse_activity(activity_type: str, body: str) -> ActivityData:
    common = {"id": str(uuid4()), "type": activity_type}
    if activity_type == "fillblank":
        return ActivityData(**common, text=_get_scalar(body, "text"), answer=_get_scalar(body, "answer"))
    if activity_type == "multiplechoice":
        return ActivityData(**common, question=_get_scalar(body, "question"), options=_get_list(body, "options"), answer=_get_scalar(body, "answer"))
    if activity_type in {"textbox", "speaking"}:
        return ActivityData(**common, prompt=_get_scalar(body, "prompt"))
    if activity_type == "matching":
        return ActivityData(**common, left=_get_list(body, "left"), right=_get_list(body, "right"))
    if activity_type == "reading":
        return ActivityData(**common, title=_get_scalar(body, "title"), content=_get_scalar(body, "content"), questions=_get_list(body, "questions"))
    if activity_type == "imagequestion":
        return ActivityData(**common, image=_get_scalar(body, "image"), prompt=_get_scalar(body, "prompt"))
    raise WorksheetScriptError(f"Unsupported activity type: {activity_type}")


def parse_worksheet_script(script: str) -> WorksheetData:
    worksheet_body = _extract_block(script, "worksheet")
    title = _get_scalar(worksheet_body, "title")
    if not title:
        raise WorksheetScriptError("Worksheet title is required")
    description = _get_scalar(worksheet_body, "description", "") or ""
    activities = [parse_activity(activity_type, body) for activity_type, body in _find_activity_blocks(worksheet_body)]
    if not activities:
        raise WorksheetScriptError("At least one activity is required")
    return WorksheetData(title=title, description=description, activities=activities)
