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


def test_parse_reading_accepts_accidental_quote_before_colon():
    script = '''worksheet {
title: "Reading test"
description: "Checks typo-tolerant reading keys"

reading {
  title": "At the Supermarket"
  content": "Maria is at the supermarket. She buys 6 apples, 3 bananas, and 2 oranges. She also buys some milk and some rice. She has $20 in her wallet."
  questions":
  - How many apples does Maria buy?
  - How many bananas does Maria buy?
  - How many oranges does Maria buy?
  - How much money does Maria have in her wallet?
  - Does Maria buy milk?
}
}'''

    worksheet = parse_worksheet_script(script)
    reading = worksheet.activities[0]

    assert reading.title == "At the Supermarket"
    assert reading.content.startswith("Maria is at the supermarket")
    assert reading.questions == [
        "How many apples does Maria buy?",
        "How many bananas does Maria buy?",
        "How many oranges does Maria buy?",
        "How much money does Maria have in her wallet?",
        "Does Maria buy milk?",
    ]
