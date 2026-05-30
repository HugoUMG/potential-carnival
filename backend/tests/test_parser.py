from backend.app.parser import parse_worksheet_script


SCRIPT = '''worksheet {
title: "Present Continuous Practice"
description: "A1 grammar review"

fillblank {
  text: "I ____ studying English."
  answer: "am"
}

multiplechoice {
  question: "Choose the correct answer."
  options:
  - am
  - is
  - are
  answer: "am"
}

reading {
  title: "My School"
  content:
  """
  This is my school.
  """
  questions:
  - What is the text about?
}
}'''


def test_parse_worksheet_script_to_json():
    worksheet = parse_worksheet_script(SCRIPT)

    assert worksheet.title == "Present Continuous Practice"
    assert worksheet.description == "A1 grammar review"
    assert len(worksheet.activities) == 3
    assert worksheet.activities[0].type == "fillblank"
    assert worksheet.activities[1].options == ["am", "is", "are"]
    assert worksheet.activities[2].content == "This is my school."
