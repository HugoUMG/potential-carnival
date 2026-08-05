"""La IA a veces escribe la respuesta entre paréntesis en el texto que lee el alumno.
El prompt lo prohíbe, pero el filtro es la parte que no depende del modelo.

No toca la base de datos ni llama a ninguna IA (regla 34).
"""
from backend.app.ai import _clean_script


def test_borra_la_respuesta_filtrada():
    script = _clean_script(
        'worksheet {\n'
        '  fillblank {\n'
        '    question: "She _____ to school yesterday. (answer: went)"\n'
        '    answer: "went"\n'
        '  }\n'
        '}'
    )
    assert 'question: "She _____ to school yesterday."' in script
    assert 'answer: "went"' in script  # la respuesta real sigue ahí


def test_respeta_la_pista_gramatical():
    script = _clean_script(
        'worksheet {\n'
        '  fillblank {\n'
        '    question: "She _____ (go) to school."\n'
        '    answer: "went"\n'
        '  }\n'
        '}'
    )
    assert "(go)" in script


def test_borra_variantes_en_espanol_y_opciones():
    script = _clean_script(
        'worksheet {\n'
        '  multiplechoice {\n'
        '    question: "¿Cuál es correcta? (respuesta: B)"\n'
        '    instructions: "Marca una (correcto: la segunda)"\n'
        '  }\n'
        '}'
    )
    assert "respuesta:" not in script
    assert "correcto:" not in script
