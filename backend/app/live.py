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

import random
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
LIVE_TYPES = ("multiplechoice", "multiselect", "poll", "truefalse", "imagechoice",
              "matching", "imagematching", "dragdrop", "fillblank",
              "listeningmultiplechoice", "listeningtruefalse", "listeningmatching",
              "listeningfillblank", "listeningorder", "readingtruefalse")

# Cuántas fichas puede tener una oración para ordenar. Armar doce fichas con el pulgar y el
# cronómetro corriendo no es una pregunta de inglés, es una de motricidad.
MAX_LIVE_TILES = 8

# El hueco del DSL. Misma cadena que cuenta `_activity_problem` en `parser.py` y que parte el
# renderer de la hoja: si aquí se contara distinto, la sesión pediría más o menos huecos de los
# que el profesor escribió.
BLANK = "_____"
# Tope de huecos por pregunta. Rellenar cuatro campos con el pulgar y el cronómetro corriendo no
# es una pregunta, es un castigo; y en la pantalla proyectada la oración deja de leerse.
MAX_LIVE_BLANKS = 3

# Tope de opciones de una pregunta en vivo. `OPTION_COLORS` en `LivePage.tsx` tiene CUATRO
# entradas y cicla: con siete opciones hay dos azules, y el color deja de identificar nada desde
# el fondo del salón — que es justo para lo que está. Una actividad que pase de aquí no se
# recorta (perdería la respuesta correcta la mitad de las veces): se descarta entera y se
# reporta, como todo lo demás que se queda fuera.
MAX_LIVE_OPTIONS = 6

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
# Sin poll en este tiempo, el alumno cuenta como desconectado y no se le espera para revelar. El
# celular polea cada 1s; 25s aguantan pantalla bloqueada breve o red lenta sin falsos positivos.
OFFLINE_AFTER = 25.0
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
    image: str | None = None  # imagechoice / imagematching: imagen del enunciado
    option_images: list[str] | None = None  # imagechoice: URL por opción, PARALELA a `options`
    # MECÁNICA de respuesta, separada del tipo del DSL. El cliente decide qué pinta mirando
    # esto, no `type`: con 21 tipos, ramificar por tipo son 21 ramas repartidas en tres archivos
    # y la certeza de que alguna se olvida. Cinco mecánicas cubren el catálogo entero
    # ("choice", "multi", y más adelante "text", "blanks", "order"); `type` se queda solo para
    # la etiqueta y el color.
    input: str = "choice"
    # ¿Cuenta para la nota? `poll` es lo único que llega con False: una encuesta de opinión no
    # tiene clave, así que no da puntos, no rompe la racha, no entra al snapshot y en el reveal
    # solo se proyecta el reparto de votos. Es un booleano y no otro `input` porque la mecánica
    # de respuesta es la misma de siempre (botones); lo que cambia es la calificación.
    scored: bool = True
    # ── Audio ────────────────────────────────────────────────────────────────
    # El texto que se sintetiza NUNCA sale en `public_state()`: el alumno y la pantalla polean
    # el MISMO endpoint sin autenticación, así que publicarlo aquí sería regalar la
    # transcripción del audio a cualquiera que abra las herramientas del navegador — la regla 41
    # rota por otra puerta. Al cliente solo le llega `has_audio`; el mp3 se pide aparte, con la
    # llave de pantalla (`LiveSession.screen_key`), que solo viaja en `host_state()`.
    audio_text: str | None = None
    voice: str | None = None
    rate: str | None = None
    # Texto compartido sobre el que pregunta la actividad (el `text` de un `block {}`). Se pinta
    # arriba del enunciado. Sin esto, una hoja con una lectura y cinco preguntas debajo mandaba
    # al alumno las preguntas SIN el texto del que hablan.
    passage: str | None = None

    def is_correct(self, given: Any) -> bool:
        """Misma semántica que `_build_answer_details` en `main.py`. Se ramifica por MECÁNICA
        (`input`), no por tipo, porque dos mecánicas distintas usan una lista de respuestas y la
        comparan de forma opuesta:

          · `multi` (multiselect): el CONJUNTO elegido debe coincidir exactamente, sin importar
            el orden en que se tocaron las opciones;
          · `blanks` (fillblank, dragdrop): comparación POSICIONAL, hueco por hueco. Aquí el
            orden es justo lo que se está calificando.

        El resto compara texto sin distinguir mayúsculas. `truefalse` cae ahí porque llega ya
        convertido a las opciones "True"/"False" — las mismas cadenas que guarda el renderer
        normal, así que la entrega que deja `finish` es indistinguible de una hecha en la hoja.

        ponytail: unas líneas duplicadas en vez de importar el calificador de `main.py`, que
        arrastraría el `.env` de producción al test (ADR-26). El umbral que fija esa decisión
        para sacar un módulo compartido es un TERCER SITIO que lo necesite, y siguen siendo dos.
        Precio: si cambia el criterio de estos tipos hay que tocar los dos — por eso cada
        mecánica nueva trae su test, y el descuadre sale en rojo y no en el salón.
        """
        if not self.scored:
            return False  # encuesta: no hay respuesta correcta que acertar
        if self.input == "multi":
            correct = {_norm(a) for a in (self.answer if isinstance(self.answer, list) else [self.answer])}
            chosen = {_norm(a) for a in (given if isinstance(given, list) else ([given] if given else []))}
            return bool(correct) and chosen == correct
        if self.input == "order":
            # Orden EXACTO, con `==` y no `>=`: aquí sobrar una ficha sí es un error (`main.py`
            # usa el mismo criterio para `listeningorder`). En los huecos no, porque el que
            # sobra es un campo vacío del cliente, no una palabra que el alumno haya puesto.
            correct_order = self.answer if isinstance(self.answer, list) else [self.answer]
            chosen_order = given if isinstance(given, list) else [given]
            return len(chosen_order) == len(correct_order) and all(
                _norm(chosen_order[i]) == _norm(c) for i, c in enumerate(correct_order)
            )
        if self.input == "blanks":
            correct_list = self.answer if isinstance(self.answer, list) else [self.answer]
            chosen_list = given if isinstance(given, list) else [given]
            # `>=` y no `==`, igual que `main.py`: al alumno le sobra un campo vacío en el
            # cliente antes que faltarle uno, y lo que se califica son los huecos que hay clave.
            return len(chosen_list) >= len(correct_list) and all(
                _norm(chosen_list[i]) == _norm(c) for i, c in enumerate(correct_list)
            )
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
    last_seen: float = field(default_factory=time.monotonic)  # último poll con su pid

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
    # Llave del audio proyectado. Viaja SOLO en `host_state()` (el panel la mete en la URL de la
    # pantalla); con ella se pide el mp3 en `/live/{code}/audio`. Existe porque el alumno y la
    # pantalla polean el MISMO endpoint público: sin una llave aparte, cualquier forma de mandar
    # el audio a la pantalla se lo manda también al celular, y con él la transcripción.
    screen_key: str = field(default_factory=lambda: secrets.token_urlsafe(8))
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
        """lobby → [listening] → question → reveal → … → ended.

        El tiempo agotado pasa solo a `reveal` (una pregunta abierta con el cronómetro en cero
        sería un limbo), igual que cuando ya respondieron todos (`submit`), pero LANZAR la siguiente siempre es decisión del profesor.

        `listening` es la subfase de las preguntas con audio: se proyecta y suena, pero los
        botones del alumno están cerrados y el cronómetro **no ha arrancado**. Sin ella, el bono
        de rapidez de `_points` premiaría a quien toca un botón antes de oír el audio: 500 puntos
        por adivinar a ciegas, y el que escucha la pregunta entera pierde por escucharla. El
        cronómetro arranca cuando el profesor pulsa "Abrir respuestas" (`open_answers`).
        """
        if self.index < 0:
            return "lobby"
        if self.index >= len(self.questions):
            return "ended"
        if self.revealed:
            return "reveal"
        if self.opened_at is None:
            return "listening"  # lanzada pero sin respuestas abiertas todavía
        if self.remaining_ms() == 0:
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
        question = self.questions[self.index]
        # Con audio, la pregunta nace en `listening`: se proyecta y suena con las respuestas
        # cerradas, y el cronómetro no arranca hasta `open_answers`. Sin audio, como siempre.
        self.opened_at = None if question.audio_text else time.monotonic()
        # Se marca al LANZAR, no al abrir respuestas: quien entra durante la escucha sí vivió la
        # pregunta, y esto es lo que `snapshot()` usa para distinguir "no llegó a tiempo" de "se
        # conectó después". Medirlo desde `open_answers` regalaría la pregunta al que entra tarde.
        self.question_opened_at[question.id] = time.monotonic()
        self.revealed = False
        self.version += 1

    def open_answers(self) -> None:
        """Cierra la escucha y arranca el cronómetro. Solo tiene sentido en fase `listening`."""
        if self.phase() != "listening":
            raise LiveError("Las respuestas ya están abiertas")
        self.opened_at = time.monotonic()
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
        participant.last_seen = time.monotonic()
        self._reveal_if_all_answered()
        if not question.scored:
            # Votar no puntúa NI rompe la racha: quien va acertando no debe perderla por opinar.
            self.version += 1
            return {"registered": True}
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

    def _reveal_if_all_answered(self) -> None:
        """Como Kahoot: si ya respondieron todos los conectados, se revela sin esperar el cronómetro.

        Se llama al responder Y en cada poll: si el último que faltaba cierra la pestaña, nadie
        vuelve a responder y solo el paso del tiempo (visto desde un poll) lo saca de la cuenta.
        """
        question = self.current()
        if question is None or self.phase() != "question":
            return
        now = time.monotonic()
        pending = [p for p in self.participants.values()
                   if question.id not in p.answers and now - p.last_seen < OFFLINE_AFTER]
        # Sin ninguna respuesta no se revela: con todo el salón desconectado (o vacío) la pregunta
        # se quedaría cerrada en cuanto se lanza.
        if not pending and self.answered_count():
            self.revealed = True
            self.version += 1

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
        if pid and pid in self.participants:
            self.participants[pid].last_seen = time.monotonic()
        self._reveal_if_all_answered()
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

        if question is not None and phase in {"listening", "question", "reveal"}:
            state["question"] = {
                "id": question.id,
                "type": question.type,
                "input": question.input,
                "scored": question.scored,
                # Solo el booleano. El texto que se sintetiza NO viaja por aquí: este endpoint
                # es público y lo poleа el celular del alumno igual que la pantalla.
                "has_audio": bool(question.audio_text),
                "question": question.question,
                "options": question.options,
                "number": self.index + 1,
                "image": question.image,
                "option_images": question.option_images,
                "passage": question.passage,
            }

        if phase == "reveal" and question is not None:
            if question.scored:
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
        if question is not None and question.scored and me["answered"] and (phase == "reveal" or self.instant_feedback):
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
        # Solo aquí: `host_state` va detrás del JWT del profesor. Si esto se colara en
        # `public_state`, el celular del alumno podría pedir el mp3 y sacar la transcripción.
        state["screen_key"] = self.screen_key
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
                if not q.scored:
                    continue  # una encuesta no se califica: ni acierto ni fallo en Revisión
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


def _answer_list(activity: Any) -> list[str]:
    """La clave de una actividad como lista: una entrada por hueco o por ficha.

    `answer` llega como cadena cuando hay un solo hueco (`answer: "May"`) y como lista cuando hay
    varios. Recorrer la cadena la parte en LETRAS: un `fillblank` con clave "May" se jugaba
    pidiendo "M" y daba por mala la palabra entera.
    """
    raw = getattr(activity, "answer", None) or []
    if isinstance(raw, str):
        raw = [raw]
    return [str(a) for a in raw if str(a).strip()]


def activity_questions(activity: Any, passage: str | None = None) -> list[LiveQuestion]:
    """Las preguntas en vivo que da UNA actividad. Lista vacía = no se puede jugar.

    Es la única autoridad sobre qué entra y qué no: `extract_questions` la recorre y `summarize`
    la usa para contar lo descartado. Antes eran dos criterios distintos (una lista de tipos y
    un recorrido aparte), y bastaba que una actividad de tipo jugable no diera ninguna pregunta
    —sin clave, con demasiadas opciones— para que desapareciera sin contarse ni como jugada ni
    como descartada. El fallo silencioso de la regla 3, otra vez.

    Sobre la explosión: una actividad no es siempre una pregunta. Un `truefalse` de cinco
    enunciados son CINCO preguntas, y un `matching` de cuatro filas son CUATRO. Se numeran
    `{activity_id}:{índice}`, la misma convención que usa `_build_answer_details` en `main.py`
    para esos mismos tipos, de modo que la entrega que guarda `finish` encaja con lo que
    Revisión ya sabe leer.
    """
    kind = getattr(activity, "type", None)
    if kind not in LIVE_TYPES:
        return []

    audio = getattr(activity, "audio_text", None) or None
    voice = getattr(activity, "voice", None)
    rate = getattr(activity, "rate", None)

    def build(**kwargs: Any) -> LiveQuestion:
        kwargs.setdefault("audio_text", audio)
        return LiveQuestion(passage=passage, voice=voice, rate=rate, **kwargs)

    # ── Audio ────────────────────────────────────────────────────────────────
    # Los cinco tipos `listening*` son los de arriba con un audio delante. Todos exigen
    # `audio_text`: sin él, la pregunta es incontestable (y el parser ya lo valida, pero una
    # hoja vieja o editada a mano puede llegar sin él).

    if kind == "listeningmatching":
        # Un audio POR PAR: se oye una frase y se elige con qué empareja. De todos los tipos de
        # audio es el que mejor funciona en vivo — el audio es corto y se repite por pregunta.
        pairs = [p for p in (getattr(activity, "pairs", None) or []) if p.get("audio_text") and p.get("match")]
        options = list(getattr(activity, "options", None) or []) or [p["match"] for p in pairs]
        if len(pairs) < 1 or not (2 <= len(options) <= MAX_LIVE_OPTIONS):
            return []
        shuffled = list(options)
        random.Random(f"{activity.id}:live").shuffle(shuffled)
        return [
            build(
                id=f"{activity.id}:{index}",
                type=kind,
                # Mismo texto que usa `_build_answer_details` para este tipo: sin el enunciado,
                # el temario del profesor y Revisión mostrarían filas en blanco.
                question=f"Audio {index + 1}",
                options=shuffled,
                answer=pair["match"],
                audio_text=pair["audio_text"],
            )
            for index, pair in enumerate(pairs)
        ]

    if kind == "listeningtruefalse":
        statements = [
            s for s in (getattr(activity, "statements", None) or [])
            if (s.get("text") or "").strip() and s.get("answer") is not None
        ]
        if not audio or not statements:
            return []
        # El MISMO audio en cada enunciado: se vuelve a poder oír en cada pregunta, que es lo
        # que hace falta cuando son cinco enunciados sobre una grabación de veinte segundos.
        return [
            build(
                id=f"{activity.id}:{index}",
                type=kind,
                question=statement["text"].strip(),
                options=list(TRUE_FALSE_OPTIONS),
                answer="True" if statement["answer"] else "False",
            )
            for index, statement in enumerate(statements)
        ]

    if kind == "listeningorder":
        tiles = _answer_list(activity)
        if not audio or not (2 <= len(tiles) <= MAX_LIVE_TILES):
            return []
        bank = list(getattr(activity, "bank", None) or tiles)
        shuffled = list(bank)
        random.Random(f"{activity.id}:live").shuffle(shuffled)
        return [build(
            id=activity.id,
            type=kind,
            question=str(getattr(activity, "prompt", None) or "Ordena la oración que escuchaste"),
            options=shuffled,
            answer=tiles,
            input="order",
        )]

    if kind == "listeningmultiplechoice" and not audio:
        return []
    if kind == "listeningfillblank" and not audio:
        return []

    # `readingtruefalse` es un `truefalse` con un texto encima. NO usa la subfase de escucha, y
    # la diferencia no es de comodidad: el audio es EFÍMERO —no se puede volver a oír mientras
    # el reloj corre, por eso necesita una pausa antes de arrancarlo— y el texto se queda en
    # pantalla, así que se lee mientras se responde. Es el mismo trato que ya reciben los textos
    # de un `block {}`. Lo que sí hace falta es más tiempo, y el panel lo sugiere.
    if kind == "readingtruefalse":
        content = (getattr(activity, "content", None) or "").strip()
        statements = [
            s for s in (getattr(activity, "statements", None) or [])
            if (s.get("text") or "").strip() and s.get("answer") is not None
        ]
        if not content or not statements:
            return []
        return [
            LiveQuestion(
                id=f"{activity.id}:{index}",
                type=kind,
                question=statement["text"].strip(),
                options=list(TRUE_FALSE_OPTIONS),
                answer="True" if statement["answer"] else "False",
                # El texto de la actividad gana al del bloque: es más específico. Un
                # `readingtruefalse` dentro de un bloque con lectura es raro, pero si pasa, el
                # alumno tiene que ver el que la pregunta cita.
                passage=content,
            )
            for index, statement in enumerate(statements)
        ]

    if kind == "truefalse":
        out = []
        for index, statement in enumerate(getattr(activity, "statements", None) or []):
            text = (statement.get("text") or "").strip()
            if not text or statement.get("answer") is None:
                continue
            out.append(build(
                id=f"{activity.id}:{index}",
                type="truefalse",
                question=text,
                options=list(TRUE_FALSE_OPTIONS),
                # Las mismas cadenas que guarda el renderer de la hoja ('true'/'false'),
                # comparadas sin distinguir mayúsculas.
                answer="True" if statement["answer"] else "False",
            ))
        return out

    # `matching` e `imagematching`: una pregunta POR FILA, no un tablero que se arrastra.
    # El renderer normal se juega con líneas y por eso se descartó en vivo la primera vez, pero
    # `_build_answer_details` (main.py) ya califica estos tipos fila a fila — o sea que la
    # unidad de calificación YA ES una opción múltiple: enunciado = `left[i]`, opciones = todas
    # las `right`, clave = `right[i]`. En vivo son los mismos botones que el resto y el problema
    # del dedo desaparece, igual que desapareció con `truefalse`.
    if kind in {"matching", "imagematching"}:
        left = list(getattr(activity, "left", None) or [])
        right = list(getattr(activity, "right", None) or [])
        images = list(getattr(activity, "left_images", None) or [])
        if len(left) < 2 or len(right) < len(left) or len(right) > MAX_LIVE_OPTIONS:
            return []
        # Barajado DETERMINISTA por actividad: sin él la clave de la fila `i` cae siempre en la
        # posición `i` (fila 1 → primer botón, fila 2 → segundo…) y el juego se resuelve sin
        # leer nada. La semilla es el id de la actividad para que el orden sea el mismo en toda
        # la sesión y reproducible en un test; `random` aquí es cosmético, no criptográfico.
        options = list(right)
        random.Random(f"{activity.id}:live").shuffle(options)
        return [
            build(
                id=f"{activity.id}:{index}",
                type=kind,
                question=str(label),
                options=options,
                answer=right[index],
                # `imagematching` pregunta POR la imagen: es el enunciado, no una opción.
                image=images[index] if kind == "imagematching" and index < len(images) else None,
            )
            for index, label in enumerate(left)
        ]

    # `dragdrop` y `fillblank`: una oración con huecos `_____`. Los dos son la misma pregunta en
    # vivo y solo cambia de dónde sale la respuesta — `dragdrop` trae `bank` (se toca una ficha)
    # y `fillblank` no (se teclea). Por eso comparten `input="blanks"`: el cliente decide fichas
    # o teclado mirando si vienen `options`, sin una rama por tipo.
    #
    # El de UN hueco con banco es, además, un `multiplechoice` disfrazado: el parser ya valida
    # que el `bank` contenga todas las respuestas, así que se juega con los botones de siempre.
    if kind in {"dragdrop", "fillblank", "listeningfillblank"}:
        text = str(getattr(activity, "text", None) or "")
        answers = _answer_list(activity)
        bank = list(getattr(activity, "bank", None) or [])
        blanks = text.count(BLANK)
        # Sin huecos no hay dónde escribir, y con más claves que huecos la oración no cuadra.
        # `fillblank` admite `blanks == 0` en el parser (la clave puede ir suelta), pero en vivo
        # se necesita el hueco para pintar el campo: sin él, no es jugable.
        if not (1 <= blanks <= MAX_LIVE_BLANKS) or len(answers) < blanks:
            return []
        answers = answers[:blanks]

        if blanks == 1 and 2 <= len(bank) <= MAX_LIVE_OPTIONS:
            return [build(id=activity.id, type=kind, question=text, options=bank, answer=answers[0])]

        return [build(
            id=activity.id,
            type=kind,
            question=text,
            # Con banco, las fichas son las opciones; sin banco se teclea y no hay ninguna.
            options=bank if bank else [],
            answer=answers,
            input="blanks",
        )]

    if kind == "poll":
        options = list(getattr(activity, "options", None) or [])
        if not (2 <= len(options) <= MAX_LIVE_OPTIONS):
            return []
        return [build(
            id=activity.id,
            type=kind,
            question=getattr(activity, "question", None) or "",
            options=options,
            answer="",
            scored=False,
        )]

    options = list(getattr(activity, "options", None) or [])
    answer = getattr(activity, "answer", None)
    if not (2 <= len(options) <= MAX_LIVE_OPTIONS) or not answer:
        return []  # sin opciones, sin clave o con demasiadas: no se puede jugar ni calificar
    images = list(getattr(activity, "option_images", None) or []) if kind == "imagechoice" else []
    return [build(
        id=activity.id,
        type=kind,
        question=getattr(activity, "question", None) or getattr(activity, "prompt", None) or "",
        options=options,
        answer=answer,
        input="multi" if kind == "multiselect" else "choice",
        image=getattr(activity, "image", None) if kind == "imagechoice" else None,
        # Se rellena a la longitud de `options`: una URL de menos dejaría la opción sin
        # imagen, no descuadrada.
        option_images=(images + [""] * len(options))[:len(options)] if images else None,
    )]


@dataclass(slots=True)
class _BlockContext:
    """Lo que un `block {}` aporta a cada actividad que cuelga de él.

    `WorksheetJson.iter_activities()` aplana los bloques y tira el `BlockData` entero
    (`models.py`), así que hasta agosto de 2026 una hoja con una lectura arriba y cinco preguntas
    debajo (ADR-24) se jugaba en vivo mandando las preguntas SIN el texto del que hablan. Nadie se
    enteraba: llegaban bien formadas, solo que sobre la nada.
    """
    passages: dict[str, str] = field(default_factory=dict)
    audios: dict[str, tuple[str, str | None, str | None]] = field(default_factory=dict)
    # Bloques de CONVERSACIÓN (`lines`, dos voces). Siguen mudos: sintetizarlos es concatenar un
    # mp3 por turno (`/tts/conversation`), no una llamada. Se descartan y se reportan, en vez de
    # preguntar por un diálogo que nadie ha oído.
    muted: set[str] = field(default_factory=set)


def _block_context(blocks: list[Any] | None) -> _BlockContext:
    context = _BlockContext()
    for block in blocks or []:
        text = (getattr(block, "text", None) or "").strip()
        audio = (getattr(block, "audio_text", None) or "").strip()
        lines = getattr(block, "lines", None)
        for activity in getattr(block, "activities", None) or []:
            if text:
                context.passages[activity.id] = text
            if audio:
                context.audios[activity.id] = (audio, getattr(block, "voice", None), getattr(block, "rate", None))
            elif lines:
                context.muted.add(activity.id)
    return context


def extract_questions(activities: list[Any], blocks: list[Any] | None = None) -> list[LiveQuestion]:
    """Las preguntas jugables de la hoja, en su orden. `blocks` aporta el estímulo compartido."""
    context = _block_context(blocks)
    out: list[LiveQuestion] = []
    for activity in activities:
        if activity.id in context.muted:
            continue
        questions = activity_questions(activity, context.passages.get(activity.id))
        # El audio del BLOQUE se hereda: una `multiplechoice` normal colgada de un bloque con
        # `audio_text` es, en vivo, una pregunta de escucha. Solo si la actividad no trae el suyo.
        if (audio := context.audios.get(activity.id)) is not None:
            for question in questions:
                if not question.audio_text:
                    question.audio_text, question.voice, question.rate = audio
        out.extend(questions)
    return out


def summarize(activities: list[Any], blocks: list[Any] | None = None) -> dict[str, Any]:
    """Cuántas preguntas jugables da la hoja y qué se queda fuera, por tipo.

    Existe para que descartar una actividad sea VISIBLE. Sin esto, un profesor con una hoja de
    diez actividades abre una sesión de tres preguntas y no hay nada que le diga por qué — el
    fallo silencioso que este proyecto ya se ha comido varias veces (ver 12_RULES).
    """
    context = _block_context(blocks)
    skipped: dict[str, int] = {}
    playable = 0
    for activity in activities:
        kind = getattr(activity, "type", None)
        if kind == "content":
            continue  # material de repaso, no una actividad que se descarte
        # Se cuenta por lo que la actividad DA, no por su tipo: un `matching` de ocho columnas
        # es de tipo jugable y aun así no entra, y eso tiene que verse.
        count = 0 if activity.id in context.muted else len(activity_questions(activity))
        if count:
            playable += count
        else:
            skipped[kind] = skipped.get(kind, 0) + 1
    return {
        "playable": playable,
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
            "múltiple, selección múltiple, verdadero/falso, imagen + opción múltiple, "
            "emparejar, emparejar imágenes y arrastrar de un solo hueco.",
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
