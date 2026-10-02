import {
  Alert,
  AlertDescription,
  Badge,
  formatDate,
  Icon,
  RadioCard,
  RadioGroup,
  Spinner,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';

import type {
  DeclarantVersion,
  DeclarantVersions,
  SelfAccessResult,
} from '../../../server/self-access.server';
import { declarationYear } from './application-view';
import { messages as m } from './messages';

/** A version's key in the picker: its declaration and version number. */
export function versionKey(version: Pick<DeclarantVersion, 'declarationId' | 'version'>): string {
  return `${version.declarationId}:${String(version.version)}`;
}

/** What the officer sees of the chosen declarant's versions while they load. */
export type VersionsLoad =
  { state: 'loading' } | { state: 'done'; result: SelfAccessResult<DeclarantVersions> };

/**
 * The submitted version the certified copy is of, latest first: the version in force marked
 * Current, the ones a later version replaced Superseded.
 */
export function VersionPicker({
  load,
  value,
  error,
  onChange,
}: {
  /** Null until a declarant is chosen. */
  load: VersionsLoad | null;
  value: string | null;
  error?: string;
  onChange: (key: string) => void;
}) {
  if (load === null) return <Note>{m.chooseDeclarantFirst}</Note>;
  if (load.state === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {m.loadingVersions}
      </p>
    );
  }
  if (!load.result.ok) {
    return (
      <Alert variant="destructive" role="status">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription>{m.versionsFailed}</AlertDescription>
      </Alert>
    );
  }
  const { versions } = load.result.data;
  if (versions.length === 0) return <Note>{m.noVersions}</Note>;
  // Current only tells versions of one declaration apart; a single version needs no badge.
  const revised = new Set(
    versions.filter((version) => version.superseded).map((version) => version.declarationId),
  );
  return (
    <RadioGroup legend={m.versionLabel} legendHidden error={error}>
      {versions.map((version) => {
        const key = versionKey(version);
        return (
          <RadioCard
            key={key}
            name="self-access-version"
            value={key}
            checked={value === key}
            onChange={() => {
              onChange(key);
            }}
            label={m.versionOption(
              m.declarationTypes[version.type],
              declarationYear(version.type, version.statementDate),
              version.version,
            )}
            description={
              <>
                <span className="font-mono">{version.reference}</span>
                {` · ${m.submittedOn(formatDate(version.submittedAt))}`}
              </>
            }
            icon={
              version.superseded ? (
                <Badge>{m.superseded}</Badge>
              ) : revised.has(version.declarationId) ? (
                <Badge variant="success">{m.current}</Badge>
              ) : undefined
            }
          />
        );
      })}
    </RadioGroup>
  );
}

function Note({ children }: { children: string }) {
  return (
    <p className="rounded-lg bg-muted px-3.5 py-3 text-sm text-secondary-foreground">{children}</p>
  );
}
