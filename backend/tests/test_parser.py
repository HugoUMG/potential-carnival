from backend.app.parser import parse_worksheet_script


SCRIPT = '''worksheet {
title: "Práctica del presente continuo"
description: "Repaso de gramática A1"

fillblank {
  text: "Yo ____ estudiando inglés."
  answer: "am"
}

multiplechoice {
  question: "Elige la respuesta correcta."
  options:
  - am
  - is
  - are
  answer: "am"
}

reading {
  title: "Mi escuela"
  content:
  """
  Esta es mi escuela.
  """
  questions:
  - ¿De qué trata el texto?
}
}'''


def test_parse_worksheet_script_to_json():
    worksheet = parse_worksheet_script(SCRIPT)

    assert worksheet.title == "Práctica del presente continuo"
    assert worksheet.description == "Repaso de gramática A1"
    assert len(worksheet.activities) == 3
    assert worksheet.activities[0].type == "fillblank"
    assert worksheet.activities[1].options == ["am", "is", "are"]
    assert worksheet.activities[2].content == "Esta es mi escuela."
