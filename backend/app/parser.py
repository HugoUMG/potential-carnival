from __future__ import annotations

import re
from uuid import uuid4

from .domain import ActivityData, BlockData, WorksheetData

SUPPORTED_BLOCKS = {
    "fillblank",
    "multiplechoice",
    "multiselect",
    "dragdrop",
    "textbox",
    "matching",
    "speaking",
    "reading",
    "imagequestion",
    "listening",
    "listeningfillblank",
    "listeningmultiplechoice",
    "listeningmatching",
    "listeningtruefalse",
    "truefalse",
    "readingtruefalse",
}


class WorksheetScriptError(ValueError):
    """Se lanza cuando WorksheetScript no se puede convertir en JSON validado de hoja de trabajo."""


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
        raise WorksheetScriptError(f"Falta el bloque requerido {keyword}")

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

    raise WorksheetScriptError(f"Bloque {keyword} sin cerrar")


def _find_all_keyword_blocks(source: str, keyword: str) -> list[str]:
    """Devuelve los cuerpos de todos los bloques `keyword { ... }` encontrados."""
    bodies: list[str] = []
    cursor = 0
    while cursor < len(source):
        match = re.search(rf"\b{keyword}\s*{{", source[cursor:])
        if not match:
            break
        body_start = cursor + match.end()
        depth = 1
        idx = body_start
        while idx < len(source) and depth:
            if source[idx] == "{":
                depth += 1
            elif source[idx] == "}":
                depth -= 1
            idx += 1
        if depth:
            raise WorksheetScriptError(f"Bloque {keyword} sin cerrar")
        bodies.append(source[body_start : idx - 1])
        cursor = idx
    return bodies


def _parse_info_fields(worksheet_body: str) -> list[str]:
    """Extrae los campos del bloque opcional info { fields: [...] }."""
    match = re.search(r"\binfo\s*{", worksheet_body)
    if not match:
        return []
    start = match.end()
    depth = 1
    cursor = start
    while cursor < len(worksheet_body) and depth:
        if worksheet_body[cursor] == "{":
            depth += 1
        elif worksheet_body[cursor] == "}":
            depth -= 1
        cursor += 1
    if depth:
        return []
    info_body = worksheet_body[start : cursor - 1]
    return _get_list(info_body, "fields")


def _parse_theme(worksheet_body: str) -> dict[str, str] | None:
    match = re.search(r"\btheme\s*{", worksheet_body)
    if not match:
        return None
    start = match.end()
    depth = 1
    cursor = start
    while cursor < len(worksheet_body) and depth:
        if worksheet_body[cursor] == "{":
            depth += 1
        elif worksheet_body[cursor] == "}":
            depth -= 1
        cursor += 1
    if depth:
        return None
    theme_body = worksheet_body[start : cursor - 1]
    theme: dict[str, str] = {}
    for key in ("primary_color", "background_color", "text_color"):
        val = _get_scalar(theme_body, key)
        if val:
            theme[key] = val
    return theme or None


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
            raise WorksheetScriptError(f"Bloque {activity_type} sin cerrar")
        blocks.append((activity_type, source[body_start : index - 1]))
        cursor = index
    return blocks


def _key_pattern(key: str) -> str:
    return rf"{key}\s*\"?"


def _get_scalar(body: str, key: str, default: str | None = None) -> str | None:
    key_pattern = _key_pattern(key)
    multiline = re.search(rf'^\s*{key_pattern}:\s*"""(.*?)"""', body, re.MULTILINE | re.DOTALL)
    if multiline:
        return multiline.group(1).strip()
    match = re.search(rf"^\s*{key_pattern}:\s*(.+)$", body, re.MULTILINE)
    if match:
        return _strip_quotes(match.group(1))
    return default


def _get_list(body: str, key: str) -> list[str]:
    key_pattern = _key_pattern(key)
    match = re.search(rf"^\s*{key_pattern}:\s*\n((?:\s*-\s*.+\n?)+)", body, re.MULTILINE)
    if match:
        return [_strip_quotes(line.split("-", 1)[1]) for line in match.group(1).splitlines() if line.strip().startswith("-")]
    # ponytail: también acepta el formato inline `key: [a, b, c]`
    scalar = _get_scalar(body, key)
    if scalar and scalar.startswith("["):
        return _parse_inline_array(scalar) or []
    return []


def _parse_inline_array(raw: str) -> list[str] | None:
    """Parsea 'answer: ["a", "b", "c"]' o "answer: [a, b, c]" como lista.
    Retorna None si raw no empieza con '['.
    """
    raw = raw.strip()
    if not (raw.startswith("[") and raw.endswith("]")):
        return None
    inner = raw[1:-1]
    # Split por coma respetando comillas
    items: list[str] = []
    current: list[str] = []
    in_quote = False
    for ch in inner:
        if ch == '"' and not in_quote:
            in_quote = True
        elif ch == '"' and in_quote:
            in_quote = False
        elif ch == ',' and not in_quote:
            items.append(_strip_quotes("".join(current).strip()))
            current = []
            continue
        current.append(ch)
    if current:
        items.append(_strip_quotes("".join(current).strip()))
    return [i for i in items if i]


def _get_answer(body: str):
    values = _get_list(body, "answer")
    if values:
        return values
    scalar = _get_scalar(body, "answer")
    if scalar and scalar.startswith("["):
        parsed = _parse_inline_array(scalar)
        if parsed:
            return parsed
    return scalar


def _get_statements(body: str) -> list[dict]:
    """Parsea enunciados True/False desde dos formatos:
    1. Lista: statements:\n  - Texto del enunciado. | true
    2. Bloques: statement { text: "..." answer: true }
    """
    list_match = re.search(r"^\s*statements?\s*:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)", body, re.MULTILINE)
    if list_match:
        statements = []
        for line in list_match.group(1).splitlines():
            line = line.strip()
            if not line.startswith("-"):
                continue
            content = line[1:].strip()
            if "|" in content:
                parts = content.rsplit("|", 1)
                text = _strip_quotes(parts[0].strip())
                answer = parts[1].strip().lower() == "true"
            else:
                text = _strip_quotes(content)
                answer = True
            if text:
                statements.append({"text": text, "answer": answer})
        if statements:
            return statements
    # Fallback: bloques statement { text: "..." answer: true }
    stmt_bodies = _find_all_keyword_blocks(body, "statement")
    return [
        {"text": t, "answer": (a or "").strip().lower() == "true"}
        for sb in stmt_bodies
        for t, a in [(_get_scalar(sb, "text"), _get_scalar(sb, "answer"))]
        if t
    ]


def parse_activity(activity_type: str, body: str) -> ActivityData:
    common = {"id": str(uuid4()), "type": activity_type, "instructions": _get_scalar(body, "instructions")}
    if activity_type == "fillblank":
        return ActivityData(**common, text=_get_scalar(body, "text"), answer=_get_answer(body))
    if activity_type == "dragdrop":
        # Oración con _____ + banco de palabras arrastrables. answer = palabra correcta por hueco.
        answer = _get_answer(body)
        if not isinstance(answer, list):
            answer = [answer] if answer else []
        return ActivityData(**common, text=_get_scalar(body, "text"), answer=answer, bank=_get_list(body, "bank"))
    if activity_type == "multiplechoice":
        return ActivityData(**common, question=_get_scalar(body, "question"), options=_get_list(body, "options"), answer=_get_answer(body))
    if activity_type == "multiselect":
        answer = _get_answer(body)
        if not isinstance(answer, list):
            answer = [answer] if answer else []
        return ActivityData(**common, question=_get_scalar(body, "question"), options=_get_list(body, "options"), answer=answer)
    if activity_type == "textbox":
        return ActivityData(**common, prompt=_get_scalar(body, "prompt"))
    if activity_type == "speaking":
        # target: oración a leer en voz alta (modo lectura). Sin target = pregunta abierta (IA).
        return ActivityData(**common, prompt=_get_scalar(body, "prompt"), target=_get_scalar(body, "target"))
    if activity_type == "matching":
        return ActivityData(**common, left=_get_list(body, "left"), right=_get_list(body, "right"))
    if activity_type == "reading":
        return ActivityData(**common, title=_get_scalar(body, "title"), content=_get_scalar(body, "content"), questions=_get_list(body, "questions"))
    if activity_type == "imagequestion":
        return ActivityData(**common, image=_get_scalar(body, "image"), prompt=_get_scalar(body, "prompt"))
    if activity_type == "listening":
        return ActivityData(**common, text=_get_scalar(body, "text"), question=_get_scalar(body, "question"), answer=_get_answer(body))
    if activity_type == "listeningfillblank":
        return ActivityData(**common, audio_text=_get_scalar(body, "audio_text"), text=_get_scalar(body, "text"), answer=_get_answer(body))
    if activity_type == "listeningmultiplechoice":
        return ActivityData(**common, audio_text=_get_scalar(body, "audio_text"), question=_get_scalar(body, "question"), options=_get_list(body, "options"), answer=_get_answer(body))
    if activity_type == "listeningmatching":
        pair_bodies = _find_all_keyword_blocks(body, "pair")
        pairs = [
            {"audio_text": at, "match": m}
            for pb in pair_bodies
            for at, m in [(_get_scalar(pb, "audio_text"), _get_scalar(pb, "match"))]
            if at and m
        ]
        return ActivityData(**common, pairs=pairs or None, options=_get_list(body, "options") or None)
    if activity_type == "listeningtruefalse":
        statements = _get_statements(body)
        return ActivityData(**common, audio_text=_get_scalar(body, "audio_text"), statements=statements or None)
    if activity_type == "truefalse":
        statements = _get_statements(body)
        return ActivityData(**common, statements=statements or None)
    if activity_type == "readingtruefalse":
        statements = _get_statements(body)
        return ActivityData(**common, title=_get_scalar(body, "title"), content=_get_scalar(body, "content"), statements=statements or None)
    raise WorksheetScriptError(f"Tipo de actividad no compatible: {activity_type}")


def parse_worksheet_script(script: str) -> WorksheetData:
    worksheet_body = _extract_block(script, "worksheet")
    title = _get_scalar(worksheet_body, "title")
    if not title:
        raise WorksheetScriptError("El título de la hoja es obligatorio")
    description = _get_scalar(worksheet_body, "description", "") or ""
    theme = _parse_theme(worksheet_body)
    info_fields = _parse_info_fields(worksheet_body)

    block_bodies = _find_all_keyword_blocks(worksheet_body, "block")
    if block_bodies:
        blocks: list[BlockData] = []
        for block_body in block_bodies:
            block_title = _get_scalar(block_body, "title")
            block_instructions = _get_scalar(block_body, "instructions")
            block_activities = [parse_activity(t, b) for t, b in _find_activity_blocks(block_body)]
            blocks.append(BlockData(title=block_title, instructions=block_instructions, activities=block_activities))
        if not any(b.activities for b in blocks):
            raise WorksheetScriptError("Se requiere al menos una actividad")
        return WorksheetData(title=title, description=description, blocks=blocks, theme=theme, info_fields=info_fields)

    activities = [parse_activity(activity_type, body) for activity_type, body in _find_activity_blocks(worksheet_body)]
    if not activities:
        raise WorksheetScriptError("Se requiere al menos una actividad")
    return WorksheetData(title=title, description=description, activities=activities, theme=theme, info_fields=info_fields)
