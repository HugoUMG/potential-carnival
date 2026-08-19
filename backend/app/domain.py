from dataclasses import asdict, dataclass, field
from uuid import uuid4


@dataclass(slots=True)
class ActivityData:
    type: str
    id: str = field(default_factory=lambda: str(uuid4()))
    text: str | None = None
    question: str | None = None
    options: list[str] | None = None
    answer: str | list[str] | None = None
    instructions: str | None = None
    note: str | None = None  # nota privada del profesor: solo la lee la IA al calificar
    prompt: str | None = None
    left: list[str] | None = None
    right: list[str] | None = None
    title: str | None = None
    content: str | None = None
    questions: list[str] | None = None
    image: str | None = None
    option_images: list[str] | None = None  # imagechoice: URL por opción, paralelo a `options`
    left_images: list[str] | None = None  # imagematching: URL por fila, paralelo a `left`
    audio_text: str | None = None
    voice: str | None = None  # 'male' | 'female' | nombre de voz edge-tts; solo listening
    target: str | None = None
    bank: list[str] | None = None
    pairs: list[dict] | None = None
    statements: list[dict] | None = None
    lines: list[dict] | None = None  # conversation: [{speaker: 'male'|'female', text}]
    html: str | None = None  # content: HTML del repaso (se sanea en el front)
    sandbox: bool | None = None  # content: True → render en iframe aislado (HTML+CSS+JS completo)

    def to_dict(self) -> dict[str, object]:
        return {key: value for key, value in asdict(self).items() if value is not None}


@dataclass(slots=True)
class BlockData:
    title: str | None = None
    instructions: str | None = None
    # Estímulo compartido: se muestra UNA vez arriba del bloque y todas sus actividades
    # (de cualquier tipo) responden sobre él. `text` es visible; `audio_text`/`lines` son
    # audio TTS y quedan ocultos, igual que en las actividades listening.
    text: str | None = None
    audio_text: str | None = None
    lines: list[dict] | None = None  # conversación a dos voces: [{speaker, text}]
    voice: str | None = None  # 'male' | 'female'; solo con audio_text
    activities: list[ActivityData] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        d: dict[str, object] = {
            "title": self.title,
            "instructions": self.instructions,
            "activities": [a.to_dict() for a in self.activities],
        }
        for key in ("text", "audio_text", "lines", "voice"):
            value = getattr(self, key)
            if value:
                d[key] = value
        return d


@dataclass(slots=True)
class WorksheetData:
    title: str
    description: str = ""
    activities: list[ActivityData] = field(default_factory=list)
    blocks: list[BlockData] = field(default_factory=list)
    theme: dict[str, str] | None = None
    info_fields: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        d: dict[str, object] = {
            "title": self.title,
            "description": self.description,
            "activities": [a.to_dict() for a in self.activities],
        }
        if self.blocks:
            d["blocks"] = [b.to_dict() for b in self.blocks]
        if self.info_fields:
            d["info_fields"] = self.info_fields
        return d
