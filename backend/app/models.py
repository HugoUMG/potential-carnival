from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class UserRole(str, Enum):
    admin = "admin"
    teacher = "teacher"
    student = "student"


class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    email: str | None = None
    username: str
    password_hash: str
    role: UserRole
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


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


class LoginResponse(BaseModel):
    user: PublicUser
    access_token: str
    token_type: str = "bearer"


class Activity(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal["fillblank", "multiplechoice", "textbox", "matching", "speaking", "reading", "imagequestion"]
    text: str | None = None
    question: str | None = None
    options: list[str] | None = None
    answer: str | None = None
    prompt: str | None = None
    left: list[str] | None = None
    right: list[str] | None = None
    title: str | None = None
    content: str | None = None
    questions: list[str] | None = None
    image: str | None = None


class WorksheetJson(BaseModel):
    title: str
    description: str = ""
    activities: list[Activity]


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


class WorksheetCreate(BaseModel):
    script_content: str
    created_by: str
    max_attempts: int | None = None


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
