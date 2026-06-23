import json
import os
import threading
import time
from typing import Any

import httpx

# ── API endpoints ──────────────────────────────────────────────────────────────
_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_GROQ_MODEL = "llama-3.3-70b-versatile"
_GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"

# ── System prompts ─────────────────────────────────────────────────────────────
_WORKSHEET_SYSTEM = """You are an expert English worksheet creator for a language learning platform.
You generate worksheets using a strict DSL format. Follow ALL rules exactly.
Output ONLY the DSL script — no markdown fences, no explanation, no comments.

=== MANDATORY OUTER STRUCTURE ===
Every output MUST start with "worksheet {" and end with the closing "}".
NEVER output bare activities — they must always be inside worksheet { }.

worksheet {
  title: "Worksheet Title Here"
  description: "Brief description for students."

  block {
    title: "Part 1: Section Name"
    instructions: "Optional instruction for this section."
    [activities here]
  }

  block {
    title: "Part 2: Another Section"
    [activities here]
  }
}

You may also place activities directly inside worksheet { } without block {} wrappers.
Use block {} when grouping activities by skill or topic makes sense.

=== ACTIVITY TYPES ===
ALLOWED: fillblank, multiplechoice, multiselect, matching, truefalse, textbox, reading, imagequestion,
         listening, listeningmultiplechoice, listeningfillblank, listeningmatching, listeningtruefalse
NEVER USE: speaking

=== GENERAL DSL RULES ===
- block {} groups activities with a shared title and instructions
- Each activity can have an optional "instructions" field for per-activity guidance
- Use \\n for line breaks inside strings
- fillblank blank marker: _____ (exactly 5 underscores)
- Multiple blanks: answer: ["word1", "word2"]  — one entry per blank, in order
- truefalse / listeningtruefalse statements format (one per line):
    - Statement text here. | true
    - Another statement. | false

=== CRITICAL LISTENING RULES ===
This platform uses TEXT-TO-SPEECH (TTS). There are NO audio files and NO URLs.
NEVER use a field called "audio:" — it does not exist.
- "listening" uses field: text  (the sentence read aloud, hidden from student)
- All other listening types use field: audio_text  (hidden from student, read by TTS)
"listeningmatching" uses pair {} blocks — NEVER a plain list for pairs.

=== ACTIVITY REFERENCE (field names and example for each type) ===

── fillblank ──────────────────────────────────────────────────
Fields: text (with _____), answer (string or array)
fillblank {
  text: "She _____ to school every day."
  answer: "goes"
}
fillblank {
  text: "They _____ play football and _____ study."
  answer: ["don't", "must"]
}

── multiplechoice ─────────────────────────────────────────────
Fields: question, options (list), answer
multiplechoice {
  question: "Which sentence uses the correct verb form?"
  options:
  - She go to school.
  - She goes to school.
  - She going to school.
  answer: "She goes to school."
}

── multiselect (varias respuestas correctas) ──────────────────
Fields: question, options (list), answer (LIST of all correct options)
multiselect {
  question: "Select all the verbs in the simple present."
  options:
  - runs
  - running
  - eats
  - eaten
  answer: ["runs", "eats"]
}

── matching ───────────────────────────────────────────────────
Fields: left (list), right (list) — same number of items on each side
matching {
  left:
  - can
  - must
  - should
  right:
  - Ability
  - Obligation
  - Advice
}

── truefalse ──────────────────────────────────────────────────
Fields: statements (- text | true/false)
truefalse {
  statements:
  - We use 'goes' with he/she/it. | true
  - 'Eaten' is the past simple of 'eat'. | false
  - Modal verbs are followed by the base form. | true
}

── textbox ────────────────────────────────────────────────────
Fields: prompt
textbox {
  prompt: "Write three sentences about your last weekend using Past Simple."
}

── reading ────────────────────────────────────────────────────
Fields: title, content (use \\n for line breaks), questions (list of open questions)
reading {
  title: "School Rules"
  content: "At our school, students have to wear a uniform every day.\\nThey must arrive before 8:00 AM and cannot use mobile phones in class.\\nHowever, they don't have to do homework on Fridays."
  questions:
  - What time do students have to arrive?
  - What can't students do in class?
  - What don't students have to do on Fridays?
}

── imagequestion ──────────────────────────────────────────────
Fields: image (URL provided by teacher — use a placeholder), prompt
imagequestion {
  image: "IMAGE_URL_HERE"
  prompt: "Look at the picture. What are the people doing? Use Present Continuous."
}

── listening ──────────────────────────────────────────────────
Fields: text (TTS sentence — HIDDEN from student), question, answer
Note: field is "text", NOT "audio_text"
listening {
  text: "She had to stay late at the office because her boss needed the report."
  question: "Why did she have to stay late?"
  answer: "Because her boss needed the report."
}

── listeningmultiplechoice ────────────────────────────────────
Fields: audio_text (TTS — HIDDEN), question, options (list), answer
listeningmultiplechoice {
  audio_text: "Yesterday I had to wake up at 5 AM because my flight was very early."
  question: "Why did she have to wake up so early?"
  options:
  - Because her flight was early.
  - Because she had an exam.
  - Because she starts work at 5 AM.
  answer: "Because her flight was early."
}

── listeningfillblank ─────────────────────────────────────────
Fields: audio_text (TTS — HIDDEN), text (visible to student, with _____), answer
listeningfillblank {
  audio_text: "Tom didn't have to wear a uniform at his new school."
  text: "Tom _____ wear a uniform at his new school."
  answer: "didn't have to"
}
listeningfillblank {
  audio_text: "Where did they have to go for the school trip?"
  text: "Where _____ they _____ go for the school trip?"
  answer: ["did", "have to"]
}

── listeningmatching ──────────────────────────────────────────
Fields: pair {} blocks (each with audio_text + match), options (list)
IMPORTANT: pairs are pair {} BLOCKS — never a plain list.
listeningmatching {
  pair {
    audio_text: "She had to call the doctor last night."
    match: "Affirmative"
  }
  pair {
    audio_text: "We didn't have to bring our books."
    match: "Negative"
  }
  pair {
    audio_text: "Did he have to work on Saturday?"
    match: "Yes/No Question"
  }
  pair {
    audio_text: "Why did she have to leave so early?"
    match: "Wh-Question"
  }
  options:
  - Affirmative
  - Negative
  - Yes/No Question
  - Wh-Question
}

── listeningtruefalse ─────────────────────────────────────────
Fields: audio_text (TTS — HIDDEN, can be a full passage), statements (- text | true/false)
listeningtruefalse {
  audio_text: "Last week Anna had a job interview. She had to wear formal clothes and arrive at 9 AM. She didn't have to bring a portfolio, but she had to answer many questions about her experience."
  statements:
  - Anna had to wear formal clothes. | true
  - Anna had to bring a portfolio. | false
  - Anna had to arrive at 10 AM. | false
  - Anna answered questions about her experience. | true
}"""

_GRADE_SYSTEM = """You are an English language teacher assistant grading student worksheet answers.
You will receive a JSON list of activities that NEED evaluation. Answers already auto-graded as
correct are NOT sent to you — do not worry about them and do not invent entries for them.

GRADING RULES:
1. fillblank/listeningfillblank marked "incorrect": check carefully if the student answer is
   semantically equivalent or has only a minor typo, accent, or capitalization difference. If the
   meaning is correct, set status "correct" and leave "comment" EMPTY. Otherwise keep "incorrect"
   and give a DETAILED explanation: what was wrong, the correct form, and a short example.
2. "pending" (textbox, imagequestion, reading questions) — these are OPEN answers. Grade by
   relevance to the prompt, grammatical accuracy, and content quality. Set status "correct",
   "incorrect", or "partial".
   - If CORRECT: write a SHORT encouraging comment (1 sentence) noting what they did well.
   - If incorrect/partial: give a DETAILED explanation (2-4 sentences) of what to improve and how.
3. So comments go on: every incorrect/partial answer (detailed), AND every CORRECT OPEN answer
   (brief praise). A fillblank/listeningfillblank that you flip to "correct" keeps its comment EMPTY.
4. Comments must be in Spanish, educational and specific.
5. Be fair and generous with near-correct answers.

RESPOND ONLY with valid JSON in this exact format (no markdown, no extra text):
{"grades": [{"id": "ACTIVITY_ID", "status": "correct|incorrect|partial", "comment": "Comentario aquí."}]}"""


# ── HTTP helpers ───────────────────────────────────────────────────────────────
def _call_groq(system: str, user: str) -> str:
    key = os.getenv("GROQ_API_KEY", "")
    if not key:
        raise RuntimeError("GROQ_API_KEY not set")
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            _GROQ_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": _GROQ_MODEL,
                "temperature": 0.4,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        usage = data.get("usage", {})
        print(
            f"[AI:groq] prompt={usage.get('prompt_tokens','?')} "
            f"completion={usage.get('completion_tokens','?')} "
            f"total={usage.get('total_tokens','?')} tokens"
        )
        return data["choices"][0]["message"]["content"]


def _call_gemini(prompt: str) -> str:
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{_GEMINI_URL}?key={key}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.4},
            },
        )
        resp.raise_for_status()
        data = resp.json()
        usage = data.get("usageMetadata", {})
        print(
            f"[AI:gemini] prompt={usage.get('promptTokenCount','?')} "
            f"completion={usage.get('candidatesTokenCount','?')} "
            f"thinking={usage.get('thoughtsTokenCount',0)} "
            f"total={usage.get('totalTokenCount','?')} tokens"
        )
        return data["candidates"][0]["content"]["parts"][0]["text"]


# Serializa las llamadas a la IA: con varios envíos casi simultáneos (todos con IA),
# las peticiones concurrentes chocaban con el rate-limit del proveedor y una quedaba
# sin calificar. El lock las pone en fila y los reintentos cubren fallos transitorios.
_ai_lock = threading.Lock()


def _ai_call(system: str, user: str) -> str:
    """Llama a la IA (Gemini → Groq), serializado y con reintentos ante errores transitorios."""
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    last_error: Exception | None = None
    with _ai_lock:
        for attempt in range(2):
            if gemini_key:
                try:
                    return _call_gemini(f"{system}\n\n{user}")
                except Exception as exc:
                    last_error = exc
            try:
                return _call_groq(system, user)
            except Exception as exc:
                last_error = exc
            if attempt == 0:
                time.sleep(1.5)  # backoff antes del segundo intento
    raise last_error or RuntimeError("AI call failed")


# ── Worksheet generation ───────────────────────────────────────────────────────
def generate_worksheet_script(prompt: str) -> str:
    raw = _ai_call(_WORKSHEET_SYSTEM, prompt)
    # Strip markdown fences if the model added them despite instructions
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    raw = raw.strip()
    # If the model forgot the outer wrapper, add a minimal one so the parser
    # doesn't crash with "Falta el bloque requerido worksheet".
    if not raw.startswith("worksheet"):
        raw = f"worksheet {{\n{raw}\n}}"
    return raw


# ── AI grading ─────────────────────────────────────────────────────────────────
def ai_grade_activities(details: list[Any], worksheet_title: str) -> list[Any]:
    """
    Grade all activity details using AI.
    Returns the same list with updated status and teacher_comment fields.
    Silently returns unmodified details if AI call fails.
    """
    if not details:
        return details

    # Solo enviar a la IA lo que requiere juicio: respuestas incorrectas (posible typo) o pendientes.
    # Las correctas automáticas no se envían → ahorra tokens y no genera comentarios innecesarios.
    to_grade = [d for d in details if d.status in {"incorrect", "pending"}]
    if not to_grade:
        return details

    activities_payload = []
    for d in to_grade:
        activities_payload.append({
            "id": d.activity_id,
            "type": d.activity_type,
            "prompt": d.prompt,
            "correct_answer": _serialize(d.correct_answer),
            "student_answer": _serialize(d.student_answer),
            "auto_status": d.status,
        })

    user_prompt = (
        f'Worksheet: "{worksheet_title}"\n\n'
        f"Activities to grade:\n{json.dumps(activities_payload, ensure_ascii=False, indent=2)}"
    )

    try:
        raw = _ai_call(_GRADE_SYSTEM, user_prompt)
        raw = raw.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed: dict = json.loads(raw)
        grades: list[dict] = parsed.get("grades", [])
    except Exception:
        return details

    grades_by_id = {g["id"]: g for g in grades}
    for d in details:
        grade = grades_by_id.get(d.activity_id)
        if not grade:
            continue
        original_status = d.status
        ai_status = grade.get("status", d.status)
        # Only allow AI to change status for fillblank/listeningfillblank and pending
        if d.status == "incorrect" and d.activity_type in {"fillblank", "listeningfillblank"}:
            if ai_status == "correct":
                d.status = "correct"
        elif d.status == "pending":
            if ai_status in {"correct", "incorrect", "partial"}:
                d.status = "correct" if ai_status == "correct" else "incorrect"
        # Comentario: siempre en las incorrectas/parciales; en las correctas SOLO si era
        # una respuesta abierta (originalmente "pending"). Un fillblank que se corrige por
        # typo no lleva comentario.
        if d.status != "correct" or original_status == "pending":
            d.teacher_comment = grade.get("comment", "")
        else:
            d.teacher_comment = ""

    return details


_SUMMARY_SYSTEM = """Eres un asistente pedagógico. Recibes estadísticas de una hoja de trabajo de inglés
(por actividad: cuántos acertaron/fallaron y ejemplos de respuestas incorrectas). Escribe un
resumen BREVE y útil para el profesor, en español, con EXACTAMENTE estas tres secciones y sin
markdown de encabezados (usa los títulos tal cual, en mayúsculas, seguidos de viñetas con "- "):

ERRORES COMUNES
- (2-4 viñetas con los patrones de error más frecuentes; cita el tema, no al alumno)

CONCEPTOS A REFORZAR
- (2-3 viñetas con la gramática/vocabulario a repasar)

RECOMENDACIONES
- (2-3 viñetas con acciones concretas para la próxima clase)

Sé concreto y conciso. Si casi todo está correcto, dilo y felicita brevemente."""


def summarize_worksheet_performance(worksheet_title: str, activities: list[dict]) -> str:
    """Genera un resumen de desempeño de una hoja a partir de estadísticas por actividad."""
    if not activities:
        return ""
    user_prompt = (
        f'Hoja: "{worksheet_title}"\n\n'
        f"Estadísticas por actividad:\n{json.dumps(activities, ensure_ascii=False, indent=2)}"
    )
    try:
        return _ai_call(_SUMMARY_SYSTEM, user_prompt).strip()
    except Exception:
        return ""


def _serialize(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [_serialize(v) for v in value]
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    return str(value)
