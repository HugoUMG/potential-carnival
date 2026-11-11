import pytest


@pytest.fixture(autouse=True)
def _sin_mp3_en_memoria():
    """La memoria de mp3 de edge (`_edge_memory`) vive en el proceso: sin vaciarla, un test oiría
    el audio que sintetizó otro."""
    from backend.app import main
    main._edge_memory.clear()
    yield
