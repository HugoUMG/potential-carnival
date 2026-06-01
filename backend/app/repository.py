from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

from .database import get_connection, get_database_backend
from .models import PublicUser, StudentCreate, TeacherCreate, UserRole, Worksheet, WorksheetResponse
from .security import hash_password, needs_password_rehash, verify_password


def _parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _decode_json(value: object, fallback: object | None = None) -> object:
    if value is None:
        return fallback
    if isinstance(value, str):
        return json.loads(value)
    return value


class WorksheetRepository:
    """Repositorio compatible con SQLite local y PostgreSQL en producción."""

    @property
    def _placeholder(self) -> str:
        return "%s" if get_database_backend() == "postgresql" else "?"

    def _placeholders(self, amount: int) -> str:
        return ", ".join(self._placeholder for _ in range(amount))

    def _bool_param(self, value: bool) -> bool | int:
        return value if get_database_backend() == "postgresql" else int(value)

    def _json_param(self, value: object) -> object:
        if get_database_backend() == "postgresql":
            from psycopg.types.json import Jsonb

            return Jsonb(value)
        return json.dumps(value, ensure_ascii=False)

    def get_user(self, user_id: str) -> PublicUser | None:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(
                f"SELECT id, name, email, username, role FROM users WHERE id = {placeholder}",
                (user_id,),
            ).fetchone()
        return self._user_from_row(row) if row else None

    def authenticate(self, username: str, password: str, role: UserRole) -> PublicUser | None:
        placeholder = self._placeholder
        allowed_roles = (UserRole.teacher.value, UserRole.admin.value) if role == UserRole.teacher else (role.value,)
        with get_connection() as connection:
            row = connection.execute(
                f"""
                SELECT id, name, email, username, password_hash, role
                FROM users
                WHERE LOWER(username) = LOWER({placeholder}) AND role IN ({self._placeholders(len(allowed_roles))})
                """,
                (username, *allowed_roles),
            ).fetchone()

        if not row:
            return None

        data = dict(row)
        stored_hash = data["password_hash"]
        if not verify_password(password, stored_hash):
            return None
        if needs_password_rehash(stored_hash):
            self.update_password_hash(data["id"], hash_password(password))
        return self._user_from_row(row)

    def update_password_hash(self, user_id: str, password_hash: str) -> None:
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(
                f"UPDATE users SET password_hash = {placeholder} WHERE id = {placeholder}",
                (password_hash, user_id),
            )

    def _ensure_username_available(self, username: str) -> None:
        placeholder = self._placeholder
        with get_connection() as connection:
            existing = connection.execute(
                f"SELECT id FROM users WHERE LOWER(username) = LOWER({placeholder})",
                (username,),
            ).fetchone()
        if existing:
            raise ValueError("El usuario ya existe")

    def create_student(self, payload: StudentCreate) -> PublicUser:
        self._ensure_username_available(payload.username)
        user_id = str(uuid4())
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(
                f"INSERT INTO users (id, name, username, password_hash, role) VALUES ({self._placeholders(4)}, 'student')",
                (user_id, payload.name, payload.username, hash_password(payload.password)),
            )
            row = connection.execute(
                f"SELECT id, name, email, username, role FROM users WHERE id = {placeholder}",
                (user_id,),
            ).fetchone()
        return self._user_from_row(row)

    def create_teacher(self, payload: TeacherCreate) -> PublicUser:
        self._ensure_username_available(payload.username)
        user_id = str(uuid4())
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(
                f"INSERT INTO users (id, name, email, username, password_hash, role) VALUES ({self._placeholders(5)}, 'teacher')",
                (user_id, payload.name, payload.email, payload.username, hash_password(payload.password)),
            )
            row = connection.execute(
                f"SELECT id, name, email, username, role FROM users WHERE id = {placeholder}",
                (user_id,),
            ).fetchone()
        return self._user_from_row(row)

    def list_students(self) -> list[PublicUser]:
        with get_connection() as connection:
            rows = connection.execute("SELECT id, name, email, username, role FROM users WHERE role = 'student' ORDER BY name").fetchall()
        return [self._user_from_row(row) for row in rows]

    def list_teachers(self) -> list[PublicUser]:
        with get_connection() as connection:
            rows = connection.execute("SELECT id, name, email, username, role FROM users WHERE role IN ('admin', 'teacher') ORDER BY role, name").fetchall()
        return [self._user_from_row(row) for row in rows]

    def add_worksheet(self, worksheet: Worksheet) -> Worksheet:
        with get_connection() as connection:
            connection.execute(
                f"""
                INSERT INTO worksheets (id, title, description, script_content, json_content, created_by, created_at, published, archived, max_attempts)
                VALUES ({self._placeholders(10)})
                """,
                (
                    worksheet.id,
                    worksheet.title,
                    worksheet.description,
                    worksheet.script_content,
                    self._json_param(worksheet.json_content.model_dump(mode="json")),
                    worksheet.created_by,
                    worksheet.created_at.isoformat(),
                    self._bool_param(worksheet.published),
                    self._bool_param(worksheet.archived),
                    worksheet.max_attempts,
                ),
            )
        return worksheet

    def list_worksheets(self, created_by: str | None = None, published: bool | None = None, archived: bool | None = None) -> list[Worksheet]:
        clauses: list[str] = []
        params: list[object] = []
        placeholder = self._placeholder
        if created_by:
            clauses.append(f"created_by = {placeholder}")
            params.append(created_by)
        if published is not None:
            clauses.append(f"published = {placeholder}")
            params.append(self._bool_param(published))
        if archived is not None:
            clauses.append(f"archived = {placeholder}")
            params.append(self._bool_param(archived))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with get_connection() as connection:
            rows = connection.execute(f"SELECT * FROM worksheets {where} ORDER BY created_at DESC", params).fetchall()
        return [self._worksheet_from_row(row) for row in rows]

    def get_worksheet(self, worksheet_id: str) -> Worksheet | None:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(f"SELECT * FROM worksheets WHERE id = {placeholder}", (worksheet_id,)).fetchone()
        return self._worksheet_from_row(row) if row else None

    def publish_worksheet(self, worksheet_id: str) -> Worksheet | None:
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(
                f"UPDATE worksheets SET published = {placeholder}, archived = {placeholder} WHERE id = {placeholder}",
                (self._bool_param(True), self._bool_param(False), worksheet_id),
            )
        return self.get_worksheet(worksheet_id)

    def unpublish_worksheet(self, worksheet_id: str) -> Worksheet | None:
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(f"UPDATE worksheets SET published = {placeholder} WHERE id = {placeholder}", (self._bool_param(False), worksheet_id))
        return self.get_worksheet(worksheet_id)

    def archive_worksheet(self, worksheet_id: str) -> Worksheet | None:
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(
                f"UPDATE worksheets SET archived = {placeholder}, published = {placeholder} WHERE id = {placeholder}",
                (self._bool_param(True), self._bool_param(False), worksheet_id),
            )
        return self.get_worksheet(worksheet_id)

    def unarchive_worksheet(self, worksheet_id: str) -> Worksheet | None:
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(f"UPDATE worksheets SET archived = {placeholder} WHERE id = {placeholder}", (self._bool_param(False), worksheet_id))
        return self.get_worksheet(worksheet_id)

    def delete_worksheet(self, worksheet_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            cursor = connection.execute(f"DELETE FROM worksheets WHERE id = {placeholder}", (worksheet_id,))
            return bool(cursor.rowcount)

    def add_response(self, response: WorksheetResponse) -> WorksheetResponse:
        with get_connection() as connection:
            connection.execute(
                f"""
                INSERT INTO worksheet_responses (id, worksheet_id, student_id, student_name, answers_json, details_json, score, correct_count, pending_count, submitted_at)
                VALUES ({self._placeholders(10)})
                """,
                (
                    response.id,
                    response.worksheet_id,
                    response.student_id,
                    response.student_name,
                    self._json_param(response.answers_json),
                    self._json_param([detail.model_dump(mode="json") for detail in response.details]),
                    response.score,
                    response.correct_count,
                    response.pending_count,
                    response.submitted_at.isoformat(),
                ),
            )
        return response

    def count_student_attempts(self, worksheet_id: str, student_id: str) -> int:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(
                f"SELECT COUNT(*) AS total FROM worksheet_responses WHERE worksheet_id = {placeholder} AND student_id = {placeholder}",
                (worksheet_id, student_id),
            ).fetchone()
        return int(dict(row)["total"] if row else 0)

    def get_response(self, response_id: str) -> WorksheetResponse | None:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(f"SELECT * FROM worksheet_responses WHERE id = {placeholder}", (response_id,)).fetchone()
        return self._response_from_row(row) if row else None

    def update_response_review(self, response: WorksheetResponse) -> WorksheetResponse:
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(
                f"""
                UPDATE worksheet_responses
                SET details_json = {placeholder}, score = {placeholder}, correct_count = {placeholder}, pending_count = {placeholder}
                WHERE id = {placeholder}
                """,
                (
                    self._json_param([detail.model_dump(mode="json") for detail in response.details]),
                    response.score,
                    response.correct_count,
                    response.pending_count,
                    response.id,
                ),
            )
        return response

    def list_responses(self, worksheet_id: str | None = None, student_id: str | None = None, include_archived: bool = True) -> list[WorksheetResponse]:
        clauses: list[str] = []
        params: list[object] = []
        placeholder = self._placeholder
        if worksheet_id:
            clauses.append(f"worksheet_responses.worksheet_id = {placeholder}")
            params.append(worksheet_id)
        if student_id:
            clauses.append(f"worksheet_responses.student_id = {placeholder}")
            params.append(student_id)
        if not include_archived:
            clauses.append(f"worksheets.archived = {placeholder}")
            params.append(self._bool_param(False))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT worksheet_responses.*
                FROM worksheet_responses
                JOIN worksheets ON worksheets.id = worksheet_responses.worksheet_id
                {where}
                ORDER BY worksheet_responses.submitted_at DESC
                """,
                params,
            ).fetchall()
        return [self._response_from_row(row) for row in rows]

    def _user_from_row(self, row: object) -> PublicUser:
        data = dict(row)
        return PublicUser(id=data["id"], name=data["name"], email=data.get("email"), username=data.get("username") or data.get("email") or data["id"], role=UserRole(data["role"]))

    def _worksheet_from_row(self, row: object) -> Worksheet:
        data = dict(row)
        return Worksheet(
            id=data["id"],
            title=data["title"],
            description=data["description"],
            script_content=data["script_content"],
            json_content=_decode_json(data["json_content"], {}),
            created_by=data["created_by"],
            created_at=_parse_datetime(data["created_at"]),
            published=bool(data["published"]),
            archived=bool(data.get("archived")),
            max_attempts=data.get("max_attempts"),
        )

    def _response_from_row(self, row: object) -> WorksheetResponse:
        data = dict(row)
        return WorksheetResponse(
            id=data["id"],
            worksheet_id=data["worksheet_id"],
            student_id=data["student_id"],
            student_name=data["student_name"],
            answers_json=_decode_json(data["answers_json"], {}),
            details=_decode_json(data.get("details_json"), []) or [],
            score=data["score"],
            correct_count=data.get("correct_count") or 0,
            pending_count=data.get("pending_count") or 0,
            submitted_at=_parse_datetime(data["submitted_at"]),
        )


repository = WorksheetRepository()
