import type { Worksheet } from '../types';

export const sampleScript = `worksheet {
title: "Can, Could y Will Be Able To"

description: "Práctica A1 de verbos modales con producción controlada y creativa."

fillblank {
  text: "Yo ____ nadar."
  answer: "can"
}

multiplechoice {
  question: "Elige la oración correcta."
  options:
  - I can to swim.
  - I can swim.
  - I can swimming.
  answer: "I can swim."
}

textbox {
  prompt: "Escribe tres cosas que puedes hacer ahora."
}

matching {
  left:
  - can
  - could
  - will be able to
  right:
  - habilidad actual
  - habilidad en el pasado
  - habilidad en el futuro
}

reading {
  title: "Nuevas habilidades"
  content:
  """
  Ana puede tocar la guitarra ahora. Cuando tenía siete años, podía tocar canciones sencillas. El próximo año podrá unirse a la banda escolar.
  """
  questions:
  - ¿Qué puede hacer Ana ahora?
  - ¿Qué podía hacer cuando tenía siete años?
}

imagequestion {
  image: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80"
  prompt: "Describe qué podrán hacer los estudiantes después de practicar."
}
}`;

export const sampleWorksheet: Worksheet = {
  id: 'hoja-001',
  title: 'Can, Could y Will Be Able To',
  description: 'Práctica A1 de verbos modales con actividades interactivas mixtas.',
  status: 'draft',
  archived: false,
  scriptContent: sampleScript,
  createdBy: 'Docente de demostración',
  createdAt: '2026-06-01T09:00:00.000Z',
  activities: [
    { id: 'a1', type: 'fillblank', text: 'Yo ____ nadar.', answer: 'can' },
    {
      id: 'a2',
      type: 'multiplechoice',
      question: 'Elige la oración correcta.',
      options: ['I can to swim.', 'I can swim.', 'I can swimming.'],
      answer: 'I can swim.',
    },
    { id: 'a3', type: 'textbox', prompt: 'Escribe tres cosas que puedes hacer ahora.' },
    {
      id: 'a4',
      type: 'matching',
      left: ['can', 'could', 'will be able to'],
      right: ['habilidad actual', 'habilidad en el pasado', 'habilidad en el futuro'],
    },
    {
      id: 'a6',
      type: 'reading',
      title: 'Nuevas habilidades',
      content:
        'Ana puede tocar la guitarra ahora. Cuando tenía siete años, podía tocar canciones sencillas. El próximo año podrá unirse a la banda escolar.',
      questions: ['¿Qué puede hacer Ana ahora?', '¿Qué podía hacer cuando tenía siete años?'],
    },
    {
      id: 'a7',
      type: 'imagequestion',
      image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80',
      prompt: 'Describe qué podrán hacer los estudiantes después de practicar.',
    },
  ],
};
