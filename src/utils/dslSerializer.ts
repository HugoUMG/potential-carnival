/**
 * Serializa el estado del constructor visual a DSL WorksheetScript.
 * Solo maneja los 5 tipos visuales: fillblank, multiplechoice, matching, textbox, truefalse.
 */

export interface VisualStatement {
  id: string;
  text: string;
  answer: boolean;
}

export interface VisualActivity {
  id: string;
  type: 'fillblank' | 'multiplechoice' | 'matching' | 'textbox' | 'truefalse';
  instructions: string;
  // fillblank
  text: string;
  answer: string; // comma-separated for multiple blanks
  // multiplechoice
  question: string;
  options: string[];
  correctOption: string;
  // matching
  left: string[];
  right: string[];
  // textbox
  prompt: string;
  // truefalse
  statements: VisualStatement[];
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

export function emptyActivity(type: VisualActivity['type']): VisualActivity {
  return {
    id: crypto.randomUUID(),
    type,
    instructions: '',
    text: 'She _____ happy yesterday.',
    answer: type === 'fillblank' ? 'was' : '',
    question: '',
    options: ['Option A', 'Option B', 'Option C'],
    correctOption: 'Option A',
    left: ['can', 'should', 'must'],
    right: ['Ability', 'Advice', 'Obligation'],
    prompt: 'Write your answer here.',
    statements: [
      { id: crypto.randomUUID(), text: 'Write a true statement here.', answer: true },
      { id: crypto.randomUUID(), text: 'Write a false statement here.', answer: false },
    ],
  };
}

export function emptyBlock(): VisualBlock {
  return {
    id: crypto.randomUUID(),
    title: '',
    instructions: '',
    activities: [],
  };
}

export function emptyState(): VisualState {
  return {
    title: '',
    description: '',
    blocks: [{ ...emptyBlock(), title: 'Part 1' }],
  };
}
