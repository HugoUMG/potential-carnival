from backend.app.ai import _AI_RESCUABLE, _grade_system


def test_tolerance_picks_the_right_rule_block() -> None:
    assert "STRICT" in _grade_system(0)
    assert "STRICT" in _grade_system(33)
    assert "BALANCED" in _grade_system(34)
    assert "BALANCED" in _grade_system(66)
    assert "PERMISSIVE" in _grade_system(67)
    assert "PERMISSIVE" in _grade_system(100)


def test_tolerance_is_clamped_and_interpolated() -> None:
    assert "(0/100)" in _grade_system(-40)
    assert "(100/100)" in _grade_system(999)
    # El placeholder de las reglas siempre se sustituye: si quedara, el modelo lo leería literal.
    for value in (0, 50, 100):
        assert "{tolerance_rules}" not in _grade_system(value)
        assert "{value}" not in _grade_system(value)


def test_pronoun_shift_in_listening_answers_is_explicitly_allowed() -> None:
    # Regresión: la IA marcó "She will go back and get it" como incorrecta porque el audio
    # decía "I will go back and get it", exigiendo que se copiara el pronombre literal en vez
    # de adaptarlo al sujeto que pide la pregunta.
    assert "PRONOUNS" in _grade_system(50)


def test_matching_can_be_rescued_by_the_ai() -> None:
    # Regresión: matching de pronombre + frase verbal donde las 4 combinaciones del alumno eran
    # inglés correcto, pero la clave (mismo índice) las marcó todas mal y la IA no podía tocarlas.
    assert "matching" in _AI_RESCUABLE
    prompt = _grade_system(50)
    assert '"matching": each item is ONE pair' in prompt
    # …y ya no se lista entre los tipos de clic que la IA tiene prohibido rescatar.
    assert "truefalse, matching" not in prompt
