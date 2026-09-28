import { Card, CardIcon, formatDate, Icon } from '@adili/ui';
import { BankIcon } from '@hugeicons/core-free-icons';

import type { LoadedSuggestionSet } from '../../server/declarations.server';
import {
  complianceText,
  latestSets,
  maskKraPin,
  suggestionKind,
} from '../../declaration/suggestions';

/**
 * What KRA answered about the officer's PIN in their last registry check, as the line under Your
 * details: "KRA PIN A00•••••76K · Compliance: Compliant (checked 26 Sep 2026)". Read-only:
 * declaration.v1 has no KRA fields for the officer yet (contract gap 6), so there is no Apply.
 */
export function kraLineText(sets: LoadedSuggestionSet[]): string | null {
  const set = latestSets(sets).kra;
  const suggestion = set?.suggestions.find(
    (each) =>
      suggestionKind(each.itemType).target === 'tax' &&
      (each.status === 'new' || each.status === 'accepted'),
  );
  const pin = suggestion?.fields.kraPin;
  if (!set || typeof pin !== 'string' || pin.trim() === '') return null;
  const compliance = complianceText(suggestion?.fields.complianceStatus);
  const checked = formatDate(set.readyAt ?? set.requestedAt);
  return `KRA PIN ${maskKraPin(pin)}${compliance ? ` · Compliance: ${compliance}` : ''} (checked ${checked})`;
}

export function KraLine({ sets }: { sets: LoadedSuggestionSet[] }) {
  const text = kraLineText(sets);
  if (!text) return null;
  return (
    <Card className="flex-row items-center gap-3 p-4 sm:p-4">
      <CardIcon className="mb-0 shrink-0">
        <Icon icon={BankIcon} />
      </CardIcon>
      <p className="text-sm">{text}</p>
    </Card>
  );
}
