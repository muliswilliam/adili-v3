import { type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { toggleInOrder } from '../lib/toggle-in-order';
import { useFieldIds } from '../lib/use-field-ids';
import { Checkbox } from './checkbox';
import { FieldError, FieldHint } from './form-field';

/** The grounds on which access to a declaration may be denied or limited (Regs r.24), in order. */
export const REGULATION_24_GROUNDS = [
  'public-interest',
  'prejudice-proceeding',
  'frivolous-vexatious',
  'not-objectives',
] as const;

export type Ground = (typeof REGULATION_24_GROUNDS)[number];

/** A short label for each ground, and the text of Regulation 24 it cites. */
export const groundMeta: Record<Ground, { label: string; text: string }> = {
  'public-interest': {
    label: 'Against public interest',
    text: '(a) the disclosure of any information contained in the declaration or clarification would be against public interest;',
  },
  'prejudice-proceeding': {
    label: 'Prejudice to a proceeding or investigation',
    text: '(b) the access to the information contained in the declaration or clarification may prejudice an ongoing proceeding or investigation by the responsible Commission or a law enforcement agency;',
  },
  'frivolous-vexatious': {
    label: 'Frivolous, vexatious or scandalous',
    text: '(c) the request is frivolous, vexatious or scandalous;',
  },
  'not-objectives': {
    label: 'Does not promote the objectives of the Act',
    text: '(d) the reason for the access of the information contained in the declaration or clarification does not promote the objectives of the Act.',
  },
};

export interface GroundsSelectProps {
  value: Ground[];
  onChange: (value: Ground[]) => void;
  legend?: ReactNode;
  hint?: ReactNode;
  /** When set, the group is marked invalid and described by the message. */
  error?: ReactNode;
  disabled?: boolean;
  name?: string;
  className?: string;
}

/**
 * Chooses the Regulation 24 grounds for a partial grant or a denial. Each ground is a card
 * that toggles from anywhere on it; its checkbox is named by the short label and described by
 * the regulation's text.
 */
export function GroundsSelect({
  value,
  onChange,
  legend = 'Regulation 24 grounds',
  hint = 'Required for a partial grant or a denial. Choose every ground that applies.',
  error,
  disabled = false,
  name = 'grounds',
  className,
}: GroundsSelectProps) {
  const ids = useFieldIds({ hint, error });
  const baseId = useId();

  return (
    <fieldset
      aria-invalid={error ? true : undefined}
      aria-describedby={ids.describedBy}
      className={cn('grid min-w-0 gap-2', className)}
    >
      <legend className="mb-1 text-sm leading-5 font-medium text-secondary-foreground">
        {legend}
      </legend>
      {hint ? (
        <FieldHint id={ids.hintId} className="-mt-1 mb-1">
          {hint}
        </FieldHint>
      ) : null}
      {REGULATION_24_GROUNDS.map((ground) => {
        const labelId = `${baseId}-${ground}`;
        const textId = `${labelId}-text`;
        return (
          <label
            key={ground}
            className={cn(
              'grid grid-cols-[18px_minmax(0,1fr)] gap-3 rounded-lg bg-card px-3.5 py-3',
              'has-checked:shadow-control-selected',
              error ? 'shadow-control-error' : 'shadow-control',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            )}
          >
            <Checkbox
              name={name}
              value={ground}
              checked={value.includes(ground)}
              disabled={disabled}
              aria-labelledby={labelId}
              aria-describedby={textId}
              className="mt-px"
              onChange={(event) => {
                onChange(
                  toggleInOrder(value, ground, event.currentTarget.checked, REGULATION_24_GROUNDS),
                );
              }}
            />
            <span>
              <span id={labelId} className="text-[14.5px] leading-5 font-medium">
                {groundMeta[ground].label}
              </span>
              <q id={textId} className="mt-[3px] block text-[13px] text-muted-foreground">
                {groundMeta[ground].text}
              </q>
            </span>
          </label>
        );
      })}
      {error ? <FieldError id={ids.errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}
