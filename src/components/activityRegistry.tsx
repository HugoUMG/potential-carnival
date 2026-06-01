/* eslint-disable react-refresh/only-export-components */
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
        placeholder="Type the missing word"
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
        placeholder="Write your answer"
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
      <p className="text-base font-medium text-slate-800">Match each item with its meaning.</p>
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
              <option value="">Select a match</option>
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
      <p className="mt-1 text-sm text-slate-500">Audio recording will be available later. For now, write speaking notes.</p>
      <textarea
        className={`${inputClass} min-h-24 resize-y`}
        disabled={readonly}
        placeholder="Student speaking notes"
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
      <img className="mb-4 h-56 w-full rounded-2xl object-cover" src={activity.image} alt="Worksheet prompt image" />
      <TextBoxRenderer activity={{ ...activity, type: 'textbox' }} value={value} readonly={readonly} onChange={onChange} />
    </div>
  );
}

const nextId = (type: string) => `${type}-${crypto.randomUUID()}`;

export const activityRegistry = {
  fillblank: {
    type: 'fillblank',
    label: 'Fill in the blank',
    description: 'The student types the missing word or phrase.',
    icon: '✏️',
    create: () => ({ id: nextId('fillblank'), type: 'fillblank', text: 'I ____ ready.', answer: 'am' }),
    Renderer: FillBlankRenderer,
  },
  multiplechoice: {
    type: 'multiplechoice',
    label: 'Multiple choice',
    description: 'The student chooses one correct option.',
    icon: '✅',
    create: () => ({ id: nextId('multiplechoice'), type: 'multiplechoice', question: 'Choose the correct answer.', options: ['am', 'is', 'are'], answer: 'am' }),
    Renderer: MultipleChoiceRenderer,
  },
  textbox: {
    type: 'textbox',
    label: 'Text box',
    description: 'Long written response.',
    icon: '📝',
    create: () => ({ id: nextId('textbox'), type: 'textbox', prompt: 'Describe your house.' }),
    Renderer: TextBoxRenderer,
  },
  matching: {
    type: 'matching',
    label: 'Matching',
    description: 'Match words with meanings.',
    icon: '🔗',
    create: () => ({ id: nextId('matching'), type: 'matching', left: ['dog', 'cat'], right: ['animal that barks', 'animal that meows'] }),
    Renderer: MatchingRenderer,
  },
  speaking: {
    type: 'speaking',
    label: 'Speaking',
    description: 'Prompt for oral production.',
    icon: '🎙️',
    create: () => ({ id: nextId('speaking'), type: 'speaking', prompt: 'Talk about your family.' }),
    Renderer: SpeakingRenderer,
  },
  reading: {
    type: 'reading',
    label: 'Reading',
    description: 'Reading text with questions.',
    icon: '📖',
    create: () => ({ id: nextId('reading'), type: 'reading', title: 'My school', content: 'This is my school.', questions: ['What is the text about?'] }),
    Renderer: ReadingRenderer,
  },
  imagequestion: {
    type: 'imagequestion',
    label: 'Image question',
    description: 'Visual prompt with written answer.',
    icon: '🖼️',
    create: () => ({ id: nextId('imagequestion'), type: 'imagequestion', image: 'https://placehold.co/900x500', prompt: 'Describe what you see.' }),
    Renderer: ImageQuestionRenderer,
  },
} satisfies { [Type in WorksheetActivity['type']]: ActivityDefinition<Extract<WorksheetActivity, { type: Type }>> };

export const activityDefinitions = Object.values(activityRegistry);
