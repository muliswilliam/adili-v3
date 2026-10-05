import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  FormField,
  Icon,
  Input,
  formatLongDate,
  OfficerReference,
} from '@adili/ui';
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  MinusSignCircleIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { type SyntheticEvent, useState } from 'react';

import { OFR_PATTERN } from '../../server/account-support';
import type { ServiceResult } from '../../server/service-call';
import type { PersonSummary } from '../../server/support/types';
import { messages as t } from './messages';

/** The lookup form: an officer reference, upper-cased as typed, checked for shape before it searches. */
export function PersonLookupForm({
  applied,
  onLookUp,
}: {
  applied: string | undefined;
  onLookUp: (ofr: string) => void;
}) {
  const [ofr, setOfr] = useState(applied ?? '');
  const [touched, setTouched] = useState(false);
  const value = ofr.trim().toUpperCase();
  const error = OFR_PATTERN.test(value) ? undefined : t.search.invalid;

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (error) return;
    onLookUp(value);
  }

  return (
    <form aria-label={t.search.label} onSubmit={submit} noValidate>
      <div className="grid gap-x-3 gap-y-3 sm:grid-cols-[minmax(0,420px)_auto] sm:gap-y-1.5">
        <FormField
          label={t.search.field}
          hint={t.search.help}
          error={touched ? error : undefined}
          className="sm:col-start-1 sm:row-span-2 sm:grid-rows-subgrid"
        >
          <Input
            id="support-ofr"
            placeholder={t.search.hint}
            value={ofr}
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase placeholder:normal-case"
            onChange={(e) => {
              setOfr(e.target.value);
            }}
          />
        </FormField>
        <Button
          type="submit"
          className="self-start justify-self-start sm:col-start-2 sm:row-start-2"
        >
          <Icon icon={Search01Icon} />
          {t.search.submit}
        </Button>
      </div>
    </form>
  );
}

/** What a lookup found, or why it found nothing. */
export function PersonLookupResult({ result }: { result: ServiceResult<PersonSummary> }) {
  if (result.ok) return <PersonCard person={result.data} />;
  const { error } = result;
  const copy =
    error.kind === 'problem'
      ? error.problem.status === 404
        ? t.notFound
        : error.problem.status === 400
          ? t.mistyped
          : error.problem.status === 403
            ? t.forbidden
            : t.unavailable
      : t.unavailable;
  return (
    <Alert variant={copy === t.notFound ? 'neutral' : 'warning'}>
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>{copy.text}</AlertDescription>
    </Alert>
  );
}

function PersonCard({ person }: { person: PersonSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{person.fullName}</CardTitle>
        <CardDescription>{t.result.title}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <DescriptionList>
          <DescriptionItem term={t.result.ofr} className="items-center">
            <OfficerReference value={person.ofr} />
          </DescriptionItem>
          <DescriptionItem term={t.result.commissions}>
            {person.commissions.length > 0 ? (
              <span className="flex flex-wrap justify-end gap-1.5">
                {person.commissions.map((slug) => (
                  <Badge key={slug}>{slug.toUpperCase()}</Badge>
                ))}
              </span>
            ) : (
              t.result.noCommissions
            )}
          </DescriptionItem>
          <DescriptionItem term={t.result.email}>
            <OnFile present={person.contactsOnFile.email} />
          </DescriptionItem>
          <DescriptionItem term={t.result.phone}>
            <OnFile present={person.contactsOnFile.phone} />
          </DescriptionItem>
          <DescriptionItem term={t.result.created}>
            {formatLongDate(person.createdAt)}
          </DescriptionItem>
        </DescriptionList>
        <p className="text-[13.5px] text-muted-foreground">{t.result.recovery}</p>
      </CardContent>
    </Card>
  );
}

function OnFile({ present }: { present: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon
        icon={present ? CheckmarkCircle02Icon : MinusSignCircleIcon}
        className={present ? 'size-4 text-success' : 'size-4 text-muted-foreground'}
      />
      {present ? t.result.onFile : t.result.notOnFile}
    </span>
  );
}
