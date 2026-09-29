import { type ComponentProps, useId } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';

export type SuggestedQuestionsProps = Omit<ComponentProps<'div'>, 'children'> & {
  questions: readonly string[];
  /** Sends the question pressed, as if typed. */
  onAsk: (question: string) => void;
  /** The heading over the chips, which also names the list. Defaults to "Suggested questions". */
  label?: string;
  /** Turns the chips off, e.g. while an answer is on its way. */
  disabled?: boolean;
};

/**
 * Questions to ask in one press: the ones for the section when the panel opens, or follow-ups
 * under an answer. Each is a violet-edged chip on its own line, left-aligned, under a small
 * uppercase heading that names the list.
 */
export function SuggestedQuestions({
  questions,
  onAsk,
  label = 'Suggested questions',
  disabled = false,
  className,
  ...props
}: SuggestedQuestionsProps) {
  const headingId = useId();
  if (questions.length === 0) return null;

  return (
    <div className={cn('grid gap-2', className)} {...props}>
      <p
        id={headingId}
        className="text-xs font-semibold tracking-[0.05em] text-muted-foreground uppercase"
      >
        {label}
      </p>
      <ul aria-labelledby={headingId} className="flex flex-col items-start gap-1.5">
        {questions.map((question) => (
          <li key={question} className="max-w-full">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onAsk(question);
              }}
              className={cn(
                focusRing,
                'cursor-pointer rounded-[14px] bg-card px-3 py-[7px] text-left text-[13.5px] leading-[1.35] text-ai-subtle-foreground shadow-[0_0_0_1px] shadow-ai/25 hover:bg-ai-subtle disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card',
              )}
            >
              {question}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
