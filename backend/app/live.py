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

# Avatares que puede elegir el alumno. Lista CERRADA a propósito: es lo que se proyecta en la
# pantalla del salón, así que no se acepta cualquier carácter que llegue en el JSON — un emoji
# arbitrario (o una cadena de mil caracteres) es texto libre de un anónimo en el proyector.
# Veinte y no más: la cuadrícula tiene que caber en un celular sin scroll y elegir tiene que
# durar segundos, no un minuto. **Duplicada en `src/pages/LivePage.tsx`** (mismo criterio que
# `LIVE_TYPES`); si cambia aquí, cambia allá — lo comprueba un test.
AVATARS = (
    "🦖", "🦕", "🐉", "🦊", "🐼", "🦁", "🐨", "🐸", "🦉", "🐙",
    "🦈", "🐝", "🚀", "⚡", "🎸", "🎨", "⚽", "🍕", "👑", "🤖",
)
DEFAULT_AVATAR = "🦖"

# Emojis que un alumno puede lanzar en los tiempos muertos. Cinco, no un chat: en una pantalla
# proyectada delante de la clase, texto libre de un anónimo es un problema de moderación que
# nadie va a poder atender en medio de una evaluación. Con cinco caras no hay nada que moderar.
REACTIONS = ("👍", "😂", "😮", "🔥", "😭")
REACTION_COOLDOWN = 1.5   # segundos entre reacciones del MISMO alumno: evita el spam de uno solo
REACTION_TTL = 6.0        # cuánto viaja una reacción en el estado antes de caerse sola
MAX_REACTIONS = 40        # cota del buffer: 50 alumnos tocando a la vez no lo hacen crecer sin fin
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
    emoji: str = DEFAULT_AVATAR
    score: int = 0
    correct: int = 0
    answers: dict[str, Any] = field(default_factory=dict)  # question_id -> respuesta enviada
    joined_at: float = field(default_factory=time.monotonic)
    # Segundos tardados en las preguntas ACERTADAS y cuántas son. Es lo que permite premiar al
    # más rápido sin confundirlo con el que más acierta: el puntaje mezcla las dos cosas (500
    # por acertar + hasta 500 por rapidez) y por eso, mirando solo el puntaje, no se puede saber
    # cuál de las dos ganó — que es exactamente la pregunta que hacen los alumnos al ver el
    # marcador. Solo cuentan los aciertos: contestar rapidísimo y mal no es ser rápido.
    speed_sum: float = 0.0
    speed_n: int = 0
    streak: int = 0
    best_streak: int = 0
    # Desglose de la ÚLTIMA respuesta, para poder enseñar "500 + 320" en vez de un 820 sin origen.
    last_base: int = 0
    last_speed_bonus: int = 0
    last_reaction_at: float = 0.0

    def avg_speed(self) -> float | None:
        """Segundos promedio por acierto. `None` si no acertó ninguna: sin aciertos no hay
        velocidad que medir (y un 0.0 lo haría ganar el premio al más rápido)."""
        return self.speed_sum / self.speed_n if self.speed_n else None


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
    # Cuándo se lanzó CADA pregunta (question_id -> monotonic). Es lo que permite distinguir, al
    # cerrar la sesión, entre "no llegó a tiempo" (ya estaba dentro cuando se lanzó) y "se la
    # perdió por completo" (entró después): sin esto solo se sabe que no contestó, no por qué.
    question_opened_at: dict[str, float] = field(default_factory=dict)
    revealed: bool = False
    version: int = 0  # sube en cada cambio; el cliente lo usa para saber "pasó algo"
    participants: dict[str, Participant] = field(default_factory=dict)
    created_at: float = field(default_factory=time.monotonic)
    # Reacciones recientes, las últimas primero. NO suben `version`: son decoración, y hacer que
    # cuenten como "pasó algo" mezclaría un emoji con lanzar una pregunta.
    reactions: list[dict[str, Any]] = field(default_factory=list)

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

    def awards(self) -> list[dict[str, Any]]:
        """Menciones del final: quién fue el más rápido, quién el que más acertó, etc.

        Existen porque el marcador solo enseña el TOTAL, y el total mezcla aciertos con rapidez
        (`_points`). Cuando el segundo lugar tiene más respuestas correctas que el primero, el
        podio a secas parece injusto; nombrar en voz alta lo que cada uno hizo mejor lo explica
        sin tener que enseñar la fórmula.

        Cada alumno se lleva UNA mención como mucho, en el orden en que se otorgan aquí: repartir
        cuatro títulos entre el mismo primer lugar deja al resto del salón sin nada, que es justo
        lo contrario de para lo que sirven.
        """
        launched = len(self.question_opened_at)
        pool = [p for p in self.ranking() if p.answers]
        if not pool:
            return []

        taken: set[str] = set()
        out: list[dict[str, Any]] = []

        def add(key: str, badge: str, title: str, subtitle: str, who: Participant | None, detail: str) -> None:
            if who is None or who.pid in taken:
                return
            taken.add(who.pid)
            out.append({"key": key, "badge": badge, "title": title, "subtitle": subtitle,
                        "label": who.label, "emoji": who.emoji, "detail": detail})

        sharpest = max(pool, key=lambda p: (p.correct, p.score))
        quick = [p for p in pool if p.speed_n]
        # Empate al milisegundo → gana quien tiene más puntos. Sin el desempate, el ganador
        # dependería del orden del dict, que no es un criterio que se pueda explicar a nadie.
        fastest = min(quick, key=lambda p: (p.avg_speed() or 0.0, -p.score)) if quick else None

        def secs(p: Participant) -> str:
            return f"{p.avg_speed():.1f}s por acierto"

        if sharpest.correct and fastest is sharpest:
            add("mente_maestra", "🧠", "La mente maestra", "Más aciertos Y el más rápido del salón",
                sharpest, f"{sharpest.correct} de {launched} · {secs(sharpest)}")
        else:
            if sharpest.correct:
                add("mentalista", "🔮", "El mentalista", "Nadie acertó más preguntas",
                    sharpest, f"{sharpest.correct} de {launched} correctas")
            if fastest is not None:
                add("veloz", "🤠", "El más veloz del Oeste", "El dedo más rápido en acertar",
                    fastest, secs(fastest))

        streaks = [p for p in pool if p.best_streak >= 3]
        if streaks:
            champ = max(streaks, key=lambda p: (p.best_streak, p.score))
            add("imparable", "🔥", "El imparable", "La racha más larga sin fallar",
                champ, f"{champ.best_streak} seguidas")

        snipers = [p for p in pool if len(p.answers) >= 3 and p.correct / len(p.answers) >= 0.6]
        if snipers:
            champ = max(snipers, key=lambda p: (p.correct / len(p.answers), p.correct))
            add("francotirador", "🎯", "El francotirador", "La mejor puntería: casi no falla",
                champ, f"{round(100 * champ.correct / len(champ.answers))}% de acierto")

        if launched >= 3:
            complete = [p for p in pool if len(p.answers) == launched]
            if complete:
                add("incansable", "💪", "El incansable", "No dejó ni una sola sin responder",
                    max(complete, key=lambda p: p.score), f"{launched} de {launched} respondidas")

        return out

    # ── Acciones del profesor ─────────────────────────────────────────────────

    def open_next(self, duration: int | None = None) -> None:
        if self.index + 1 >= len(self.questions):
            raise LiveError("No quedan preguntas por lanzar")
        if duration is not None:
            self.duration = max(0, min(600, duration))
        self.index += 1
        self.opened_at = time.monotonic()
        self.question_opened_at[self.questions[self.index].id] = self.opened_at
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

    def join(self, info: dict[str, str], emoji: str | None = None) -> Participant:
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

        avatar = emoji if emoji in AVATARS else DEFAULT_AVATAR

        key_field = self.info_fields[0] if self.info_fields else None
        if key_field:
            key = _norm(clean[key_field])
            for existing in self.participants.values():
                if _norm(existing.info.get(key_field)) == key:
                    existing.info = clean
                    existing.label = self._label(clean)
                    if emoji in AVATARS:
                        existing.emoji = avatar
                    return existing

        if len(self.participants) >= MAX_PARTICIPANTS:
            raise LiveError("La sesión está llena", status=409)

        participant = Participant(pid=secrets.token_urlsafe(9), info=clean, label=self._label(clean), emoji=avatar)
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
        base, bonus = self._points(elapsed) if correct else (0, 0)
        participant.last_base, participant.last_speed_bonus = base, bonus
        if correct:
            participant.correct += 1
            participant.score += base + bonus
            participant.speed_sum += elapsed
            participant.speed_n += 1
            participant.streak += 1
            participant.best_streak = max(participant.best_streak, participant.streak)
        else:
            participant.streak = 0
        self.version += 1

        result: dict[str, Any] = {"registered": True}
        if self.instant_feedback:
            result |= {"correct": correct, "points": base + bonus, "base": base, "speed_bonus": bonus}
        return result

    def _points(self, elapsed: float) -> tuple[int, int]:
        """(500 por acertar, hasta 500 por rapidez). Con 50 personas el conteo de aciertos a secas
        deja veinte empatadas en primer lugar; el bono de velocidad desempata solo.

        Devuelve las DOS mitades por separado, no el total: sin el desglose, dos alumnos con
        distinto número de aciertos y puntajes cruzados (más aciertos, menos puntos) no tienen
        forma de saber por qué, y el marcador parece arbitrario. Es la pregunta que hacen en
        cuanto ven el podio.
        """
        if not self.duration:
            return 500, 500  # sin cronómetro no hay rapidez que medir: todos cobran el bono entero
        return 500, round(500 * max(0.0, 1 - elapsed / self.duration))

    def react(self, pid: str, emoji: str) -> None:
        """Lanza un emoji al aire. No es un chat (ver `REACTIONS`): cinco caras y nada más."""
        participant = self.participants.get(pid)
        if participant is None:
            raise LiveError("No estás en esta sesión", status=404)
        if emoji not in REACTIONS:
            raise LiveError("Ese emoji no está disponible", status=422)
        now = time.monotonic()
        if now - participant.last_reaction_at < REACTION_COOLDOWN:
            return  # silencioso: al alumno que toca rápido no se le enseña un error, se le ignora
        participant.last_reaction_at = now
        self.reactions.append({"emoji": emoji, "label": participant.label, "at": now})
        del self.reactions[:-MAX_REACTIONS]

    def recent_reactions(self) -> list[dict[str, Any]]:
        now = time.monotonic()
        self.reactions = [r for r in self.reactions if now - r["at"] < REACTION_TTL]
        # `age_ms` en vez de `at`: el cliente no comparte el reloj monotónico del servidor, y con
        # la edad puede animar el emoji desde donde va sin necesidad de sincronizar nada.
        return [{"emoji": r["emoji"], "label": r["label"], "age_ms": int((now - r["at"]) * 1000)} for r in self.reactions]

    def set_avatar(self, pid: str, emoji: str) -> Participant:
        """Cambia el avatar. Solo ANTES de que arranque la evaluación (o ya terminada): a mitad
        de una pregunta, un alumno que cambia de cara en la pantalla proyectada es una distracción
        para todo el salón, y el marcador dejaría de ser reconocible entre pregunta y pregunta."""
        participant = self.participants.get(pid)
        if participant is None:
            raise LiveError("No estás en esta sesión", status=404)
        if self.phase() not in {"lobby", "ended"}:
            raise LiveError("Solo puedes cambiar tu avatar antes de que empiece la evaluación")
        if emoji not in AVATARS:
            raise LiveError("Ese avatar no está disponible", status=422)
        participant.emoji = emoji
        self.version += 1
        return participant

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
            "reactions": self.recent_reactions(),
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
                {"label": p.label, "emoji": p.emoji, "score": p.score, "correct": p.correct}
                for p in self.ranking()[:top]
            ]

        if phase == "lobby":
            # Quién ha entrado, para la pantalla de espera. Solo el nombre y el avatar: el resto
            # del `info {}` (el carné) NO viaja a un endpoint público. Se corta en 60 porque es
            # lo que cabe en una proyección; el contador de arriba ya da el total real.
            state["lobby_roster"] = [
                {"label": p.label, "emoji": p.emoji}
                for p in sorted(self.participants.values(), key=lambda p: p.joined_at)[:60]
            ]

        if phase == "ended":
            state["awards"] = self.awards()

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
            "emoji": participant.emoji,
            "score": participant.score,
            "correct_total": participant.correct,
            "rank": next((i + 1 for i, p in enumerate(ranking) if p.pid == pid), None),
            "answered": question is not None and question.id in participant.answers,
            "answer": participant.answers.get(question.id) if question else None,
            "can_change_avatar": phase in {"lobby", "ended"},
        }
        # El ✓/✗ se guarda hasta el reveal (comportamiento Kahoot): así el primero en responder
        # no le canta la respuesta al de al lado. `instant_feedback` lo adelanta al toque.
        if question is not None and me["answered"] and (phase == "reveal" or self.instant_feedback):
            me["correct"] = question.is_correct(participant.answers[question.id])
            # El desglose solo viaja con el ✓/✗: enseñarlo antes delataría si acertó.
            me |= {"last_base": participant.last_base, "last_speed_bonus": participant.last_speed_bonus}
        return me

    def host_state(self) -> dict[str, Any]:
        """Estado del panel del profesor: todo lo público + la lista completa y el temario."""
        state = self.public_state(top=MAX_PARTICIPANTS)
        state["questions"] = [{"number": i + 1, "question": q.question, "type": q.type} for i, q in enumerate(self.questions)]
        state["skipped"] = self.skipped
        state["roster"] = [
            {
                "label": p.label,
                "emoji": p.emoji,
                "info": p.info,
                "score": p.score,
                "correct": p.correct,
                # El promedio por acierto es lo único que separa "acertó más" de "fue más rápido"
                # cuando dos puntajes se cruzan. El profesor es quien recibe la pregunta.
                "avg_speed": round(p.avg_speed(), 1) if p.avg_speed() is not None else None,
            }
            for p in self.ranking()
        ]
        state["instant_feedback"] = self.instant_feedback
        state["awards"] = self.awards()
        return state

    def snapshot(self) -> list[dict[str, Any]]:
        """Resultado por alumno para persistirlo en `worksheet_responses`. Devuelve datos planos:
        construir el `WorksheetResponse` es cosa de `main`, que sí conoce el repositorio.

        Recorre TODAS las preguntas que se llegaron a LANZAR, no solo las que el alumno respondió.
        Antes la nota se promediaba solo sobre lo respondido (`correct / len(graded)` en
        `_score_details`, con `graded` limitado a esas): alguien que entraba a media sesión y se
        perdía la mitad de las preguntas terminaba con la misma nota que quien las respondió
        todas, porque el denominador se encogía junto con el numerador. Las que faltan cuentan
        como incorrectas, con el motivo distinguido en `teacher_comment` (se ve en Revisión):

          · ya estaba dentro cuando se lanzó y no llegó a contestar → "No respondió a tiempo."
          · entró después de que se lanzara → "Pregunta omitida: se conectó después de que se
            lanzara esta pregunta."

        Una pregunta que nunca se llegó a lanzar (la sesión terminó antes) no cuenta ni a favor ni
        en contra de nadie: no forma parte de la sesión que vivió ningún alumno.
        """
        results = []
        for participant in self.ranking():
            rows: list[tuple[LiveQuestion, Any, str, str]] = []
            for q in self.questions:
                opened_at = self.question_opened_at.get(q.id)
                if opened_at is None:
                    continue
                if q.id in participant.answers:
                    given = participant.answers[q.id]
                    rows.append((q, given, "correct" if q.is_correct(given) else "incorrect", ""))
                elif participant.joined_at > opened_at:
                    rows.append((q, None, "incorrect", "Pregunta omitida: se conectó después de que se lanzara esta pregunta."))
                else:
                    rows.append((q, None, "incorrect", "No respondió a tiempo."))
            results.append({
                "pid": participant.pid,
                "label": participant.label,
                "info": participant.info,
                "score": participant.score,
                "correct": participant.correct,
                "answered": len(participant.answers),  # lo que de verdad tocó, no lo omitido
                "answers": dict(participant.answers),
                "details": [
                    {
                        "activity_id": q.id,
                        "activity_type": q.type,
                        "prompt": q.question,
                        "student_answer": given,
                        "correct_answer": q.answer,
                        "status": status,
                        "teacher_comment": comment,
                    }
                    for q, given, status, comment in rows
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
