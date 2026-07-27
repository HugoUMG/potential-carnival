"""Asigna dueño a los alumnos anteriores a la columna `users.created_by`.

POR QUÉ HACE FALTA
------------------
`GET /students` muestra a un profesor sus alumnos (`created_by = él`) **y también** los que
tienen `created_by IS NULL`, que son los creados antes de que existiera la columna. Esa regla
existía para que ningún profesor perdiera de vista a sus alumnos al desplegar el cambio.

Con el registro abierto por Google, esa regla se vuelve un agujero: cualquiera que se registre
ve —y puede editar o borrar— a todos los alumnos heredados. Este script cierra el hueco
asignándolos a su profesor real.

USO
---
    python scripts/backfill_student_owner.py                      # solo informa (dry-run)
    python scripts/backfill_student_owner.py --owner <id_o_usuario>          # previsualiza
    python scripts/backfill_student_owner.py --owner <id_o_usuario> --apply  # escribe

Sin --apply no toca nada. Solo actualiza filas con created_by IS NULL: los alumnos que ya
tienen dueño no se tocan nunca.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.database import get_connection, get_database_backend  # noqa: E402

PH = "%s" if get_database_backend() == "postgresql" else "?"


def _rows(conn, sql, params=()):
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Asigna dueño a los alumnos heredados.")
    parser.add_argument("--owner", help="id o username del profesor/admin que será su dueño")
    parser.add_argument("--apply", action="store_true", help="escribe los cambios (por defecto solo informa)")
    args = parser.parse_args()

    with get_connection() as conn:
        try:
            huerfanos = _rows(conn, "SELECT id, name, username FROM users WHERE role = 'student' AND created_by IS NULL ORDER BY name")
        except Exception:
            # La columna la crea la migración de arranque del backend. Contra una BD donde
            # aún no se ha desplegado ese código, el traceback de psycopg no dice qué hacer.
            print("Esta BD todavía no tiene la columna users.created_by.")
            print("La crea el backend al arrancar: despliega primero y vuelve a ejecutar.")
            return 1
        docentes = _rows(conn, "SELECT id, name, username, role FROM users WHERE role IN ('teacher', 'admin') ORDER BY role, name")

        print(f"Alumnos sin dueño: {len(huerfanos)}")
        for s in huerfanos:
            print(f"   · {s['name']}  (@{s['username']})")
        if not huerfanos:
            print("\nNada que hacer: todos los alumnos ya tienen dueño.")
            return 0

        if not args.owner:
            print("\nProfesores y administradores disponibles como dueño:")
            for d in docentes:
                print(f"   {d['role']:<8} @{d['username']:<16} {d['name']:<24} id={d['id']}")
            print("\nVuelve a ejecutar con --owner <id o @usuario> para previsualizar.")
            return 0

        clave = args.owner.lstrip("@")
        dueno = next((d for d in docentes if d["id"] == clave or d["username"] == clave), None)
        if not dueno:
            print(f"\nNo encontré ningún profesor/admin con id o usuario '{args.owner}'.")
            return 1

        print(f"\nDueño elegido: {dueno['name']} (@{dueno['username']}, {dueno['role']})")
        if not args.apply:
            print(f"DRY-RUN: se asignarían {len(huerfanos)} alumnos. Añade --apply para escribir.")
            return 0

        conn.execute(
            f"UPDATE users SET created_by = {PH} WHERE role = 'student' AND created_by IS NULL",
            (dueno["id"],),
        )
        restantes = _rows(conn, "SELECT id FROM users WHERE role = 'student' AND created_by IS NULL")
        print(f"Listo: {len(huerfanos)} alumnos asignados. Quedan sin dueño: {len(restantes)}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
