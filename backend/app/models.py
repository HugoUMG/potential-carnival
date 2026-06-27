from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class UserRole(str, Enum):
    admin = "admin"
    teacher = "teacher"
    student = "student"
    reader = "reader"  # Solo lectura de vocabulario; contraseña no modificable


class PublicUser(BaseModel):
    id: str
    name: str
    username: str
    role: UserRole
    email: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str = Field(min_length=8)
    role: UserRole


class StudentCreate(BaseModel):
    name: str
    username: str
    password: str = Field(min_length=8)


class TeacherCreate(BaseModel):
    name: str
    username: str
    password: str = Field(min_length=8)
    email: str | None = None


class ReaderCreate(BaseModel):
    name: str
    username: str
    password: str = Field(min_length=8)


class LoginResponse(BaseModel):
    user: PublicUser
    access_token: str
    token_type: str = "bearer"


class Activity(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal[
        "fillblank", "multiplechoice", "multiselect", "textbox", "matching", "speaking", "dragdrop",
        "reading", "imagequestion", "listening",
        "listeningfillblank", "listeningmultiplechoice", "listeningmatching", "listeningtruefalse",
        "truefalse", "readingtruefalse",
    ]  # "speaking" se conserva: datos antiguos en producción pueden contenerlo (no crear nuevas)
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
    target: str | None = None
    bank: list[str] | None = None
    pairs: list[dict] | None = None
    statements: list[dict] | None = None


class ActivityBlock(BaseModel):
    title: str | None = None
    instructions: str | None = None
    activities: list[Activity] = Field(default_factory=list)


class WorksheetJson(BaseModel):
    title: str
    description: str = ""
    activities: list[Activity] = Field(default_factory=list)
    blocks: list[ActivityBlock] | None = None
    info_fields: list[str] = Field(default_factory=list)

    def iter_activities(self) -> list[Activity]:
        if self.blocks:
            return [activity for block in self.blocks for activity in block.activities]
        return self.activities


class Worksheet(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str = ""
    script_content: str
    json_content: WorksheetJson
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    published: bool = False
    archived: bool = False
    max_attempts: int | None = None
    theme: dict[str, str] | None = None
    ai_grading: bool = True
    attempts_used: int | None = None
    attempts_remaining: int | None = None
    due_date: datetime | None = None


class WorksheetCreate(BaseModel):
    script_content: str
    created_by: str
    max_attempts: int | None = None
    theme: dict[str, str] | None = None
    ai_grading: bool = True


class AiGenerateRequest(BaseModel):
    prompt: str
    created_by: str


class AnswerReview(BaseModel):
    activity_id: str
    status: Literal["correct", "incorrect"]
    comment: str = ""


class AnswerDetail(BaseModel):
    activity_id: str
    activity_type: str
    prompt: str
    student_answer: Any = None
    correct_answer: Any = None
    status: Literal["correct", "incorrect", "pending"]
    teacher_comment: str = ""


class WorksheetResponseCreate(BaseModel):
    worksheet_id: str
    student_name: str
    answers_json: dict[str, Any]
    student_id: str | None = None


class GuestResponseCreate(BaseModel):
    worksheet_id: str
    student_name: str
    guest_token: str
    answers_json: dict[str, Any]


class GuestSessionLog(BaseModel):
    guest_token: str
    name: str
    classroom_id: str
    classroom_name: str


class WorksheetResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    worksheet_id: str
    student_name: str
    answers_json: dict[str, Any]
    details: list[AnswerDetail] = Field(default_factory=list)
    score: float | None = None
    correct_count: int = 0
    pending_count: int = 0
    submitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    student_id: str | None = None
    guest_token: str | None = None


class ClassroomCreate(BaseModel):
    name: str


class ClassroomStudentAssignment(BaseModel):
    student_id: str


class ClassroomWorksheetAssignment(BaseModel):
    worksheet_id: str
    due_date: datetime | None = None


class ClassroomVisibilityUpdate(BaseModel):
    is_public: bool


class Classroom(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_public: bool = False


class ClassroomDetail(Classroom):
    students: list[PublicUser] = Field(default_factory=list)
    worksheets: list[Worksheet] = Field(default_factory=list)
    student_statuses: dict[str, str] = Field(default_factory=dict)


class UserUpdate(BaseModel):
    name: str
    email: str | None = None
    username: str


class PasswordUpdate(BaseModel):
    new_password: str = Field(min_length=8)
    current_password: str | None = None


class TeacherDashboardStats(BaseModel):
    total_students: int
    active_worksheets: int
    total_responses: int = 0
    avg_scores: list[dict[str, float | str]] = Field(default_factory=list)
    worksheet_stats: list[dict[str, float | int | str]] = Field(default_factory=list)
    total_correct: int
    total_incorrect: int
    students_per_classroom: list[dict[str, int | str]] = Field(default_factory=list)


class UserSession(BaseModel):
    id: str
    user_id: str
    logged_in_at: datetime
    logged_out_at: datetime | None = None


class StudentActivity(BaseModel):
    student_id: str
    student_name: str
    username: str
    last_login: datetime | None = None
    is_online: bool = False
    total_sessions: int = 0


# ─── Vocabulario ───────────────────────────────────────────────────────────────

class VocabularyItem(BaseModel):
    english: str
    spanish: str
    type: str  # verb, noun, adjective, adverb, connector, linking word, preposition, phrase, other
    block: str = ""
    v_past: str = ""
    v_participle: str = ""
    v_ing: str = ""
    v_3rd: str = ""


class VocabularyList(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str = ""
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    items: list[VocabularyItem] = Field(default_factory=list)


class VocabularyListCreate(BaseModel):
    title: str
    description: str = ""
    created_by: str
    items: list[VocabularyItem] = Field(default_factory=list)


class VocabularyAssignment(BaseModel):
    classroom_id: str
