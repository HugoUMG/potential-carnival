from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

from .database import get_connection, get_database_backend
from .models import ActivityLock, Group, GroupDetail, PublicUser, StudentActivity, StudentCreate, TeacherCreate, UserRole, UserSession, Worksheet, WorksheetResponse
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
                INSERT INTO worksheet_responses (id, worksheet_id, student_id, student_name, answers_json, details_json, score, correct_count, pending_count, submitted_at, group_id)
                VALUES ({self._placeholders(11)})
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
                    response.group_id,
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

    def count_attempts_per_worksheet(self, student_id: str, worksheet_ids: list[str]) -> dict[str, int]:
        """Devuelve {worksheet_id: attempts_count} en una sola query para un estudiante."""
        if not worksheet_ids:
            return {}
        placeholder = self._placeholder
        w_placeholders = ", ".join([placeholder] * len(worksheet_ids))
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT worksheet_id, COUNT(*) AS cnt
                FROM worksheet_responses
                WHERE student_id = {placeholder} AND worksheet_id IN ({w_placeholders})
                GROUP BY worksheet_id
                """,
                (student_id, *worksheet_ids),
            ).fetchall()
        return {dict(r)["worksheet_id"]: int(dict(r)["cnt"]) for r in rows}

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

    def list_student_classrooms(self, student_id: str):
        from .models import Classroom
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT classrooms.* FROM classrooms
                JOIN classroom_students ON classroom_students.classroom_id = classrooms.id
                WHERE classroom_students.student_id = {placeholder}
                ORDER BY classrooms.name
                """,
                (student_id,),
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
            group_id=data.get("group_id"),
        )

    # ── Sesiones de usuario ──────────────────────────────────────────────────

    def create_session(self, user_id: str) -> str:
        """Cierra sesiones activas anteriores e inserta una nueva al hacer login."""
        session_id = str(uuid4())
        placeholder = self._placeholder
        with get_connection() as connection:
            # Cerrar todas las sesiones activas previas del mismo usuario
            connection.execute(
                f"UPDATE user_sessions SET logged_out_at = CURRENT_TIMESTAMP WHERE user_id = {placeholder} AND logged_out_at IS NULL",
                (user_id,),
            )
            connection.execute(
                f"INSERT INTO user_sessions (id, user_id) VALUES ({placeholder}, {placeholder})",
                (session_id, user_id),
            )
        return session_id

    def close_active_session(self, user_id: str) -> None:
        """Cierra la sesión activa más reciente del usuario (logout explícito)."""
        placeholder = self._placeholder
        with get_connection() as connection:
            connection.execute(
                f"""
                UPDATE user_sessions SET logged_out_at = CURRENT_TIMESTAMP
                WHERE id = (
                    SELECT id FROM user_sessions
                    WHERE user_id = {placeholder} AND logged_out_at IS NULL
                    ORDER BY logged_in_at DESC LIMIT 1
                )
                """,
                (user_id,),
            )

    def list_student_sessions(self, student_id: str) -> list[UserSession]:
        """Devuelve todas las sesiones de un estudiante, más recientes primero."""
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT id, user_id, logged_in_at, logged_out_at
                FROM user_sessions
                WHERE user_id = {placeholder}
                ORDER BY logged_in_at DESC
                """,
                (student_id,),
            ).fetchall()
        return [
            UserSession(
                id=dict(r)["id"],
                user_id=dict(r)["user_id"],
                logged_in_at=_parse_datetime(dict(r)["logged_in_at"]),
                logged_out_at=_parse_datetime(dict(r)["logged_out_at"]) if dict(r)["logged_out_at"] else None,
            )
            for r in rows
        ]

    def get_students_activity(self, expire_minutes: int) -> list[StudentActivity]:
        """
        Devuelve un resumen de actividad para todos los estudiantes.
        is_online = tiene sesión sin logout Y logged_in_at dentro del ventana del token.
        """
        from datetime import timezone
        placeholder = self._placeholder

        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT
                    u.id        AS user_id,
                    u.name      AS student_name,
                    u.username  AS username,
                    MAX(s.logged_in_at)   AS last_login,
                    COUNT(s.id)           AS total_sessions,
                    (
                        SELECT s2.logged_out_at
                        FROM user_sessions s2
                        WHERE s2.user_id = u.id
                        ORDER BY s2.logged_in_at DESC LIMIT 1
                    ) AS latest_logout,
                    (
                        SELECT s3.logged_in_at
                        FROM user_sessions s3
                        WHERE s3.user_id = u.id
                        ORDER BY s3.logged_in_at DESC LIMIT 1
                    ) AS latest_login
                FROM users u
                LEFT JOIN user_sessions s ON s.user_id = u.id
                WHERE u.role = {placeholder}
                GROUP BY u.id, u.name, u.username
                ORDER BY u.name
                """,
                ("student",),
            ).fetchall()

        now = datetime.now(timezone.utc)
        result: list[StudentActivity] = []
        for r in rows:
            data = dict(r)
            last_login = _parse_datetime(data["last_login"]) if data["last_login"] else None
            latest_login = _parse_datetime(data["latest_login"]) if data["latest_login"] else None
            latest_logout = data["latest_logout"]
            is_online = (
                latest_logout is None
                and latest_login is not None
                and (now - latest_login).total_seconds() < expire_minutes * 60
            )
            result.append(
                StudentActivity(
                    student_id=data["user_id"],
                    student_name=data["student_name"],
                    username=data["username"],
                    last_login=last_login,
                    is_online=is_online,
                    total_sessions=int(data["total_sessions"] or 0),
                )
            )
        return result


    # ── Grupos colaborativos ──────────────────────────────────────────────────

    def create_group(self, name: str, classroom_id: str, created_by: str) -> Group:
        group = Group(name=name, classroom_id=classroom_id, created_by=created_by)
        with get_connection() as connection:
            connection.execute(
                f"INSERT INTO groups (id, classroom_id, name, created_by, created_at) VALUES ({self._placeholders(5)})",
                (group.id, group.classroom_id, group.name, group.created_by, group.created_at.isoformat()),
            )
        return group

    def get_group(self, group_id: str) -> Group | None:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(f"SELECT * FROM groups WHERE id = {placeholder}", (group_id,)).fetchone()
        return self._group_from_row(row) if row else None

    def list_classroom_groups(self, classroom_id: str) -> list[GroupDetail]:
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"SELECT * FROM groups WHERE classroom_id = {placeholder} ORDER BY name",
                (classroom_id,),
            ).fetchall()
        result = []
        for row in rows:
            group = self._group_from_row(row)
            students = self.list_group_students(group.id)
            worksheet_ids = self._list_group_worksheet_ids(group.id)
            result.append(GroupDetail(**group.model_dump(), students=students, worksheet_ids=worksheet_ids))
        return result

    def delete_group(self, group_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            cursor = connection.execute(f"DELETE FROM groups WHERE id = {placeholder}", (group_id,))
            return bool(cursor.rowcount)

    def add_student_to_group(self, group_id: str, student_id: str) -> None:
        with get_connection() as connection:
            connection.execute(
                f"INSERT {'OR IGNORE' if get_database_backend() == 'sqlite' else ''} INTO group_students (group_id, student_id) VALUES ({self._placeholders(2)})"
                if get_database_backend() == "sqlite"
                else f"INSERT INTO group_students (group_id, student_id) VALUES ({self._placeholders(2)}) ON CONFLICT DO NOTHING",
                (group_id, student_id),
            )

    def remove_student_from_group(self, group_id: str, student_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            cursor = connection.execute(
                f"DELETE FROM group_students WHERE group_id = {placeholder} AND student_id = {placeholder}",
                (group_id, student_id),
            )
            return bool(cursor.rowcount)

    def assign_worksheet_to_group(self, group_id: str, worksheet_id: str) -> None:
        with get_connection() as connection:
            connection.execute(
                f"INSERT {'OR IGNORE' if get_database_backend() == 'sqlite' else ''} INTO group_worksheets (group_id, worksheet_id) VALUES ({self._placeholders(2)})"
                if get_database_backend() == "sqlite"
                else f"INSERT INTO group_worksheets (group_id, worksheet_id) VALUES ({self._placeholders(2)}) ON CONFLICT DO NOTHING",
                (group_id, worksheet_id),
            )

    def unassign_worksheet_from_group(self, group_id: str, worksheet_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            cursor = connection.execute(
                f"DELETE FROM group_worksheets WHERE group_id = {placeholder} AND worksheet_id = {placeholder}",
                (group_id, worksheet_id),
            )
            return bool(cursor.rowcount)

    def list_group_students(self, group_id: str) -> list[PublicUser]:
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT users.id, users.name, users.email, users.username, users.role
                FROM users JOIN group_students ON group_students.student_id = users.id
                WHERE group_students.group_id = {placeholder}
                ORDER BY users.name
                """,
                (group_id,),
            ).fetchall()
        return [self._user_from_row(row) for row in rows]

    def _list_group_worksheet_ids(self, group_id: str) -> list[str]:
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"SELECT worksheet_id FROM group_worksheets WHERE group_id = {placeholder}",
                (group_id,),
            ).fetchall()
        return [dict(r)["worksheet_id"] for r in rows]

    def is_student_in_group(self, group_id: str, student_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(
                f"SELECT 1 FROM group_students WHERE group_id = {placeholder} AND student_id = {placeholder}",
                (group_id, student_id),
            ).fetchone()
        return row is not None

    def is_student_in_classroom(self, classroom_id: str, student_id: str) -> bool:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(
                f"SELECT 1 FROM classroom_students WHERE classroom_id = {placeholder} AND student_id = {placeholder}",
                (classroom_id, student_id),
            ).fetchone()
        return row is not None

    def list_student_group_worksheets(self, student_id: str) -> list[tuple[Worksheet, Group]]:
        """Devuelve las hojas de trabajo asignadas a grupos donde el estudiante es miembro."""
        placeholder = self._placeholder
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT worksheets.*, groups.id AS grp_id, groups.name AS grp_name
                FROM worksheets
                JOIN group_worksheets ON group_worksheets.worksheet_id = worksheets.id
                JOIN groups ON groups.id = group_worksheets.group_id
                JOIN group_students ON group_students.group_id = groups.id
                WHERE group_students.student_id = {placeholder}
                  AND worksheets.published = {placeholder}
                  AND worksheets.archived = {placeholder}
                ORDER BY worksheets.created_at DESC
                """,
                (student_id, self._bool_param(True), self._bool_param(False)),
            ).fetchall()
        result = []
        seen = set()
        for row in rows:
            data = dict(row)
            key = (data["id"], data["grp_id"])
            if key in seen:
                continue
            seen.add(key)
            worksheet = self._worksheet_from_row(row)
            worksheet.group_id = data["grp_id"]
            worksheet.group_name = data["grp_name"]
            group = Group(
                id=data["grp_id"],
                name=data["grp_name"],
                classroom_id="",  # no needed here
                created_by="",
            )
            result.append((worksheet, group))
        return result

    def count_group_attempts(self, worksheet_id: str, group_id: str) -> int:
        placeholder = self._placeholder
        with get_connection() as connection:
            row = connection.execute(
                f"SELECT COUNT(*) AS total FROM worksheet_responses WHERE worksheet_id = {placeholder} AND group_id = {placeholder}",
                (worksheet_id, group_id),
            ).fetchone()
        return int(dict(row)["total"] if row else 0)

    # ── Locks de actividad ────────────────────────────────────────────────────

    LOCK_TTL_SECONDS = 60

    def acquire_lock(self, worksheet_id: str, group_id: str, activity_index: int, locked_by: str, locked_by_name: str) -> ActivityLock | None:
        """
        Intenta tomar el lock de una actividad.
        - Si está libre o expirado (TTL), toma el lock → devuelve ActivityLock.
        - Si está tomado por OTRO y vigente → devuelve None.
        - Si está tomado por EL MISMO usuario → renueva y devuelve ActivityLock.
        """
        from datetime import timezone
        placeholder = self._placeholder
        now = datetime.now(timezone.utc)
        lock_id = str(uuid4())

        with get_connection() as connection:
            row = connection.execute(
                f"""
                SELECT * FROM activity_locks
                WHERE worksheet_id = {placeholder} AND group_id = {placeholder} AND activity_index = {placeholder}
                """,
                (worksheet_id, group_id, activity_index),
            ).fetchone()

            if row:
                data = dict(row)
                locked_at = _parse_datetime(data["locked_at"])
                age = (now - locked_at).total_seconds()
                if age < self.LOCK_TTL_SECONDS and data["locked_by"] != locked_by:
                    # Lock vigente de otro usuario
                    return None
                # Actualizar lock (propio o expirado)
                connection.execute(
                    f"""
                    UPDATE activity_locks
                    SET locked_by = {placeholder}, locked_by_name = {placeholder}, locked_at = {placeholder}, id = {placeholder}
                    WHERE worksheet_id = {placeholder} AND group_id = {placeholder} AND activity_index = {placeholder}
                    """,
                    (locked_by, locked_by_name, now.isoformat(), lock_id, worksheet_id, group_id, activity_index),
                )
            else:
                connection.execute(
                    f"""
                    INSERT INTO activity_locks (id, worksheet_id, group_id, activity_index, locked_by, locked_by_name, locked_at)
                    VALUES ({self._placeholders(7)})
                    """,
                    (lock_id, worksheet_id, group_id, activity_index, locked_by, locked_by_name, now.isoformat()),
                )

        return ActivityLock(
            id=lock_id,
            worksheet_id=worksheet_id,
            group_id=group_id,
            activity_index=activity_index,
            locked_by=locked_by,
            locked_by_name=locked_by_name,
            locked_at=now,
        )

    def renew_lock(self, worksheet_id: str, group_id: str, activity_index: int, locked_by: str) -> bool:
        """Renueva el locked_at del lock propio."""
        from datetime import timezone
        placeholder = self._placeholder
        now = datetime.now(timezone.utc)
        with get_connection() as connection:
            cursor = connection.execute(
                f"""
                UPDATE activity_locks SET locked_at = {placeholder}
                WHERE worksheet_id = {placeholder} AND group_id = {placeholder}
                  AND activity_index = {placeholder} AND locked_by = {placeholder}
                """,
                (now.isoformat(), worksheet_id, group_id, activity_index, locked_by),
            )
            return bool(cursor.rowcount)

    def release_lock(self, worksheet_id: str, group_id: str, activity_index: int, locked_by: str) -> bool:
        """Libera el lock del estudiante actual."""
        placeholder = self._placeholder
        with get_connection() as connection:
            cursor = connection.execute(
                f"""
                DELETE FROM activity_locks
                WHERE worksheet_id = {placeholder} AND group_id = {placeholder}
                  AND activity_index = {placeholder} AND locked_by = {placeholder}
                """,
                (worksheet_id, group_id, activity_index, locked_by),
            )
            return bool(cursor.rowcount)

    def list_active_locks(self, worksheet_id: str, group_id: str) -> list[ActivityLock]:
        """Devuelve los locks vigentes (no expirados) del grupo+hoja."""
        from datetime import timezone
        placeholder = self._placeholder
        now = datetime.now(timezone.utc)
        with get_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT * FROM activity_locks
                WHERE worksheet_id = {placeholder} AND group_id = {placeholder}
                ORDER BY activity_index
                """,
                (worksheet_id, group_id),
            ).fetchall()
        result = []
        for row in rows:
            data = dict(row)
            locked_at = _parse_datetime(data["locked_at"])
            if (now - locked_at).total_seconds() < self.LOCK_TTL_SECONDS:
                result.append(ActivityLock(
                    id=data["id"],
                    worksheet_id=data["worksheet_id"],
                    group_id=data["group_id"],
                    activity_index=int(data["activity_index"]),
                    locked_by=data["locked_by"],
                    locked_by_name=data["locked_by_name"],
                    locked_at=locked_at,
                ))
        return result

    def _group_from_row(self, row: object) -> Group:
        data = dict(row)
        return Group(
            id=data["id"],
            classroom_id=data["classroom_id"],
            name=data["name"],
            created_by=data["created_by"],
            created_at=_parse_datetime(data["created_at"]),
        )


repository = WorksheetRepository()
