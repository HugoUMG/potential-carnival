/**
 * Serializa el estado del constructor visual a DSL WorksheetScript.
 * Soporta todos los tipos de actividad del sistema.
 */

import type { WorksheetActivity } from '../types';

export interface VisualStatement {
  id: string;
  text: string;
  answer: boolean;
}

export interface VisualPair {
  id: string;
  audioText: string;
  match: string;
}

export interface VisualLine {
  id: string;
  speaker: 'male' | 'female';
  text: string;
}

export type VisualActivityType =
  | 'fillblank' | 'multiplechoice' | 'multiselect' | 'dragdrop' | 'matching' | 'textbox' | 'truefalse'
  | 'listening' | 'listeningfillblank' | 'listeningmultiplechoice'
  | 'listeningmatching' | 'listeningtruefalse' | 'listeningorder' | 'conversation'
  | 'reading' | 'readingtruefalse' | 'imagequestion' | 'imagechoice' | 'imagematching' | 'speaking' | 'content';

export interface VisualActivity {
  id: string;
  type: VisualActivityType;
  instructions: string;
  /** Nota privada para la IA calificadora. El alumno nunca la ve (el backend la borra del payload). */
  note: string;
  // fillblank / dragdrop / listeningfillblank
  text: string;
  answer: string;
  // dragdrop
  bank: string[];
  // multiplechoice / listeningmultiplechoice
  question: string;
  options: string[];
  correctOption: string;
  // multiselect (varias correctas)
  correctOptions: string[];
  // matching
  left: string[];
  right: string[];
  // textbox / speaking
  prompt: string;
  // speaking (leer en voz alta; opcional)
  target: string;
  // truefalse / listeningtruefalse / readingtruefalse
  statements: VisualStatement[];
  // listening* / listeningfillblank / listeningmultiplechoice / listeningtruefalse
  audioText: string;
  voice: string; // 'male' | 'female' | ''(preferencia global); solo listening

  // listeningmatching
  pairs: VisualPair[];
  // conversation
  lines: VisualLine[];
  // content (repaso HTML)
  html: string;
  sandbox: boolean; // content: true → iframe aislado (HTML+CSS+JS completo)
  // reading / readingtruefalse
  readingTitle: string;
  readingContent: string;
  readingQuestions: string[];
  // imagequestion / imagechoice (imagen de enunciado)
  imageUrl: string;
  // imagechoice: URL por opción, PARALELA a options ('' = esa opción va como texto)
  optionImages: string[];
  // imagematching: URL por fila, PARALELA a left
  leftImages: string[];
}

export interface VisualBlock {
  id: string;
  title: string;
  instructions: string;
  // Estímulo compartido del bloque: un solo texto/audio arriba y N actividades debajo.
  text: string; // lectura visible
  audioText: string; // audio TTS oculto (excluyente con `lines`)
  voice: '' | 'male' | 'female';
  lines: VisualLine[]; // conversación a dos voces (excluyente con `audioText`)
  activities: VisualActivity[];
}

export interface VisualTheme {
  primary_color: string;
  background_color: string;
  text_color: string;
}

export interface VisualState {
  title: string;
  description: string;
  theme: VisualTheme;
  infoFields: string[]; // campos de identificación (info {}) a nivel de hoja: Nombre, Fecha…
  blocks: VisualBlock[];
}

function esc(s: string): string {
  // ponytail: solo las comillas, y a tipográficas. Escapar el backslash rompía dos cosas:
  //  · los saltos de línea (`\n` → `\\n`) dejaban un backslash suelto a la vista del alumno
  //  · el parser solo quita las comillas EXTERIORES, así que las \" quedaban literales
  // El DSL no tiene otros escapes, así que no hay nada más que proteger.
  return s.replace(/"/g, '”');
}

function serializeActivity(act: VisualActivity, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}${act.type} {`);

  if (act.instructions.trim()) {
    lines.push(`${indent}  instructions: "${esc(act.instructions)}"`);
  }
  if (act.note?.trim()) {
    // Una sola línea: el backend la borra del script del alumno buscando la línea `note:`.
    lines.push(`${indent}  note: "${esc(act.note.replace(/\n/g, ' '))}"`);
  }

  if (act.type === 'fillblank') {
    if (act.text.trim()) lines.push(`${indent}  text: "${esc(act.text)}"`);
    const answers = act.answer.split(',').map((a) => a.trim()).filter(Boolean);
    if (answers.length > 1) {
      lines.push(`${indent}  answer:`);
      answers.forEach((a) => lines.push(`${indent}  - ${a}`));
    } else if (answers.length === 1) {
      lines.push(`${indent}  answer: "${esc(answers[0])}"`);
    }

  } else if (act.type === 'multiplechoice') {
    if (act.question.trim()) lines.push(`${indent}  question: "${esc(act.question)}"`);
    const validOpts = act.options.filter((o) => o.trim());
    if (validOpts.length > 0) {
      lines.push(`${indent}  options:`);
      validOpts.forEach((o) => lines.push(`${indent}  - ${o}`));
    }
    if (act.correctOption.trim()) lines.push(`${indent}  answer: "${esc(act.correctOption)}"`);

  } else if (act.type === 'multiselect') {
    if (act.question.trim()) lines.push(`${indent}  question: "${esc(act.question)}"`);
    const validOpts = act.options.filter((o) => o.trim());
    if (validOpts.length > 0) {
      lines.push(`${indent}  options:`);
      validOpts.forEach((o) => lines.push(`${indent}  - ${o}`));
    }
    const correct = act.correctOptions.filter((o) => o.trim());
    if (correct.length > 0) {
      lines.push(`${indent}  answer:`);
      correct.forEach((o) => lines.push(`${indent}  - ${o}`));
    }

  } else if (act.type === 'dragdrop') {
    if (act.text.trim()) lines.push(`${indent}  text: "${esc(act.text)}"`);
    const answers = act.answer.split(',').map((a) => a.trim()).filter(Boolean);
    if (answers.length > 0) {
      lines.push(`${indent}  answer:`);
      answers.forEach((a) => lines.push(`${indent}  - ${a}`));
    }
    const bank = act.bank.filter((b) => b.trim());
    if (bank.length > 0) {
      lines.push(`${indent}  bank:`);
      bank.forEach((b) => lines.push(`${indent}  - ${b}`));
    }

  } else if (act.type === 'matching') {
    const validLeft = act.left.filter((l) => l.trim());
    const validRight = act.right.filter((r) => r.trim());
    if (validLeft.length > 0) {
      lines.push(`${indent}  left:`);
      validLeft.forEach((l) => lines.push(`${indent}  - ${l}`));
    }
    if (validRight.length > 0) {
      lines.push(`${indent}  right:`);
      validRight.forEach((r) => lines.push(`${indent}  - ${r}`));
    }

  } else if (act.type === 'textbox') {
    if (act.prompt.trim()) lines.push(`${indent}  prompt: "${esc(act.prompt)}"`);

  } else if (act.type === 'truefalse') {
    const validStmts = act.statements.filter((s) => s.text.trim());
    if (validStmts.length > 0) {
      lines.push(`${indent}  statements:`);
      validStmts.forEach((s) => {
        lines.push(`${indent}  - ${esc(s.text)} | ${s.answer ? 'true' : 'false'}`);
      });
    }

  } else if (act.type === 'listening') {
    if (act.audioText.trim()) lines.push(`${indent}  text: "${esc(act.audioText)}"`);
    if (act.question.trim()) lines.push(`${indent}  question: "${esc(act.question)}"`);
    if (act.answer.trim()) lines.push(`${indent}  answer: "${esc(act.answer)}"`);

  } else if (act.type === 'listeningfillblank') {
    if (act.audioText.trim()) lines.push(`${indent}  audio_text: "${esc(act.audioText)}"`);
    if (act.text.trim()) lines.push(`${indent}  text: "${esc(act.text)}"`);
    const answers = act.answer.split(',').map((a) => a.trim()).filter(Boolean);
    if (answers.length > 1) {
      lines.push(`${indent}  answer:`);
      answers.forEach((a) => lines.push(`${indent}  - ${a}`));
    } else if (answers.length === 1) {
      lines.push(`${indent}  answer: "${esc(answers[0])}"`);
    }

  } else if (act.type === 'listeningmultiplechoice') {
    if (act.audioText.trim()) lines.push(`${indent}  audio_text: "${esc(act.audioText)}"`);
    if (act.question.trim()) lines.push(`${indent}  question: "${esc(act.question)}"`);
    const validOpts = act.options.filter((o) => o.trim());
    if (validOpts.length > 0) {
      lines.push(`${indent}  options:`);
      validOpts.forEach((o) => lines.push(`${indent}  - ${o}`));
    }
    if (act.correctOption.trim()) lines.push(`${indent}  answer: "${esc(act.correctOption)}"`);

  } else if (act.type === 'listeningmatching') {
    const validPairs = act.pairs.filter((p) => p.audioText.trim() || p.match.trim());
    if (validPairs.length > 0) {
      lines.push(`${indent}  pairs:`);
      validPairs.forEach((p) => {
        lines.push(`${indent}  - audio_text: "${esc(p.audioText)}"`);
        lines.push(`${indent}    match: "${esc(p.match)}"`);
      });
    }
    const validOpts = act.options.filter((o) => o.trim());
    if (validOpts.length > 0) {
      lines.push(`${indent}  options:`);
      validOpts.forEach((o) => lines.push(`${indent}  - ${o}`));
    }

  } else if (act.type === 'listeningtruefalse') {
    if (act.audioText.trim()) lines.push(`${indent}  audio_text: "${esc(act.audioText)}"`);
    const validStmts = act.statements.filter((s) => s.text.trim());
    if (validStmts.length > 0) {
      lines.push(`${indent}  statements:`);
      validStmts.forEach((s) => {
        lines.push(`${indent}  - ${esc(s.text)} | ${s.answer ? 'true' : 'false'}`);
      });
    }

  } else if (act.type === 'listeningorder') {
    if (act.audioText.trim()) lines.push(`${indent}  audio_text: "${esc(act.audioText)}"`);
    const answers = act.answer.split(',').map((a) => a.trim()).filter(Boolean);
    if (answers.length > 0) {
      lines.push(`${indent}  answer:`);
      answers.forEach((a) => lines.push(`${indent}  - ${a}`));
    }
    const bank = act.bank.filter((b) => b.trim());
    if (bank.length > 0) {
      lines.push(`${indent}  bank:`);
      bank.forEach((b) => lines.push(`${indent}  - ${b}`));
    }

  } else if (act.type === 'conversation') {
    const validLines = act.lines.filter((l) => l.text.trim());
    if (validLines.length > 0) {
      lines.push(`${indent}  lines:`);
      validLines.forEach((l) => lines.push(`${indent}  - ${l.speaker === 'female' ? 'f' : 'm'}: "${esc(l.text)}"`));
    }
    if (act.question.trim()) lines.push(`${indent}  question: "${esc(act.question)}"`);
    if (act.answer.trim()) lines.push(`${indent}  answer: "${esc(act.answer)}"`);

  } else if (act.type === 'content') {
    if (act.readingTitle.trim()) lines.push(`${indent}  title: "${esc(act.readingTitle)}"`);
    if (act.sandbox) lines.push(`${indent}  sandbox: true`);
    if (act.html.trim()) {
      // HTML multilínea con triple comilla; el parser lo captura literal (ignora sus llaves).
      lines.push(`${indent}  html: """`);
      lines.push(act.html);
      lines.push(`${indent}  """`);
    }

  } else if (act.type === 'reading') {
    if (act.readingTitle.trim()) lines.push(`${indent}  title: "${esc(act.readingTitle)}"`);
    if (act.readingContent.trim()) {
      lines.push(`${indent}  content: "${esc(act.readingContent.replace(/\n/g, '\\n'))}"`);
    }
    const validQs = act.readingQuestions.filter((q) => q.trim());
    if (validQs.length > 0) {
      lines.push(`${indent}  questions:`);
      validQs.forEach((q) => lines.push(`${indent}  - ${q}`));
    }

  } else if (act.type === 'readingtruefalse') {
    if (act.readingTitle.trim()) lines.push(`${indent}  title: "${esc(act.readingTitle)}"`);
    if (act.readingContent.trim()) {
      lines.push(`${indent}  content: "${esc(act.readingContent.replace(/\n/g, '\\n'))}"`);
    }
    const validStmts = act.statements.filter((s) => s.text.trim());
    if (validStmts.length > 0) {
      lines.push(`${indent}  statements:`);
      validStmts.forEach((s) => {
        lines.push(`${indent}  - ${esc(s.text)} | ${s.answer ? 'true' : 'false'}`);
      });
    }

  } else if (act.type === 'imagequestion') {
    if (act.imageUrl.trim()) lines.push(`${indent}  image: "${esc(act.imageUrl)}"`);
    if (act.prompt.trim()) lines.push(`${indent}  prompt: "${esc(act.prompt)}"`);

  } else if (act.type === 'imagechoice') {
    if (act.imageUrl.trim()) lines.push(`${indent}  image: "${esc(act.imageUrl)}"`);
    if (act.question.trim()) lines.push(`${indent}  question: "${esc(act.question)}"`);
    const validOpts = act.options.filter((o) => o.trim());
    if (validOpts.length > 0) {
      lines.push(`${indent}  options:`);
      validOpts.forEach((o) => lines.push(`${indent}  - ${o}`));
    }
    // Lista PARALELA a options: se recorta al último hueco con imagen y los huecos van como ""
    // (el parser exige algo después del guion; "" se lee como cadena vacía = esa opción es texto).
    const optImages = act.options.map((o, i) => (o.trim() ? (act.optionImages[i] ?? '') : '')).filter((_, i) => act.options[i]?.trim());
    const lastImage = optImages.reduce((last, u, i) => (u.trim() ? i : last), -1);
    if (lastImage >= 0) {
      lines.push(`${indent}  option_images:`);
      optImages.slice(0, lastImage + 1).forEach((u) => lines.push(`${indent}  - ${u.trim() ? u : '""'}`));
    }
    if (act.correctOption.trim()) lines.push(`${indent}  answer: "${esc(act.correctOption)}"`);

  } else if (act.type === 'imagematching') {
    const rows = act.leftImages.map((url, i) => ({ url, word: act.right[i] ?? '', label: act.left[i] ?? `Image ${i + 1}` }))
      .filter((r) => r.url.trim() || r.word.trim());
    if (rows.length > 0) {
      lines.push(`${indent}  left_images:`);
      rows.forEach((r) => lines.push(`${indent}  - ${r.url.trim() ? r.url : '""'}`));
      lines.push(`${indent}  left:`);
      rows.forEach((r) => lines.push(`${indent}  - ${r.label}`));
      lines.push(`${indent}  right:`);
      rows.forEach((r) => lines.push(`${indent}  - ${r.word}`));
    }

  } else if (act.type === 'speaking') {
    if (act.prompt.trim()) lines.push(`${indent}  prompt: "${esc(act.prompt)}"`);
    if (act.target.trim()) lines.push(`${indent}  target: "${esc(act.target)}"`);
  }

  // voz por actividad (solo listening): 'male'/'female' o nombre edge-tts literal
  if (act.type.startsWith('listening') && act.voice?.trim()) {
    lines.push(`${indent}  voice: ${act.voice.trim()}`);
  }

  lines.push(`${indent}}`);
  return lines;
}

function serializeBlock(block: VisualBlock, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}block {`);
  if (block.title.trim()) lines.push(`${indent}  title: "${esc(block.title)}"`);
  if (block.instructions.trim()) lines.push(`${indent}  instructions: "${esc(block.instructions)}"`);
  // Estímulo compartido. Va ANTES de las actividades a propósito: el parser solo lee los campos
  // del bloque hasta la primera actividad (`_block_header`), para no robarle el `title:` a un
  // `reading {}` hijo ni el `audio_text:` a un `listening*`.
  if (block.text.trim()) lines.push(`${indent}  text: "${esc(block.text.replace(/\n/g, '\\n'))}"`);
  const blockLines = block.lines?.filter((l) => l.text.trim()) ?? [];
  if (blockLines.length > 0) {
    lines.push(`${indent}  lines:`);
    blockLines.forEach((l) => lines.push(`${indent}  - ${l.speaker === 'female' ? 'f' : 'm'}: "${esc(l.text)}"`));
  } else if (block.audioText.trim()) {
    lines.push(`${indent}  audio_text: "${esc(block.audioText)}"`);
    if (block.voice) lines.push(`${indent}  voice: ${block.voice}`);
  }
  for (const act of block.activities) {
    lines.push(...serializeActivity(act, `${indent}  `));
  }
  lines.push(`${indent}}`);
  return lines;
}

export function serializeToScript(state: VisualState): string {
  const lines: string[] = ['worksheet {'];
  lines.push(`  title: "${esc(state.title)}"`);
  if (state.description.trim()) {
    lines.push(`  description: "${esc(state.description.replace(/\n/g, '\\n'))}"`);
  }
  const t = state.theme;
  if (t && (t.primary_color.trim() || t.background_color.trim() || t.text_color.trim())) {
    lines.push('  theme {');
    if (t.primary_color.trim()) lines.push(`    primary_color: "${esc(t.primary_color)}"`);
    if (t.background_color.trim()) lines.push(`    background_color: "${esc(t.background_color)}"`);
    if (t.text_color.trim()) lines.push(`    text_color: "${esc(t.text_color)}"`);
    lines.push('  }');
  }
  const infoFields = state.infoFields?.filter((f) => f.trim()) ?? [];
  if (infoFields.length > 0) {
    lines.push('  info {');
    lines.push('    fields:');
    infoFields.forEach((f) => lines.push(`    - ${f.trim()}`));
    lines.push('  }');
  }
  for (const block of state.blocks) {
    lines.push(...serializeBlock(block, '  '));
  }
  lines.push('}');
  return lines.join('\n');
}

/** Lista separada por comas → array, que es como el constructor guarda varias respuestas. */
function csv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * `VisualActivity` → `WorksheetActivity`: deja que el constructor pinte la actividad con el MISMO
 * componente que ve el alumno (`activityRegistry`) en vez de una imitación que se desincroniza.
 *
 * Es el espejo exacto de `serializeActivity` de este mismo archivo: los dos traducen los campos
 * planos del constructor a la forma real de cada tipo. Si añades un campo a un tipo y solo tocas
 * uno de los dos, la tarjeta del profesor mentirá sobre lo que verá el alumno — no falla, miente.
 */
export function toWorksheetActivity(act: VisualActivity): WorksheetActivity {
  const base = {
    id: act.id,
    ...(act.instructions.trim() ? { instructions: act.instructions } : {}),
    ...(act.note?.trim() ? { note: act.note } : {}),
    ...(act.voice.trim() ? { voice: act.voice } : {}),
  };
  const statements = act.statements.filter((s) => s.text.trim()).map((s) => ({ text: s.text, answer: s.answer }));
  const options = act.options.filter((o) => o.trim());

  switch (act.type) {
    case 'fillblank': {
      const answers = csv(act.answer);
      return { ...base, type: 'fillblank', text: act.text, answer: answers.length > 1 ? answers : (answers[0] ?? '') };
    }
    case 'multiplechoice':
      return { ...base, type: 'multiplechoice', question: act.question, options, answer: act.correctOption };
    case 'multiselect':
      return { ...base, type: 'multiselect', question: act.question, options, answer: act.correctOptions.filter((o) => o.trim()) };
    case 'dragdrop':
      return { ...base, type: 'dragdrop', text: act.text, answer: csv(act.answer), bank: act.bank.filter((b) => b.trim()) };
    case 'matching':
      return { ...base, type: 'matching', left: act.left.filter((l) => l.trim()), right: act.right.filter((r) => r.trim()) };
    case 'textbox':
      return { ...base, type: 'textbox', prompt: act.prompt };
    case 'truefalse':
      return { ...base, type: 'truefalse', statements };
    case 'listening':
      return { ...base, type: 'listening', text: act.audioText, question: act.question, answer: act.answer };
    case 'listeningfillblank': {
      const answers = csv(act.answer);
      return { ...base, type: 'listeningfillblank', audio_text: act.audioText, text: act.text, answer: answers.length > 1 ? answers : (answers[0] ?? '') };
    }
    case 'listeningmultiplechoice':
      return { ...base, type: 'listeningmultiplechoice', audio_text: act.audioText, question: act.question, options, answer: act.correctOption };
    case 'listeningmatching':
      return {
        ...base, type: 'listeningmatching', options,
        pairs: act.pairs.filter((p) => p.audioText.trim() || p.match.trim()).map((p) => ({ audio_text: p.audioText, match: p.match })),
      };
    case 'listeningtruefalse':
      return { ...base, type: 'listeningtruefalse', audio_text: act.audioText, statements };
    case 'listeningorder':
      return { ...base, type: 'listeningorder', audio_text: act.audioText, answer: csv(act.answer), bank: act.bank.filter((b) => b.trim()) };
    case 'conversation':
      return {
        ...base, type: 'conversation', question: act.question, answer: act.answer,
        lines: act.lines.filter((l) => l.text.trim()).map((l) => ({ speaker: l.speaker, text: l.text })),
      };
    case 'content':
      return { ...base, type: 'content', title: act.readingTitle, html: act.html, sandbox: act.sandbox };
    case 'reading':
      return { ...base, type: 'reading', title: act.readingTitle, content: act.readingContent, questions: act.readingQuestions.filter((q) => q.trim()) };
    case 'readingtruefalse':
      return { ...base, type: 'readingtruefalse', title: act.readingTitle, content: act.readingContent, statements };
    case 'imagequestion':
      return { ...base, type: 'imagequestion', image: act.imageUrl, prompt: act.prompt };
    case 'imagechoice':
      return {
        ...base, type: 'imagechoice', image: act.imageUrl || undefined, question: act.question, options,
        option_images: act.options.map((o, i) => (o.trim() ? (act.optionImages[i] ?? '') : '')).filter((_, i) => act.options[i]?.trim()),
        answer: act.correctOption,
      };
    case 'imagematching': {
      // Solo las filas que ya tienen algo; las tres listas se recortan a la vez para no descuadrar.
      const rows = act.leftImages.map((url, i) => ({ url, word: act.right[i] ?? '', label: act.left[i] ?? `Image ${i + 1}` }))
        .filter((r) => r.url.trim() || r.word.trim());
      return { ...base, type: 'imagematching', left: rows.map((r) => r.label), left_images: rows.map((r) => r.url), right: rows.map((r) => r.word) };
    }
    case 'speaking':
      return { ...base, type: 'speaking', prompt: act.prompt, target: act.target };
  }
}

const BASE_ACTIVITY: Omit<VisualActivity, 'id' | 'type'> = {
  instructions: '',
  note: '',
  text: '',
  answer: '',
  bank: [],
  question: '',
  options: ['Option A', 'Option B', 'Option C'],
  correctOption: 'Option A',
  correctOptions: [],
  left: ['can', 'should', 'must'],
  right: ['Ability', 'Advice', 'Obligation'],
  prompt: '',
  target: '',
  statements: [],
  audioText: '',
  voice: '',
  pairs: [],
  lines: [],
  html: '',
  sandbox: false,
  readingTitle: '',
  readingContent: '',
  readingQuestions: [''],
  imageUrl: '',
  optionImages: [],
  leftImages: [],
};

export function emptyActivity(type: VisualActivityType): VisualActivity {
  const id = crypto.randomUUID();
  switch (type) {
    case 'fillblank':
      return { ...BASE_ACTIVITY, id, type, text: 'She _____ happy yesterday.', answer: 'was' };
    case 'multiplechoice':
      return { ...BASE_ACTIVITY, id, type, question: 'Choose the correct answer.', options: ['am', 'is', 'are'], correctOption: 'am' };
    case 'multiselect':
      return { ...BASE_ACTIVITY, id, type, question: 'Select ALL correct options.', options: ['runs', 'running', 'eats', 'eaten'], correctOptions: ['runs', 'eats'] };
    case 'dragdrop':
      return { ...BASE_ACTIVITY, id, type, text: 'She _____ to school and _____ English every day.', answer: 'goes, studies', bank: ['goes', 'go', 'studies', 'study'] };
    case 'matching':
      return { ...BASE_ACTIVITY, id, type };
    case 'textbox':
      return { ...BASE_ACTIVITY, id, type, prompt: 'Describe your house.' };
    case 'truefalse':
      return { ...BASE_ACTIVITY, id, type, statements: [
        { id: crypto.randomUUID(), text: 'Write a true statement here.', answer: true },
        { id: crypto.randomUUID(), text: 'Write a false statement here.', answer: false },
      ]};
    case 'listening':
      return { ...BASE_ACTIVITY, id, type, audioText: 'The meeting is on Monday at 9 AM.', question: 'When is the meeting?', answer: 'Monday at 9 AM' };
    case 'listeningfillblank':
      return { ...BASE_ACTIVITY, id, type, audioText: 'She goes to school every day.', text: 'She _____ to school every day.', answer: 'goes' };
    case 'listeningmultiplechoice':
      return { ...BASE_ACTIVITY, id, type, audioText: 'The store opens at 9 AM.', question: 'When does the store open?', options: ['8 AM', '9 AM', '10 AM'], correctOption: '9 AM' };
    case 'listeningmatching':
      return { ...BASE_ACTIVITY, id, type,
        pairs: [
          { id: crypto.randomUUID(), audioText: 'It might rain later.', match: 'Possibility' },
          { id: crypto.randomUUID(), audioText: 'You should rest more.', match: 'Advice' },
        ],
        options: ['Possibility', 'Advice'],
      };
    case 'listeningtruefalse':
      return { ...BASE_ACTIVITY, id, type, audioText: 'The store opens at 9 AM and closes at 6 PM.', statements: [
        { id: crypto.randomUUID(), text: 'The store opens at 9 AM.', answer: true },
        { id: crypto.randomUUID(), text: 'The store closes at 8 PM.', answer: false },
      ]};
    case 'listeningorder':
      return { ...BASE_ACTIVITY, id, type, audioText: 'She has never been to Paris.', answer: 'She, has, never, been, to, Paris', bank: ['Paris', 'She', 'to', 'has', 'been', 'never'] };
    case 'conversation':
      return { ...BASE_ACTIVITY, id, type, lines: [
        { id: crypto.randomUUID(), speaker: 'female', text: 'Hi, are you new here?' },
        { id: crypto.randomUUID(), speaker: 'male', text: 'Yes, I started today.' },
      ], question: 'Where did he start today?', answer: 'at school' };
    case 'content':
      return { ...BASE_ACTIVITY, id, type, readingTitle: 'Repaso', html: '<h1 style="color:#0EA5E9">Título</h1>\n<p>Escribe aquí un repaso corto del tema. Puedes usar <b>negrita</b>, colores y listas.</p>' };
    case 'reading':
      return { ...BASE_ACTIVITY, id, type, readingTitle: 'My School', readingContent: 'This is my school. It is big and beautiful.', readingQuestions: ['What is the text about?', 'Describe the school.'] };
    case 'readingtruefalse':
      return { ...BASE_ACTIVITY, id, type, readingTitle: 'The Water Cycle', readingContent: 'Water evaporates from oceans and rivers.', statements: [
        { id: crypto.randomUUID(), text: 'Water evaporates from oceans.', answer: true },
        { id: crypto.randomUUID(), text: 'Rain is created by wind alone.', answer: false },
      ]};
    case 'imagequestion':
      return { ...BASE_ACTIVITY, id, type, imageUrl: 'https://placehold.co/900x500', prompt: 'Describe what you see in the image.' };
    case 'imagechoice':
      return { ...BASE_ACTIVITY, id, type, question: 'Which one is the apple?', options: ['apple', 'banana', 'orange'], correctOption: 'apple', optionImages: ['', '', ''] };
    case 'imagematching':
      return { ...BASE_ACTIVITY, id, type, left: ['Image 1', 'Image 2'], leftImages: ['', ''], right: ['dog', 'cat'] };
    case 'speaking':
      return { ...BASE_ACTIVITY, id, type, prompt: 'Introduce yourself. Say your name and age.', target: '' };
    default:
      return { ...BASE_ACTIVITY, id, type };
  }
}

export function emptyBlock(): VisualBlock {
  return { id: crypto.randomUUID(), title: '', instructions: '', text: '', audioText: '', voice: '', lines: [], activities: [] };
}

export function emptyState(): VisualState {
  return { title: '', description: '', theme: { primary_color: '', background_color: '', text_color: '' }, infoFields: [], blocks: [{ ...emptyBlock(), title: 'Part 1' }] };
}
