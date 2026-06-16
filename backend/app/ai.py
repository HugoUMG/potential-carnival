import json
import os
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

=== ACTIVITY TYPES ===
ALLOWED: fillblank, multiplechoice, matching, truefalse, textbox, reading, imagequestion,
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
You will receive a JSON list of student activities and must evaluate each one.

GRADING RULES:
1. For activities already marked "correct": confirm status, add a brief encouraging comment.
2. For fillblank/listeningfillblank marked "incorrect": check carefully if the answer is semantically
   equivalent or has only a minor typo, accent issue, or capitalization difference. If the meaning
   is correct, change status to "correct". Otherwise keep "incorrect" and briefly explain the error.
3. For activities marked "pending" (textbox, imagequestion, reading questions): grade based on
   relevance to the prompt, grammatical accuracy, and content quality. Set status to "correct",
   "incorrect", or "partial" (partially correct / incomplete answer).
4. For multiplechoice, matching, truefalse already graded: just add a short comment, do NOT change status.
5. Comments must be in Spanish, encouraging and educational, maximum 2 sentences.
6. Be fair and generous with near-correct answers.

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


def _ai_call(system: str, user: str) -> str:
    """Try Gemini first, fall back to Groq."""
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if gemini_key:
        try:
            return _call_gemini(f"{system}\n\n{user}")
        except Exception:
            pass
    return _call_groq(system, user)


# ── Worksheet generation ───────────────────────────────────────────────────────
def generate_worksheet_script(prompt: str) -> str:
    return _ai_call(_WORKSHEET_SYSTEM, prompt)


# ── AI grading ─────────────────────────────────────────────────────────────────
def ai_grade_activities(details: list[Any], worksheet_title: str) -> list[Any]:
    """
    Grade all activity details using AI.
    Returns the same list with updated status and teacher_comment fields.
    Silently returns unmodified details if AI call fails.
    """
    if not details:
        return details

    activities_payload = []
    for d in details:
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
        ai_status = grade.get("status", d.status)
        # Only allow AI to change status for fillblank/listeningfillblank and pending
        if d.status == "incorrect" and d.activity_type in {"fillblank", "listeningfillblank"}:
            if ai_status == "correct":
                d.status = "correct"
        elif d.status == "pending":
            if ai_status in {"correct", "incorrect", "partial"}:
                d.status = "correct" if ai_status == "correct" else "incorrect"
        d.teacher_comment = grade.get("comment", "")

    return details


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
