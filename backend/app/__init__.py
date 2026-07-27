"""Paquete de la app.

El .env se carga AQUÍ, no en main.py: `__init__` corre antes que cualquier submódulo, y
hay constantes que se leen del entorno al importar (p. ej. el modelo de Gemini en ai.py).
Si se cargara más tarde, esas ya habrían tomado su valor por defecto.
"""

from .settings import _load_dotenv

_load_dotenv()
