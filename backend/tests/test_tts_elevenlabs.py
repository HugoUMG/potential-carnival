"""Voces de ElevenLabs con edge-tts de respaldo y caché en `tts_cache`.

Nada de aquí toca la red ni la base real: la elección de voz se prueba con un catálogo falso, la
síntesis con dobles y la caché sobre un SQLite temporal (como en test_teacher_images.py).
"""
import asyncio

import pytest

from backend.app import main
from backend.app.database import initialize_database
from backend.app.main import _eleven_speed, _eleven_voice_for, _synth_mp3
from backend.app.repository import repository

# Lo que devuelve `GET /v2/voices`, reducido a lo que se mira: nombre, id y etiquetas.
CATALOGO = [
    {"voice_id": "B" * 20, "name": "Brian", "labels": {"gender": "male", "accent": "american", "age": "middle-aged"}},
    {"voice_id": "L" * 20, "name": "Liam", "labels": {"gender": "male", "accent": "american", "age": "young", "use_case": "social_media"}},
    {"voice_id": "H" * 20, "name": "Harry - Fierce Warrior", "labels": {"gender": "male", "accent": "american", "age": "young", "use_case": "characters_animation"}},
    {"voice_id": "G" * 20, "name": "George", "labels": {"gender": "male", "accent": "british", "age": "middle_aged"}},
    {"voice_id": "A" * 20, "name": "Aria", "labels": {"gender": "female", "accent": "american", "age": "middle-aged", "use_case": "social_media"}},
    {"voice_id": "M" * 20, "name": "Matilda", "labels": {"gender": "female", "accent": "american", "age": "middle-aged", "use_case": "informative_educational"}},
    {"voice_id": "J" * 20, "name": "Jessica", "labels": {"gender": "female", "accent": "american", "age": "young"}},
    {"voice_id": "X" * 20, "name": "Alice", "labels": {"gender": "female", "accent": "british", "age": "middle-aged"}},
    {"voice_id": "S" * 20, "name": "Sin etiquetas"},
]


def test_la_velocidad_del_dsl_se_traduce_al_rango_de_elevenlabs():
    assert _eleven_speed("-15%") == 0.85
    assert _eleven_speed("+0%") == 1.0
    assert _eleven_speed("-35%") == 0.7  # «Muy lento» se queda en el mínimo que admite ElevenLabs
    assert _eleven_speed("slow") == 0.85  # basura del query string → el default (-15%)


def test_la_voz_de_elevenlabs_se_elige_por_genero_acento_y_edad(monkeypatch):
    monkeypatch.setattr(main, "_eleven_voices", CATALOGO)

    def pick(edge_name: str) -> str:
        return asyncio.run(_eleven_voice_for(edge_name))

    assert pick("en-US-AndrewNeural") == "B" * 20  # ♂ EE. UU. adulto
    assert pick("en-US-AriaNeural") == "M" * 20  # ♀ EE. UU. adulta: la educativa gana a la de redes sociales
    assert pick("en-GB-RyanNeural") == "G" * 20  # ♂ británico
    assert pick("en-GB-SoniaNeural") == "X" * 20  # ♀ británica
    assert pick("en-US-AnaNeural") == "J" * 20  # niña → la joven
    assert pick("en-US-RogerNeural") == "L" * 20  # niño → el joven, y NUNCA el personaje de dibujos
    # Sin voz de ese acento (Australia) manda el género: nunca una voz del otro género.
    assert pick("en-AU-NatashaNeural") in {"A" * 20, "J" * 20, "X" * 20, "M" * 20}


def test_elevenlabs_voices_fija_una_voz_por_nombre_o_id(monkeypatch):
    monkeypatch.setattr(main, "_eleven_voices", CATALOGO)
    monkeypatch.setenv("ELEVENLABS_VOICES", "en-US-AndrewNeural=Harry, en-US-AriaNeural=" + "A" * 20 + ",en-GB-RyanNeural=Nadie")
    assert asyncio.run(_eleven_voice_for("en-US-AndrewNeural")) == "H" * 20  # por nombre (lo de antes del " - ")
    assert asyncio.run(_eleven_voice_for("en-US-AriaNeural")) == "A" * 20  # por voice_id
    assert asyncio.run(_eleven_voice_for("en-GB-RyanNeural")) == "G" * 20  # no existe → etiquetas
    assert asyncio.run(_eleven_voice_for("en-GB-SoniaNeural")) == "X" * 20  # no fijada → etiquetas


def test_sin_clave_no_se_llama_a_elevenlabs(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)

    async def edge(text: str, voice: str, rate: str) -> bytes:
        return f"edge:{voice}".encode()

    async def eleven(text: str, voice: str, rate: str) -> bytes:
        raise AssertionError("sin clave no debía llamarse a ElevenLabs")

    monkeypatch.setattr(main, "_edge_synth", edge)
    monkeypatch.setattr(main, "_eleven_synth", eleven)
    assert asyncio.run(_synth_mp3([("Hi", "en-US-AndrewNeural")], "-15%")) == b"edge:en-US-AndrewNeural"


def test_si_elevenlabs_falla_la_pista_entera_se_rehace_con_edge(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    pedidos: list[str] = []

    async def eleven(text: str, voice: str, rate: str) -> bytes:
        pedidos.append(text)
        if text == "two":
            raise RuntimeError("quota_exceeded")
        return b"11:" + text.encode()

    async def edge(text: str, voice: str, rate: str) -> bytes:
        return b"edge:" + text.encode()

    monkeypatch.setattr(main, "_eleven_synth", eleven)
    monkeypatch.setattr(main, "_edge_synth", edge)
    mp3 = asyncio.run(_synth_mp3([("one", "en-US-AndrewNeural"), ("two", "en-US-AriaNeural")], "-15%"))
    # Nada de mezclar motores en una pista (44,1 kHz + 24 kHz se traba en el navegador): toda edge.
    assert mp3 == b"edge:oneedge:two"
    assert pedidos == ["one", "two"]


def test_una_voz_inexistente_sigue_siendo_error_aunque_haya_clave(monkeypatch):
    # La validación va ANTES de ElevenLabs: el 400 con mensaje claro no se pierde en el fallback.
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    with pytest.raises(ValueError, match="no existe en el servicio de edge-tts"):
        asyncio.run(_synth_mp3([("Hi", "en-GB-OliverNeural")], "-15%"))


def test_un_voice_id_de_elevenlabs_en_el_dsl_pasa_y_en_edge_cae_a_andrew(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    voces: list[str] = []

    class FakeCommunicate:
        def __init__(self, text: str, voice: str, **kwargs: object) -> None:
            voces.append(voice)

        async def stream(self):
            yield {"type": "audio", "data": b"mp3"}

    monkeypatch.setattr("edge_tts.Communicate", FakeCommunicate)
    # Un id de 20 caracteres no es una voz de edge: no se rechaza (ElevenLabs sí lo entiende) y
    # cuando toca edge suena la voz por defecto en vez de un 400.
    assert asyncio.run(_synth_mp3([("Hi", "pNInz6obpgDQGcFmaJgB")], "-15%")) == b"mp3"
    assert voces == ["en-US-AndrewNeural"]


class FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        pass


class FakeClient:
    """`httpx.AsyncClient` de mentira: apunta las peticiones y devuelve un mp3 fijo."""

    calls: list[tuple[str, dict]] = []

    def __init__(self, **kwargs: object) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    async def post(self, url: str, **kwargs: dict) -> FakeResponse:
        FakeClient.calls.append((url, kwargs))
        return FakeResponse(b"mp3!")


def test_un_mp3_nuevo_se_pide_una_vez_y_se_guarda(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    monkeypatch.setattr(main, "_eleven_voices", CATALOGO)
    store: dict[str, bytes] = {}
    monkeypatch.setattr(repository, "get_tts_audio", store.get)
    monkeypatch.setattr(repository, "put_tts_audio", store.__setitem__)
    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    FakeClient.calls.clear()

    assert asyncio.run(main._eleven_synth("Hello", "en-GB-SoniaNeural", "-35%")) == b"mp3!"
    ((url, kwargs),) = FakeClient.calls
    assert url.endswith("/text-to-speech/" + "X" * 20)  # la ♀ británica del catálogo
    assert kwargs["headers"] == {"xi-api-key": "k"}
    assert kwargs["json"]["voice_settings"]["speed"] == 0.7
    assert list(store.values()) == [b"mp3!"]

    # La segunda vez sale de la caché: ni una petición más (ni un crédito más).
    assert asyncio.run(main._eleven_synth("Hello", "en-GB-SoniaNeural", "-35%")) == b"mp3!"
    assert len(FakeClient.calls) == 1


def test_seis_alumnos_a_la_vez_pagan_un_solo_mp3(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
    monkeypatch.setattr(main, "_eleven_voices", CATALOGO)
    store: dict[str, bytes] = {}
    monkeypatch.setattr(repository, "get_tts_audio", store.get)
    monkeypatch.setattr(repository, "put_tts_audio", store.__setitem__)

    class SlowClient(FakeClient):
        async def post(self, url: str, **kwargs: dict) -> FakeResponse:
            await asyncio.sleep(0.01)  # da tiempo a que los otros cinco lleguen y se pongan a esperar
            return await super().post(url, **kwargs)

    monkeypatch.setattr(main.httpx, "AsyncClient", SlowClient)
    FakeClient.calls.clear()

    async def avalancha() -> list[bytes]:
        return await asyncio.gather(*[main._eleven_synth("Same text", "en-US-AndrewNeural", "-15%") for _ in range(6)])

    assert asyncio.run(avalancha()) == [b"mp3!"] * 6
    assert len(FakeClient.calls) == 1  # con Semaphore(2) eran dos: el mismo texto pagado dos veces


@pytest.fixture
def db(tmp_path, monkeypatch):
    # Mismo motivo que en test_teacher_images.py: sin esto el test correría contra la base de
    # PRODUCCIÓN si el .env local apunta a Aiven.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SEED_DEMO_USERS", "false")
    monkeypatch.setenv("WORKSHEET_DATABASE_PATH", str(tmp_path / "test.db"))
    initialize_database()


def test_la_cache_guarda_el_mp3_una_sola_vez(db):
    assert repository.get_tts_audio("k1") is None
    repository.put_tts_audio("k1", b"\xff\xfb mp3")
    repository.put_tts_audio("k1", b"otro")  # el segundo en llegar no pisa ni falla
    assert repository.get_tts_audio("k1") == b"\xff\xfb mp3"
