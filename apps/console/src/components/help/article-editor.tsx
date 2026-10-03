import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  cn,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  FieldHint,
  FilterChip,
  FormField,
  formatDateTime,
  formatNumber,
  Icon,
  Input,
  SegmentedChoice,
  Spinner,
  Switch,
  Textarea,
  useIdempotencyKey,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  FloppyDiskIcon,
  PencilEdit02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Link, useBlocker } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import type { HelpArticle, HelpTag } from '../../server/declarations/client';
import { ITEM_TYPE_TAGS, SECTION_TAGS, TOPIC_TAGS } from '../../server/declarations/help-tags';
import type { HelpResult, HelpScope } from '../../server/help.server';
import { InfoTip } from '../info-tip';
import { NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { messages as m } from './messages';
import {
  type ArticleDraft,
  articleDraft,
  type ArticleErrors,
  articleInputOf,
  articleStatus,
  BODY_MAX,
  previewBlocks,
  problemFieldErrors,
  TITLE_MAX,
  validateArticle,
} from './model';
import { ArticleStatusBadge, inEffect, ReadOnlyBadge, TagChip } from './parts';
import { type HelpWorkspace, useHelpSession } from './scope';

/** Saves an article; the page passes the server function. */
export type SaveArticle = (input: {
  scope: HelpScope;
  articleId: string | null;
  idempotencyKey: string;
  input: ReturnType<typeof articleInputOf>;
}) => Promise<HelpResult<HelpArticle>>;

export interface ArticleEditorProps {
  workspace: HelpWorkspace;
  /** The article as stored; null for a new one. */
  article: HelpArticle | null;
  /** What a new article starts with, e.g. a theme's title and tag. */
  initial?: Partial<ArticleDraft>;
  /** Today in Nairobi, `YYYY-MM-DD`. */
  today: string;
  save: SaveArticle;
  /** After a save: the page reloads the list, and moves a new article to its own address. */
  onSaved: (article: HelpArticle, created: boolean) => void;
  onUnauthenticated: () => void;
}

type DateField = 'effectiveFrom' | 'effectiveTo';

/** Field ids, for the error summary's links and focus. */
const fieldId = (base: string, field: keyof ArticleErrors) => `${base}-${field}`;

const ERROR_ORDER: (keyof ArticleErrors)[] = [
  'title',
  'bodyEn',
  'bodySw',
  'tags',
  'effectiveFrom',
  'effectiveTo',
];

/** A refusal the summary shows on top of any field errors. */
interface Refusal {
  title: string;
  detail?: string;
}

const TAG_GROUPS: { label: string; tags: readonly HelpTag[] }[] = [
  { label: m.tagGroupSections, tags: SECTION_TAGS },
  { label: m.tagGroupItems, tags: ITEM_TYPE_TAGS },
  { label: m.tagGroupTopics, tags: TOPIC_TAGS },
];

const MAX_TAGS = 20;

const TOPIC_SET: ReadonlySet<HelpTag> = new Set(TOPIC_TAGS);

/**
 * The help article editor (spec 11 FE-4, S9): title, body in English and Kiswahili with a
 * preview, tags from the section kinds, item types and corpus topics, the period in force and
 * the publish switch. Checks the form before saving and shows the service's own refusals on the
 * fields; asks before leaving with unsaved changes. Reporting officers get the article to read.
 */
export function ArticleEditor(props: ArticleEditorProps) {
  // Reporting officers read articles; there is nothing to read in a new one.
  if (props.workspace.readOnly && props.article === null) {
    return (
      <Page narrow>
        <PageHead title={m.newArticle} />
        <NoAccess
          text={m.newForbidden}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/help">{m.backToArticles}</Link>
            </Button>
          }
        />
      </Page>
    );
  }
  return <ArticleForm {...props} />;
}

function ArticleForm({
  workspace,
  article,
  initial,
  today,
  save,
  onSaved,
  onUnauthenticated,
}: ArticleEditorProps) {
  const base = useId();
  const { toast } = useToast();
  const session = useHelpSession();
  const keys = useIdempotencyKey();
  const readOnly = workspace.readOnly;
  const [baseline, setBaseline] = useState<ArticleDraft>(() => ({
    ...articleDraft(article, today),
    ...(article ? {} : initial),
  }));
  const [draft, setDraft] = useState<ArticleDraft>(baseline);
  const [invalidDates, setInvalidDates] = useState<DateField[]>([]);
  const [language, setLanguage] = useState<'en' | 'sw'>('en');
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [errors, setErrors] = useState<ArticleErrors>({});
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [saving, setSaving] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const [focusSummary, setFocusSummary] = useState(0);

  const dirty = !readOnly && JSON.stringify(draft) !== JSON.stringify(baseline);
  // Set on a save, so the move to a new article's own address that follows is not blocked by
  // the render that has not caught up yet; cleared by the next change.
  const justSaved = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => !justSaved.current && dirty && !saving,
    enableBeforeUnload: dirty,
    withResolver: true,
  });

  useEffect(() => {
    if (focusSummary > 0) summary.current?.focus();
  }, [focusSummary]);

  const change = (patch: Partial<ArticleDraft>) => {
    justSaved.current = false;
    setDraft((current) => ({ ...current, ...patch }));
  };

  const submit = async () => {
    if (saving) return;
    const found = validateArticle(draft, invalidDates);
    setRefusal(null);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (found.bodyEn) setLanguage('en');
      else if (found.bodySw) setLanguage('sw');
      setMode('write');
      setFocusSummary((count) => count + 1);
      return;
    }
    const input = articleInputOf(draft);
    setSaving(true);
    const result = await save({
      scope: workspace.scope,
      articleId: article?.id ?? null,
      idempotencyKey: keys.keyFor(input),
      input,
    }).catch((): HelpResult<HelpArticle> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
    setSaving(false);
    if (result.ok) {
      keys.reset();
      const saved = articleDraft(result.data, today);
      setBaseline(saved);
      setDraft(saved);
      setErrors({});
      justSaved.current = true;
      const nowInForce = articleStatus(result.data, today) === 'published';
      const wasInForce = article ? articleStatus(article, today) === 'published' : false;
      if (nowInForce && !wasInForce) {
        session.setJustPublished(result.data.id);
        toast({
          title:
            workspace.scope.kind === 'platform'
              ? m.publishedToastPlatform
              : m.publishedToastCommission,
        });
      } else {
        toast({ title: m.savedToast(result.data.version) });
      }
      onSaved(result.data, article === null);
      return;
    }
    const { error } = result;
    if (error.kind === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    if (error.kind === 'problem' && error.problem.status === 400) {
      const fields = problemFieldErrors(error.problem);
      setErrors(fields);
      setRefusal({
        title: m.refusedTitle,
        ...(Object.keys(fields).length === 0 ? { detail: m.refusedDetail } : {}),
      });
    } else if (error.kind === 'problem' && error.problem.status === 403) {
      setRefusal({ title: m.refusedTitle, detail: m.forbiddenSave });
    } else if (error.kind === 'problem' && error.problem.status === 404) {
      setRefusal({ title: m.articleNotFound, detail: m.articleNotFoundText });
    } else if (error.kind === 'problem') {
      // Problem titles and details are the service's words, not copy (ProblemDetails).
      setRefusal({ title: m.refusedTitle, detail: m.refusedDetail });
    } else {
      setRefusal({ title: m.saveFailedTitle, detail: m.saveFailedDetail });
    }
    setFocusSummary((count) => count + 1);
  };

  const errorList = ERROR_ORDER.flatMap((field) => {
    const message = errors[field];
    return message ? [{ field, message }] : [];
  });
  const focusField = (field: keyof ArticleErrors) => {
    if (field === 'bodyEn' || field === 'bodySw') {
      setLanguage(field === 'bodyEn' ? 'en' : 'sw');
      setMode('write');
      // The textarea for that language renders on the next frame.
      requestAnimationFrame(() => document.getElementById(fieldId(base, field))?.focus());
      return;
    }
    document.getElementById(fieldId(base, field))?.focus();
  };

  const title = article ? article.title : m.newArticle;
  const status = article ? articleStatus(article, today) : null;

  return (
    <Page>
      <PageHead
        title={title}
        actions={
          readOnly ? (
            <ReadOnlyBadge />
          ) : (
            <>
              <Button asChild variant="secondary" disabled={saving}>
                <Link to="/help">{m.cancel}</Link>
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={saving}
                aria-busy={saving || undefined}
              >
                {saving ? <Spinner className="size-3.5" /> : <Icon icon={FloppyDiskIcon} />}
                {saving ? m.saving : m.save}
              </Button>
            </>
          )
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-muted-foreground">
          {article && status ? (
            <>
              <ArticleStatusBadge status={status} />
              <span>{m.versionUpdated(article.version, formatDateTime(article.updatedAt))}</span>
            </>
          ) : (
            <Badge>
              <Icon icon={PencilEdit02Icon} className="size-3" strokeWidth={2.2} />
              {m.notSaved}
            </Badge>
          )}
        </div>
      </PageHead>
      {errorList.length > 0 || refusal ? (
        <Alert
          ref={summary}
          variant="destructive"
          tabIndex={-1}
          aria-labelledby={`${base}-summary`}
          className="mb-4 outline-none"
        >
          <Icon icon={AlertCircleIcon} />
          <AlertTitle id={`${base}-summary`}>
            {refusal ? refusal.title : m.fixErrors(errorList.length)}
          </AlertTitle>
          <AlertDescription>
            {refusal?.detail ? <p>{refusal.detail}</p> : null}
            {errorList.length > 0 ? (
              <ul className="mt-1.5 list-disc pl-[18px]">
                {errorList.map(({ field, message }) => (
                  <li key={field}>
                    <a
                      href={`#${fieldId(base, field)}`}
                      className="underline underline-offset-2"
                      onClick={(event) => {
                        event.preventDefault();
                        focusField(field);
                      }}
                    >
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid items-start gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="grid gap-4 p-5 sm:p-5">
          {readOnly ? null : (
            <FormField label={m.fieldTitle} controlId={fieldId(base, 'title')} error={errors.title}>
              <Input
                value={draft.title}
                maxLength={TITLE_MAX + 20}
                onChange={(event) => {
                  change({ title: event.target.value });
                }}
              />
            </FormField>
          )}
          <BodyField
            base={base}
            draft={draft}
            readOnly={readOnly}
            language={language}
            onLanguageChange={setLanguage}
            mode={mode}
            onModeChange={setMode}
            errors={errors}
            onChange={change}
          />
        </Card>
        <div className="grid gap-4">
          <SideCard title={m.publishing}>
            {readOnly && article ? (
              <dl className="grid grid-cols-2 gap-3 text-[14px]">
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">{m.statusLabel}</dt>
                  <dd className="mt-1">
                    <ArticleStatusBadge status={articleStatus(article, today)} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">{m.inEffectLabel}</dt>
                  <dd className="mt-1 font-medium">{inEffect(article)}</dd>
                </div>
              </dl>
            ) : (
              <>
                <PublishSwitch
                  published={draft.published}
                  scope={workspace.scope}
                  onChange={(published) => {
                    change({ published });
                  }}
                />
                <div className="grid gap-3">
                  <DateField
                    id={fieldId(base, 'effectiveFrom')}
                    label={m.inEffectFromLabel}
                    value={draft.effectiveFrom}
                    today={today}
                    error={errors.effectiveFrom}
                    onChange={(value, invalid) => {
                      change({ effectiveFrom: value });
                      setInvalidDates((current) => mark(current, 'effectiveFrom', invalid));
                    }}
                  />
                  <DateField
                    id={fieldId(base, 'effectiveTo')}
                    label={
                      <>
                        {m.untilLabel}{' '}
                        <span className="font-normal text-muted-foreground">({m.optional})</span>
                      </>
                    }
                    value={draft.effectiveTo}
                    today={today}
                    error={errors.effectiveTo}
                    onChange={(value, invalid) => {
                      change({ effectiveTo: value });
                      setInvalidDates((current) => mark(current, 'effectiveTo', invalid));
                    }}
                  />
                </div>
                <FieldHint>{m.untilHint}</FieldHint>
              </>
            )}
          </SideCard>
          <SideCard title={m.tags} count={readOnly ? undefined : draft.tags.length} tip={m.tagsTip}>
            <TagPicker
              id={fieldId(base, 'tags')}
              tags={draft.tags}
              readOnly={readOnly}
              error={errors.tags}
              onChange={(tags) => {
                change({ tags });
              }}
            />
          </SideCard>
        </div>
      </div>
      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.leaveTitle}</DialogTitle>
            <DialogDescription>{m.leaveText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              {m.keepEditing}
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              {m.discard}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function mark(current: DateField[], field: DateField, invalid: boolean): DateField[] {
  const without = current.filter((each) => each !== field);
  return invalid ? [...without, field] : without;
}

function SideCard({
  title,
  count,
  tip,
  children,
}: {
  title: string;
  count?: number;
  tip?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <Card role="region" aria-labelledby={headingId} className="p-0 sm:p-0">
      <div className="flex items-center gap-2 border-b px-5 py-3.5">
        <h2 id={headingId} className="text-[15px] font-semibold">
          {title}
        </h2>
        {count !== undefined ? <Badge>{count}</Badge> : null}
        {tip ? <InfoTip content={tip} label={tip} className="text-muted-foreground" /> : null}
      </div>
      <div className="grid gap-3.5 px-5 py-4">{children}</div>
    </Card>
  );
}

function BodyField({
  base,
  draft,
  readOnly,
  language,
  onLanguageChange,
  mode,
  onModeChange,
  errors,
  onChange,
}: {
  base: string;
  draft: ArticleDraft;
  readOnly: boolean;
  language: 'en' | 'sw';
  onLanguageChange: (language: 'en' | 'sw') => void;
  mode: 'write' | 'preview';
  onModeChange: (mode: 'write' | 'preview') => void;
  errors: ArticleErrors;
  onChange: (patch: Partial<ArticleDraft>) => void;
}) {
  const field = language === 'en' ? 'bodyEn' : 'bodySw';
  const value = draft[field];
  const error = errors[field];
  const errorId = `${fieldId(base, field)}-error`;
  const hintId = `${fieldId(base, field)}-hint`;
  const showPreview = readOnly || mode === 'preview';
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-medium">{readOnly ? m.text : m.body}</span>
        <SegmentedChoice
          variant="track"
          legend={m.language}
          value={language}
          options={[
            { value: 'en', label: m.english },
            { value: 'sw', label: m.kiswahili },
          ]}
          onValueChange={(value) => {
            onLanguageChange(value === 'sw' ? 'sw' : 'en');
          }}
        />
        {readOnly ? null : (
          <SegmentedChoice
            variant="track"
            legend={m.view}
            className="ml-auto"
            value={mode}
            options={[
              { value: 'write', label: m.write },
              { value: 'preview', label: m.preview },
            ]}
            onValueChange={(value) => {
              onModeChange(value === 'preview' ? 'preview' : 'write');
            }}
          />
        )}
      </div>
      {showPreview ? (
        <div
          lang={language}
          aria-live={readOnly ? undefined : 'polite'}
          className="min-h-[300px] rounded-lg border bg-card px-[18px] py-4 text-[15px] leading-[1.65]"
        >
          {readOnly && language === 'sw' && !draft.bodySw ? (
            <p className="text-muted-foreground">{m.noKiswahiliRead}</p>
          ) : (
            <Preview body={value} />
          )}
        </div>
      ) : (
        <Textarea
          key={field}
          id={fieldId(base, field)}
          lang={language}
          rows={12}
          value={value}
          aria-label={language === 'en' ? m.bodyEnLabel : m.bodySwLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : language === 'sw' ? hintId : undefined}
          placeholder={language === 'en' ? m.bodyEnPlaceholder : m.bodySwPlaceholder}
          className="min-h-[300px] text-[14.5px] leading-[1.6]"
          onChange={(event) => {
            onChange({ [field]: event.target.value });
          }}
        />
      )}
      {readOnly ? null : (
        <div className="flex items-start gap-2.5">
          {error ? (
            <FieldError id={errorId}>{error}</FieldError>
          ) : language === 'sw' ? (
            <FieldHint id={hintId}>{m.kiswahiliOptional}</FieldHint>
          ) : null}
          <span
            className={cn(
              'ml-auto text-xs text-muted-foreground tabular-nums',
              value.length > BODY_MAX && 'text-destructive',
            )}
          >
            {m.characters(formatNumber(value.length), formatNumber(BODY_MAX))}
          </span>
        </div>
      )}
    </div>
  );
}

function Preview({ body }: { body: string }) {
  const blocks = previewBlocks(body);
  if (blocks.length === 0) return <p className="text-muted-foreground">{m.nothingToPreview}</p>;
  return (
    <div className="grid gap-2.5">
      {blocks.map((block, index) =>
        block.kind === 'list' ? (
          <ul key={index} className="list-disc pl-5">
            {block.items.map((runs, item) => (
              <li key={item}>
                <Runs runs={runs} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            {block.lines.map((runs, line) => (
              <span key={line}>
                {line > 0 ? <br /> : null}
                <Runs runs={runs} />
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

function Runs({ runs }: { runs: { text: string; bold: boolean }[] }) {
  return runs.map((run, index) =>
    run.bold ? <b key={index}>{run.text}</b> : <span key={index}>{run.text}</span>,
  );
}

function PublishSwitch({
  published,
  scope,
  onChange,
}: {
  published: boolean;
  scope: HelpScope;
  onChange: (published: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div className="grid gap-1">
      <Switch
        checked={published}
        onCheckedChange={onChange}
        label={m.published}
        aria-describedby={hintId}
        className="justify-self-start"
      />
      <p id={hintId} className="text-[13px] text-muted-foreground">
        {published
          ? scope.kind === 'platform'
            ? m.publishedHintPlatform
            : m.publishedHintCommission
          : m.notPublishedHint}
      </p>
    </div>
  );
}

function DateField({
  id,
  label,
  value,
  today,
  error,
  onChange,
}: {
  id: string;
  label: ReactNode;
  value: string;
  today: string;
  error: string | undefined;
  onChange: (value: string, invalid: boolean) => void;
}) {
  return (
    <FormField label={label} controlId={id} error={error}>
      <DateInput
        value={value || null}
        today={today}
        onValueChange={(iso, { invalid }) => {
          onChange(iso ?? '', invalid);
        }}
      />
    </FormField>
  );
}

function TagPicker({
  id,
  tags,
  readOnly,
  error,
  onChange,
}: {
  id: string;
  tags: HelpTag[];
  readOnly: boolean;
  error: string | undefined;
  onChange: (tags: HelpTag[]) => void;
}) {
  const topicsId = useId();
  // Open when a topic is chosen already, so no chosen tag is out of sight.
  const [showTopics, setShowTopics] = useState(() => tags.some((tag) => TOPIC_SET.has(tag)));
  if (readOnly) {
    if (tags.length === 0) return <p className="text-[13px] text-muted-foreground">{m.noTags}</p>;
    return (
      <div className="grid gap-3">
        {TAG_GROUPS.filter((group) => group.tags.some((tag) => tags.includes(tag))).map((group) => (
          <TagGroup key={group.label} label={group.label}>
            {group.tags
              .filter((tag) => tags.includes(tag))
              .map((tag) => (
                <li key={tag}>
                  <TagChip tag={tag} />
                </li>
              ))}
          </TagGroup>
        ))}
      </div>
    );
  }
  const full = tags.length >= MAX_TAGS;
  const chosenTopics = tags.filter((tag) => TOPIC_SET.has(tag)).length;
  return (
    <div id={id} tabIndex={-1} className="grid gap-3 outline-none">
      {TAG_GROUPS.map((group) => {
        const topics = group.tags === TOPIC_TAGS;
        const toggle = topics ? (
          <Button
            key="toggle"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            aria-expanded={showTopics}
            aria-controls={topicsId}
            onClick={() => {
              setShowTopics((shown) => !shown);
            }}
          >
            {showTopics ? m.hideTopics : m.showTopics(TOPIC_TAGS.length, chosenTopics)}
          </Button>
        ) : null;
        // The same element list either way, so the toggle stays mounted (and keeps focus).
        if (topics && !showTopics) return [toggle];
        return [
          toggle,
          <TagGroup key={group.label} id={topics ? topicsId : undefined} label={group.label}>
            {group.tags.map((tag) => {
              const on = tags.includes(tag);
              return (
                <li key={tag}>
                  <FilterChip
                    pressed={on}
                    disabled={!on && full}
                    icon={on ? Tick02Icon : undefined}
                    className="h-7 px-2.5 text-[13px]"
                    onPressedChange={(pressed) => {
                      onChange(pressed ? [...tags, tag] : tags.filter((each) => each !== tag));
                    }}
                  >
                    {m.tag[tag]}
                  </FilterChip>
                </li>
              );
            })}
          </TagGroup>,
        ];
      })}
      {full ? <FieldHint>{m.tagsMax}</FieldHint> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

function TagGroup({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div id={id}>
      <p
        id={labelId}
        className="mb-2 text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase"
      >
        {label}
      </p>
      <ul aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {children}
      </ul>
    </div>
  );
}
