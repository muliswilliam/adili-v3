import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  FilterChip,
  type FilterChipProps,
  formatDateTime,
  Icon,
} from '@adili/ui';
import { AlertCircleIcon, UserRemove01Icon } from '@hugeicons/core-free-icons';

/** Marks a roster record whose identity check against the national register failed. */
export function IdentityMismatchBadge() {
  return (
    <Badge variant="destructive">
      <Icon icon={AlertCircleIcon} strokeWidth={2.2} />
      Identity check failed
    </Badge>
  );
}

export type IdentityMismatchFilterChipProps = Omit<
  FilterChipProps,
  'children' | 'icon' | 'countLabel'
>;

/**
 * The records list's "Identity check failed" toggle, next to "Flagged only". Pair it with
 * `toggleIdentityMismatch` and `rosterRecordsQuery` (`identityMismatch=true`).
 */
export function IdentityMismatchFilterChip(props: IdentityMismatchFilterChipProps) {
  return (
    <FilterChip icon={UserRemove01Icon} countLabel="records" {...props}>
      Identity check failed
    </FilterChip>
  );
}

/** Record detail callout: when the check failed and what the reporting officer should do. */
export function IdentityMismatchCallout({ at }: { at: string }) {
  return (
    <Alert variant="destructive" role="status">
      <Icon icon={UserRemove01Icon} />
      <AlertTitle>Identity check failed on {formatDateTime(at)}.</AlertTitle>
      <AlertDescription>
        Name or national ID does not match the national register. Correct it in your next import.
      </AlertDescription>
    </Alert>
  );
}
