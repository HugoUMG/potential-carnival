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
    "imagechoice",
    "imagematching",
    "listening",
    "listeningfillblank",
    "listeningmultiplechoice",
    "listeningmatching",
    "listeningtruefalse",
    "listeningorder",
    "conversation",
    "content",
    "truefalse",
    "readingtruefalse",
}


# Tipos que NO pasan a papel: necesitan audio o micrófono. Es la misma lista que descarta
# `isPrintable()` en src/components/WorksheetPrint.tsx — si una cambia, la otra también.
NON_PRINTABLE_TYPES = {b for b in SUPPORTED_BLOCKS if b.startswith("listening")} | {"speaking", "conversation"}
PRINTABLE_TYPES = SUPPORTED_BLOCKS - NON_PRINTABLE_TYPES


class WorksheetScriptError(ValueError):
    """Se lanza cuando WorksheetScript no se puede convertir en JSON validado de hoja de trabajo."""


def _strip_quotes(value: str) -> str:
    value = value.strip()
    if value.startswith('"""') and value.endswith('"""'):
        return value[3:-3].strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return value[1:-1]
    return value


def _matching_brace(source: str, start: int) -> int:
    """Dado `start` (índice justo después del '{' de apertura), devuelve el índice del '}'
    que lo cierra, **ignorando las llaves dentro de strings triple-comilla** (\"\"\"...\"\"\").
    Así un bloque `content { html: \"\"\"<style>body{...}</style>\"\"\" }` con CSS/JS/HTML no
    descuadra el conteo de llaves. Devuelve -1 si no se cierra."""
    depth = 1
    i = start
    n = len(source)
    while i < n:
        if source.startswith('"""', i):  # saltar el contenido triple-comilla completo
            end = source.find('"""', i + 3)
            if end == -1:
                return -1
            i = end + 3
            continue
        char = source[i]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _extract_block(source: str, keyword: str) -> str:
    match = re.search(rf"\b{keyword}\s*{{", source)
    if not match:
        raise WorksheetScriptError(f"Falta el bloque requerido {keyword}")
    end = _matching_brace(source, match.end())
    if end == -1:
        raise WorksheetScriptError(f"Bloque {keyword} sin cerrar")
    return source[match.end():end]


def _find_all_keyword_blocks(source: str, keyword: str) -> list[str]:
    """Devuelve los cuerpos de todos los bloques `keyword { ... }` encontrados."""
    bodies: list[str] = []
    cursor = 0
    while cursor < len(source):
        match = re.search(rf"\b{keyword}\s*{{", source[cursor:])
        if not match:
            break
        body_start = cursor + match.end()
        end = _matching_brace(source, body_start)
        if end == -1:
            raise WorksheetScriptError(f"Bloque {keyword} sin cerrar")
        bodies.append(source[body_start:end])
        cursor = end + 1
    return bodies


def _parse_info_fields(worksheet_body: str) -> list[str]:
    """Extrae los campos del bloque opcional info { fields: [...] }."""
    match = re.search(r"\binfo\s*{", worksheet_body)
    if not match:
        return []
    end = _matching_brace(worksheet_body, match.end())
    if end == -1:
        return []
    info_body = worksheet_body[match.end():end]
    return _get_list(info_body, "fields")


def _parse_theme(worksheet_body: str) -> dict[str, str] | None:
    match = re.search(r"\btheme\s*{", worksheet_body)
    if not match:
        return None
    end = _matching_brace(worksheet_body, match.end())
    if end == -1:
        return None
    theme_body = worksheet_body[match.end():end]
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
        end = _matching_brace(source, body_start)
        if end == -1:
            raise WorksheetScriptError(f"Bloque {activity_type} sin cerrar")
        blocks.append((activity_type, source[body_start:end]))
        cursor = end + 1
    return blocks


def _block_header(block_body: str) -> str:
    """Trozo de un `block {}` ANTES de su primera actividad: donde viven sus campos propios
    (`title`, `instructions`, `text`, `audio_text`, `lines`, `voice`, `rate`).

    Sin este recorte `_get_scalar(block_body, "title")` encontraría el `title:` de un
    `reading {}` hijo y el bloque se quedaría con el título de la actividad; con el estímulo
    compartido sería peor: el `audio_text:` de un `listeningfillblank` hijo le montaría al
    bloque un reproductor que el profesor nunca pidió."""
    cursor = 0
    while cursor < len(block_body):
        match = re.search(r"\b([a-z]+)\s*{", block_body[cursor:])
        if not match:
            return block_body
        if match.group(1) in SUPPORTED_BLOCKS:
            return block_body[:cursor + match.start()]
        cursor += match.end()
    return block_body


def strip_non_printable(script: str) -> str:
    """Quita del script las actividades que no pasan a papel (modo físico de la IA).

    Se hace sobre el SCRIPT y no sobre el JSON a propósito: `script_content` es lo que se vuelve a
    parsear cada vez que el profesor guarda. Si solo se filtrara el json, las actividades de audio
    reaparecerían al primer guardado.

    ponytail: recorte por texto reusando el contador de llaves del parser; no se reindenta ni se
    limpia el `block {}` que quede vacío (el renderer y la impresión ya ignoran un bloque sin
    actividades). Si algún día hay que reescribir el script, tocaría serializar desde WorksheetData.
    """
    out = script
    for activity_type in sorted(NON_PRINTABLE_TYPES):
        while True:
            match = re.search(rf"^[ \t]*{activity_type}\s*{{", out, re.MULTILINE)
            if not match:
                break
            end = _matching_brace(out, match.end())
            if end == -1:
                break  # bloque sin cerrar: lo reporta el parser con su propio mensaje
            tail = out[end + 1:]
            out = out[:match.start()] + (tail[1:] if tail.startswith("\n") else tail)
    # Un `block {}` con audio compartido se va ENTERO: sus actividades sí son de tipos
    # imprimibles, pero en papel serían preguntas sobre un audio que nadie va a oír.
    cursor = 0
    while True:
        match = re.search(r"^[ \t]*block\s*{", out[cursor:], re.MULTILINE)
        if not match:
            break
        start = cursor + match.start()
        body_start = cursor + match.end()
        end = _matching_brace(out, body_start)
        if end == -1:
            break
        header = _block_header(out[body_start:end])
        if _get_scalar(header, "audio_text") or _parse_conversation_lines(header):
            tail = out[end + 1:]
            out = out[:start] + (tail[1:] if tail.startswith("\n") else tail)
            cursor = start
        else:
            cursor = end + 1
    return out


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

    Un enunciado sin valor deja `answer` en None y la validación lo rechaza. Antes se asumía
    `true`: la clave de respuestas quedaba mal EN SILENCIO y marcaba como incorrectos a los
    alumnos que habían respondido bien.
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
                answer = None  # sin pipe no hay clave: lo detecta _activity_problem
            if text:
                statements.append({"text": text, "answer": answer})
        if statements:
            return statements
    # Fallback: bloques statement { text: "..." answer: true }
    stmt_bodies = _find_all_keyword_blocks(body, "statement")
    return [
        {"text": t, "answer": None if a is None else a.strip().lower() == "true"}
        for sb in stmt_bodies
        for t, a in [(_get_scalar(sb, "text"), _get_scalar(sb, "answer"))]
        if t
    ]


def _parse_pairs(body: str) -> list[dict]:
    """Pares de `listeningmatching`. Formato canónico: bloques `pair { audio_text match }`.
    También acepta la lista `pairs:` — es lo que emite el constructor visual y lo que escribe
    la IA por costumbre YAML; antes se ignoraba en silencio y la actividad quedaba vacía."""
    pair_bodies = _find_all_keyword_blocks(body, "pair")
    if pair_bodies:
        return [
            {"audio_text": at, "match": m}
            for pb in pair_bodies
            for at, m in [(_get_scalar(pb, "audio_text"), _get_scalar(pb, "match"))]
            if at and m
        ]
    header = re.search(r"^[ \t]*pairs?\s*:\s*$", body, re.MULTILINE)
    if not header:
        return []
    chunks: list[list[str]] = []
    for line in body[header.end():].splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if re.match(r"^(options|instructions|voice|rate)\s*:", stripped):
            break  # fin de la lista: empieza otro campo de la actividad
        if stripped.startswith("-"):
            chunks.append([stripped[1:].strip()])
        elif chunks:
            chunks[-1].append(stripped)
        else:
            break
    pairs = []
    for chunk in chunks:
        chunk_body = "\n".join(chunk)
        audio_text, match = _get_scalar(chunk_body, "audio_text"), _get_scalar(chunk_body, "match")
        if audio_text and match:
            pairs.append({"audio_text": audio_text, "match": match})
    return pairs


def _parse_conversation_lines(body: str) -> list[dict]:
    """Parsea `lines:` de una conversación. Cada ítem: `- f: "texto"` o `- m: "texto"`.
    speaker se normaliza a 'female' (empieza con f) o 'male'."""
    match = re.search(r"^\s*lines\s*:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)", body, re.MULTILINE)
    if not match:
        return []
    result: list[dict] = []
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line.startswith("-"):
            continue
        content = line[1:].strip()
        if ":" not in content:
            continue
        speaker_raw, text_raw = content.split(":", 1)
        speaker = "female" if speaker_raw.strip().lower().startswith("f") else "male"
        text = _strip_quotes(text_raw.strip())
        if text:
            result.append({"speaker": speaker, "text": text})
    return result


def _normalize_bool(raw: str | None) -> bool | None:
    if raw and raw.strip().lower() in ("true", "yes", "1", "sí", "si"):
        return True
    return None


def _normalize_voice(raw: str | None) -> str | None:
    """Normaliza el campo `voice` de un listening a 'male'/'female'.
    Un valor desconocido se pasa tal cual (permite un nombre de voz edge-tts literal)."""
    if not raw:
        return None
    v = raw.strip().lower()
    if v in ("female", "f", "mujer", "femenina", "woman"):
        return "female"
    if v in ("male", "m", "hombre", "masculina", "man"):
        return "male"
    return raw.strip()


# Velocidad de síntesis: edge-tts REGENERA el audio más lento (articulación y pausas limpias), que
# no es estirar la onda ya grabada. El vocabulario es cerrado a propósito — al revés que `voice`,
# donde cualquier nombre desconocido puede ser una de las ~47 voces de edge-tts.
_RATES = {
    "very slow": "-35%", "very_slow": "-35%", "muy lento": "-35%", "muy despacio": "-35%",
    "slow": "-15%", "lento": "-15%", "despacio": "-15%",
    "normal": "+0%", "natural": "+0%",
}


def _normalize_rate(raw: str | None) -> str | None:
    """Normaliza el campo `rate` a la forma `±NN%` que entiende edge-tts.
    Un valor irreconocible es un error: si se ignorara en silencio, el profesor creería que la hoja
    va lenta cuando no lo está."""
    if not raw:
        return None
    v = " ".join(raw.strip().lower().split())
    if v in _RATES:
        return _RATES[v]
    if re.match(r"^[+-]\d{1,2}%$", v):
        return v
    raise WorksheetScriptError(
        f"`rate: {raw.strip()}` no es una velocidad válida. Usa `very slow`, `slow`, `normal` o "
        "un porcentaje como `-25%`."
    )


def parse_activity(activity_type: str, body: str) -> ActivityData:
    # `note`: nota privada del profesor. La lee SOLO la IA al calificar; nunca llega al alumno
    # (se elimina del payload público en main.py). Vale para cualquier tipo, como `instructions`.
    common = {
        "id": str(uuid4()),
        "type": activity_type,
        "instructions": _get_scalar(body, "instructions"),
        "note": _get_scalar(body, "note"),
    }
    if activity_type.startswith("listening"):
        common["voice"] = _normalize_voice(_get_scalar(body, "voice"))
        common["rate"] = _normalize_rate(_get_scalar(body, "rate"))
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
    if activity_type == "imagechoice":
        # Opción múltiple con imagen. `options` sigue siendo la clave (texto legible);
        # `option_images` es una lista PARALELA por índice que decide qué se pinta.
        return ActivityData(
            **common,
            image=_get_scalar(body, "image"),
            question=_get_scalar(body, "question"),
            options=_get_list(body, "options"),
            option_images=_get_list(body, "option_images") or None,
            answer=_get_answer(body),
        )
    if activity_type == "imagematching":
        # Emparejar imagen con palabra: mismo modelo de respuesta que `matching`.
        # `left` es opcional; sin él se numeran las imágenes para que la clave del profesor se lea
        # ("Image 1" → "dog") en vez de mostrar una URL de 90 caracteres en la revisión.
        left_images = _get_list(body, "left_images")
        left = _get_list(body, "left") or [f"Image {i + 1}" for i in range(len(left_images))]
        return ActivityData(**common, left=left, left_images=left_images or None, right=_get_list(body, "right"))
    if activity_type == "listening":
        return ActivityData(**common, text=_get_scalar(body, "text"), question=_get_scalar(body, "question"), answer=_get_answer(body))
    if activity_type == "listeningfillblank":
        return ActivityData(**common, audio_text=_get_scalar(body, "audio_text"), text=_get_scalar(body, "text"), answer=_get_answer(body))
    if activity_type == "listeningmultiplechoice":
        return ActivityData(**common, audio_text=_get_scalar(body, "audio_text"), question=_get_scalar(body, "question"), options=_get_list(body, "options"), answer=_get_answer(body))
    if activity_type == "listeningmatching":
        return ActivityData(**common, pairs=_parse_pairs(body) or None, options=_get_list(body, "options") or None)
    if activity_type == "listeningtruefalse":
        statements = _get_statements(body)
        return ActivityData(**common, audio_text=_get_scalar(body, "audio_text"), statements=statements or None)
    if activity_type == "listeningorder":
        # Escuchar y ordenar: audio oculto + fichas desordenadas que se arrastran/tocan.
        # answer = oración en orden (una ficha por elemento). bank opcional (si falta, el front baraja answer).
        answer = _get_answer(body)
        if not isinstance(answer, list):
            answer = [answer] if answer else []
        return ActivityData(**common, audio_text=_get_scalar(body, "audio_text"), answer=answer, bank=_get_list(body, "bank") or None)
    if activity_type == "conversation":
        # Diálogo con voces alternadas (m/f) fusionadas en un audio + pregunta.
        # answer opcional: con answer se autocalifica; sin answer queda pendiente (IA/profesor).
        return ActivityData(**common, lines=_parse_conversation_lines(body) or None, question=_get_scalar(body, "question"), answer=_get_answer(body))
    if activity_type == "content":
        # Bloque informativo: repaso del tema en HTML (se sanea en el front con DOMPurify).
        # Solo lectura: sin input, sin calificación. `html` admite string multilínea ("""...""").
        # ponytail: el DSL cuenta llaves {} para delimitar bloques; el HTML/CSS debe tener
        #           llaves balanceadas (todo HTML válido lo está). Una llave suelta en texto
        #           rompería el parseo → usar &#123;/&#125; en ese caso raro.
        # sandbox: true → el front lo renderiza en un iframe aislado (permite CSS/JS/fuentes
        # propios sin filtrarse a la app). Por defecto (sin sandbox) se sanea inline con DOMPurify.
        return ActivityData(**common, title=_get_scalar(body, "title"), html=_get_scalar(body, "html"), sandbox=_normalize_bool(_get_scalar(body, "sandbox")))
    if activity_type == "truefalse":
        statements = _get_statements(body)
        return ActivityData(**common, statements=statements or None)
    if activity_type == "readingtruefalse":
        statements = _get_statements(body)
        return ActivityData(**common, title=_get_scalar(body, "title"), content=_get_scalar(body, "content"), statements=statements or None)
    raise WorksheetScriptError(f"Tipo de actividad no compatible: {activity_type}")


def _answer_list(answer) -> list[str]:
    if isinstance(answer, list):
        return [str(a) for a in answer if str(a).strip()]
    return [str(answer)] if str(answer or "").strip() else []


def _activity_problem(a: ActivityData) -> str | None:
    """Motivo por el que la actividad quedaría rota para el alumno, o None si está bien.

    El parser es deliberadamente tolerante (campo ausente = None), así que sin esta
    comprobación un campo mal escrito no falla: la actividad se guarda vacía y el alumno
    se encuentra una pregunta imposible de responder. Los casos cubiertos son los que se
    han visto de verdad: varios campos en la MISMA línea (el primero se traga el resto),
    `answer` que no coincide con ninguna opción, y listas descuadradas.
    """
    t = a.type
    options = [o.strip().lower() for o in (a.options or [])]
    answers = _answer_list(a.answer)
    blanks = (a.text or "").count("_____")

    if t in {"fillblank", "listeningfillblank"}:
        if t == "listeningfillblank" and not a.audio_text:
            return "falta 'audio_text' (la oración que lee el audio)"
        if not a.text:
            return "falta 'text'"
        if not answers:
            return "falta 'answer'"
        if blanks and len(answers) < blanks:
            return f"'text' tiene {blanks} huecos _____ pero 'answer' trae {len(answers)}"
    elif t == "dragdrop":
        if not blanks:
            return "'text' necesita al menos un hueco _____"
        if len(answers) != blanks:
            return f"'text' tiene {blanks} huecos pero 'answer' trae {len(answers)}"
        bank = [b.strip().lower() for b in (a.bank or [])]
        missing = [w for w in answers if w.strip().lower() not in bank]
        if missing:
            return f"'bank' no contiene {missing}; el alumno no puede colocar esa palabra"
    elif t in {"multiplechoice", "listeningmultiplechoice", "imagechoice"}:
        if t == "listeningmultiplechoice" and not a.audio_text:
            return "falta 'audio_text'"
        if not a.question:
            return "falta 'question'"
        if len(options) < 2:
            return "necesita al menos 2 'options'"
        if not answers:
            return "falta 'answer'"
        if answers[0].strip().lower() not in options:
            return f"'answer' ({answers[0]}) no coincide con ninguna opción: nadie puede acertar"
        if t == "imagechoice" and len(a.option_images or []) > len(options):
            # Al revés sí vale: una lista más corta deja esas opciones como texto.
            return f"'option_images' trae {len(a.option_images or [])} imágenes para {len(options)} opciones"
    elif t == "multiselect":
        if not a.question:
            return "falta 'question'"
        if len(options) < 2:
            return "necesita al menos 2 'options'"
        if not answers:
            return "falta 'answer' (lista con TODAS las correctas)"
        missing = [x for x in answers if x.strip().lower() not in options]
        if missing:
            return f"'answer' incluye {missing}, que no está en 'options'"
    elif t in {"matching", "imagematching"}:
        left, right = a.left or [], a.right or []
        lado = "'left_images'" if t == "imagematching" else "'left'"
        if t == "imagematching" and len(a.left_images or []) < 2:
            return "necesita al menos 2 URLs en 'left_images'"
        if len(left) < 2:
            return f"necesita al menos 2 elementos en {lado}"
        if len(left) != len(right):
            return f"{lado} ({len(left)}) y 'right' ({len(right)}) deben tener el mismo número de elementos"
    elif t in {"truefalse", "readingtruefalse", "listeningtruefalse"}:
        if not a.statements:
            return "necesita 'statements' con el formato '- Enunciado. | true'"
        sin_clave = [i for i, s in enumerate(a.statements, start=1) if s.get("answer") is None]
        if sin_clave:
            return f"el enunciado {sin_clave[0]} no termina en '| true' ni en '| false': sin el pipe no hay clave"
        if t == "readingtruefalse" and not a.content:
            return "falta 'content' (el texto de lectura)"
        if t == "listeningtruefalse" and not a.audio_text:
            return "falta 'audio_text'"
    elif t == "reading":
        if not a.content:
            return "falta 'content' (el texto de lectura)"
    elif t == "listening":
        if not a.text:
            return "falta 'text' (la oración que lee el audio)"
        if not a.question:
            return "falta 'question'"
    elif t == "listeningmatching":
        if not a.pairs:
            return "necesita bloques 'pair { audio_text: … match: … }'"
        if len(options) < 2:
            return "necesita al menos 2 'options'"
        absent = [p.get("match") for p in a.pairs if str(p.get("match") or "").strip().lower() not in options]
        if absent:
            return f"el 'match' {absent} no aparece en 'options': no se puede seleccionar"
    elif t == "listeningorder":
        if not a.audio_text:
            return "falta 'audio_text'"
        if len(answers) < 2:
            return "'answer' necesita las palabras de la oración, una por ficha y en orden"
    elif t == "conversation":
        if len(a.lines or []) < 2:
            return "necesita al menos 2 turnos en 'lines' (- m: \"…\" / - f: \"…\")"
        if not a.question:
            return "falta 'question'"
    elif t == "content":
        if not a.html:
            return "falta 'html' (el repaso a mostrar)"
    elif t == "textbox":
        if not a.prompt:
            return "falta 'prompt'"
    elif t == "imagequestion":
        if not a.image:
            return "falta 'image' (URL de la imagen)"
        if not a.prompt:
            return "falta 'prompt'"
    elif t == "speaking":
        if not (a.prompt or a.target):
            return "necesita 'prompt' (pregunta hablada) o 'target' (oración a leer)"
    return None


def _validate(activities: list[ActivityData]) -> None:
    problems = [
        f"Actividad {i} ({a.type}): {problem}"
        for i, a in enumerate(activities, start=1)
        for problem in [_activity_problem(a)]
        if problem
    ]
    if problems:
        hint = "Recuerda: cada campo del DSL va en SU PROPIA LÍNEA (si pones dos en la misma, el primero se traga el resto)."
        raise WorksheetScriptError(" · ".join(problems) + " — " + hint)


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
            header = _block_header(block_body)
            block_lines = _parse_conversation_lines(header)
            block_audio_text = _get_scalar(header, "audio_text")
            if block_audio_text and block_lines:
                raise WorksheetScriptError(
                    "Un bloque no puede tener 'audio_text' y 'lines' a la vez: son dos audios y solo se reproduce uno"
                )
            block_activities = [parse_activity(t, b) for t, b in _find_activity_blocks(block_body)]
            if (block_audio_text or block_lines or _get_scalar(header, "text")) and not block_activities:
                raise WorksheetScriptError(
                    "Un bloque con audio o texto compartido necesita al menos una actividad debajo"
                )
            blocks.append(BlockData(
                title=_get_scalar(header, "title"),
                instructions=_get_scalar(header, "instructions"),
                text=_get_scalar(header, "text"),
                audio_text=block_audio_text,
                lines=block_lines or None,
                voice=_get_scalar(header, "voice"),
                rate=_normalize_rate(_get_scalar(header, "rate")),
                activities=block_activities,
            ))
        if not any(b.activities for b in blocks):
            raise WorksheetScriptError("Se requiere al menos una actividad")
        _validate([a for b in blocks for a in b.activities])
        return WorksheetData(title=title, description=description, blocks=blocks, theme=theme, info_fields=info_fields)

    activities = [parse_activity(activity_type, body) for activity_type, body in _find_activity_blocks(worksheet_body)]
    if not activities:
        raise WorksheetScriptError("Se requiere al menos una actividad")
    _validate(activities)
    return WorksheetData(title=title, description=description, activities=activities, theme=theme, info_fields=info_fields)
