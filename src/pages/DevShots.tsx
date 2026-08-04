import { useState } from 'react';
import { WorksheetEditor } from '../components/WorksheetEditor';
import type { Worksheet } from '../types';

/**
 * Banco de pruebas SOLO de desarrollo (`/__shots`, montado bajo `import.meta.env.DEV`).
 * Monta el editor real con datos de ejemplo para que `scripts/shots.mjs` capture las
 * imágenes de /aprende. No se incluye en el build de producción.
 */

const SCRIPT = `worksheet {
  title: "Past Simple · Unit 3"
  description: "Regular and irregular verbs. Level A2."

  block {
    title: "Part 1: Fill in the blank"
    instructions: "Complete each sentence with the past simple."

    fillblank {
      text: "She _____ to school yesterday."
      answer: "walked"
    }
    fillblank {
      text: "They _____ a movie last night."
      answer: "watched"
    }
  }

  block {
    title: "Part 2: Listen and order"

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
  }
}`;

const ACTIVITIES: Worksheet['activities'] = [
  { id: 's1', type: 'multiplechoice', question: 'Which sentence is in the past simple?', options: ['She walked to school.', 'She walks to school.', 'She is walking to school.'], answer: 'She walked to school.' },
  { id: 's2', type: 'fillblank', text: 'They _____ a movie last night.', answer: 'watched' },
  { id: 's3', type: 'listeningorder', audio_text: 'She has never been to Paris.', voice: 'female', answer: ['She', 'has', 'never', 'been', 'to', 'Paris'] },
];

const WORKSHEET: Worksheet = {
  id: 'shot-001',
  title: 'Past Simple · Unit 3',
  description: 'Regular and irregular verbs. Level A2.',
  status: 'draft',
  archived: false,
  scriptContent: SCRIPT,
  createdBy: 'Docente',
  createdAt: '2026-07-01T09:00:00.000Z',
  activities: ACTIVITIES,
  blocks: [
    { title: 'Part 1: Fill in the blank', instructions: 'Complete each sentence with the past simple.', activities: ACTIVITIES.slice(0, 2) },
    { title: 'Part 2: Listen and order', instructions: null, activities: ACTIVITIES.slice(2) },
  ],
};

export function DevShots() {
  const [script, setScript] = useState(SCRIPT);
  const [maxAttempts, setMaxAttempts] = useState('unlimited');
  const [aiGrading, setAiGrading] = useState(true);
  const [aiTolerance, setAiTolerance] = useState(50);

  return (
    <main className="min-h-screen px-6 py-6 text-ink">
      <div id="shot" className="mx-auto max-w-6xl">
        <WorksheetEditor
          worksheet={WORKSHEET}
          scriptDraft={script}
          maxAttemptsDraft={maxAttempts}
          aiGradingDraft={aiGrading}
          aiToleranceDraft={aiTolerance}
          userId="dev"
          onAddActivity={() => {}}
          onScriptChange={setScript}
          onMaxAttemptsChange={setMaxAttempts}
          onAiGradingChange={setAiGrading}
          onAiToleranceChange={setAiTolerance}
          onSaveScript={() => {}}
        />
      </div>
    </main>
  );
}
