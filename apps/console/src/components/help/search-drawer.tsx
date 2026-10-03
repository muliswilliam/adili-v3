import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  EmptyState,
  FieldError,
  FormField,
  Icon,
  Input,
  Select,
  SelectItem,
  Spinner,
} from '@adili/ui';
import { AlertCircleIcon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Fragment, type SyntheticEvent, useId, useState } from 'react';

import type { HelpLanguage, HelpPassage } from '../../server/declarations/client';
import type { HelpResult, HelpScope } from '../../server/help.server';
import { messages as m } from './messages';
import { CitationTag } from './parts';

/** Runs the help search as the scope's declarants get it; the page passes the server function. */
export type SearchAsDeclarants = (input: {
  scope: HelpScope;
  q: string;
  language: HelpLanguage;
}) => Promise<HelpResult<HelpPassage[]>>;

type Outcome =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'done'; q: string; passages: HelpPassage[] }
  | { kind: 'failed' };

/**
 * "Test help search" (spec 11 S9): the help search a declarant of the Commission (or any
 * declarant, for platform articles) would get in Ask Adili, so whoever publishes an article sees
 * it found within the same session. The article published last is marked "Just published".
 */
export function HelpSearchDrawer({
  open,
  onOpenChange,
  scope,
  search,
  justPublished,
  onUnauthenticated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: HelpScope;
  search: SearchAsDeclarants;
  justPublished: string | null;
  onUnauthenticated: () => void;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [language, setLanguage] = useState<HelpLanguage>('en');
  const [tooShort, setTooShort] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = q.trim();
    if (text.length < 2) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setOutcome({ kind: 'searching' });
    const result = await search({ scope, q: text, language }).catch(
      (): HelpResult<HelpPassage[]> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }),
    );
    if (result.ok) {
      setOutcome({ kind: 'done', q: text, passages: result.data });
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    setOutcome({ kind: 'failed' });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>{m.searchDrawerTitle}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="gap-3">
          <form className="grid gap-1.5" onSubmit={(event) => void submit(event)}>
            <div className="flex items-end gap-2">
              <FormField label={m.searchField} className="min-w-0 flex-1">
                <Input
                  type="search"
                  aria-invalid={tooShort || undefined}
                  aria-errormessage={tooShort ? `${id}-short` : undefined}
                  value={q}
                  maxLength={200}
                  placeholder={m.searchPlaceholderExample}
                  onChange={(event) => {
                    setQ(event.target.value);
                  }}
                />
              </FormField>
              <FormField label={m.language}>
                <Select
                  value={language}
                  onValueChange={(value) => {
                    setLanguage(value === 'sw' ? 'sw' : 'en');
                  }}
                  className="w-auto min-w-[124px]"
                >
                  <SelectItem value="en">{m.english}</SelectItem>
                  <SelectItem value="sw">{m.kiswahili}</SelectItem>
                </Select>
              </FormField>
              <Button
                type="submit"
                size="icon"
                className="size-11"
                disabled={outcome.kind === 'searching'}
              >
                {outcome.kind === 'searching' ? <Spinner /> : <Icon icon={Search01Icon} />}
                <span className="sr-only">{m.searchSubmit}</span>
              </Button>
            </div>
            {tooShort ? <FieldError id={`${id}-short`}>{m.searchTooShort}</FieldError> : null}
          </form>
          <SearchOutcome outcome={outcome} scope={scope} justPublished={justPublished} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function SearchOutcome({
  outcome,
  scope,
  justPublished,
}: {
  outcome: Outcome;
  scope: HelpScope;
  justPublished: string | null;
}) {
  if (outcome.kind === 'idle') {
    return (
      <p className="text-[13px] text-muted-foreground">
        {scope.kind === 'platform' ? m.searchIntroPlatform : m.searchIntroCommission}
      </p>
    );
  }
  if (outcome.kind === 'searching') {
    return (
      <p role="status" className="text-[13px] text-muted-foreground">
        {m.searching}
      </p>
    );
  }
  if (outcome.kind === 'failed') {
    return (
      <Alert variant="destructive">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription>{m.searchFailed}</AlertDescription>
      </Alert>
    );
  }
  if (outcome.passages.length === 0) {
    return (
      <div role="status">
        <EmptyState
          icon={<Icon icon={Search01Icon} />}
          title={m.searchNoResults}
          description={m.searchNoResultsText}
        />
      </div>
    );
  }
  return (
    <div aria-live="polite">
      <p className="sr-only">{m.resultCount(outcome.passages.length)}</p>
      <ol className="flex flex-col">
        {outcome.passages.map((passage) => {
          const fresh = passage.source === 'help' && passage.id === justPublished;
          return (
            <li
              key={passage.id}
              className={
                fresh
                  ? '-mx-6 flex flex-col gap-1.5 border-b bg-linear-to-r from-success-subtle to-transparent to-80% px-6 py-3.5 last:border-b-0'
                  : 'flex flex-col gap-1.5 border-b py-3.5 last:border-b-0'
              }
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <CitationTag citation={passage.citation} help={passage.source === 'help'} />
                {fresh ? (
                  <Badge variant="success">
                    <Icon icon={Tick02Icon} className="size-3" strokeWidth={2.4} />
                    {m.justPublished}
                  </Badge>
                ) : null}
              </div>
              <p className="text-[14.5px] font-semibold">{passage.title}</p>
              <p
                lang={passage.language}
                className="text-[13.5px] leading-[1.55] text-secondary-foreground"
              >
                <Highlighted text={passage.snippet} q={outcome.q} />
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The snippet with the searched words (3 letters or more) marked, as the prototype has it. */
function Highlighted({ text, q }: { text: string; q: string }) {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return text;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'ig'));
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded-[3px] bg-[#fff1c2] px-px text-inherit">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
