from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.database import get_database_path, initialize_database


if __name__ == "__main__":
    initialize_database()
    print(f"Base de datos lista en: {get_database_path()}")
