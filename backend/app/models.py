from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class UserRole(str, Enum):
    teacher = "teacher"
    student = "student"


class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    email: str
    password_hash: str
    role: UserRole
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PublicUser(BaseModel):
    id: str
    name: str
    email: str
    role: UserRole


class LoginRequest(BaseModel):
    email: str
    password: str
    role: UserRole


class LoginResponse(BaseModel):
    user: PublicUser
    access_token: str
    token_type: str = "demo"


class Activity(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal[
        "fillblank",
        "multiplechoice",
        "textbox",
        "matching",
        "speaking",
        "reading",
        "imagequestion",
    ]
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


class WorksheetCreate(BaseModel):
    script_content: str
    created_by: str


class WorksheetUpdateScript(BaseModel):
    script_content: str


class AiGenerateRequest(BaseModel):
    prompt: str
    created_by: str


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
    score: float | None = None
    submitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    student_id: str | None = None
