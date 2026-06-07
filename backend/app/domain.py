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
    prompt: str | None = None
    left: list[str] | None = None
    right: list[str] | None = None
    title: str | None = None
    content: str | None = None
    questions: list[str] | None = None
    image: str | None = None
    audio_text: str | None = None
    pairs: list[dict] | None = None
    statements: list[dict] | None = None

    def to_dict(self) -> dict[str, object]:
        return {key: value for key, value in asdict(self).items() if value is not None}


@dataclass(slots=True)
class BlockData:
    title: str | None = None
    instructions: str | None = None
    activities: list[ActivityData] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {
            "title": self.title,
            "instructions": self.instructions,
            "activities": [a.to_dict() for a in self.activities],
        }


@dataclass(slots=True)
class WorksheetData:
    title: str
    description: str = ""
    activities: list[ActivityData] = field(default_factory=list)
    blocks: list[BlockData] = field(default_factory=list)
    theme: dict[str, str] | None = None

    def to_dict(self) -> dict[str, object]:
        d: dict[str, object] = {
            "title": self.title,
            "description": self.description,
            "activities": [a.to_dict() for a in self.activities],
        }
        if self.blocks:
            d["blocks"] = [b.to_dict() for b in self.blocks]
        return d
