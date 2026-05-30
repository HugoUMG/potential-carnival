import type { Worksheet } from '../types';

export const sampleScript = `worksheet {
title: "Can, Could and Will Be Able To"

description: "A1 modal verbs practice with controlled and creative production."

fillblank {
  text: "I ____ swim."
  answer: "can"
}

multiplechoice {
  question: "Choose the correct sentence."
  options:
  - I can to swim.
  - I can swim.
  - I can swimming.
  answer: "I can swim."
}

textbox {
  prompt: "Write three things you can do now."
}

matching {
  left:
  - can
  - could
  - will be able to
  right:
  - ability now
  - ability in the past
  - ability in the future
}

speaking {
  prompt: "Talk about one skill you could do as a child and one skill you will be able to do next year."
}

reading {
  title: "New Skills"
  content:
  """
  Ana can play the guitar now. When she was seven, she could play simple songs. Next year, she will be able to join the school band.
  """
  questions:
  - What can Ana do now?
  - What could she do when she was seven?
}

imagequestion {
  image: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80"
  prompt: "Describe what the students will be able to do after practice."
}
}`;

export const sampleWorksheet: Worksheet = {
  id: 'ws-001',
  title: 'Can, Could and Will Be Able To',
  description: 'A1 modal verbs practice with mixed interactive activities.',
  level: 'A1',
  status: 'draft',
  scriptContent: sampleScript,
  createdBy: 'Teacher Demo',
  createdAt: '2026-05-30T09:00:00.000Z',
  analytics: {
    completionRate: 78,
    averageScore: 84,
    attempts: 42,
    mostMissedQuestions: ['Future ability with will be able to', 'Past ability with could'],
  },
  activities: [
    { id: 'a1', type: 'fillblank', text: 'I ____ swim.', answer: 'can' },
    {
      id: 'a2',
      type: 'multiplechoice',
      question: 'Choose the correct sentence.',
      options: ['I can to swim.', 'I can swim.', 'I can swimming.'],
      answer: 'I can swim.',
    },
    { id: 'a3', type: 'textbox', prompt: 'Write three things you can do now.' },
    {
      id: 'a4',
      type: 'matching',
      left: ['can', 'could', 'will be able to'],
      right: ['ability now', 'ability in the past', 'ability in the future'],
    },
    {
      id: 'a5',
      type: 'speaking',
      prompt: 'Talk about one skill you could do as a child and one skill you will be able to do next year.',
    },
    {
      id: 'a6',
      type: 'reading',
      title: 'New Skills',
      content:
        'Ana can play the guitar now. When she was seven, she could play simple songs. Next year, she will be able to join the school band.',
      questions: ['What can Ana do now?', 'What could she do when she was seven?'],
    },
    {
      id: 'a7',
      type: 'imagequestion',
      image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80',
      prompt: 'Describe what the students will be able to do after practice.',
    },
  ],
};
