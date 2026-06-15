/**
 * Serializa el estado del constructor visual a DSL WorksheetScript.
 * Soporta todos los tipos de actividad del sistema.
 */

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

export type VisualActivityType =
  | 'fillblank' | 'multiplechoice' | 'matching' | 'textbox' | 'truefalse'
  | 'listening' | 'listeningfillblank' | 'listeningmultiplechoice'
  | 'listeningmatching' | 'listeningtruefalse'
  | 'reading' | 'imagequestion';

export interface VisualActivity {
  id: string;
  type: VisualActivityType;
  instructions: string;
  // fillblank / listeningfillblank
  text: string;
  answer: string;
  // multiplechoice / listeningmultiplechoice
  question: string;
  options: string[];
  correctOption: string;
  // matching
  left: string[];
  right: string[];
  // textbox
  prompt: string;
  // truefalse / listeningtruefalse
  statements: VisualStatement[];
  // listening* / listeningfillblank / listeningmultiplechoice / listeningtruefalse
  audioText: string;
  // listeningmatching
  pairs: VisualPair[];
  // reading
  readingTitle: string;
  readingContent: string;
  readingQuestions: string[];
  // imagequestion
  imageUrl: string;
}

export interface VisualBlock {
  id: string;
  title: string;
  instructions: string;
  activities: VisualActivity[];
}

export interface VisualState {
  title: string;
  description: string;
  blocks: VisualBlock[];
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function serializeActivity(act: VisualActivity, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}${act.type} {`);

  if (act.instructions.trim()) {
    lines.push(`${indent}  instructions: "${esc(act.instructions)}"`);
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

  } else if (act.type === 'imagequestion') {
    if (act.imageUrl.trim()) lines.push(`${indent}  image: "${esc(act.imageUrl)}"`);
    if (act.prompt.trim()) lines.push(`${indent}  prompt: "${esc(act.prompt)}"`);
  }

  lines.push(`${indent}}`);
  return lines;
}

function serializeBlock(block: VisualBlock, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}block {`);
  if (block.title.trim()) lines.push(`${indent}  title: "${esc(block.title)}"`);
  if (block.instructions.trim()) lines.push(`${indent}  instructions: "${esc(block.instructions)}"`);
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
  for (const block of state.blocks) {
    lines.push(...serializeBlock(block, '  '));
  }
  lines.push('}');
  return lines.join('\n');
}

const BASE_ACTIVITY: Omit<VisualActivity, 'id' | 'type'> = {
  instructions: '',
  text: '',
  answer: '',
  question: '',
  options: ['Option A', 'Option B', 'Option C'],
  correctOption: 'Option A',
  left: ['can', 'should', 'must'],
  right: ['Ability', 'Advice', 'Obligation'],
  prompt: '',
  statements: [],
  audioText: '',
  pairs: [],
  readingTitle: '',
  readingContent: '',
  readingQuestions: [''],
  imageUrl: '',
};

export function emptyActivity(type: VisualActivityType): VisualActivity {
  const id = crypto.randomUUID();
  switch (type) {
    case 'fillblank':
      return { ...BASE_ACTIVITY, id, type, text: 'She _____ happy yesterday.', answer: 'was' };
    case 'multiplechoice':
      return { ...BASE_ACTIVITY, id, type, question: 'Choose the correct answer.', options: ['am', 'is', 'are'], correctOption: 'am' };
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
    case 'reading':
      return { ...BASE_ACTIVITY, id, type, readingTitle: 'My School', readingContent: 'This is my school. It is big and beautiful.', readingQuestions: ['What is the text about?', 'Describe the school.'] };
    case 'imagequestion':
      return { ...BASE_ACTIVITY, id, type, imageUrl: 'https://placehold.co/900x500', prompt: 'Describe what you see in the image.' };
    default:
      return { ...BASE_ACTIVITY, id, type };
  }
}

export function emptyBlock(): VisualBlock {
  return { id: crypto.randomUUID(), title: '', instructions: '', activities: [] };
}

export function emptyState(): VisualState {
  return { title: '', description: '', blocks: [{ ...emptyBlock(), title: 'Part 1' }] };
}
