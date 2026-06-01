import type {
  ActivityDefinition,
  ActivityRendererProps,
  FillBlankActivity,
  ImageQuestionActivity,
  MatchingActivity,
  MultipleChoiceActivity,
  ReadingActivity,
  SpeakingActivity,
  StudentAnswer,
  TextBoxActivity,
  WorksheetActivity,
} from '../types';

const inputClass = 'mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

function asString(value: StudentAnswer | undefined): string {
  return typeof value === 'string' ? value : '';
}

function FillBlankRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<FillBlankActivity>) {
  return (
    <label className="block">
      <span className="text-base font-medium text-slate-800">{activity.text}</span>
      <input
        className={inputClass}
        disabled={readonly}
        placeholder="Escribe la palabra que falta"
        value={asString(value)}
        onChange={(event) => onChange(activity.id, event.target.value)}
      />
    </label>
  );
}

function MultipleChoiceRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<MultipleChoiceActivity>) {
  return (
    <fieldset>
      <legend className="text-base font-medium text-slate-800">{activity.question}</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {activity.options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-300">
            <input
              disabled={readonly}
              name={activity.id}
              type="radio"
              checked={value === option}
              onChange={() => onChange(activity.id, option)}
            />
            <span className="text-sm text-slate-700">{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TextBoxRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<TextBoxActivity>) {
  return (
    <label className="block">
      <span className="text-base font-medium text-slate-800">{activity.prompt}</span>
      <textarea
        className={`${inputClass} min-h-28 resize-y`}
        disabled={readonly}
        placeholder="Escribe tu respuesta"
        value={asString(value)}
        onChange={(event) => onChange(activity.id, event.target.value)}
      />
    </label>
  );
}

function MatchingRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<MatchingActivity>) {
  const selections = typeof value === 'object' && !Array.isArray(value) && value !== null ? value : {};

  return (
    <div>
      <p className="text-base font-medium text-slate-800">Relaciona cada elemento con su significado.</p>
      <div className="mt-4 grid gap-3">
        {activity.left.map((leftItem) => (
          <label key={leftItem} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_2fr] sm:items-center">
            <span className="font-semibold text-slate-700">{leftItem}</span>
            <select
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              disabled={readonly}
              value={selections[leftItem] ?? ''}
              onChange={(event) => onChange(activity.id, { ...selections, [leftItem]: event.target.value })}
            >
              <option value="">Selecciona una relación</option>
              {activity.right.map((rightItem) => (
                <option key={rightItem} value={rightItem}>
                  {rightItem}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function SpeakingRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<SpeakingActivity>) {
  return (
    <label className="block">
      <span className="text-base font-medium text-slate-800">{activity.prompt}</span>
      <p className="mt-1 text-sm text-slate-500">La grabación de audio se puede agregar más adelante; por ahora escribe notas de la respuesta oral.</p>
      <textarea
        className={`${inputClass} min-h-24 resize-y`}
        disabled={readonly}
        placeholder="Notas de expresión oral del estudiante"
        value={asString(value)}
        onChange={(event) => onChange(activity.id, event.target.value)}
      />
    </label>
  );
}

function ReadingRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ReadingActivity>) {
  const answers = typeof value === 'object' && !Array.isArray(value) && value !== null ? value : {};

  return (
    <article>
      <h3 className="text-lg font-semibold text-slate-900">{activity.title}</h3>
      <p className="mt-3 rounded-xl bg-blue-50 p-4 leading-7 text-slate-700">{activity.content}</p>
      <div className="mt-4 grid gap-3">
        {activity.questions.map((question, index) => (
          <label key={question} className="block">
            <span className="text-sm font-medium text-slate-700">{question}</span>
            <input
              className={inputClass}
              disabled={readonly}
              value={answers[String(index)] ?? ''}
              onChange={(event) => onChange(activity.id, { ...answers, [index]: event.target.value })}
            />
          </label>
        ))}
      </div>
    </article>
  );
}

function ImageQuestionRenderer({ activity, value, readonly, onChange }: ActivityRendererProps<ImageQuestionActivity>) {
  return (
    <div>
      <img className="mb-4 h-56 w-full rounded-2xl object-cover" src={activity.image} alt="Imagen de apoyo de la actividad" />
      <TextBoxRenderer activity={{ ...activity, type: 'textbox' }} value={value} readonly={readonly} onChange={onChange} />
    </div>
  );
}

const nextId = (type: string) => `${type}-${crypto.randomUUID()}`;

export const activityRegistry = {
  fillblank: {
    type: 'fillblank',
    label: 'Completar espacios',
    description: 'El estudiante escribe una palabra o frase faltante.',
    icon: '✏️',
    create: () => ({ id: nextId('fillblank'), type: 'fillblank', text: 'Yo ____ listo.', answer: 'am' }),
    Renderer: FillBlankRenderer,
  },
  multiplechoice: {
    type: 'multiplechoice',
    label: 'Opción múltiple',
    description: 'El estudiante elige una opción correcta.',
    icon: '✅',
    create: () => ({ id: nextId('multiplechoice'), type: 'multiplechoice', question: 'Elige la respuesta correcta.', options: ['am', 'is', 'are'], answer: 'am' }),
    Renderer: MultipleChoiceRenderer,
  },
  textbox: {
    type: 'textbox',
    label: 'Caja de texto',
    description: 'Respuesta escrita extensa.',
    icon: '📝',
    create: () => ({ id: nextId('textbox'), type: 'textbox', prompt: 'Describe tu casa.' }),
    Renderer: TextBoxRenderer,
  },
  matching: {
    type: 'matching',
    label: 'Relacionar',
    description: 'Une palabras con significados.',
    icon: '🔗',
    create: () => ({ id: nextId('matching'), type: 'matching', left: ['perro', 'gato'], right: ['animal que ladra', 'animal que maúlla'] }),
    Renderer: MatchingRenderer,
  },
  speaking: {
    type: 'speaking',
    label: 'Expresión oral',
    description: 'Consigna para producción oral.',
    icon: '🎙️',
    create: () => ({ id: nextId('speaking'), type: 'speaking', prompt: 'Habla sobre tu familia.' }),
    Renderer: SpeakingRenderer,
  },
  reading: {
    type: 'reading',
    label: 'Lectura',
    description: 'Texto de lectura con preguntas.',
    icon: '📖',
    create: () => ({ id: nextId('reading'), type: 'reading', title: 'Mi escuela', content: 'Esta es mi escuela.', questions: ['¿De qué trata el texto?'] }),
    Renderer: ReadingRenderer,
  },
  imagequestion: {
    type: 'imagequestion',
    label: 'Pregunta con imagen',
    description: 'Consigna visual con respuesta escrita.',
    icon: '🖼️',
    create: () => ({ id: nextId('imagequestion'), type: 'imagequestion', image: 'https://placehold.co/900x500', prompt: 'Describe lo que ves.' }),
    Renderer: ImageQuestionRenderer,
  },
} satisfies Record<WorksheetActivity['type'], ActivityDefinition>;

export const activityDefinitions = Object.values(activityRegistry);
