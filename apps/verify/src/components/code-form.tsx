import { normalizeVerificationId } from '@adili/events/contracts';
import { Button, cn, Label, Spinner } from '@adili/ui';
import { type ChangeEvent, type SubmitEvent, useId, useRef, useState } from 'react';

import { verifyMessages as copy } from '../copy';
import { codeFromInput, formatCodeInput } from '../lib/code-input';

export interface CodeFormProps {
  /** A code to start from, e.g. the one "Edit code" came back with. */
  initialCode?: string;
  /** While the lookup of a submitted code is on its way. */
  pending?: boolean;
  /** Called with the normalised code, e.g. `ADL-7Q4K-...-8P`. */
  onSubmit: (verificationId: string) => void;
}

/**
 * The code field on the index: `ADL-` outside the input, the rest shaped into groups as it is
 * typed or pasted. Submits only a code that can be a verification code.
 */
export function CodeForm({ initialCode = '', pending = false, onSubmit }: CodeFormProps) {
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() => formatCodeInput(initialCode).value);
  const [error, setError] = useState<string | null>(null);

  function change(event: ChangeEvent<HTMLInputElement>) {
    const field = event.target;
    const next = formatCodeInput(field.value, field.selectionStart ?? field.value.length);
    setValue(next.value);
    setError(null);
    // After React writes the shaped value, put the caret back after the same character.
    requestAnimationFrame(() => {
      if (document.activeElement === field) field.setSelectionRange(next.caret, next.caret);
    });
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = value ? normalizeVerificationId(codeFromInput(value)) : null;
    if (!id) {
      setError(value ? copy.codeInvalid : copy.codeEmpty);
      input.current?.focus();
      return;
    }
    onSubmit(id);
  }

  return (
    // Without JavaScript yet (a slow connection), the browser submits the form itself: /v?code=
    // redirects to the result page.
    <form method="get" action="/v" className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-2">
        <Label htmlFor={inputId}>{copy.codeLabel}</Label>
        <div
          className={cn(
            'flex h-11 items-center rounded-lg bg-control pl-3 shadow-control transition-shadow hover:shadow-control-hover has-focus-visible:shadow-control-focus',
            error &&
              'shadow-control-error hover:shadow-control-error has-focus-visible:shadow-control-error-focus',
          )}
        >
          <span
            aria-hidden="true"
            className="pr-0.5 font-mono text-[15px] font-semibold text-secondary-foreground"
          >
            ADL-
          </span>
          <input
            ref={input}
            id={inputId}
            name="code"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder={copy.codePlaceholder}
            value={value}
            onChange={change}
            aria-invalid={error ? true : undefined}
            aria-describedby={hintId}
            // 16px everywhere: smaller text makes iOS zoom in on focus. A code longer than a narrow
            // field scrolls in it, and the placeholder ends in an ellipsis.
            className="h-full min-w-0 flex-1 rounded-r-lg bg-transparent pr-3 pl-1 font-mono text-base text-ellipsis uppercase outline-none placeholder:text-placeholder placeholder:normal-case sm:tracking-[0.06em] sm:placeholder:tracking-[0.04em]"
          />
        </div>
        {error ? (
          <p id={hintId} role="alert" className="text-[13px] font-medium text-destructive">
            {error}
          </p>
        ) : (
          <p id={hintId} className="text-[13px] text-muted-foreground">
            {copy.codeHint}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Spinner />
            {copy.checking}
          </>
        ) : (
          copy.check
        )}
      </Button>
    </form>
  );
}
