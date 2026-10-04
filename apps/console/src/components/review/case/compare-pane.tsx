import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DiffTable,
  EmptyState,
  formatDate,
  Icon,
  Skeleton,
  Spinner,
  Switch,
} from '@adili/ui';
import {
  ArrowDown01Icon,
  GitCompareIcon,
  HelpCircleIcon,
  Refresh01Icon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { ComparedStatement, ComparisonView } from '../../../review-case/compare';
import type { CaseDetail } from '../../../server/review/types';
import { DeclarationCard, PersonAvatar } from './declaration-pane';
import { messages as t } from './messages';

/**
 * The version comparison (spec 07a FE-3, S10): with Compare on, the declaration pane shows the
 * current version against the person's previous submitted version, a `DiffTable` per statement
 * (matched items with the change and percentage, items in one version only), with counts and how
 * items are matched. Read from review when Compare is turned on: an audited read of both.
 */

export type ComparisonState =
  | { status: 'loading' }
  | { status: 'failed' }
  /** Review found no previous version (409). */
  | { status: 'none' }
  | { status: 'ready'; view: ComparisonView };

/** "Compare with version 1": blocked, with why, for a first declaration on Adili. */
export function CompareSwitch({
  checked,
  onCheckedChange,
  previousVersion,
  blocked,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The version compared with, when it is an earlier version of this declaration. */
  previousVersion: number | null;
  blocked: boolean;
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onCheckedChange}
      label={t.compare.toggle(previousVersion)}
      blockedReason={blocked ? t.compare.firstDeclaration : undefined}
    />
  );
}

export function ComparePane({
  state,
  version,
  versions,
  tools,
  onRetry,
  retrying,
}: {
  state: ComparisonState;
  /** "Version 2 of 2": the current version, compared with the previous one. */
  version: string;
  versions: CaseDetail['versions'];
  /** The Compare switch, on the title bar. */
  tools: ReactNode;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <DeclarationCard title={t.compare.title} version={version} tools={tools}>
      {state.status === 'loading' ? (
        <div aria-busy="true" aria-label={t.compare.loading} className="grid gap-[14px] p-5">
          {['45%', '95%', '80%', '90%', '60%', '85%'].map((width, index) => (
            <Skeleton key={index} style={{ width }} />
          ))}
        </div>
      ) : state.status === 'failed' ? (
        <div className="p-5">
          <Alert
            variant="warning"
            role="alert"
            className="gap-x-4 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:items-center"
          >
            <Icon icon={WifiDisconnected01Icon} />
            <div>
              <AlertTitle>{t.compare.failedTitle}</AlertTitle>
              <AlertDescription className="mt-0.5">{t.compare.failedBody}</AlertDescription>
            </div>
            <div className="mt-2.5 min-[560px]:mt-0 min-[560px]:!pl-0">
              <Button variant="secondary" size="sm" onClick={onRetry} disabled={retrying}>
                {retrying ? <Spinner className="size-4" /> : <Icon icon={Refresh01Icon} />}
                {t.declaration.tryAgain}
              </Button>
            </div>
          </Alert>
        </div>
      ) : state.status === 'none' ? (
        <div className="p-5">
          <EmptyState
            icon={<Icon icon={GitCompareIcon} />}
            title={t.compare.noneTitle}
            description={t.compare.noneBody}
          />
        </div>
      ) : (
        <Comparison view={state.view} versions={versions} />
      )}
    </DeclarationCard>
  );
}

function Comparison({
  view,
  versions,
}: {
  view: ComparisonView;
  versions: CaseDetail['versions'];
}) {
  const dateOf = (version: number) => {
    const found = versions.find((each) => each.version === version);
    return found ? formatDate(found.submittedAt) : null;
  };
  const { counts } = view;
  // The last cycle's declaration is numbered on its own, and the case does not carry its date.
  const previous = view.previousIsEarlierVersion
    ? t.compare.versionOn(view.previousVersion, dateOf(view.previousVersion))
    : t.compare.previousDeclaration;
  return (
    <>
      <div className="border-b px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">{t.compare.matched(counts.matched)}</Badge>
          <Badge variant="warning">{t.compare.rulesFlagged(counts.rulesFlagged)}</Badge>
          <Badge variant="warning">{t.compare.oneVersionOnly(counts.oneVersionOnly)}</Badge>
          <span className="ml-auto text-[13px] text-muted-foreground">
            {t.compare.span(
              previous,
              t.compare.versionOn(view.currentVersion, dateOf(view.currentVersion)),
            )}
          </span>
        </div>
        <details className="group mt-2.5 rounded-lg bg-muted text-sm text-secondary-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-3 font-medium text-foreground [&::-webkit-details-marker]:hidden">
            <Icon icon={HelpCircleIcon} className="size-4" />
            {t.compare.howMatched}
            <Icon
              icon={ArrowDown01Icon}
              className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180"
            />
          </summary>
          <p className="px-3.5 pb-3.5 pl-[40px] leading-relaxed">{t.compare.howMatchedBody}</p>
        </details>
      </div>
      {view.statements.map((statement) => (
        <StatementDiff
          key={statement.personKey}
          statement={statement}
          previousVersion={view.previousVersion}
          currentVersion={view.currentVersion}
          previousIsEarlierVersion={view.previousIsEarlierVersion}
        />
      ))}
    </>
  );
}

function StatementDiff({
  statement,
  previousVersion,
  currentVersion,
  previousIsEarlierVersion,
}: {
  statement: ComparedStatement;
  previousVersion: number;
  currentVersion: number;
  previousIsEarlierVersion: boolean;
}) {
  const name = statement.name || t.declaration.unnamed;
  return (
    <section aria-label={name} className="border-b px-5 py-[18px] last:border-b-0">
      <h3 className="mb-3 flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]">
        <PersonAvatar name={statement.name} relation={statement.relation} />
        {name}
        <span className="text-[13px] font-normal text-muted-foreground">
          {statement.relationLabel}
        </span>
      </h3>
      {statement.empty ? (
        <p className="text-[13.5px] text-muted-foreground">{t.compare.nilBoth}</p>
      ) : (
        // Edge to edge in the pane (the cells' own padding lines the text up with the heading),
        // with long descriptions wrapping, so all six columns fit beside the review tools.
        <div className="-mx-2">
          <DiffTable
            className="[&_th[scope=row]]:min-w-[128px] [&_th[scope=row]]:[overflow-wrap:anywhere]"
            caption={t.compare.caption(
              name,
              previousIsEarlierVersion ? previousVersion : null,
              currentVersion,
            )}
            messages={
              previousIsEarlierVersion
                ? undefined
                : { previousColumn: () => t.compare.previousColumn }
            }
            previousVersion={previousVersion}
            currentVersion={currentVersion}
            groups={statement.groups}
          />
        </div>
      )}
    </section>
  );
}
