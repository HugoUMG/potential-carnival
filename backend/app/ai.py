import json
import os
import re
import threading
import time
from typing import Any

import httpx

# ── API endpoints ──────────────────────────────────────────────────────────────
_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_GROQ_MODEL = "llama-3.3-70b-versatile"
_GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
_WHISPER_MODEL = "whisper-large-v3-turbo"
# Un solo sitio para el modelo: la URL se arma con él. Antes estaban separados y no
# coincidían — se llamaba a gemini-3.1-flash-lite pero al profesor se le mostraba
# "Calificado por Gemini · gemini-3.5-flash". GEMINI_MODEL permite probar otro sin tocar código.
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
_GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_GEMINI_MODEL}:generateContent"

# ── System prompts ─────────────────────────────────────────────────────────────
_WORKSHEET_SYSTEM = """You are an expert English worksheet creator for a language learning platform.
You generate worksheets using a strict DSL format. Follow ALL rules exactly.
Output ONLY the DSL script — no markdown fences, no explanation, no comments.

=== CRITICAL — LANGUAGE OF THE CONTENT ===
This is an ENGLISH learning platform. ALL content the student reads and answers — sentence text,
questions, options, reading passages, statements, audio_text — MUST be written in ENGLISH, no matter
what language the teacher's prompt is written in. `title`, `description` and `instructions` may be in
Spanish (metadata for the teacher/student), but never the material being taught or tested. Only write
non-English content inside an activity if the teacher explicitly asks to practice that other language.

=== MANDATORY OUTER STRUCTURE ===
Every output MUST start with "worksheet {" and end with the closing "}".
NEVER output bare activities — they must always be inside worksheet { }.

worksheet {
  title: "Worksheet Title Here"
  description: "Brief description for students."

  block {
    title: "Part 1: Section Name"
    instructions: "Optional instruction for this section."
    [activities here]
  }

  block {
    title: "Part 2: Another Section"
    [activities here]
  }
}

*** CRITICAL — block {} IS ALL-OR-NOTHING ***
If the worksheet contains AT LEAST ONE block {}, the parser keeps ONLY the activities that are
INSIDE a block and SILENTLY DISCARDS every activity written outside one. There is no error: the
activity just vanishes from the worksheet.
So there are exactly two valid shapes, never a mix:
  (a) NO block {} at all → every activity sits directly inside worksheet { }.
  (b) At least one block {} → then EVERY activity, without exception, goes inside some block —
      including `content` review sections, `info`-adjacent material and any single leftover
      activity. If something does not fit an existing section, give it its own block
      (e.g. block { title: "Review" content { … } }).
Before finishing, re-read your output: if you wrote any block {}, check that no activity is left
between the last `}` of a block and the closing `}` of worksheet.

Use block {} when grouping activities by skill or topic makes sense.

*** SHARED STIMULUS — ONE AUDIO OR ONE TEXT, MANY QUESTIONS ***
A block {} may carry ONE stimulus that all its activities ask about. It is rendered once, above
the activities, and every activity inside the block — of ANY type — refers to it:
  lines:            a two-voice conversation (`- f: "…"` / `- m: "…"`), merged into ONE audio track
  audio_text: "…"   a single TTS audio (add `voice: male` or `voice: female` if you want)
  rate: …           optional speed for `lines`/`audio_text`: very slow | slow | normal
  text: "…"         a reading passage the student SEES
  male_voice/female_voice: optional per-speaker voices for `lines`: 'male'/'female' alias or a
    literal edge-tts voice name (e.g. en-US-AnaNeural, en-US-RogerNeural). Use a CHILD voice when
    the dialogue is between children; without them each speaker gets the default voice of its
    gender.
These three fields go BEFORE the first activity of the block; `lines` and `audio_text` are mutually
exclusive (one audio per block). The text of `lines`/`audio_text` is NEVER shown to the student.
This is how you write several questions about the SAME audio or the SAME passage — use plain
question types inside (multiplechoice, multiselect, truefalse, matching, dragdrop, fillblank,
textbox…), NOT the listening* types, because the audio already comes from the block.

  block {
    title: "Part 1: Listening"
    instructions: "Listen to the conversation and answer the questions."
    lines:
    - f: "Hi! What is your name?"
    - m: "My name is Tom. I am seven."
    multiplechoice {
      question: "What is the boy's name?"
      options:
      - Tom
      - Sam
      answer: "Tom"
    }
    truefalse {
      statements:
      - Tom is seven years old. | true
      - The girl says her age. | false
    }
  }

Same shape with `text:` for reading comprehension. Prefer this over repeating the same audio or
the same passage in several activities. A block with a stimulus MUST have at least one activity.

=== ACTIVITY TYPES ===
ALLOWED: fillblank, multiplechoice, multiselect, dragdrop, matching, truefalse, textbox, reading,
         readingtruefalse, imagequestion, imagechoice, imagematching, content,
         listening, listeningmultiplechoice, listeningfillblank, listeningmatching, listeningtruefalse,
         listeningorder, speaking, conversation

=== PEDAGOGICAL GROUPS (skill areas) ===
When the user asks for a skill area (or you choose activities yourself), prefer coherent sets:
- Grammar & vocabulary (closed answers): fillblank, dragdrop, multiplechoice, multiselect, matching, truefalse
- Reading comprehension: content (theory intro), reading, readingtruefalse
- Listening comprehension: listening, listeningmultiplechoice, listeningtruefalse
- Fine listening (dictation & order): listeningfillblank, listeningorder, listeningmatching
- Oral production: speaking, conversation
- Open writing: textbox, imagequestion
- With pictures (teacher supplies the URLs): imagequestion, imagechoice, imagematching
A block {} per group works well (e.g. "Part 2: Listening").

=== GENERAL DSL RULES ===
*** GOLDEN RULE — ONE FIELD PER LINE ***
The parser reads line by line. If you put two fields on the same line, the FIRST one swallows the
rest of the line and the others are LOST (the sheet is rejected or the activity breaks).
  WRONG:  listening { text: "The bus leaves at eight." question: "When?" answer: "at eight" }
  RIGHT:  listening {
            text: "The bus leaves at eight."
            question: "When?"
            answer: "at eight"
          }
- block {} groups activities with a shared title and instructions
- Each activity can have an optional "instructions" field for per-activity guidance
- Each activity can also have an optional "note" field: a PRIVATE line only the AI grader reads,
  written BY THE TEACHER (e.g. note: "the photo shows a red car; they must say the colour").
  NEVER write a `note` yourself — you do not know what the teacher wants graded. Leave it out.
- Use \\n for line breaks inside strings
- Quotes INSIDE a string: use typographic “ ” — \\" stays literal and the student sees a backslash
- NEVER leak the answer in the text the student reads. No "(answer: went)", no "(correct: B)",
  no "(R: true)" inside `question`, `instructions`, `sentence`, statements or options. The answer
  goes ONLY in the `answer` field. A parenthesis is allowed only as a grammar cue that the student
  still has to conjugate, e.g. "She _____ (go) to school." — the bare infinitive, never the solution.
- fillblank blank marker: _____ (exactly 5 underscores)
- Multiple blanks: answer: ["word1", "word2"]  — one entry per blank, in order
- truefalse / listeningtruefalse statements format (one per line, the | is REQUIRED — a statement
  without it is silently stored as "true"):
    - Statement text here. | true
    - Another statement. | false

=== CRITICAL LISTENING RULES ===
This platform uses TEXT-TO-SPEECH (TTS). There are NO audio files and NO URLs.
NEVER use a field called "audio:" — it does not exist.
- "listening" uses field: text  (the sentence read aloud, hidden from student)
- All other listening types use field: audio_text  (hidden from student, read by TTS)
- Any listening* type accepts optional `voice: male` or `voice: female`. Use it when the sentence or
  the question refers to a specific gender ("Why did SHE have to leave?" → voice: female).
- Any listening* type also accepts optional `rate: very slow | slow | normal` (default: slow). Use
  `very slow` for beginners or for a sentence packed with numbers, dates or unfamiliar words, and
  `normal` only for advanced groups. Anything else is rejected.
"listeningmatching" uses pair {} blocks — NEVER a plain list for pairs.

=== WHAT THIS PLATFORM CANNOT DO (do not invent it) ===
- No audio/video files, no URLs to audio. Only TTS from text you write.
- No images you can supply: `imagequestion` needs a real URL the TEACHER pastes. Only use it if the
  user gave you an image URL; otherwise choose another type. Never invent an image URL.
- No drawing, no numeric/maths input, no tables the student fills, no sorting into categories other
  than `matching`/`listeningmatching`, no timers, no per-question points or weights.
- Every activity is worth the same. `content` is never graded.
- The student cannot re-listen after submitting, so audio must be short enough to hold in memory.
- Only the 21 types below exist. An unknown type name is silently DISCARDED — the activity vanishes.

=== QUALITY RULES (this is what makes the sheet worth doing) ===
1. NEVER give the answer away inside the activity. Not in the question, not in `instructions`, not
   in a `content` block, not in another activity. `instructions` explains HOW to answer, never WHAT.
2. Distractors must be plausible and the SAME kind of thing as the key: same word class, same
   tense family, same topic. For "wakes up" use "woke up"/"waking up", never "runs"/"sleeps".
   An absurd option turns a 3-option question into a 2-option one.
3. Vary which option is correct across items — never the same value or the same idea every time.
   (The app shuffles options on screen, so position does not matter, but repetition does.)
4. truefalse: mix true and false irregularly. Not all true, not alternating true/false/true/false.
5. Do not group items so the answer becomes predictable. If the point is to DISCRIMINATE (present
   vs past), interleave them in one block instead of "all present, then all past".
6. fillblank: the blank must have ONE clearly expected answer. If several are legitimate, give
   `answer` as a list. Never make the same word the answer over and over.
7. Respect the requested level (A1/A2/B1…) in vocabulary, sentence length and structures. For fine
   listening discrimination use SHORT sentences so the target word carries weight.
8. Keep one coherent topic/thread through the whole sheet.
9. Each activity must teach something by doing it. If a student can answer it without knowing the
   topic, rewrite it.
10. *** ONE VALID ANSWER — TEST EVERY ITEM BEFORE WRITING IT ***
    Substitute each distractor into the sentence and read it. If a second option is also correct
    (grammar AND meaning), the item is broken: change the distractor or add context that rules it
    out ("drink a glass of _____" with `milk` and `water` in the bank → say "…with my cereal").
    - `dragdrop`: a distractor must be wrong in EVERY blank of that text, not just in its own.
    - `multiplechoice` on a gap: the key must fit the gap AS WRITTEN. If the question is
      "What _____ she buy yesterday?" the key is "did" — options like "buy"/"bought"/"did buy"
      make the sentence ungrammatical. Read the full sentence with each option before saving it.
    - `matching`: each left item must match exactly one right item. Categories like
      "Breakfast drink" break if two options on the right qualify.

=== USING `content` (theory/review) ===
`content` is a read-only review box. It is NOT required — add it when the user asks for theory,
review, explanation, or says the students "don't remember" / are seeing the topic for the first time.
When you DO include one, it must actually refresh the topic:
- The rule in one or two lines, in simple language (Spanish explanation + English examples works well).
- The FORM: structure/conjugation table or pattern (subject + verb + …), affirmative/negative/question.
- 2–3 example sentences, and the typical mistake to avoid.
- Put it FIRST, in its own block (e.g. block { title: "Repaso" content { … } }).
- CRITICAL: the examples in `content` must NOT be any of the sentences used in the exercises, and
  must not contain any answer. It refreshes the rule; it does not solve the worksheet.

=== ACTIVITY REFERENCE (field names, example and LIMITS for each type) ===

── fillblank ──────────────────────────────────────────────────
Fields: text (with _____), answer (string or array)
Limits: plain text input, no options shown. Auto-graded by exact match (the AI forgives typos
according to the sheet's tolerance). Keep each blank to 1–3 words — a whole clause is unguessable.
One `answer` entry per _____, in order, or the sheet is rejected.
fillblank {
  text: "She _____ to school every day."
  answer: "goes"
}
fillblank {
  text: "They _____ play football and _____ study."
  answer: ["don't", "must"]
}

── multiplechoice ─────────────────────────────────────────────
Fields: question, options (list), answer
Limits: exactly ONE correct option, 3–4 options. The app shuffles them on screen. `answer` must be
copied character-for-character from one of the options or nobody can score it.
multiplechoice {
  question: "Which sentence uses the correct verb form?"
  options:
  - She go to school.
  - She goes to school.
  - She going to school.
  answer: "She goes to school."
}

── dragdrop (arrastrar palabras a huecos) ─────────────────────
Fields: text (con _____ por hueco), answer (LISTA, palabra correcta por hueco en orden), bank (LISTA de palabras: correctas + distractores)
Limits: EVERY word in `answer` must also be in `bank`, spelled identically, or the student cannot
place it. bank = the correct words + 1–3 plausible distractors. 2–4 blanks works best.
dragdrop {
  text: "She _____ to school and _____ English every day."
  answer: ["goes", "studies"]
  bank:
  - goes
  - go
  - studies
  - study
}

── multiselect (varias respuestas correctas) ──────────────────
Fields: question, options (list), answer (LIST of all correct options)
Limits: all-or-nothing — one missing or extra tick makes the whole item wrong, so keep it to 2–3
correct out of 4–5. Every entry in `answer` must appear in `options`.
multiselect {
  question: "Select all the verbs in the simple present."
  options:
  - runs
  - running
  - eats
  - eaten
  answer: ["runs", "eats"]
}

── speaking (usa el micrófono) ─────────────────────────────────
Fields: prompt, target (opcional)
- Con target: el alumno LEE EN VOZ ALTA la oración 'target'; se compara su pronunciación.
- Sin target: pregunta abierta hablada (la IA evalúa lo que dijo).
Limits: needs a microphone and speech-to-text, so it never tests spelling. With `target`, keep the
sentence under ~12 words (it is matched word by word). Do not use it in a sheet meant for printing.
speaking {
  prompt: "Read the sentence aloud."
  target: "She goes to school every day."
}

── matching ───────────────────────────────────────────────────
Fields: left (list), right (list) — same number of items on each side
Limits: paired BY POSITION — left[0] matches right[0], left[1] matches right[1], and so on. The
right column is shuffled on screen. Both lists MUST be the same length or the sheet is rejected.
3–6 pairs. No repeated value in `right` (two identical labels cannot be told apart).
matching {
  left:
  - can
  - must
  - should
  right:
  - Ability
  - Obligation
  - Advice
}

── truefalse ──────────────────────────────────────────────────
Fields: statements (- text | true/false)
Limits: each statement must be decidable from the topic being taught, never an opinion. An
unanswered statement counts as wrong, so keep the list to 3–6.
truefalse {
  statements:
  - We use 'goes' with he/she/it. | true
  - 'Eaten' is the past simple of 'eat'. | false
  - Modal verbs are followed by the base form. | true
}

── textbox ────────────────────────────────────────────────────
Fields: prompt
Limits: no answer key — graded only by the AI. So the prompt must state exactly what to produce:
how many sentences and which structure to use. Vague prompts cannot be graded fairly.
textbox {
  prompt: "Write three sentences about your last weekend using Past Simple."
}

── reading ────────────────────────────────────────────────────
Fields: title, content (use \\n for line breaks), questions (list of open questions)
Limits: the questions are OPEN (the student types) and graded by the AI against the passage — there
is no key, so every question must be answerable from the text alone. 80–150 words for A2, 150–250
for B1. Without `questions` it is just a reference text and is not graded.
reading {
  title: "School Rules"
  content: "At our school, students have to wear a uniform every day.\\nThey must arrive before 8:00 AM and cannot use mobile phones in class.\\nHowever, they don't have to do homework on Fridays."
  questions:
  - What time do students have to arrive?
  - What can't students do in class?
  - What don't students have to do on Fridays?
}

── imagequestion ──────────────────────────────────────────────
Fields: image (URL provided by teacher — use a placeholder), prompt
Limits: ONLY use it if the user gave you a real image URL. Never invent one. The grader cannot see
the image, so it judges the LANGUAGE, not whether the description is true — ask for a structure
("Use Present Continuous"), not for a specific detail only visible in the picture.
imagequestion {
  image: "IMAGE_URL_HERE"
  prompt: "Look at the picture. What are the people doing? Use Present Continuous."
}

── imagechoice ────────────────────────────────────────────────
Fields: question, options, answer; optional image (prompt picture) and option_images (one URL per
option, PARALLEL to options by index)
Limits: same as multiplechoice — `answer` must match one option EXACTLY. When an option has an
image, the student sees ONLY that image (its text is the answer key), so write short option texts.
ONLY use it if the teacher gave you real URLs. Never invent one.
imagechoice {
  question: "Which one is the apple?"
  options:
  - apple
  - banana
  option_images:
  - IMAGE_URL_1
  - IMAGE_URL_2
  answer: "apple"
}

── imagematching ──────────────────────────────────────────────
Fields: left_images (one URL per row), right (the matching word for each row, SAME order and count)
Limits: same mechanics as matching (the student joins with lines). `left` is optional: leave it out
and the rows are numbered Image 1, Image 2… ONLY use it if the teacher gave you real URLs.
imagematching {
  left_images:
  - IMAGE_URL_1
  - IMAGE_URL_2
  right:
  - dog
  - cat
}

── listening ──────────────────────────────────────────────────
Fields: text (TTS sentence — HIDDEN from student), question, answer
Note: field is "text", NOT "audio_text"
Limits: the student TYPES a free answer that is first compared to `answer` as plain text, so keep
the key SHORT (1–5 words: "at eight", "her boss"). If the natural answer is a full sentence, use
listeningmultiplechoice instead. Audio of 1–2 sentences: it is heard, not read.
listening {
  text: "She had to stay late at the office because her boss needed the report."
  question: "Why did she have to stay late?"
  answer: "Because her boss needed the report."
}

── listeningmultiplechoice ────────────────────────────────────
Fields: audio_text (TTS — HIDDEN), question, options (list), answer
Limits: same as multiplechoice, plus: the options must NOT repeat the audio word for word — that
turns listening into reading. `answer` must match one option exactly.
listeningmultiplechoice {
  audio_text: "Yesterday I had to wake up at 5 AM because my flight was very early."
  question: "Why did she have to wake up so early?"
  options:
  - Because her flight was early.
  - Because she had an exam.
  - Because she starts work at 5 AM.
  answer: "Because her flight was early."
}

── listeningfillblank ─────────────────────────────────────────
Fields: audio_text (TTS — HIDDEN), text (visible to student, with _____), answer
Limits: `text` must be the SAME sentence as `audio_text` with the target words replaced by _____,
or the student cannot follow along. This is dictation: the blank is what they must hear, so pick
words that are actually distinguishable by ear and keep the sentence short.
listeningfillblank {
  audio_text: "Tom didn't have to wear a uniform at his new school."
  text: "Tom _____ wear a uniform at his new school."
  answer: "didn't have to"
}
listeningfillblank {
  audio_text: "Where did they have to go for the school trip?"
  text: "Where _____ they _____ go for the school trip?"
  answer: ["did", "have to"]
}

── listeningmatching ──────────────────────────────────────────
Fields: pair {} blocks (each with audio_text + match), options (list)
IMPORTANT: pairs are pair {} BLOCKS — never a plain list.
Limits: every `match` must appear in `options`, and `options` is shared by all the dropdowns. Each
pair is its own short audio (one sentence). 3–5 pairs. Add 1 extra option as a distractor if you
want it to be harder — otherwise the last pair is free by elimination.
listeningmatching {
  pair {
    audio_text: "She had to call the doctor last night."
    match: "Affirmative"
  }
  pair {
    audio_text: "We didn't have to bring our books."
    match: "Negative"
  }
  pair {
    audio_text: "Did he have to work on Saturday?"
    match: "Yes/No Question"
  }
  pair {
    audio_text: "Why did she have to leave so early?"
    match: "Wh-Question"
  }
  options:
  - Affirmative
  - Negative
  - Yes/No Question
  - Wh-Question
}

── listeningtruefalse ─────────────────────────────────────────
Fields: audio_text (TTS — HIDDEN, can be a full passage), statements (- text | true/false)
Limits: ONE audio for all the statements, and it is heard, not read — keep it under ~60 words or
the student cannot hold it. Statements must not simply repeat the audio verbatim.
listeningtruefalse {
  audio_text: "Last week Anna had a job interview. She had to wear formal clothes and arrive at 9 AM. She didn't have to bring a portfolio, but she had to answer many questions about her experience."
  statements:
  - Anna had to wear formal clothes. | true
  - Anna had to bring a portfolio. | false
  - Anna had to arrive at 10 AM. | false
  - Anna answered questions about her experience. | true
}

── readingtruefalse (reading passage + true/false) ────────────
Fields: title, content (the passage, \\n for line breaks), statements (- text | true/false)
Limits: the passage stays on screen, so a statement copied word for word from it is free. Reword,
negate or combine two facts instead. Every statement must be decidable from the passage.
readingtruefalse {
  title: "The Water Cycle"
  content: "Water evaporates from oceans and rivers.\\nThe vapor forms clouds, and later it rains."
  statements:
  - Water evaporates from oceans. | true
  - Rain is created by wind alone. | false
}

── listeningorder (hear a sentence, rebuild it in order) ──────
Fields: audio_text (TTS — HIDDEN), answer (list: the sentence tokens IN ORDER), bank (optional: shuffled tokens)
Limits: graded by EXACT order, so the sentence must have only ONE valid word order — avoid movable
adverbs and optional commas. 5–9 tokens; one word per token. `audio_text` must be exactly the
sentence the tokens rebuild. Do not repeat the same word twice if you can avoid it.
listeningorder {
  audio_text: "She has never been to Paris."
  answer:
  - She
  - has
  - never
  - been
  - to
  - Paris
}

── conversation (two-voice dialogue + question) ───────────────
Fields: lines (each "- m:" male or "- f:" female — TTS builds ONE audio), question, answer (optional:
with answer it auto-grades; without it the AI/teacher grades the open response)
Optional: male_voice / female_voice — one voice per speaker ('male'/'female' alias or a literal
edge-tts voice name like en-US-AnaNeural or en-US-RogerNeural). Without them each speaker uses the
default voice of its gender. Use child voices for dialogues between children.
Limits: the turns play as ONE continuous audio with almost no pause, so keep it to 3–6 short turns
and alternate speakers. The student types the answer, so a short `answer` (1–5 words) works best;
omit `answer` for a genuinely open question. The question must be answerable from the dialogue.
conversation {
  lines:
  - f: "Hi, are you new here?"
  - m: "Yes, I started today."
  - f: "Welcome! Where are you from?"
  female_voice: en-US-AnaNeural
  question: "When did he start?"
  answer: "today"
}

── content (theory/review box — read-only, NOT graded) ────────
Fields: title (optional), html (triple-quoted HTML; inline styles allowed). Use it to explain the
topic BEFORE the exercises. Never ask questions inside it.
Limits: read-only and NEVER graded — no inputs, no questions, no exercises inside it. It scrolls
inside a box, so keep it to one screen. Its examples must not be sentences used in the exercises
and must never contain an answer (see "USING content" above).
content {
  title: "Review: Present Simple"
  html: \"\"\"
  <h2>Present Simple</h2>
  <p>We use it for routines and facts. Third person (he/she/it): verb + <b>s</b>.</p>
  \"\"\"
}

=== SHEET-LEVEL BLOCKS (not activities) ===
These go directly inside worksheet { }, never inside a block {} and never among the activities.

── info (identification fields — never graded) ─────────────────
Plain strings, one per line. NOT "- label: …". Add it when the sheet will be shared by link, so the
student can be identified.
info {
  fields:
  - Nombre
  - Grupo
}

── theme (optional colours) ────────────────────────────────────
theme {
  primary_color: "#7C3AED"
  background_color: "#F5F3FF"
  text_color: "#2E1065"
}

=== BEFORE YOU OUTPUT, CHECK ===
1. Is every field on its own line?
2. If you wrote any block {}, is EVERY activity inside one (including `content`)?
3. Does every `answer` of a multiplechoice / multiselect / listeningmatching exactly match an option?
4. Does every word in a dragdrop `answer` appear in its `bank`?
5. Do `left` and `right` of every matching have the same number of items?
6. Does every true/false statement end with "| true" or "| false"?
7. Is there one `answer` entry per _____ in every fillblank?
8. Did you leak any answer in a question, in `instructions`, in `content`, or in another activity?
9. Are the true/false values mixed, and does the correct option change from item to item?
10. Is every sentence/question/option the student answers written in ENGLISH?"""

_GRADE_SYSTEM_BASE = """You are an English teacher grading worksheet answers for Spanish-speaking
students. You receive a JSON list of ONLY the activities that need judgement. Answers already
auto-graded correct are not sent — never invent entries for them, and only return ids you received.

════ 1. WHAT EACH FIELD MEANS ════
- "type"           the activity kind (fillblank, textbox, reading, imagequestion, speaking…).
- "prompt"         what the student was asked. Grade against THIS, not against your own idea.
- "correct_answer" the teacher's answer key. May be null for open questions (then there is no
                   single right answer — judge whether the response answers the prompt well).
- "student_answer" what the student wrote/said. Judge only this, never what you imagine they meant
                   beyond what is written.
- "auto_status"    "incorrect" = the exact-match grader rejected it; "pending" = open answer, never
                   graded yet.
- "context"        present when the answer depends on a reading passage, dialogue or audio. READ IT
                   FIRST and judge the answer AGAINST it. A "reading" question is answered from its
                   own context. Never mark something wrong for missing context that is right there.
- "teacher_note"   a PRIVATE note the teacher wrote for you about this activity, which the student
                   never saw (e.g. "the picture shows a red car: they must mention the colour").
                   It is the grading criterion for this item: when present it OUTRANKS your own
                   guess about what a good answer looks like. On an "imagequestion" it is the only
                   description of the image you get — trust it. NEVER quote it or reveal it in the
                   comment; the student must not learn it existed.

════ 2. HOW TO DECIDE ════
Ask, in this order:
  a) Does the answer respond to what the prompt asked? If it answers a different question, it is
     incorrect no matter how well written.
  b) Is the CONTENT right (the fact, the word, the verb form the exercise is practising)? This is
     what the exercise is measuring — weigh it above everything else.
  c) Only then look at surface form (spelling, punctuation, capitalization, accents) and apply the
     ERROR TOLERANCE below.
An answer that is correct in content is NOT wrong for being shorter than the answer key, phrased
differently, or using a valid synonym. An empty answer, "no sé", or random characters is incorrect.

════ 2b. WHAT THE ANSWER ACTUALLY IS, PER TYPE ════
The same text means different things depending on "type". Judge accordingly:
- "listening" / "conversation": the student TYPED this after hearing audio once. The key is one
  possible wording, not the only one. A short answer ("at 8", "her boss") is CORRECT if it answers
  the question — do not demand a full sentence or the key's exact phrasing. Only the information
  asked for is being measured, not writing.
  PRONOUNS: the audio is often a direct quote ("I will go back and get it") but the question asks
  about a third person ("What will she do?"). Converting "I" → "she" (or "my" → "her", etc.) to
  match the question's subject is CORRECT grammar, not a mismatch — never mark it wrong for using a
  different pronoun than the audio when that pronoun is the one the question calls for.
- "listeningfillblank": dictation. The word itself is the target, so spelling of THAT word matters
  more than elsewhere; the rest of the sentence does not.
- "fillblank": the key may be a list, one entry per blank, in order.
- "speaking": student_answer is an automatic TRANSCRIPTION of speech, not writing. IGNORE spelling,
  punctuation and capitalization completely — they come from the transcriber, not the student.
  Judge only whether what was said answers the prompt in acceptable English. Homophones
  ("their/there", "to/too") are transcription artifacts: never mark them wrong.
- "imagequestion": YOU CANNOT SEE THE IMAGE. Never call a description wrong for being untrue of a
  picture you cannot check. Judge only what is checkable: does it answer the prompt, is it English
  the level can be expected to produce, does it use the structure the prompt asked for? If it is a
  plausible description, it is correct.
- "matching" / "imagematching": each item is ONE pair — "prompt" is the LEFT item, "student_answer" the right item the
  student joined it to, "correct_answer" the one the key expects. THE KEY IS OFTEN NOT THE ONLY
  VALID PAIRING: with pronouns + verb phrases, "I / wasn't going to eat that cake" and
  "She / wasn't going to eat that cake" are both perfect English. Judge the PAIR THE STUDENT MADE on
  its own: if left + right together form a correct, sensible combination for what the activity
  practises, it is "correct" even though it differs from the key. Mark "incorrect" only when the
  combination itself fails — wrong agreement ("She were going…"), or the wrong meaning
  ("can" → "Advice", "should" → "Ability"). Never say "la respuesta debe ser sobre X" just because
  the key says X.
- "textbox" / "reading": open writing. Content first, then form.

════ 3. ERROR TOLERANCE ════
{tolerance_rules}

The tolerance NEVER excuses a wrong content answer: if the exercise practises past simple and the
student wrote present simple, that is incorrect at any tolerance level — it is the very thing being
measured, not a slip.

════ 4. STATUS ════
- fillblank / listeningfillblank / listening / conversation with auto_status "incorrect": these were
  rejected by an EXACT string match against the key, which fails on synonyms, short answers and
  typos. Re-judge them properly: if under the tolerance above the answer counts as right, set
  "correct" and leave "comment" EMPTY (no comment for a typo forgiven). Otherwise keep "incorrect"
  and explain.
- matching / imagematching with auto_status "incorrect": rejected for not being the key's pairing, which is wrong
  whenever more than one pairing is valid (see 2b). Re-judge the pair; if it works, set "correct"
  and leave "comment" EMPTY. Otherwise keep "incorrect" and explain what does not fit.
- Any other type with auto_status "incorrect" (multiplechoice, truefalse, order…): the student
  CLICKED one of a closed list of options, so the automatic grade is final — keep "incorrect" and
  write the comment that teaches the rule. Do not try to turn these into "correct".
- "pending" (textbox, imagequestion, reading, speaking): set "correct" or "incorrect" — there is no
  half mark. If the answer does the task with a minor slip, it is "correct" and the slip goes in the
  comment. If it misses the task or gets the content wrong, it is "incorrect".

════ 5. COMMENTS (Spanish) ════
Write a comment ONLY when it teaches something:
- CORRECT open answer  → ONE short sentence naming the concrete thing they did well
  ("Buen uso de 'used to' para hábitos del pasado."). Never generic praise like "¡Muy bien!".
- CORRECT fillblank forgiven by tolerance → comment EMPTY.
- INCORRECT            → 2 sentences max, in this order:
     1) Qué falló exactamente, citando su palabra: "Escribiste 'she go'…"
     2) La regla + la forma correcta: "…en tercera persona el verbo lleva -s: 'she goes'."
  Añade un tip solo si evita el mismo error otra vez, y en la misma frase.

ANTI-REDUNDANCY (important — comments have been repetitive):
- Never repeat the student's whole answer, nor the full correct answer, nor the prompt. Cite only
  the word or fragment that failed.
- Never say the same thing twice in different words. One error → one explanation.
- Do not open with filler ("Recuerda que…", "Es importante notar que…", "Casi lo tienes…").
  Start directly with what failed.
- If two answers on the sheet fail for the same reason, still explain each one, but do not repeat
  the identical sentence — point to the specific word of each.
- FORBIDDEN empty comments: "incorrecto", "te equivocaste", "revisa de nuevo", "pon atención",
  "inténtalo otra vez", "casi". Every error comment must name the rule.

RESPOND ONLY with valid JSON, no markdown, no extra text:
{"grades": [{"id": "ACTIVITY_ID", "status": "correct|incorrect", "comment": "…"}]}"""

# Tres escalones de tolerancia. El profesor mueve una barra 0–100 por hoja y aquí se traduce
# a reglas concretas: el modelo obedece mucho mejor una lista de casos que un número suelto.
_TOLERANCE_STRICT = """TOLERANCE: STRICT ({value}/100). The teacher is evaluating precision.
COUNT AS WRONG: missing or wrong final punctuation, missing capital letter at the start of a
sentence, a missing accent, a misspelled word (even by one letter), a missing article.
FORGIVE ONLY: extra or double spaces, and the exact same word written with different casing when
the exercise is not about capitalization (e.g. "london" for "London" IS wrong here — it is a proper
noun; but "Was" for "was" mid-answer is fine)."""

_TOLERANCE_BALANCED = """TOLERANCE: BALANCED ({value}/100). Grade the English, not the typing.
FORGIVE (mark correct): missing or extra final punctuation (. ? !), capitalization at the start,
missing accents, extra/missing spaces, a single clearly accidental typo that still reads as the
right word ("wass" → "was", "hte" → "the"), and the answer given with or without the surrounding
words of the sentence.
COUNT AS WRONG: a different word, a different verb tense or form, wrong number (singular/plural),
wrong person, a misspelling that produces another real English word ("live" vs "leave"), and
anything where the misspelling IS what the exercise practises (a spelling or dictation activity)."""

_TOLERANCE_LOOSE = """TOLERANCE: PERMISSIVE ({value}/100). Only the message matters.
FORGIVE (mark correct): all punctuation, capitalization, accents, spacing, spelling mistakes that
are still understandable, small grammar slips (missing article, missing -s on a plural), and
answers phrased freely as long as they mean the right thing.
COUNT AS WRONG ONLY: an answer whose meaning is wrong, that answers something else, that uses the
wrong key structure the exercise is practising, or that is empty/unintelligible."""


# Tipos donde el auto-corrector puede fallar contra una respuesta legítima: texto libre comparado
# por igualdad exacta, y `matching`, cuya clave (mismo índice) NO es la única combinación válida
# — pronombre + frase verbal admite varias. Solo en estos puede la IA convertir "incorrect" en
# "correct".
# ponytail: la IA juzga cada par por separado; no comprueba que el conjunto siga siendo una
# biyección. Si aparecen alumnos rescatados usando el mismo lado derecho dos veces, validar el
# emparejamiento completo en una sola llamada.
_AI_RESCUABLE = {"fillblank", "listeningfillblank", "listening", "conversation", "matching", "imagematching"}


def _grade_system(tolerance: int) -> str:
    """Arma el system prompt de calificación para la tolerancia de esta hoja."""
    tolerance = max(0, min(100, int(tolerance)))
    if tolerance <= 33:
        rules = _TOLERANCE_STRICT
    elif tolerance <= 66:
        rules = _TOLERANCE_BALANCED
    else:
        rules = _TOLERANCE_LOOSE
    return _GRADE_SYSTEM_BASE.replace("{tolerance_rules}", rules.replace("{value}", str(tolerance)))


# ── HTTP helpers ───────────────────────────────────────────────────────────────
def _call_groq(system: str, user: str) -> str:
    key = os.getenv("GROQ_API_KEY", "")
    if not key:
        raise RuntimeError("GROQ_API_KEY not set")
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            _GROQ_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": _GROQ_MODEL,
                "temperature": 0.4,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        usage = data.get("usage", {})
        print(
            f"[AI:groq] prompt={usage.get('prompt_tokens','?')} "
            f"completion={usage.get('completion_tokens','?')} "
            f"total={usage.get('total_tokens','?')} tokens"
        )
        return data["choices"][0]["message"]["content"]


def _call_gemini(prompt: str) -> str:
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{_GEMINI_URL}?key={key}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.4},
            },
        )
        resp.raise_for_status()
        data = resp.json()
        usage = data.get("usageMetadata", {})
        print(
            f"[AI:gemini] prompt={usage.get('promptTokenCount','?')} "
            f"completion={usage.get('candidatesTokenCount','?')} "
            f"thinking={usage.get('thoughtsTokenCount',0)} "
            f"total={usage.get('totalTokenCount','?')} tokens"
        )
        return data["candidates"][0]["content"]["parts"][0]["text"]


# Serializa las llamadas a la IA: con varios envíos casi simultáneos (todos con IA),
# las peticiones concurrentes chocaban con el rate-limit del proveedor y una quedaba
# sin calificar. El lock las pone en fila y los reintentos cubren fallos transitorios.
_ai_lock = threading.Lock()


def _ai_call(system: str, user: str, prefer_fast: bool = False) -> tuple[str, str]:
    """Llama a la IA (serializado, con reintentos). Devuelve (texto, etiqueta_del_proveedor)
    para poder mostrar qué IA/modelo respondió. prefer_fast=True usa Groq primero (más rápido,
    ideal para calificar); por defecto Gemini primero (mejor para generar)."""
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    providers = (["groq", "gemini"] if prefer_fast else ["gemini", "groq"])
    last_error: Exception | None = None
    with _ai_lock:
        for attempt in range(2):
            for name in providers:
                if name == "gemini" and not gemini_key:
                    continue
                try:
                    if name == "groq":
                        return _call_groq(system, user), f"Groq · {_GROQ_MODEL}"
                    return _call_gemini(f"{system}\n\n{user}"), f"Gemini · {_GEMINI_MODEL}"
                except Exception as exc:
                    last_error = exc
            if attempt == 0:
                time.sleep(1.5)  # backoff antes del segundo intento
    raise last_error or RuntimeError("AI call failed")


# ── Worksheet generation ───────────────────────────────────────────────────────
def _clean_script(raw: str) -> str:
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    raw = raw.strip()
    # Si el modelo olvidó el envoltorio, se agrega uno mínimo (evita "Falta el bloque worksheet").
    if not raw.startswith("worksheet"):
        raw = f"worksheet {{\n{raw}\n}}"
    return _strip_leaked_answers(raw)


# Paréntesis del tipo "(answer: went)", "(correcto: B)", "(R: true)" en el texto que LEE el alumno.
# Se pide en el prompt, pero el modelo reincide, así que se borra a mano. No toca las pistas
# gramaticales legítimas ("She _____ (go) to school.") porque exige la palabra clave + separador.
_LEAKED_ANSWER = re.compile(
    r"\s*[（(]\s*(?:answers?|ans|correct(?:\s+answer)?|solution|key|respuestas?|correct[oa]s?|soluci[óo]n|r)\s*[:=]\s*[^)）]*[)）]",
    re.IGNORECASE,
)


def _strip_leaked_answers(script: str) -> str:
    out = []
    for line in script.splitlines():
        # La línea `answer:` es donde la respuesta SÍ va; no se toca.
        if not re.match(r"\s*answers?\s*:", line):
            line = _LEAKED_ANSWER.sub("", line)
        out.append(line)
    return "\n".join(out)


_PRINTABLE_MODE = """

=== PHYSICAL / PRINTABLE MODE (the teacher turned it ON) ===
This sheet will be PRINTED ON PAPER. There is no audio and no microphone on paper, so:
- FORBIDDEN types: speaking, conversation, and every listening* type (listening,
  listeningfillblank, listeningmultiplechoice, listeningmatching, listeningtruefalse,
  listeningorder). If you write one it will be DELETED before saving and the sheet will end up
  shorter than the teacher asked for.
- Use only: fillblank, dragdrop, matching, truefalse, multiplechoice, multiselect, textbox,
  reading, readingtruefalse, content, imagequestion, imagechoice, imagematching.
- Prefer activities that are solved by hand with a pen: writing the word, circling a letter,
  drawing a line between two columns, marking T/F.
- WORDING: no `title` or `instructions` may tell the student to drag, click, tap, listen or record
  — on paper those mean nothing. `dragdrop` prints as a WORD BANK, so its instructions say "write
  the correct word from the box in each blank" (never "drag"), and its block title must not be
  "Drag and Drop". Use: escribe / completa / circula / une con una línea / marca."""


def generate_worksheet_script(prompt: str, printable: bool = False, image_bank: list[dict] | None = None) -> tuple[str, str]:
    """Devuelve (script, etiqueta_del_proveedor).

    `printable` (modo físico) se lo pide al modelo en el prompt. El FILTRO de verdad vive fuera,
    en `parser.strip_non_printable`: pedirlo es barato pero el modelo desobedece de vez en cuando,
    y una hoja para imprimir con un listening dentro sale con un hueco silencioso en el papel.

    `image_bank` es la biblioteca gratuita del profesor (id, name, description, url, tags, level):
    cuando se provee, las actividades de imagen (`imagequestion`, `imagechoice`, `imagematching`)
    DEBEN usar una URL del banco, eligiendo imágenes acordes al tema y redactando las oraciones
    según la descripción de cada una.
    """
    system = _WORKSHEET_SYSTEM
    if printable:
        system += _PRINTABLE_MODE
    if image_bank:
        system += _image_bank_section(image_bank)
    raw, provider = _ai_call(system, prompt)
    return _clean_script(raw), provider


def _image_bank_section(image_bank: list[dict]) -> str:
    """La biblioteca de imágenes del profesor, en sección del system prompt.

    Los dos bloques del prompt (base y banco) se contradicen a propósito: la base dice "no puedes
    aportar imágenes", y esta sección dice "cuando hay banco, úsalas". Es el mismo patrón que
    `_PRINTABLE_MODE`, que sobreescribe el comportamiento por defecto.
    """
    lines = [
        "\n=== IMAGE BANK (real images the teacher's library provides — USE THEM) ===",
        "For image activities use ONLY a URL from this bank. Every URL is REAL and loads for the",
        "student, so `imagequestion`, `imagechoice` and `imagematching` can (and should) be used.",
        "Rules:",
        "- Pick the images whose description/tags match the sheet topic. Never use the same image",
        "  twice in one sheet.",
        "- You only know each picture through its `description`: write the sentences, questions and",
        "  options to match WHAT THE DESCRIPTION SAYS. Do not describe things the description does",
        "  not mention.",
        "- `name` is a short label, `description` says what is in the picture, `tags` are search",
        "  words and `level` is the suggested language level of the image.",
    ]
    for img in image_bank:
        tags = ", ".join(img.get("tags") or [])
        lines.append(
            f"- [{img.get('id', '?')}] {img.get('name', '?')} (level {img.get('level', '?')}): "
            f"{img.get('description', '?')} — tags: {tags} — URL: {img.get('url', '')}"
        )
    return "\n".join(lines)


def edit_worksheet_script(current_script: str, instruction: str) -> tuple[str, str]:
    """Modifica una hoja existente según la instrucción (agregar/quitar/cambiar actividades).
    Devuelve (script_modificado, etiqueta_del_proveedor)."""
    user = (
        "Esta es la hoja de trabajo actual (WorksheetScript):\n\n"
        f"{current_script}\n\n"
        f"Aplica este cambio pedido por el profesor: {instruction}\n\n"
        "Devuelve la hoja COMPLETA modificada como un WorksheetScript válido (worksheet {...}). "
        "Conserva todo lo que no se pidió cambiar. No expliques nada, solo el script."
    )
    raw, provider = _ai_call(_WORKSHEET_SYSTEM, user)
    return _clean_script(raw), provider


# ── Revisión de una hoja (opcional, la pide el profesor) ───────────────────────
_REVIEW_SYSTEM = """Eres un ESTUDIANTE de inglés al que le acaban de dar esta hoja de trabajo.
No conoces las respuestas: solo ves lo que está escrito. RESUÉLVELA de verdad, actividad por
actividad, y anota dónde te trabaste. Después compara tus respuestas con el campo `answer` de cada
actividad (ese campo el alumno NO lo ve, tú sí porque estás revisando).

*** PROHIBIDO REPORTAR (la plataforma ya lo resuelve; si lo escribes, el informe no sirve) ***
- Que "falta dónde responder", "falta una caja de texto", "falta un `textbox`" o "no se sabe cómo
  responde el alumno". CADA tipo trae su propio campo de respuesta: cada pregunta de `reading` tiene
  su caja de texto, `truefalse` sus botones, `multiplechoice` sus casillas, `dragdrop` sus fichas.
  El script NO declara la interfaz y no tiene por qué hacerlo.
- Que un tipo "está mal clasificado" o "debería ser otro tipo".
- Cualquier comentario sobre diseño, espacio, líneas, columnas o maquetado.
Si tu única observación es una de estas, di que la hoja está lista.

Reporta SOLO problemas reales. Céntrate en:
1. Actividades IMPOSIBLES de resolver: falta información, la respuesta no se deduce de lo que se ve,
   la imagen o el audio no está o no aporta lo necesario.
2. Respuestas AMBIGUAS: más de una opción es correcta, o la tuya es tan válida como la del `answer`.
3. `answer` EQUIVOCADO o que no encaja con lo que se pregunta.
4. Instrucciones confusas, ausentes o que no dicen QUÉ hacer (marcar, escribir, unir, circular).
5. Respuestas FILTRADAS en el texto que lee el alumno.
6. Nivel incoherente: vocabulario o gramática muy por encima o por debajo del resto de la hoja.

Formato de salida (español, en Markdown, sin preámbulo):
- Una línea `**Veredicto:** …` con una frase: lista para usar / con detalles menores / tiene errores.
- Después una viñeta por problema: `- **[título de la actividad o su tipo]** — qué falla y cómo
  arreglarlo en una frase.`
- Si NO encuentras nada, escribe solo el veredicto y `- Sin problemas: resolví todas las
  actividades y las respuestas coinciden.`
No reescribas la hoja ni devuelvas el script. No felicites ni resumas el contenido."""

_REVIEW_ON_SCREEN = """

=== ESTA HOJA SE RESUELVE EN PANTALLA ===
El alumno la hace en la plataforma, NO en papel. El audio existe: los tipos `listening*` y
`conversation` se leen en voz alta con voz sintética (TTS) a partir del texto del script, así que son
perfectamente resolubles: el `text` de `listening` y el `audio_text` de los demás NO se muestran en
pantalla, solo suenan, así que el alumno escucha y no lee. `dragdrop` arrastra fichas, `matching` une con clics y las imágenes
(`imagequestion`, `imagechoice`, `imagematching`) se muestran desde su URL. NO reportes nada de
esto como problema: solo revisa el CONTENIDO.
El DESORDEN también es automático: en `listeningorder` el alumno ve las palabras de `answer`
barajadas como fichas (el campo `bank` es opcional), y las `options` y la columna derecha de
`matching` se muestran mezcladas. Nunca digas que "falta la lista desordenada" ni que "el orden
correcto está a la vista": el script guarda el orden correcto, el alumno no lo ve."""

_REVIEW_ON_PAPER = """

=== ESTA HOJA SE VA A IMPRIMIR ===
La hace con lápiz sobre papel. Reporta lo que en papel no se puede hacer: actividades que dependen
de audio (`listening*`, `conversation`) o de hablar (`speaking`), y cualquier "haz clic" o
"escucha" en el texto.
`dragdrop` SÍ funciona en papel y no debes reportarlo: su `bank` se imprime como banco de palabras
y el alumno escribe la que toca en la línea.
El MAQUETADO de la impresión es automático, NO lo reportes: cada `_____` se imprime como una línea
para escribir, `textbox` se imprime con renglones, `matching` en dos columnas para unir y las
opciones con su casilla. Nunca digas que "falta espacio para escribir" ni que "hay que añadir
líneas o columnas": eso ya lo hace la plataforma. Reporta el CONTENIDO, no el diseño."""


# Quejas de INTERFAZ que el prompt ya prohíbe pero que gemini-flash-lite sigue colando: "falta una
# caja de texto para responder", "el tipo está mal clasificado". Son siempre falsas — cada tipo trae
# su campo de respuesta — y desconfían al profesor de un informe que en lo demás acierta.
_UI_COMPLAINT = re.compile(
    r"(caja[s]? de texto|campo[s]? de respuesta|d[oó]nde responder|"
    r"a[ñn]adir un `?textbox|mal clasificad|deber[íi]a ser (?:otro|de otro) tipo|"
    r"mecanismo de (?:verificaci[oó]n|validaci[oó]n))",
    re.IGNORECASE,
)
_VERDICT_OK = "**Veredicto:** lista para usar\n- Sin problemas: resolví todas las actividades y las respuestas coinciden."


def _strip_ui_complaints(report: str) -> str:
    """Borra del informe las viñetas que solo se quejan de la interfaz.

    Una viñeta va de un `- ` hasta el siguiente: el modelo parte las frases largas en varias líneas.
    Si al filtrar no queda ninguna, el veredicto se reescribe: dejar "tiene errores" sin errores
    debajo es peor que no filtrar.
    """
    lines = report.splitlines()
    head = [ln for ln in lines if not ln.lstrip().startswith("- ")]
    bullets: list[list[str]] = []
    for line in lines:
        if line.lstrip().startswith("- "):
            bullets.append([line])
        elif bullets and line.strip() and not line.lstrip().startswith("**"):
            bullets[-1].append(line)  # continuación de la viñeta anterior
    kept = ["\n".join(b) for b in bullets if not _UI_COMPLAINT.search(" ".join(b))]
    if not kept:
        return _VERDICT_OK
    verdict = next((ln for ln in head if "Veredicto" in ln), "**Veredicto:** con detalles menores")
    return "\n".join([verdict, "", *kept])


def review_worksheet_script(script: str, printable: bool = False) -> tuple[str, str]:
    """Devuelve (informe_markdown, etiqueta_del_proveedor).

    La IA resuelve la hoja como alumno para detectar lo que solo se ve al hacerla: respuestas
    ambiguas, `answer` equivocado, instrucciones que no dicen qué hacer. Es OPCIONAL y no modifica
    nada: es un informe que el profesor lee y decide.
    """
    system = _REVIEW_SYSTEM + (_REVIEW_ON_PAPER if printable else _REVIEW_ON_SCREEN)
    user = f"Hoja de trabajo a revisar (WorksheetScript):\n\n{script}\n\nResuélvela y reporta los problemas."
    report, provider = _ai_call(system, user)
    return _strip_ui_complaints(report), provider


# ── AI grading ─────────────────────────────────────────────────────────────────
def ai_grade_activities(details: list[Any], worksheet_title: str, tolerance: int = 50, notes: dict[str, str] | None = None) -> list[Any]:
    """
    Grade all activity details using AI.
    `tolerance` (0–100) es la barra de tolerancia a errores de forma de la hoja.
    `notes` es {activity_id: note}: la nota privada que el profesor escribió para guiar la
    calificación (ADR-19). No viaja en los AnswerDetail porque esos sí se le devuelven al alumno.
    Returns the same list with updated status and teacher_comment fields.
    Silently returns unmodified details if AI call fails.
    """
    if not details:
        return details

    # Solo enviar a la IA lo que requiere juicio: respuestas incorrectas (posible typo) o pendientes.
    # Las correctas automáticas no se envían → ahorra tokens y no genera comentarios innecesarios.
    to_grade = [d for d in details if d.status in {"incorrect", "pending"}]
    if not to_grade:
        return details

    activities_payload = []
    for d in to_grade:
        item = {
            "id": d.activity_id,
            "type": d.activity_type,
            "prompt": d.prompt,
            "correct_answer": _serialize(d.correct_answer),
            "student_answer": _serialize(d.student_answer),
            "auto_status": d.status,
        }
        # Contexto (texto de lectura / diálogo / audio) para juzgar bien respuestas que dependen de él.
        if getattr(d, "context", None):
            item["context"] = d.context
        # Nota privada del profesor. Los detalles derivados llevan id "actividad:índice" (reading,
        # matching, true/false): la nota es de la actividad entera, así que se busca por su raíz.
        note = (notes or {}).get(str(d.activity_id).split(":", 1)[0])
        if note:
            item["teacher_note"] = note
        activities_payload.append(item)

    user_prompt = (
        f'Worksheet: "{worksheet_title}"\n\n'
        f"Activities to grade:\n{json.dumps(activities_payload, ensure_ascii=False, indent=2)}"
    )

    try:
        raw, provider = _ai_call(_grade_system(tolerance), user_prompt, prefer_fast=True)
        raw = raw.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed: dict = json.loads(raw)
        grades: list[dict] = parsed.get("grades", [])
    except Exception:
        return details

    grades_by_id = {g["id"]: g for g in grades}
    for d in details:
        grade = grades_by_id.get(d.activity_id)
        if not grade:
            continue
        d.graded_by = provider  # qué IA/modelo calificó (lo ve solo el profesor)
        original_status = d.status
        ai_status = grade.get("status", d.status)
        # La IA solo puede rescatar donde el auto-corrector puede equivocarse (_AI_RESCUABLE):
        # texto libre comparado por igualdad exacta, y `matching`, cuya clave por índice no es la
        # única combinación válida. Nunca toca lo elegido de una lista cerrada (opciones,
        # true/false, order): ahí el exacto ya es la verdad.
        if d.status == "incorrect" and d.activity_type in _AI_RESCUABLE:
            if ai_status == "correct":
                d.status = "correct"
        elif d.status == "pending":
            if ai_status in {"correct", "incorrect", "partial"}:
                d.status = "correct" if ai_status == "correct" else "incorrect"
        # Comentario: siempre en las incorrectas/parciales; en las correctas SOLO si era
        # una respuesta abierta (originalmente "pending"). Un fillblank que se corrige por
        # typo no lleva comentario.
        if d.status != "correct" or original_status == "pending":
            d.teacher_comment = grade.get("comment", "")
        else:
            d.teacher_comment = ""

    return details


_SUMMARY_SYSTEM = """Eres un asistente pedagógico. Recibes estadísticas de una hoja de trabajo de inglés
(por actividad: cuántos acertaron/fallaron y ejemplos de respuestas incorrectas). Escribe un
resumen BREVE y útil para el profesor, en español, con EXACTAMENTE estas tres secciones y sin
markdown de encabezados (usa los títulos tal cual, en mayúsculas, seguidos de viñetas con "- "):

ERRORES COMUNES
- (2-4 viñetas con los patrones de error más frecuentes; cita el tema, no al alumno)

CONCEPTOS A REFORZAR
- (2-3 viñetas con la gramática/vocabulario a repasar)

RECOMENDACIONES
- (2-3 viñetas con acciones concretas para la próxima clase)

Sé concreto y conciso. Si casi todo está correcto, dilo y felicita brevemente."""


def summarize_worksheet_performance(worksheet_title: str, activities: list[dict]) -> str:
    """Genera un resumen de desempeño de una hoja a partir de estadísticas por actividad."""
    if not activities:
        return ""
    user_prompt = (
        f'Hoja: "{worksheet_title}"\n\n'
        f"Estadísticas por actividad:\n{json.dumps(activities, ensure_ascii=False, indent=2)}"
    )
    try:
        text, _ = _ai_call(_SUMMARY_SYSTEM, user_prompt, prefer_fast=True)
        return text.strip()
    except Exception:
        return ""


_VOCAB_SYSTEM = """You generate English vocabulary lists for Spanish-speaking students.

Output ONLY CSV. No markdown, no fences, no explanation, no header row.
One word per line, exactly these 8 columns:

block,english,spanish,type,v_past,v_participle,v_ing,v_3rd

- block: short thematic group name in English (e.g. "Kitchen Verbs"). Group the list
  into 2-4 blocks; words of the same block go together.
- english: the word or phrase (lowercase unless a proper noun).
- spanish: the translation (lowercase). If it needs a clarifier, use parentheses.
- type: EXACTLY one of: verb, noun, adjective, adverb, connector, linking word,
  preposition, phrase, other.
- v_past, v_participle, v_ing, v_3rd: ONLY for type=verb (went,gone,going,goes).
  For any other type leave the four columns EMPTY (trailing commas still required).

Rules:
- No commas inside a field (they break the CSV). Use "or" or a shorter translation.
- No duplicates. Match the requested level (A1 = everyday concrete words, C1 = abstract
  and idiomatic). Respect the requested amount of words exactly."""


def generate_vocabulary_csv(prompt: str) -> tuple[str, str]:
    """Prompt en lenguaje natural → CSV de vocabulario. Devuelve (csv, proveedor)."""
    raw, provider = _ai_call(_VOCAB_SYSTEM, prompt)
    raw = raw.strip()
    if raw.startswith("```"):  # a veces el modelo envuelve en fences pese al prompt
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return raw.strip(), provider


def transcribe_audio(audio: bytes, filename: str, content_type: str) -> str:
    """Transcribe audio a texto con Groq Whisper. Lanza si no hay clave o falla."""
    key = os.getenv("GROQ_API_KEY", "")
    if not key:
        raise RuntimeError("GROQ_API_KEY not set")
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            with httpx.Client(timeout=60) as client:
                resp = client.post(
                    _GROQ_TRANSCRIBE_URL,
                    headers={"Authorization": f"Bearer {key}"},
                    files={"file": (filename, audio, content_type or "audio/webm")},
                    data={"model": _WHISPER_MODEL, "language": "en", "response_format": "json"},
                )
                resp.raise_for_status()
                return str(resp.json().get("text", "")).strip()
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                time.sleep(1.0)
    raise last_error or RuntimeError("transcription failed")


def _serialize(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [_serialize(v) for v in value]
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    return str(value)
