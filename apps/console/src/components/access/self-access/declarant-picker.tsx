import { Button, FieldError } from '@adili/ui';

import type { RosterCandidate } from '../../../server/access/types';
import { findDeclarants } from '../../../server/self-access';
import { initials } from '../../shell/nav';
import { RosterCandidatePicker } from '../roster-candidate-picker';
import { messages as m } from './messages';

/**
 * The declarant, found on the Commission's roster by name or personnel file number. Only an
 * onboarded record can be chosen: without a declarant account there is no declaration to copy.
 * Once chosen it shows as a card with Change.
 */
export function DeclarantPicker({
  id,
  slug,
  selected,
  error,
  onSelect,
}: {
  id: string;
  slug: string;
  selected: RosterCandidate | null;
  error?: string;
  onSelect: (record: RosterCandidate | null) => void;
}) {
  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded-lg border px-3.5 py-3">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-linear-to-br from-brand/45 to-brand text-[12px] font-semibold text-primary-foreground"
        >
          {initials(selected.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium">{selected.fullName}</div>
          <div className="truncate text-[13px] text-muted-foreground">
            {[
              m.fileNumber(selected.personnelFileNumber),
              selected.designation,
              selected.reportingEntity,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={m.changeDeclarant}
          onClick={() => {
            onSelect(null);
          }}
        >
          {m.change}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2.5">
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      <RosterCandidatePicker
        id={id}
        find={(q) => findDeclarants({ data: { slug, q } })}
        choice={{ kind: 'select', onSelect }}
        notOnboardedHint={m.notOnboardedHint}
      />
    </div>
  );
}
