import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  EmptyState,
  formatNumber,
  Icon,
  Select,
  SelectItem,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  RefreshIcon,
  Search01Icon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useState } from 'react';

import type {
  CorpusImportResult,
  CorpusPassage,
  CorpusPassageText,
} from '../../server/declarations/client';
import type { HelpResult } from '../../server/help.server';
import { CursorPager } from '../cursor-pager';
import { InfoTip } from '../info-tip';
import { LoadError } from '../load-error';
import { Page } from '../page';
import { clientPage } from '../paging';
import { SearchBox } from '../search-box';
import { messages as m } from './messages';
import {
  CORPUS_PAGE_SIZE,
  CORPUS_SOURCES,
  type CorpusSearch,
  corpusVersion,
  filterCorpus,
  isSuperseded,
} from './model';
import { CitationTag, HelpHeader, inEffect, TagChip } from './parts';
import type { HelpWorkspace } from './scope';
import { HelpSearchButton } from './help-search-button';

export type LoadPassage = (passageId: string) => Promise<HelpResult<CorpusPassageText>>;
export type ImportCorpus = () => Promise<HelpResult<CorpusImportResult>>;

export interface CorpusViewProps {
  workspace: HelpWorkspace;
  /** Every stored wording; null while it loads. */
  result: HelpResult<CorpusPassage[]> | null;
  search: CorpusSearch;
  onSearchChange: (next: CorpusSearch) => void;
  today: string;
  loadPassage: LoadPassage;
  importCorpus: ImportCorpus;
  onUnauthenticated: () => void;
}

/**
 * The legal corpus (spec 11 FE-4, S9), read-only for platform admins: every wording of the Act,
 * Regulations and Administrative Mechanisms the service imported, with its period in force and
 * version, superseded ones on request; one wording's text in a drawer; and the re-import of the
 * corpus deployed with the service. Filters and page apply in the browser.
 */
export function CorpusView({
  workspace,
  result,
  search,
  onSearchChange,
  today,
  loadPassage,
  importCorpus,
  onUnauthenticated,
}: CorpusViewProps) {
  const id = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const passages = result?.ok ? result.data : null;
  const shown = passages ? filterCorpus(passages, search, today) : [];
  const page = clientPage(shown, search.page, CORPUS_PAGE_SIZE);
  const open = passages?.find((each) => each.id === openId) ?? null;
  const inForce = passages ? passages.filter((each) => !isSuperseded(each, today)) : [];
  const version = passages ? corpusVersion(inForce) : null;
  const setFilters = (patch: Partial<Pick<CorpusSearch, 'q' | 'source' | 'old'>>) => {
    onSearchChange({ ...search, ...patch, page: undefined });
  };

  return (
    <Page>
      <HelpHeader
        workspace={workspace}
        current="corpus"
        actions={
          <>
            <HelpSearchButton scope={workspace.scope} />
            <Button
              variant="secondary"
              aria-haspopup="dialog"
              disabled={importing || passages === null}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {importing ? <Spinner className="size-3.5" /> : <Icon icon={RefreshIcon} />}
              {importing ? m.importing : m.reimport}
            </Button>
          </>
        }
      />
      <Card className="overflow-hidden p-0 sm:p-0">
        <div className="flex items-center gap-2 border-b px-4 py-3 text-[13px] text-muted-foreground">
          <Icon icon={SquareLock02Icon} className="size-3.5" />
          {passages === null ? (
            <Skeleton className="w-60" />
          ) : (
            <span>
              {version
                ? m.corpusMeta(version, formatNumber(inForce.length))
                : m.corpusMeta('-', formatNumber(inForce.length))}
            </span>
          )}
          <InfoTip content={m.corpusTip} label={m.corpusTip} />
        </div>
        <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <SearchBox
            id={`${id}-search`}
            label={m.corpusSearchLabel}
            placeholder={m.corpusSearchPlaceholder}
            maxLength={100}
            applied={search.q ?? ''}
            disabled={passages === null}
            onSearch={(value) => {
              setFilters({ q: value || undefined });
            }}
          />
          <label htmlFor={`${id}-source`} className="sr-only">
            {m.sourceLabel}
          </label>
          <Select
            id={`${id}-source`}
            value={search.source ?? 'all'}
            disabled={passages === null}
            className="h-9 w-auto min-w-[150px] text-sm"
            onValueChange={(value) => {
              const source = CORPUS_SOURCES.find((each) => each === value);
              setFilters({ source });
            }}
          >
            <SelectItem value="all">{m.allSources}</SelectItem>
            {CORPUS_SOURCES.map((source) => (
              <SelectItem key={source} value={source}>
                {m.source[source]}
              </SelectItem>
            ))}
          </Select>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={search.old ?? false}
              disabled={passages === null}
              onChange={(event) => {
                setFilters({ old: event.target.checked || undefined });
              }}
            />
            {m.showSuperseded}
          </label>
        </div>
        {result && !result.ok ? (
          <div className="p-4">
            <LoadError
              title={m.corpusLoadError}
              detail={m.loadErrorDetail}
              retryLabel={m.tryAgain}
            />
          </div>
        ) : passages === null ? (
          <CorpusSkeleton />
        ) : passages.length === 0 ? (
          <EmptyState
            icon={<Icon icon={SquareLock02Icon} />}
            title={m.corpusEmpty}
            description={m.corpusEmptyText}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.corpusNoMatches}
            description={m.corpusNoMatchesText}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onSearchChange({});
                }}
              >
                {m.clearFilters}
              </Button>
            }
          />
        ) : (
          <>
            <Table caption={m.corpusCaption}>
              <TableHeader className="max-sm:sr-only">
                <TableRow>
                  <TableHead>{m.columnCitation}</TableHead>
                  <TableHead>{m.columnTitle}</TableHead>
                  <TableHead>{m.columnInEffect}</TableHead>
                  <TableHead className="text-right">{m.columnVersion}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((passage) => (
                  <TableRow
                    key={passage.id}
                    className="max-sm:grid max-sm:gap-y-1.5 max-sm:px-4 max-sm:py-3.5"
                  >
                    <TableCell className="whitespace-nowrap max-sm:p-0 max-sm:first:pl-0">
                      <CitationTag citation={passage.citation} />
                    </TableCell>
                    <TableHead
                      scope="row"
                      className="min-w-[240px] py-3 font-normal whitespace-normal max-sm:min-w-0 max-sm:p-0"
                    >
                      <TableRowLink asChild>
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          className="cursor-pointer text-left"
                          onClick={() => {
                            setOpenId(passage.id);
                          }}
                        >
                          {passage.title}
                        </button>
                      </TableRowLink>
                      <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                        {m.source[passage.source]}
                      </span>
                    </TableHead>
                    <TableCell className="whitespace-nowrap max-sm:p-0 max-sm:text-[13px] max-sm:text-muted-foreground">
                      {inEffect(passage)}
                      {isSuperseded(passage, today) ? (
                        <span className="mt-1 block max-sm:ml-2 max-sm:inline">
                          <Badge>{m.superseded}</Badge>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12.5px] text-muted-foreground max-sm:p-0 max-sm:text-left max-sm:last:pr-0">
                      {passage.version}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {page.pages > 1 ? (
              <CursorPager
                labels={{
                  pagination: m.pagination,
                  pageRange: (from, to) => m.pageRange(from, to, shown.length),
                  pageRows: m.pageRows,
                  previousPage: m.previousPage,
                  nextPage: m.nextPage,
                }}
                range={{ from: page.from, to: page.to }}
                rows={page.rows.length}
                hasPrevious={page.page > 1}
                hasNext={page.page < page.pages}
                onPrevious={() => {
                  onSearchChange({ ...search, page: page.page > 2 ? page.page - 1 : undefined });
                }}
                onNext={() => {
                  onSearchChange({ ...search, page: page.page + 1 });
                }}
              />
            ) : null}
          </>
        )}
      </Card>
      <PassageDrawer
        passage={open}
        today={today}
        load={loadPassage}
        onClose={() => {
          setOpenId(null);
        }}
        onUnauthenticated={onUnauthenticated}
      />
      <ReimportDialog
        open={confirming}
        version={version}
        onCancel={() => {
          setConfirming(false);
        }}
        importCorpus={importCorpus}
        onImporting={setImporting}
        onUnauthenticated={onUnauthenticated}
      />
    </Page>
  );
}

function CorpusSkeleton() {
  return (
    <Table caption={m.corpusCaption} aria-busy="true">
      <TableBody>
        {Array.from({ length: 6 }, (_, row) => (
          <TableRow key={row}>
            <TableCell>
              <Skeleton className="w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="w-60 max-w-full" />
              <Skeleton className="mt-1.5 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="w-28" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto w-14" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type PassageLoad = { id: string; result: HelpResult<CorpusPassageText> | null } | null;

/** One wording's text, read when its drawer opens. */
function PassageDrawer({
  passage,
  today,
  load,
  onClose,
  onUnauthenticated,
}: {
  passage: CorpusPassage | null;
  today: string;
  load: LoadPassage;
  onClose: () => void;
  onUnauthenticated: () => void;
}) {
  const [loaded, setLoaded] = useState<PassageLoad>(null);
  const passageId = passage?.id ?? null;
  useEffect(() => {
    if (!passageId) return;
    let current = true;
    void load(passageId)
      .catch((): HelpResult<CorpusPassageText> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }))
      .then((result) => {
        if (!current) return;
        if (!result.ok && result.error.kind === 'unauthenticated') {
          onUnauthenticated();
          return;
        }
        setLoaded({ id: passageId, result });
      });
    return () => {
      current = false;
    };
  }, [passageId, load, onUnauthenticated]);
  const result = loaded?.id === passageId ? loaded.result : null;
  const text = result?.ok ? result.data : null;

  return (
    <Drawer
      open={passage !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {passage ? (
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{passage.title}</DrawerTitle>
            <DrawerDescription asChild>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <CitationTag citation={passage.citation} />
                <Badge>{m.source[passage.source]}</Badge>
                {isSuperseded(passage, today) ? <Badge>{m.superseded}</Badge> : null}
              </div>
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody className="gap-5">
            <dl className="grid grid-cols-2 gap-3 text-[14px]">
              <div>
                <dt className="text-[12.5px] text-muted-foreground">{m.inEffectLabel}</dt>
                <dd className="mt-1 font-medium">{inEffect(passage)}</dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-muted-foreground">{m.columnVersion}</dt>
                <dd className="mt-1 font-mono text-[13px]">{passage.version}</dd>
              </div>
            </dl>
            {result && !result.ok ? (
              <Alert variant="destructive">
                <Icon icon={AlertCircleIcon} />
                <AlertDescription>{m.passageLoadError}</AlertDescription>
              </Alert>
            ) : (
              <>
                <PassageText label={m.english} lang="en" text={text?.textEn} loading={!text} />
                <PassageText
                  label={m.kiswahili}
                  lang="sw"
                  text={text?.textSw}
                  loading={!text}
                  missing={m.passageNoKiswahili}
                />
              </>
            )}
            <div>
              <p className="mb-1.5 text-sm font-medium">{m.tags}</p>
              {passage.tags.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {passage.tags.map((tag) => (
                    <li key={tag}>
                      <TagChip tag={tag} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted-foreground">{m.noTags}</p>
              )}
            </div>
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Icon icon={SquareLock02Icon} className="size-3.5" />
              {m.passageReadOnly}
            </p>
          </DrawerBody>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function PassageText({
  label,
  lang,
  text,
  loading,
  missing,
}: {
  label: string;
  lang: 'en' | 'sw';
  text: string | null | undefined;
  loading: boolean;
  missing?: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      {loading ? (
        <div aria-busy="true" className="grid gap-2 rounded-lg border p-4">
          <Skeleton className="w-full" />
          <Skeleton className="w-4/5" />
        </div>
      ) : text ? (
        <p
          lang={lang}
          className="rounded-lg border bg-card px-4 py-3.5 text-[14.5px] leading-[1.65] whitespace-pre-wrap"
        >
          {text}
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">{missing}</p>
      )}
    </div>
  );
}

function ReimportDialog({
  open,
  version,
  onCancel,
  importCorpus,
  onImporting,
  onUnauthenticated,
}: {
  open: boolean;
  version: string | null;
  onCancel: () => void;
  importCorpus: ImportCorpus;
  onImporting: (importing: boolean) => void;
  onUnauthenticated: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const run = async () => {
    onCancel();
    onImporting(true);
    const result = await importCorpus().catch((): HelpResult<CorpusImportResult> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
    onImporting(false);
    if (result.ok) {
      const { skipped, inserted, updated, removed } = result.data;
      toast({ title: skipped ? m.reimportSkipped : m.reimported(inserted, updated, removed) });
      if (!skipped) void router.invalidate();
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    toast({ title: m.reimportFailed, urgency: 'assertive' });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.reimportTitle}</DialogTitle>
          <DialogDescription>{m.reimportText}</DialogDescription>
        </DialogHeader>
        {version ? (
          <DialogBody>
            <dl className="text-[14px]">
              <dt className="text-[12.5px] text-muted-foreground">{m.currentVersion}</dt>
              <dd className="mt-1 font-mono text-[13px]">{version}</dd>
            </dl>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            {m.cancel}
          </Button>
          <Button onClick={() => void run()}>
            <Icon icon={RefreshIcon} />
            {m.reimport}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
