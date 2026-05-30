def generate_worksheet_script(prompt: str) -> str:
    """Deterministic placeholder for an LLM call that must return WorksheetScript, not HTML."""

    safe_topic = prompt.strip().rstrip('.') or "English practice"
    return f'''worksheet {{
title: "AI Worksheet: {safe_topic[:60]}"
description: "Generated from teacher prompt: {safe_topic}"

fillblank {{
  text: "I ____ practicing English today."
  answer: "am"
}}

multiplechoice {{
  question: "Choose the correct learning goal."
  options:
  - I can practice English.
  - I can to practice English.
  - I practicing English.
  answer: "I can practice English."
}}

speaking {{
  prompt: "Talk for one minute about {safe_topic[:80]}."
}}
}}'''
