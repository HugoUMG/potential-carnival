"""El schema de Postgres se ejecuta partido por `;` (`database.py`, `_initialize_postgres`).

Un `;` dentro de un comentario parte la sentencia en dos y el arranque en Render muere con
`syntax error at or near …` (pasó con un comentario de `game_sets`). SQLite usa `executescript`,
que sí entiende comentarios: por eso el resto de los tests no lo ve. Este es el aviso.
"""
from backend.app.database import POSTGRES_SCHEMA_PATH


def test_ningun_comentario_del_schema_postgres_lleva_punto_y_coma():
    culpables = [
        f"{n}: {line.strip()}"
        for n, line in enumerate(POSTGRES_SCHEMA_PATH.read_text(encoding="utf-8").splitlines(), start=1)
        if "--" in line and ";" in line.split("--", 1)[1]
    ]
    assert culpables == []


def test_cada_trozo_del_split_empieza_con_sql_y_no_con_texto_de_un_comentario():
    for statement in POSTGRES_SCHEMA_PATH.read_text(encoding="utf-8").split(";"):
        code = [line for line in statement.strip().splitlines() if line.strip() and not line.strip().startswith("--")]
        if code:
            assert code[0].split()[0].upper() in {"CREATE", "ALTER", "UPDATE", "INSERT", "DROP", "DO", "DELETE", "WITH", "COMMENT"}, code[0]
