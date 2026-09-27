import { Button, CopyButton, Icon } from '@adili/ui';
import { ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import { useId, useState } from 'react';

import { messages as m } from './messages';

/** Bullets standing in for a hidden secret, a fixed number so its length is not given away. */
export const HIDDEN_SECRET = '•'.repeat(24);

/**
 * One value of a just-issued credential (the prototype's `.secret` row): its label, the value in
 * monospace and a Copy button. `secret` hides the value until revealed with a labelled toggle.
 * Copying always takes the real value.
 */
export function CredentialField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const labelId = useId();
  const [revealed, setRevealed] = useState(false);
  const hidden = secret && !revealed;
  return (
    <div role="group" aria-labelledby={labelId} className="grid min-w-0 grid-cols-1 gap-2">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <div className="flex min-h-11 items-center gap-1 rounded-lg border bg-muted py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 font-mono text-sm break-all">
          {hidden ? (
            <>
              <span
                aria-hidden="true"
                className="block overflow-hidden tracking-[0.08em] whitespace-nowrap"
              >
                {HIDDEN_SECRET}
              </span>
              <span className="sr-only">{m.apiSecretHidden}</span>
            </>
          ) : (
            value
          )}
        </code>
        {secret ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={revealed}
            aria-label={revealed ? m.apiHideSecret : m.apiShowSecret}
            onClick={() => {
              setRevealed((shown) => !shown);
            }}
          >
            <Icon icon={revealed ? ViewOffSlashIcon : ViewIcon} />
            {revealed ? m.apiHide : m.apiShow}
          </Button>
        ) : null}
        <CopyButton
          value={value}
          label={m.apiCopy}
          aria-label={m.apiCopyLabel(label)}
          copiedMessage={m.apiCopied(label)}
          variant="secondary"
          size="sm"
          showLabel
        />
      </div>
    </div>
  );
}
