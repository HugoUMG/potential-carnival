from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

from .database import get_connection
from .models import PublicUser, UserRole, Worksheet, WorksheetResponse


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class SQLiteRepository:
    """Repositorio permanente en SQLite; puede migrarse a PostgreSQL manteniendo los mismos métodos."""

    def authenticate(self, email: str, password: str, role: UserRole) -> PublicUser | None:
        with get_connection() as connection:
            row = connection.execute(
                """
                SELECT id, name, email, role
                FROM users
                WHERE email = ? AND password_hash = ? AND role = ?
                """,
                (email, password, role.value),
            ).fetchone()
        if not row:
            return None
        return PublicUser(id=row["id"], name=row["name"], email=row["email"], role=UserRole(row["role"]))

    def add_worksheet(self, worksheet: Worksheet) -> Worksheet:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO worksheets (id, title, description, script_content, json_content, created_by, created_at, published)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        if not row:
            return None
        return self._worksheet_from_row(row)

    def publish_worksheet(self, worksheet_id: str) -> Worksheet | None:
        with get_connection() as connection:
            connection.execute("UPDATE worksheets SET published = 1 WHERE id = ?", (worksheet_id,))
        return self.get_worksheet(worksheet_id)

    def unpublish_worksheet(self, worksheet_id: str) -> Worksheet | None:
        with get_connection() as connection:
            connection.execute("UPDATE worksheets SET published = 0 WHERE id = ?", (worksheet_id,))
        return self.get_worksheet(worksheet_id)

    def duplicate_worksheet(self, worksheet_id: str) -> Worksheet | None:
        worksheet = self.get_worksheet(worksheet_id)
        if not worksheet:
            return None
        duplicate = worksheet.model_copy(update={"id": str(uuid4()), "title": f"{worksheet.title} (Copia)", "published": False})
        return self.add_worksheet(duplicate)

    def add_response(self, response: WorksheetResponse) -> WorksheetResponse:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO worksheet_responses (id, worksheet_id, student_id, student_name, answers_json, score, submitted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    response.id,
                    response.worksheet_id,
                    response.student_id,
                    response.student_name,
                    json.dumps(response.answers_json, ensure_ascii=False),
                    response.score,
                    response.submitted_at.isoformat(),
                ),
            )
        return response

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
        )

    def _response_from_row(self, row: object) -> WorksheetResponse:
        data = dict(row)
        return WorksheetResponse(
            id=data["id"],
            worksheet_id=data["worksheet_id"],
            student_id=data["student_id"],
            student_name=data["student_name"],
            answers_json=json.loads(data["answers_json"]),
            score=data["score"],
            submitted_at=_parse_datetime(data["submitted_at"]),
        )


repository = SQLiteRepository()
