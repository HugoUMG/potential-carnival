from backend.app.ai import _grade_system


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
