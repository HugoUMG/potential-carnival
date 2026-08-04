"""Actividades con imagen: `imagechoice` e `imagematching` (ADR-20).

Lo que hay que proteger es la decisión del REVIEW: **la imagen es un campo paralelo, nunca el valor
de la clave**. Si alguien mueve la URL a `options` o a `left`, la calificación sigue funcionando pero
la pantalla de revisión del profesor empieza a mostrar URLs — y esta prueba lo caza.

No toca la base de datos: construye modelos en memoria (regla 34).
"""
from backend.app.main import _build_answer_details
from backend.app.models import Worksheet, WorksheetJson
from backend.app.parser import parse_worksheet_script

SCRIPT = '''worksheet {
  title: "Pictures"

  imagechoice {
    image: "https://example.test/park.png"
    question: "Which one is the apple?"
    options:
    - apple
    - banana
    option_images:
    - https://example.test/apple.png
    - https://example.test/banana.png
    answer: "apple"
  }

  imagematching {
    left_images:
    - https://example.test/dog.png
    - https://example.test/cat.png
    right:
    - dog
    - cat
  }
}'''


def _hoja(script: str = SCRIPT) -> Worksheet:
    data = parse_worksheet_script(script).to_dict()
    return Worksheet(
        title=data["title"], description=data["description"], script_content=script,
        json_content=WorksheetJson(**data), created_by="prof", published=True,
    )


def test_imagechoice_guarda_la_clave_como_texto_y_las_imagenes_en_paralelo():
    eleccion = _hoja().json_content.iter_activities()[0]
    assert eleccion.answer == "apple"
    assert eleccion.options == ["apple", "banana"]
    assert eleccion.option_images == ["https://example.test/apple.png", "https://example.test/banana.png"]
    assert eleccion.image == "https://example.test/park.png"  # imagen de enunciado, aparte


def test_imagematching_numera_el_lado_izquierdo_si_no_se_escribe():
    # Sin `left:` el profesor no escribe cada palabra dos veces y la clave se lee "Image 1 → dog"
    # en vez de una URL de 90 caracteres.
    pares = _hoja().json_content.iter_activities()[1]
    assert pares.left == ["Image 1", "Image 2"]
    assert pares.left_images == ["https://example.test/dog.png", "https://example.test/cat.png"]
    assert pares.right == ["dog", "cat"]


def test_imagechoice_se_califica_como_un_multiplechoice():
    hoja = _hoja()
    eleccion = hoja.json_content.iter_activities()[0]
    bien = _build_answer_details(hoja, {eleccion.id: "apple"})[0]
    mal = _build_answer_details(hoja, {eleccion.id: "banana"})[0]
    assert (bien.status, mal.status) == ("correct", "incorrect")
    # El enunciado de la revisión es la pregunta, no una URL.
    assert bien.prompt == "Which one is the apple?"


def test_imagematching_se_califica_como_un_matching_par_a_par():
    hoja = _hoja()
    pares = hoja.json_content.iter_activities()[1]
    detalles = _build_answer_details(hoja, {pares.id: {"Image 1": "dog", "Image 2": "dog"}})
    fila_1 = next(d for d in detalles if d.activity_id == f"{pares.id}:0")
    fila_2 = next(d for d in detalles if d.activity_id == f"{pares.id}:1")
    assert (fila_1.status, fila_2.status) == ("correct", "incorrect")
    # Ni el enunciado ni la clave de la revisión son URLs.
    assert fila_1.prompt == "Image 1"
    assert fila_2.correct_answer == "cat"


def test_una_lista_de_imagenes_mas_larga_que_las_opciones_se_rechaza():
    import pytest

    from backend.app.parser import WorksheetScriptError

    roto = SCRIPT.replace(
        "    - https://example.test/banana.png\n",
        "    - https://example.test/banana.png\n    - https://example.test/sobra.png\n",
    )
    with pytest.raises(WorksheetScriptError, match="option_images"):
        parse_worksheet_script(roto)


# Salida LITERAL de `serializeToScript` (src/utils/dslSerializer.ts) para los tipos nuevos, tomada
# del constructor visual funcionando. El constructor y el parser son dos escrituras del mismo DSL:
# si una se mueve sin la otra, el profesor guarda una hoja que se parsea distinta de lo que diseñó.
DEL_CONSTRUCTOR_VISUAL = '''worksheet {
  title: "Round trip"
  block {
    title: "Part 1"
    imagechoice {
      note: "Debe reconocer la fruta."
      question: "Which one is the apple?"
      options:
      - apple
      - banana
      - orange
      option_images:
      - https://example.test/apple.png
      - ""
      - https://example.test/orange.png
      answer: "apple"
    }
    imagematching {
      left_images:
      - https://example.test/dog.png
      - https://example.test/cat.png
      left:
      - Image 1
      - Image 2
      right:
      - dog
      - cat
    }
  }
}'''


def test_el_dsl_que_emite_el_constructor_visual_parsea_igual():
    hoja = parse_worksheet_script(DEL_CONSTRUCTOR_VISUAL)
    eleccion, pares = [a for b in hoja.blocks for a in b.activities]

    assert eleccion.note == "Debe reconocer la fruta."
    assert eleccion.options == ["apple", "banana", "orange"]
    # El hueco `- ""` mantiene el paralelismo: esa opción se pinta como texto, no descoloca al resto.
    assert eleccion.option_images == ["https://example.test/apple.png", "", "https://example.test/orange.png"]
    assert pares.left == ["Image 1", "Image 2"]
    assert pares.left_images == ["https://example.test/dog.png", "https://example.test/cat.png"]
    assert pares.right == ["dog", "cat"]


def test_imagematching_necesita_al_menos_dos_imagenes():
    import pytest

    from backend.app.parser import WorksheetScriptError

    roto = '''worksheet {
  title: "x"
  imagematching {
    left_images:
    - https://example.test/dog.png
    right:
    - dog
  }
}'''
    with pytest.raises(WorksheetScriptError, match="left_images"):
        parse_worksheet_script(roto)
