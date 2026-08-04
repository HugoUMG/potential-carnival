import pytest

from backend.app.parser import WorksheetScriptError, parse_worksheet_script


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


def test_matching_keeps_entered_pair_order():
    script = '''worksheet {
title: "Future matching"

matching {
  left:
  - will + base verb
  - won't
  - Will + subject + base verb?
  - probably / maybe
  right:
  - Affirmative structure
  - Contraction of will not
  - Question structure
  - Used to soften predictions
}
}'''

    worksheet = parse_worksheet_script(script)
    matching = worksheet.activities[0]

    assert matching.left == [
        "will + base verb",
        "won't",
        "Will + subject + base verb?",
        "probably / maybe",
    ]
    assert matching.right == [
        "Affirmative structure",
        "Contraction of will not",
        "Question structure",
        "Used to soften predictions",
    ]


def _wrap(activity: str) -> str:
    return 'worksheet {\ntitle: "T"\n' + activity + "\n}"


def test_listeningmatching_accepts_pair_blocks_and_pairs_list():
    """El constructor visual serializa `pairs:` (lista) y la IA la escribe por costumbre YAML;
    el formato canónico es `pair {}`. Ambos deben producir los mismos pares."""
    canonical = _wrap('''
listeningmatching {
  pair {
    audio_text: "I can swim."
    match: "Ability"
  }
  pair {
    audio_text: "You should rest."
    match: "Advice"
  }
  options:
  - Ability
  - Advice
}''')
    as_list = _wrap('''
listeningmatching {
  pairs:
  - audio_text: "I can swim."
    match: "Ability"
  - audio_text: "You should rest."
    match: "Advice"
  options:
  - Ability
  - Advice
}''')
    expected = [
        {"audio_text": "I can swim.", "match": "Ability"},
        {"audio_text": "You should rest.", "match": "Advice"},
    ]
    for script in (canonical, as_list):
        assert parse_worksheet_script(script).activities[0].pairs == expected


@pytest.mark.parametrize(
    ("activity", "expected_message"),
    [
        # Varios campos en la misma línea: `text` se traga `question` y `answer`.
        ('listening { text: "The bus leaves at eight." question: "What?" answer: "bus" }', "question"),
        ('matching {\n left:\n - a\n - b\n - c\n right:\n - 1\n - 2\n}', "mismo número"),
        ('dragdrop {\n text: "She _____ home."\n answer:\n - goes\n}', "bank"),
        ('fillblank {\n text: "He _____ and she _____."\n answer: "runs"\n}', "huecos"),
        ('multiplechoice {\n question: "Q?"\n options:\n - a\n - b\n answer: "c"\n}', "no coincide"),
        ('listeningmatching {\n options:\n - a\n - b\n}', "pair"),
        ("speaking {\n}", "prompt"),
        # Sin el pipe no hay clave. Antes se guardaba como `true` en silencio.
        ('truefalse {\n statements:\n - The sun rises in the east. | true\n - Water freezes at 50C.\n}', "enunciado 2"),
        ('listeningtruefalse {\n audio_text: "Dogs bark."\n statements:\n - Dogs bark.\n}', "enunciado 1"),
    ],
)
def test_validation_rejects_activities_the_student_could_not_answer(activity, expected_message):
    with pytest.raises(WorksheetScriptError) as exc:
        parse_worksheet_script(_wrap(activity))
    assert expected_message in str(exc.value)


def test_statement_blocks_also_need_an_answer():
    """El formato alterno `statement { text answer }` tiene la misma regla que la lista."""
    with pytest.raises(WorksheetScriptError, match="enunciado 1"):
        parse_worksheet_script(_wrap('truefalse {\n statement {\n  text: "Dogs bark."\n }\n}'))
    ok = parse_worksheet_script(_wrap(
        'truefalse {\n'
        ' statement {\n  text: "Dogs bark."\n  answer: true\n }\n'
        ' statement {\n  text: "Cats fly."\n  answer: false\n }\n'
        '}'
    ))
    assert [s["answer"] for s in ok.activities[0].statements] == [True, False]


def test_validation_allows_reading_without_questions():
    """Una lectura sin preguntas es válida: sirve como texto de referencia."""
    script = _wrap('reading {\n title: "Ref"\n content: "Some text."\n}')
    assert parse_worksheet_script(script).activities[0].questions == []


# Una hoja con LOS 21 tipos escrita exactamente como la documentan los tres sitios que la enseñan:
# `_WORKSHEET_SYSTEM` (ai.py), `GENERATION_PROMPT` (src/utils/generationPrompt.ts) y docs/07_DSL.md.
# Si esto deja de parsear, la documentación está enseñando una sintaxis que no funciona.
ALL_TYPES = '''worksheet {
  title: "Referencia de los 21 tipos"
  description: "Una actividad de cada tipo."
  theme {
    primary_color: "#7C3AED"
  }
  info {
    fields:
    - Nombre
    - Grupo
  }
  block {
    title: "Part 1"
    instructions: "Todo dentro de un block."

    content {
      title: "Repaso"
      html: """
      <h2>Present Simple</h2>
      <style>b { color: red }</style>
      <p>Tercera persona: verbo + <b>s</b>.</p>
      """
    }
    fillblank {
      text: "She _____ to school and _____ English."
      answer: ["goes", "studies"]
    }
    multiplechoice {
      question: "Which sentence is correct?"
      options:
      - He play soccer.
      - He plays soccer.
      answer: "He plays soccer."
    }
    multiselect {
      question: "Select all the present simple verbs."
      options:
      - runs
      - running
      - eats
      answer: ["runs", "eats"]
    }
    dragdrop {
      text: "She _____ to school every day."
      answer:
      - goes
      bank:
      - goes
      - go
    }
    matching {
      left:
      - can
      - should
      right:
      - Ability
      - Advice
    }
    truefalse {
      statements:
      - He watches TV every night. | true
      - We plays basketball. | false
    }
    textbox {
      prompt: "Write three sentences about your weekend."
    }
    reading {
      title: "School Rules"
      content: "Students have to wear a uniform.\\nThey must arrive before 8:00 AM."
      questions:
      - What do students have to wear?
    }
    readingtruefalse {
      title: "The Water Cycle"
      content: "Water evaporates from oceans."
      statements:
      - Water evaporates from oceans. | true
      - Rain comes from wind alone. | false
    }
    imagequestion {
      image: "https://example.com/a.png"
      prompt: "What are the people doing?"
    }
    imagechoice {
      question: "Which one is the apple?"
      options:
      - apple
      - banana
      option_images:
      - https://example.com/apple.png
      - https://example.com/banana.png
      answer: "apple"
    }
    imagematching {
      left_images:
      - https://example.com/dog.png
      - https://example.com/cat.png
      right:
      - dog
      - cat
    }
    speaking {
      prompt: "Read the sentence aloud."
      target: "She goes to school every day."
    }
    listening {
      text: "The bus leaves at eight."
      question: "When does the bus leave?"
      answer: "at eight"
    }
    listeningmultiplechoice {
      audio_text: "My flight was very early."
      question: "Why did she wake up early?"
      options:
      - Because her flight was early.
      - Because she had an exam.
      answer: "Because her flight was early."
    }
    listeningfillblank {
      audio_text: "Tom didn't have to wear a uniform."
      text: "Tom _____ wear a uniform."
      answer: "didn't have to"
    }
    listeningtruefalse {
      audio_text: "Anna had to wear formal clothes."
      statements:
      - Anna had to wear formal clothes. | true
      - Anna brought a portfolio. | false
    }
    listeningmatching {
      pair {
        audio_text: "She had to call the doctor."
        match: "Affirmative"
      }
      pair {
        audio_text: "We didn't have to bring books."
        match: "Negative"
      }
      options:
      - Affirmative
      - Negative
    }
    listeningorder {
      audio_text: "She has never been to Paris."
      voice: female
      answer:
      - She
      - has
      - never
      - been
      - to
      - Paris
    }
    conversation {
      lines:
      - f: "Hi, are you new here?"
      - m: "Yes, I started today."
      question: "When did he start?"
      answer: "today"
    }
  }
}'''


def test_every_documented_type_parses():
    worksheet = parse_worksheet_script(ALL_TYPES)
    activities = [a for b in worksheet.blocks for a in b.activities]

    from backend.app.parser import SUPPORTED_BLOCKS

    assert {a.type for a in activities} == SUPPORTED_BLOCKS
    assert worksheet.info_fields == ["Nombre", "Grupo"]
    assert worksheet.theme == {"primary_color": "#7C3AED"}
    # El HTML con llaves de CSS no descuadra el conteo de bloques.
    content = next(a for a in activities if a.type == "content")
    assert "<style>b { color: red }</style>" in content.html
    # La voz por actividad llega normalizada.
    assert next(a for a in activities if a.type == "listeningorder").voice == "female"
