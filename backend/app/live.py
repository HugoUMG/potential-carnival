"""Evaluación en tiempo real: el profesor abre y cierra cada pregunta, los alumnos responden
desde el celular y la pantalla proyecta el marcador (estilo Kahoot, pero orquestado a mano).

Este módulo es LÓGICA PURA sobre preguntas ya cargadas: no importa `main`, ni `repository`, ni
`database`. Dos motivos, los dos importantes:

  · Importar `backend.app.main` carga el `.env` real y apunta a la BD de producción (regla 2 de
    CLAUDE.md). Manteniendo esto limpio, `test_live_session.py` corre sin tocar Aiven.
  · Evita el import circular: `main` importa `live` para montar los endpoints, no al revés.

El estado vive EN MEMORIA (`_sessions`, dict de módulo). ponytail: sin tabla, sin Redis y sin
WebSockets — el backend corre con UN worker (`render.yaml`) y una sesión dura lo que dura la
clase. Tres techos conocidos:

  · un redeploy o un reinicio del proceso borra las sesiones vivas (por eso `snapshot()` deja
    el resultado en la BD al terminar: lo que se pierde es la sesión en curso, no las notas);
  · con varios workers cada uno tendría su propio dict y los alumnos verían sesiones distintas.
    Si algún día `render.yaml` lleva `--workers`, esto necesita Redis;
  · el cliente descubre los cambios por polling de 1s, no por push. Si la latencia llega a
    notarse, el salto es a WebSockets (ver docs/15_DECISIONS.md).
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Any

# Tipos del DSL que sirven para responder en vivo desde un celular: una pregunta, opciones
# tocables y calificación instantánea. El resto (texto libre, audio, matching…) necesita
# teclado o califica en diferido, así que no entra a una sesión cronometrada.
# `truefalse` entra explotado: una actividad trae varios enunciados y cada uno es una pregunta
# en vivo con dos botones. `imagechoice` se califica como `multiplechoice` (la clave es el TEXTO
# de la opción, ADR-20); las imágenes solo cambian lo que se pinta.
#
# Lo que se queda fuera NO desaparece en silencio: `summarize()` cuenta lo descartado y el panel
# del profesor lo enseña antes de abrir la sesión. Esta lista está duplicada en
# `src/components/LiveHostPanel.tsx` para pintar ese resumen sin una petición por hoja; si cambia
# aquí, cambia allá — lo comprueba un test.
LIVE_TYPES = ("multiplechoice", "multiselect", "truefalse", "imagechoice")

MAX_PARTICIPANTS = 300
MAX_SESSIONS = 50
SESSION_TTL_SECONDS = 8 * 3600
# Sin I/O/0/1: se dicta en voz alta y se teclea en un celular, no hay margen para confundir.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 5


class LiveError(Exception):
    """Error de uso de la sesión (pregunta cerrada, ya respondió, aforo lleno…).

    `main` lo traduce a HTTPException; aquí no se importa FastAPI para que el módulo siga
    siendo probable sin levantar la app.
    """

    def __init__(self, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


@dataclass(slots=True)
class LiveQuestion:
    id: str
    type: str
    question: str
    options: list[str]
    answer: str | list[str]
    image: str | None = None  # imagechoice: imagen del enunciado
    option_images: list[str] | None = None  # imagechoice: URL por opción, PARALELA a `options`

    def is_correct(self, given: Any) -> bool:
        """Misma semántica que `_build_answer_details` en `main.py`: `multiselect` exige que el
        CONJUNTO elegido coincida exactamente; el resto compara texto sin distinguir mayúsculas.

        `truefalse` cae en la comparación de texto porque llega ya convertido a las opciones
        "True"/"False" — las mismas cadenas que guarda el renderer normal, así que la entrega que
        deja `finish` es indistinguible de una hecha en la hoja.

        ponytail: seis líneas duplicadas en vez de importar el calificador de `main.py`, que
        arrastraría el `.env` de producción al test. Si un día cambia el criterio de estos
        tipos, hay que tocar los dos sitios — por eso el test cubre los casos que se
        desincronizarían primero.
        """
        if self.type == "multiselect":
            correct = {_norm(a) for a in (self.answer if isinstance(self.answer, list) else [self.answer])}
            chosen = {_norm(a) for a in (given if isinstance(given, list) else ([given] if given else []))}
            return bool(correct) and chosen == correct
        return _norm(given) == _norm(self.answer)

    def correct_label(self) -> str:
        return ", ".join(self.answer) if isinstance(self.answer, list) else str(self.answer)


@dataclass(slots=True)
class Participant:
    pid: str
    info: dict[str, str]  # {"Carné": "2021-001", "Nombre": "Ana"} — las claves son los info_fields
    label: str
    score: int = 0
    correct: int = 0
    answers: dict[str, Any] = field(default_factory=dict)  # question_id -> respuesta enviada
    joined_at: float = field(default_factory=time.monotonic)


@dataclass
class LiveSession:
    code: str
    worksheet_id: str
    worksheet_title: str
    owner_id: str
    info_fields: list[str]
    questions: list[LiveQuestion]
    duration: int = 20  # segundos por pregunta; 0 = sin límite, cierra el profesor
    instant_feedback: bool = False  # False = ✓/✗ al revelar (Kahoot); True = al tocar
    skipped: list[dict[str, Any]] = field(default_factory=list)  # [{type, count}] descartado
    index: int = -1  # -1 = sala de espera, aún no se ha lanzado ninguna pregunta
    opened_at: float | None = None
    revealed: bool = False
    version: int = 0  # sube en cada cambio; el cliente lo usa para saber "pasó algo"
    participants: dict[str, Participant] = field(default_factory=dict)
    created_at: float = field(default_factory=time.monotonic)

    # ── Estado ────────────────────────────────────────────────────────────────

    def current(self) -> LiveQuestion | None:
        if 0 <= self.index < len(self.questions):
            return self.questions[self.index]
        return None

    def remaining_ms(self) -> int | None:
        """Milisegundos que quedan, calculados POR EL SERVIDOR. El celular solo los pinta: así
        el cronómetro no depende del reloj del alumno ni se puede adelantar cambiando la hora."""
        if self.opened_at is None or not self.duration:
            return None
        left = self.duration - (time.monotonic() - self.opened_at)
        return max(0, int(left * 1000))

    def phase(self) -> str:
        """lobby → question → reveal → … → ended.

        El tiempo agotado pasa solo a `reveal` (una pregunta abierta con el cronómetro en cero
        sería un limbo), pero LANZAR la siguiente siempre es decisión del profesor.
        """
        if self.index < 0:
            return "lobby"
        if self.index >= len(self.questions):
            return "ended"
        if self.revealed or self.remaining_ms() == 0:
            return "reveal"
        return "question"

    def answered_count(self) -> int:
        question = self.current()
        if question is None:
            return 0
        return sum(1 for p in self.participants.values() if question.id in p.answers)

    def ranking(self) -> list[Participant]:
        # Empate a puntos → gana quien lleva más aciertos; si aún empatan, quien entró antes.
        return sorted(self.participants.values(), key=lambda p: (-p.score, -p.correct, p.joined_at))

    # ── Acciones del profesor ─────────────────────────────────────────────────

    def open_next(self, duration: int | None = None) -> None:
        if self.index + 1 >= len(self.questions):
            raise LiveError("No quedan preguntas por lanzar")
        if duration is not None:
            self.duration = max(0, min(600, duration))
        self.index += 1
        self.opened_at = time.monotonic()
        self.revealed = False
        self.version += 1

    def reveal(self) -> None:
        if self.current() is None:
            raise LiveError("No hay ninguna pregunta abierta")
        self.revealed = True
        self.version += 1

    def end(self) -> None:
        self.index = len(self.questions)
        self.revealed = True
        self.version += 1

    # ── Acciones del alumno ───────────────────────────────────────────────────

    def join(self, info: dict[str, str]) -> Participant:
        """Registra a un alumno. Los campos obligatorios son los `info {}` de la propia hoja
        (Carné, Nombre…): la hoja decide qué se pide, no este módulo.

        Reingreso: si el primer campo (normalmente el carné) coincide con alguien que ya entró,
        se le devuelve su MISMO participante. Sin esto, un alumno que recarga la página pierde
        sus puntos y aparece duplicado en el marcador.
        """
        clean = {label: str(info.get(label, "")).strip() for label in self.info_fields}
        missing = [label for label, value in clean.items() if not value]
        if missing:
            raise LiveError(f"Falta completar: {', '.join(missing)}", status=422)

        key_field = self.info_fields[0] if self.info_fields else None
        if key_field:
            key = _norm(clean[key_field])
            for existing in self.participants.values():
                if _norm(existing.info.get(key_field)) == key:
                    existing.info = clean
                    existing.label = self._label(clean)
                    return existing

        if len(self.participants) >= MAX_PARTICIPANTS:
            raise LiveError("La sesión está llena", status=409)

        participant = Participant(pid=secrets.token_urlsafe(9), info=clean, label=self._label(clean))
        self.participants[participant.pid] = participant
        self.version += 1
        return participant

    def _label(self, info: dict[str, str]) -> str:
        """Nombre para el marcador: el primer campo que parezca un nombre, si no el último."""
        for label, value in info.items():
            if "nombre" in label.lower() and value:
                return value
        return next((v for v in reversed(list(info.values())) if v), "Anónimo")

    def submit(self, pid: str, answer: Any) -> dict[str, Any]:
        participant = self.participants.get(pid)
        if participant is None:
            raise LiveError("No estás en esta sesión", status=404)
        if self.phase() != "question":
            raise LiveError("La pregunta no está abierta")
        question = self.current()
        assert question is not None  # phase() == "question" lo garantiza
        if question.id in participant.answers:
            raise LiveError("Ya respondiste esta pregunta")

        elapsed = time.monotonic() - (self.opened_at or time.monotonic())
        correct = question.is_correct(answer)
        participant.answers[question.id] = answer
        points = self._points(elapsed) if correct else 0
        if correct:
            participant.correct += 1
            participant.score += points
        self.version += 1

        result: dict[str, Any] = {"registered": True}
        if self.instant_feedback:
            result |= {"correct": correct, "points": points}
        return result

    def _points(self, elapsed: float) -> int:
        """500 por acertar + hasta 500 por rapidez. Con 50 personas el conteo de aciertos a secas
        deja veinte empatadas en primer lugar; el bono de velocidad desempata solo."""
        if not self.duration:
            return 1000
        return round(500 + 500 * max(0.0, 1 - elapsed / self.duration))

    # ── Lo que ven los clientes ───────────────────────────────────────────────

    def public_state(self, pid: str | None = None, top: int = 5) -> dict[str, Any]:
        """Estado que polean alumno y pantalla.

        La respuesta correcta SOLO viaja en fase `reveal`. Mientras la pregunta está abierta, el
        payload no la lleva: quien abra las herramientas del navegador ve exactamente lo mismo
        que quien mira la pantalla.
        """
        phase = self.phase()
        question = self.current()
        state: dict[str, Any] = {
            "code": self.code,
            "title": self.worksheet_title,
            "phase": phase,
            "version": self.version,
            "index": self.index,
            "total": len(self.questions),
            "participants": len(self.participants),
            "answered": self.answered_count(),
            "duration": self.duration,
            "remaining_ms": self.remaining_ms(),
            "info_fields": self.info_fields,
        }

        if question is not None and phase in {"question", "reveal"}:
            state["question"] = {
                "id": question.id,
                "type": question.type,
                "question": question.question,
                "options": question.options,
                "number": self.index + 1,
                "image": question.image,
                "option_images": question.option_images,
            }

        if phase == "reveal" and question is not None:
            state["answer"] = question.answer
            state["answer_label"] = question.correct_label()
            state["option_counts"] = self._option_counts(question)

        if phase in {"reveal", "ended"}:
            state["leaderboard"] = [
                {"label": p.label, "score": p.score, "correct": p.correct}
                for p in self.ranking()[:top]
            ]

        if pid:
            state["me"] = self._me(pid, question, phase)
        return state

    def _option_counts(self, question: LiveQuestion) -> list[int]:
        counts = [0] * len(question.options)
        for participant in self.participants.values():
            given = participant.answers.get(question.id)
            chosen = given if isinstance(given, list) else ([given] if given is not None else [])
            for value in chosen:
                for i, option in enumerate(question.options):
                    if _norm(option) == _norm(value):
                        counts[i] += 1
        return counts

    def _me(self, pid: str, question: LiveQuestion | None, phase: str) -> dict[str, Any] | None:
        participant = self.participants.get(pid)
        if participant is None:
            return None
        ranking = self.ranking()
        me: dict[str, Any] = {
            "label": participant.label,
            "score": participant.score,
            "correct_total": participant.correct,
            "rank": next((i + 1 for i, p in enumerate(ranking) if p.pid == pid), None),
            "answered": question is not None and question.id in participant.answers,
            "answer": participant.answers.get(question.id) if question else None,
        }
        # El ✓/✗ se guarda hasta el reveal (comportamiento Kahoot): así el primero en responder
        # no le canta la respuesta al de al lado. `instant_feedback` lo adelanta al toque.
        if question is not None and me["answered"] and (phase == "reveal" or self.instant_feedback):
            me["correct"] = question.is_correct(participant.answers[question.id])
        return me

    def host_state(self) -> dict[str, Any]:
        """Estado del panel del profesor: todo lo público + la lista completa y el temario."""
        state = self.public_state(top=MAX_PARTICIPANTS)
        state["questions"] = [{"number": i + 1, "question": q.question, "type": q.type} for i, q in enumerate(self.questions)]
        state["skipped"] = self.skipped
        state["roster"] = [
            {"label": p.label, "info": p.info, "score": p.score, "correct": p.correct}
            for p in self.ranking()
        ]
        state["instant_feedback"] = self.instant_feedback
        return state

    def snapshot(self) -> list[dict[str, Any]]:
        """Resultado por alumno para persistirlo en `worksheet_responses`. Devuelve datos planos:
        construir el `WorksheetResponse` es cosa de `main`, que sí conoce el repositorio."""
        results = []
        for participant in self.ranking():
            graded = [(q, participant.answers.get(q.id)) for q in self.questions if q.id in participant.answers]
            results.append({
                "pid": participant.pid,
                "label": participant.label,
                "info": participant.info,
                "score": participant.score,
                "correct": participant.correct,
                "answered": len(graded),
                "answers": {q.id: given for q, given in graded},
                "details": [
                    {
                        "activity_id": q.id,
                        "activity_type": q.type,
                        "prompt": q.question,
                        "student_answer": given,
                        "correct_answer": q.answer,
                        "status": "correct" if q.is_correct(given) else "incorrect",
                    }
                    for q, given in graded
                ],
            })
        return results


# ── Registro de sesiones ──────────────────────────────────────────────────────

_sessions: dict[str, LiveSession] = {}


TRUE_FALSE_OPTIONS = ["True", "False"]


def extract_questions(activities: list[Any]) -> list[LiveQuestion]:
    """Se queda con las actividades del DSL que sirven en vivo, en el orden de la hoja.

    Una actividad no es siempre una pregunta: un `truefalse` con cinco enunciados son CINCO
    preguntas en vivo. Se numeran `{activity_id}:{índice}`, la misma convención que usa
    `_build_answer_details` para esos enunciados, de modo que la entrega que guarda `finish`
    encaja con lo que Revisión ya sabe leer.
    """
    questions: list[LiveQuestion] = []
    for activity in activities:
        kind = getattr(activity, "type", None)
        if kind not in LIVE_TYPES:
            continue

        if kind == "truefalse":
            for index, statement in enumerate(getattr(activity, "statements", None) or []):
                text = (statement.get("text") or "").strip()
                if not text or statement.get("answer") is None:
                    continue
                questions.append(LiveQuestion(
                    id=f"{activity.id}:{index}",
                    type="truefalse",
                    question=text,
                    options=list(TRUE_FALSE_OPTIONS),
                    # Las mismas cadenas que guarda el renderer de la hoja ('true'/'false'),
                    # comparadas sin distinguir mayúsculas.
                    answer="True" if statement["answer"] else "False",
                ))
            continue

        options = list(getattr(activity, "options", None) or [])
        answer = getattr(activity, "answer", None)
        if len(options) < 2 or not answer:
            continue  # sin opciones o sin clave no se puede jugar ni calificar
        images = list(getattr(activity, "option_images", None) or []) if kind == "imagechoice" else []
        questions.append(LiveQuestion(
            id=activity.id,
            type=kind,
            question=getattr(activity, "question", None) or getattr(activity, "prompt", None) or "",
            options=options,
            answer=answer,
            image=getattr(activity, "image", None) if kind == "imagechoice" else None,
            # Se rellena a la longitud de `options`: una URL de menos dejaría la opción sin
            # imagen, no descuadrada.
            option_images=(images + [""] * len(options))[:len(options)] if images else None,
        ))
    return questions


def summarize(activities: list[Any]) -> dict[str, Any]:
    """Cuántas preguntas jugables da la hoja y qué se queda fuera, por tipo.

    Existe para que descartar una actividad sea VISIBLE. Sin esto, un profesor con una hoja de
    diez actividades abre una sesión de tres preguntas y no hay nada que le diga por qué — el
    fallo silencioso que este proyecto ya se ha comido varias veces (ver 12_RULES).
    """
    skipped: dict[str, int] = {}
    for activity in activities:
        kind = getattr(activity, "type", None)
        if kind in LIVE_TYPES or kind == "content":
            continue  # `content` es material de repaso, no una actividad que se descarte
        skipped[kind] = skipped.get(kind, 0) + 1
    return {
        "playable": len(extract_questions(activities)),
        "skipped": [{"type": k, "count": v} for k, v in sorted(skipped.items())],
    }


def _new_code() -> str:
    for _ in range(50):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if code not in _sessions:
            return code
    raise LiveError("No se pudo generar un código libre", status=503)


def _evict() -> None:
    """Cota del dict: sin esto crece con cada sesión y nunca baja (mismo criterio que
    `_rate_hits` en main.py). Se van las caducadas; si aún sobran, las más viejas."""
    now = time.monotonic()
    for code in [c for c, s in _sessions.items() if now - s.created_at > SESSION_TTL_SECONDS]:
        del _sessions[code]
    while len(_sessions) > MAX_SESSIONS:
        oldest = min(_sessions.values(), key=lambda s: s.created_at)
        del _sessions[oldest.code]


def create_session(
    *,
    worksheet_id: str,
    worksheet_title: str,
    owner_id: str,
    info_fields: list[str],
    questions: list[LiveQuestion],
    duration: int = 20,
    instant_feedback: bool = False,
    skipped: list[dict[str, Any]] | None = None,
) -> LiveSession:
    if not questions:
        raise LiveError(
            "Esta hoja no tiene ninguna actividad que se pueda responder en vivo. Sirven: opción "
            "múltiple, selección múltiple, verdadero/falso e imagen + opción múltiple.",
            status=422,
        )
    _evict()
    # Sin `info {}` en la hoja no habría con qué identificar a nadie en el marcador.
    fields = [f for f in info_fields if f.strip()] or ["Carné", "Nombre"]
    session = LiveSession(
        code=_new_code(),
        worksheet_id=worksheet_id,
        worksheet_title=worksheet_title,
        owner_id=owner_id,
        info_fields=fields,
        questions=questions,
        duration=max(0, min(600, duration)),
        instant_feedback=instant_feedback,
        skipped=skipped or [],
    )
    _sessions[session.code] = session
    return session


def get_session(code: str) -> LiveSession:
    session = _sessions.get((code or "").strip().upper())
    if session is None:
        raise LiveError("Esa sesión no existe o ya terminó", status=404)
    return session


def owned_session(code: str, owner_id: str, is_admin: bool = False) -> LiveSession:
    session = get_session(code)
    if not is_admin and session.owner_id != owner_id:
        raise LiveError("No controlas esta sesión", status=403)
    return session


def close_session(code: str) -> None:
    _sessions.pop((code or "").strip().upper(), None)


def list_sessions(owner_id: str, is_admin: bool = False) -> list[dict[str, Any]]:
    return [
        {
            "code": s.code,
            "title": s.worksheet_title,
            "worksheet_id": s.worksheet_id,
            "phase": s.phase(),
            "participants": len(s.participants),
            "total": len(s.questions),
        }
        for s in _sessions.values()
        if is_admin or s.owner_id == owner_id
    ]
