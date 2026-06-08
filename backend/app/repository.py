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

    def delete_student(self, student_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(
                f"SELECT id FROM users WHERE id = {placeholder} AND role = 'student'",
                (student_id,),
            ).fetchone()
            if not row:
                return False
            connection.execute(
                f"UPDATE worksheet_responses SET student_id = NULL WHERE student_id = {placeholder}",
                (student_id,),
            )
            connection.execute(
                f"DELETE FROM users WHERE id = {placeholder} AND role = 'student'",
                (student_id,),
            )
        return True

    def delete_teacher(self, teacher_id: str, replacement_owner_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(
                f"SELECT id FROM users WHERE id = {placeholder} AND role = 'teacher'",
                (teacher_id,),
            ).fetchone()
            if not row:
                return False
            connection.execute(
                f"UPDATE worksheets SET created_by = {placeholder} WHERE created_by = {placeholder}",
                (replacement_owner_id, teacher_id),
            )
            connection.execute(
                f"DELETE FROM users WHERE id = {placeholder} AND role = 'teacher'",
                (teacher_id,),
            )
        return True

    def add_worksheet(self, worksheet: Worksheet) -> Worksheet:
        with get_connection() as connection:
            connection.execute(
                f"""
                INSERT INTO worksheets (id, title, description, script_content, json_content, created_by, created_at, published, archived, max_attempts, theme)
                VALUES ({self._placeholders(11)})
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
                    self._json_param(worksheet.theme) if worksheet.theme is not None else None,
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

    def get_responded_pairs(self, worksheet_ids: list[str], student_ids: list[str]) -> set[tuple[str, str]]:
        """Single query that returns all (worksheet_id, student_id) pairs that have at least one response.
        Replaces N×M individual count_student_attempts calls in classroom detail."""
        if not worksheet_ids or not student_ids:
            return set()
        placeholder = self._placeholder
        w_placeholders = ", ".join([placeholder] * len(worksheet_ids))
        s_placeholders = ", ".join([placeholder] * len(student_ids))
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT DISTINCT worksheet_id, student_id
                FROM worksheet_responses
                WHERE worksheet_id IN ({w_placeholders})
                  AND student_id IN ({s_placeholders})
                """,
                (*worksheet_ids, *student_ids),
            ).fetchall()
        return {(dict(row)["worksheet_id"], dict(row)["student_id"]) for row in rows}

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

    def update_user(self, user_id: str, name: str, email: str | None, username: str) -> PublicUser | None:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(f"SELECT id FROM users WHERE id = {placeholder}", (user_id,)).fetchone()
            if not row:
                return None
            other = connection.execute(
                f"SELECT id FROM users WHERE LOWER(username) = LOWER({placeholder}) AND id <> {placeholder}",
                (username, user_id),
            ).fetchone()
            if other:
                raise ValueError("El usuario ya existe")
            connection.execute(
                f"UPDATE users SET name = {placeholder}, email = {placeholder}, username = {placeholder} WHERE id = {placeholder}",
                (name, email, username, user_id),
            )
            row = connection.execute(f"SELECT id, name, email, username, role FROM users WHERE id = {placeholder}", (user_id,)).fetchone()
        return self._user_from_row(row) if row else None

    def verify_user_password(self, user_id: str, password: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(f"SELECT password_hash FROM users WHERE id = {placeholder}", (user_id,)).fetchone()
        return bool(row and verify_password(password, dict(row)["password_hash"]))

    def create_classroom(self, name: str, created_by: str):
        from .models import Classroom
        classroom = Classroom(name=name, created_by=created_by)
        with get_connection() as connection:
            connection.execute(
                f"INSERT INTO classrooms (id, name, created_by, created_at) VALUES ({self._placeholders(4)})",
                (classroom.id, classroom.name, classroom.created_by, classroom.created_at.isoformat()),
            )
        return classroom

    def list_classrooms(self, created_by: str | None = None):
        from .models import Classroom
        placeholder = self._placeholder
        params = []
        where = ""
        if created_by:
            where = f"WHERE created_by = {placeholder}"
            params.append(created_by)
        with get_connection() as connection:
            rows = connection.execute(f"SELECT * FROM classrooms {where} ORDER BY name", params).fetchall()
        return [Classroom(id=dict(r)["id"], name=dict(r)["name"], created_by=dict(r)["created_by"], created_at=_parse_datetime(dict(r)["created_at"])) for r in rows]

    def get_classroom(self, classroom_id: str):
        from .models import Classroom
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(f"SELECT * FROM classrooms WHERE id = {placeholder}", (classroom_id,)).fetchone()
        if not row:
            return None
        data = dict(row)
        return Classroom(id=data["id"], name=data["name"], created_by=data["created_by"], created_at=_parse_datetime(data["created_at"]))

    def assign_student_to_classroom(self, classroom_id: str, student_id: str) -> None:
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(
                f"INSERT {'OR IGNORE' if get_database_backend() == 'sqlite' else ''} INTO classroom_students (classroom_id, student_id) VALUES ({self._placeholders(2)})" if get_database_backend() == 'sqlite' else f"INSERT INTO classroom_students (classroom_id, student_id) VALUES ({self._placeholders(2)}) ON CONFLICT DO NOTHING",
                (classroom_id, student_id),
            )

    def unassign_student_from_classroom(self, classroom_id: str, student_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            cursor = connection.execute(f"DELETE FROM classroom_students WHERE classroom_id = {placeholder} AND student_id = {placeholder}", (classroom_id, student_id))
            return bool(cursor.rowcount)

    def assign_worksheet_to_classroom(self, classroom_id: str, worksheet_id: str) -> None:
        with get_connection() as connection:
            connection.execute(
                f"INSERT {'OR IGNORE' if get_database_backend() == 'sqlite' else ''} INTO classroom_worksheets (classroom_id, worksheet_id) VALUES ({self._placeholders(2)})" if get_database_backend() == 'sqlite' else f"INSERT INTO classroom_worksheets (classroom_id, worksheet_id) VALUES ({self._placeholders(2)}) ON CONFLICT DO NOTHING",
                (classroom_id, worksheet_id),
            )

    def unassign_worksheet_from_classroom(self, classroom_id: str, worksheet_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            cursor = connection.execute(f"DELETE FROM classroom_worksheets WHERE classroom_id = {placeholder} AND worksheet_id = {placeholder}", (classroom_id, worksheet_id))
            return bool(cursor.rowcount)

    def list_classroom_students(self, classroom_id: str) -> list[PublicUser]:
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT users.id, users.name, users.email, users.username, users.role
                FROM users JOIN classroom_students ON classroom_students.student_id = users.id
                WHERE classroom_students.classroom_id = {placeholder}
                ORDER BY users.name
                """,
                (classroom_id,),
            ).fetchall()
        return [self._user_from_row(row) for row in rows]

    def list_classroom_worksheets(self, classroom_id: str) -> list[Worksheet]:
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT worksheets.* FROM worksheets
                JOIN classroom_worksheets ON classroom_worksheets.worksheet_id = worksheets.id
                WHERE classroom_worksheets.classroom_id = {placeholder}
                ORDER BY worksheets.created_at DESC
                """,
                (classroom_id,),
            ).fetchall()
        return [self._worksheet_from_row(row) for row in rows]

    def list_worksheet_classrooms(self, worksheet_id: str):
        from .models import Classroom
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT classrooms.* FROM classrooms
                JOIN classroom_worksheets ON classroom_worksheets.classroom_id = classrooms.id
                WHERE classroom_worksheets.worksheet_id = {placeholder}
                ORDER BY classrooms.name
                """,
                (worksheet_id,),
            ).fetchall()
        return [Classroom(id=dict(r)["id"], name=dict(r)["name"], created_by=dict(r)["created_by"], created_at=_parse_datetime(dict(r)["created_at"])) for r in rows]

    def list_student_assigned_worksheets(self, student_id: str) -> list[Worksheet]:
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT DISTINCT worksheets.* FROM worksheets
                JOIN classroom_worksheets ON classroom_worksheets.worksheet_id = worksheets.id
                JOIN classroom_students ON classroom_students.classroom_id = classroom_worksheets.classroom_id
                WHERE classroom_students.student_id = {placeholder}
                  AND worksheets.published = {placeholder}
                  AND worksheets.archived = {placeholder}
                ORDER BY worksheets.created_at DESC
                """,
                (student_id, self._bool_param(True), self._bool_param(False)),
            ).fetchall()
        return [self._worksheet_from_row(row) for row in rows]

    def delete_response(self, response_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            cursor = connection.execute(f"DELETE FROM worksheet_responses WHERE id = {placeholder}", (response_id,))
            return bool(cursor.rowcount)

    def teacher_dashboard(self, teacher_id: str | None = None) -> dict:
        worksheets = self.list_worksheets(created_by=teacher_id, published=True, archived=False)
        students = self.list_students()
        responses = self.list_responses()
        worksheet_ids = {worksheet.id for worksheet in worksheets}
        scoped_responses = [response for response in responses if response.worksheet_id in worksheet_ids]
        avg_scores = []
        for worksheet in worksheets:
            scores = [response.score for response in scoped_responses if response.worksheet_id == worksheet.id and response.score is not None]
            avg_scores.append({"worksheet_title": worksheet.title, "average_score": round(sum(scores) / len(scores), 2) if scores else 0.0})
        total_correct = sum(response.correct_count for response in scoped_responses)
        total_incorrect = sum(1 for response in scoped_responses for detail in response.details if getattr(detail, "status", None) == "incorrect" or (isinstance(detail, dict) and detail.get("status") == "incorrect"))
        classrooms = self.list_classrooms(created_by=teacher_id)
        students_per_classroom = [
            {"classroom_name": classroom.name, "student_count": len(self.list_classroom_students(classroom.id))}
            for classroom in classrooms
        ]
        return {
            "total_students": len(students),
            "active_worksheets": len(worksheets),
            "avg_scores": avg_scores,
            "total_correct": total_correct,
            "total_incorrect": total_incorrect,
            "students_per_classroom": students_per_classroom,
        }

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
            theme=_decode_json(data.get("theme"), None),
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
