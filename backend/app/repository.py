from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

from .database import get_connection
from .models import PublicUser, StudentCreate, UserRole, Worksheet, WorksheetResponse


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class SQLiteRepository:
    """Repositorio permanente en SQLite; puede migrarse a PostgreSQL manteniendo los mismos métodos."""

    def authenticate(self, username: str, password: str, role: UserRole) -> PublicUser | None:
        with get_connection() as connection:
            row = connection.execute(
                """
                SELECT id, name, email, username, role
                FROM users
                WHERE LOWER(username) = LOWER(?) AND password_hash = ? AND role = ?
                """,
                (username, password, role.value),
            ).fetchone()
        return self._user_from_row(row) if row else None

    def create_student(self, payload: StudentCreate) -> PublicUser:
        user_id = str(uuid4())
        with get_connection() as connection:
            existing = connection.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (payload.username,)).fetchone()
            if existing:
                raise ValueError("El usuario ya existe")
            connection.execute(
                "INSERT INTO users (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, 'student')",
                (user_id, payload.name, payload.username, payload.password),
            )
            row = connection.execute("SELECT id, name, email, username, role FROM users WHERE id = ?", (user_id,)).fetchone()
        return self._user_from_row(row)

    def list_students(self) -> list[PublicUser]:
        with get_connection() as connection:
            rows = connection.execute("SELECT id, name, email, username, role FROM users WHERE role = 'student' ORDER BY name").fetchall()
        return [self._user_from_row(row) for row in rows]

    def add_worksheet(self, worksheet: Worksheet) -> Worksheet:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO worksheets (id, title, description, script_content, json_content, created_by, created_at, published, max_attempts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    worksheet.id,
                    worksheet.title,
                    worksheet.description,
                    worksheet.script_content,
                    worksheet.json_content.model_dump_json(),
                    worksheet.created_by,
                    worksheet.created_at.isoformat(),
                    int(worksheet.published),
                    worksheet.max_attempts,
                ),
            )
        return worksheet

    def list_worksheets(self, created_by: str | None = None, published: bool | None = None) -> list[Worksheet]:
        clauses: list[str] = []
        params: list[object] = []
        if created_by:
            clauses.append("created_by = ?")
            params.append(created_by)
        if published is not None:
            clauses.append("published = ?")
            params.append(int(published))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with get_connection() as connection:
            rows = connection.execute(f"SELECT * FROM worksheets {where} ORDER BY created_at DESC", params).fetchall()
        return [self._worksheet_from_row(row) for row in rows]

    def get_worksheet(self, worksheet_id: str) -> Worksheet | None:
        with get_connection() as connection:
            row = connection.execute("SELECT * FROM worksheets WHERE id = ?", (worksheet_id,)).fetchone()
        return self._worksheet_from_row(row) if row else None

    def publish_worksheet(self, worksheet_id: str) -> Worksheet | None:
        with get_connection() as connection:
            connection.execute("UPDATE worksheets SET published = 1 WHERE id = ?", (worksheet_id,))
        return self.get_worksheet(worksheet_id)

    def unpublish_worksheet(self, worksheet_id: str) -> Worksheet | None:
        with get_connection() as connection:
            connection.execute("UPDATE worksheets SET published = 0 WHERE id = ?", (worksheet_id,))
        return self.get_worksheet(worksheet_id)

    def count_student_attempts(self, worksheet_id: str, student_id: str | None) -> int:
        if not student_id:
            return 0
        with get_connection() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS total FROM worksheet_responses WHERE worksheet_id = ? AND student_id = ?",
                (worksheet_id, student_id),
            ).fetchone()
        return int(row["total"])

    def add_response(self, response: WorksheetResponse) -> WorksheetResponse:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO worksheet_responses (id, worksheet_id, student_id, student_name, answers_json, details_json, score, correct_count, pending_count, submitted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    response.id,
                    response.worksheet_id,
                    response.student_id,
                    response.student_name,
                    json.dumps(response.answers_json, ensure_ascii=False),
                    json.dumps([detail.model_dump() for detail in response.details], ensure_ascii=False),
                    response.score,
                    response.correct_count,
                    response.pending_count,
                    response.submitted_at.isoformat(),
                ),
            )
        return response

    def get_response(self, response_id: str) -> WorksheetResponse | None:
        with get_connection() as connection:
            row = connection.execute("SELECT * FROM worksheet_responses WHERE id = ?", (response_id,)).fetchone()
        return self._response_from_row(row) if row else None

    def update_response_review(self, response: WorksheetResponse) -> WorksheetResponse:
        with get_connection() as connection:
            connection.execute(
                "UPDATE worksheet_responses SET details_json = ?, score = ?, correct_count = ?, pending_count = ? WHERE id = ?",
                (
                    json.dumps([detail.model_dump() for detail in response.details], ensure_ascii=False),
                    response.score,
                    response.correct_count,
                    response.pending_count,
                    response.id,
                ),
            )
        return self.get_response(response.id) or response

    def list_responses(self, worksheet_id: str | None = None, student_id: str | None = None) -> list[WorksheetResponse]:
        clauses: list[str] = []
        params: list[object] = []
        if worksheet_id:
            clauses.append("worksheet_id = ?")
            params.append(worksheet_id)
        if student_id:
            clauses.append("student_id = ?")
            params.append(student_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with get_connection() as connection:
            rows = connection.execute(f"SELECT * FROM worksheet_responses {where} ORDER BY submitted_at DESC", params).fetchall()
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
            json_content=json.loads(data["json_content"]),
            created_by=data["created_by"],
            created_at=_parse_datetime(data["created_at"]),
            published=bool(data["published"]),
            max_attempts=data.get("max_attempts"),
        )

    def _response_from_row(self, row: object) -> WorksheetResponse:
        data = dict(row)
        return WorksheetResponse(
            id=data["id"],
            worksheet_id=data["worksheet_id"],
            student_id=data["student_id"],
            student_name=data["student_name"],
            answers_json=json.loads(data["answers_json"]),
            details=json.loads(data.get("details_json") or "[]"),
            score=data["score"],
            correct_count=data.get("correct_count") or 0,
            pending_count=data.get("pending_count") or 0,
            submitted_at=_parse_datetime(data["submitted_at"]),
        )


repository = SQLiteRepository()
