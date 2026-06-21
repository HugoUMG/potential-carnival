// Prompt/documentación lista para pegar en cualquier IA (ChatGPT, Claude, DeepSeek, etc.)
// y que genere un WorksheetScript válido para esta plataforma.
export const GENERATION_PROMPT = `Eres un generador de hojas de trabajo de inglés. Devuelve ÚNICAMENTE un "WorksheetScript"
válido en el formato DSL descrito abajo. Sin markdown, sin explicaciones, sin \`\`\`. El resultado
debe empezar con "worksheet {" y cerrar con "}".

=== TEMA (rellena esto) ===
Tema/gramática: <describe aquí, ej. "Past Simple, verbos regulares e irregulares">
Nivel: <A1 / A2 / B1 / B2>
Número de actividades: <ej. 10>
Tipo de preguntas: <abiertas / cerradas / mixtas>

=== ESTRUCTURA GENERAL ===
worksheet {
  title: "Título"
  description: "Descripción.\\nPuede tener saltos de línea con \\n"
  theme {                      # opcional
    primary_color: "#2563EB"
    background_color: "#EFF6FF"
    text_color: "#1E3A8A"
  }
  info {                       # opcional: campos NO calificables (Nombre, Grupo...)
    fields:
    - Nombre
    - Grupo
  }
  block {                      # agrupa actividades; puedes usar varios bloques
    title: "Part 1: ..."
    instructions: "Instrucción de la sección."
    ... actividades ...
  }
}

=== TIPOS DE ACTIVIDAD ===
# fillblank — completar espacios. El marcador es _____ (exactamente 5 guiones bajos).
fillblank {
  text: "She _____ to school every day."
  answer: "goes"                      # o varias aceptadas: answer: ["don't drink", "do not drink"]
  instructions: "Verb: go"            # opcional
}

# multiplechoice — una sola correcta.
multiplechoice {
  question: "Which sentence is correct?"
  options:
  - He play soccer.
  - He plays soccer.
  - He playing soccer.
  answer: "He plays soccer."
}

# multiselect — VARIAS respuestas correctas (el alumno marca todas las que apliquen).
# "answer" es una lista con TODAS las opciones correctas.
multiselect {
  question: "Select all the verbs in the simple present."
  options:
  - runs
  - running
  - eats
  - eaten
  answer: ["runs", "eats"]
}

# truefalse — varios enunciados, cada uno true o false.
truefalse {
  statements:
  - "He watches TV every night." | true
  - "We plays basketball." | false
}

# matching — emparejar por posición (left[i] ↔ right[i]).
matching {
  left:
  - I
  - She
  right:
  - work
  - works
}

# textbox — respuesta abierta larga.
textbox { prompt: "Describe your daily routine." }

# reading — texto + preguntas abiertas.
reading {
  title: "School Rules"
  content: "Text here.\\nMore text."
  questions:
  - What time does school start?
  - Name one rule.
}

# listening — reproduce un audio TTS (oculto al alumno) y pregunta.
listening { text: "Oración que se leerá en voz alta." question: "What did you hear?" answer: "key answer" }

# imagequestion — imagen + pregunta abierta.
imagequestion { image: "https://..." prompt: "Describe the picture." }

=== REGLAS IMPORTANTES ===
- Usa _____ (5 guiones bajos) para los espacios en fillblank.
- Usa \\n para saltos de línea dentro de los textos.
- NO uses el tipo "speaking" (no existe).
- Las listas (options, left, right, fields, questions, statements) van con "- " al inicio de cada línea.

=== CALIDAD (evita patrones repetitivos) ===
- VARÍA la posición de la respuesta correcta en multiplechoice: que NO sea siempre la primera ni siempre
  la misma letra. Distribúyelas (a veces 1ª, a veces 2ª, a veces 3ª).
- En truefalse MEZCLA verdaderos y falsos; no pongas todos true ni todos false.
- Que las opciones incorrectas sean creíbles (errores comunes reales), no absurdas.
- No repitas la misma estructura de pregunta una y otra vez; varía el fraseo y el contexto.
- En matching evita que la respuesta sea trivial por orden; mezcla el orden de la columna derecha.
- Mantén el vocabulario acorde al nivel indicado.

Devuelve solo el WorksheetScript.`;
