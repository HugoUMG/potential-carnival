from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.database import get_database_backend, get_database_path, get_database_url, initialize_database


if __name__ == "__main__":
    initialize_database()
    if get_database_backend() == "postgresql":
        print(f"Base de datos PostgreSQL lista en: {get_database_url()}")
    else:
        print(f"Base de datos SQLite lista en: {get_database_path()}")
