def generate_worksheet_script(prompt: str) -> str:
    """Marcador determinista para una llamada a un LLM que debe devolver WorksheetScript, no HTML."""

    safe_topic = prompt.strip().rstrip('.') or "práctica de inglés"
    return f'''worksheet {{
title: "Hoja generada por IA: {safe_topic[:60]}"
description: "Generada desde la instrucción docente: {safe_topic}"

fillblank {{
  text: "Yo ____ practicando inglés hoy."
  answer: "am"
}}

multiplechoice {{
  question: "Elige el objetivo de aprendizaje correcto."
  options:
  - I can practice English.
  - I can to practice English.
  - I practicing English.
  answer: "I can practice English."
}}

speaking {{
  prompt: "Habla durante un minuto sobre {safe_topic[:80]}."
}}
}}'''
