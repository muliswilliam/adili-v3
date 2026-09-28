import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  FormField,
  Icon,
  Input,
  RadioCard,
  RadioGroup,
  Skeleton,
  useToast,
} from '@adili/ui';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  AlertCircleIcon,
  HashtagIcon,
  Link04Icon,
  Loading03Icon,
  ServerStack01Icon,
} from '@hugeicons/core-free-icons';
import { type SyntheticEvent, useId, useRef, useState } from 'react';

import {
  checkDraft,
  checkField,
  CREATE_FIELDS,
  type CreateDraft,
  type CreateField,
  EMPTY_DRAFT,
  type FieldErrors,
  issuerCodeOf,
  normaliseSlug,
  type SubmitFailure,
  submitFailure,
} from '../../components/commissions/create-form';
import { messages as m } from '../../components/commissions/messages';
import { LoadError, NoAccess } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { goToSignIn, signInRedirect } from '../../components/sign-in-redirect';
import { createCommission, listOfficerCategories } from '../../server/commissions';
import type { OfficerCategory } from '../../server/directory/client';

export const Route = createFileRoute('/commissions/new')({
  loader: async ({ location }) => {
    const result = await listOfficerCategories();
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.createTitle} · Adili Online Console` }] }),
  staticData: { crumb: m.createTitle },
  pendingComponent: CreateSkeleton,
  component: CreateCommissionPage,
});

function CreateCommissionPage() {
  const { workspace } = Route.useRouteContext();
  const categories = Route.useLoaderData();
  const readOnly = workspace?.readOnly ?? true;

  return (
    <Page narrow>
      <PageHead title={m.createTitle} />
      {readOnly ? (
        <NoAccess
          text={m.createForbidden}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/commissions">{m.backToCommissions}</Link>
            </Button>
          }
        />
      ) : categories.ok ? (
        <CreateCommissionForm categories={categories.data} />
      ) : (
        <LoadError
          title={m.categoriesLoadError}
          detail={
            (categories.error.kind === 'unavailable' ? categories.error.detail : null) ??
            m.errorDetail
          }
          retryLabel={m.tryAgain}
        />
      )}
    </Page>
  );
}

type Alerted = Exclude<SubmitFailure['alert'], null>;

interface FormState {
  draft: CreateDraft;
  errors: FieldErrors;
  /** Set after the first submit: fields are then re-checked as they change. */
  submitted: boolean;
  /** Messages the directory sent that name no form field. */
  unmapped: string[];
  /** Show "Fix N fields to continue": after client validation and server 400s, not 409s. */
  summary: boolean;
  alert: Alerted | null;
  submitting: boolean;
}

/**
 * The create form (spec 01, Create Commission). One Idempotency-Key per form instance: it is
 * made on the first submit, kept across retries after network errors and 5xx, and replaced once
 * the directory has stored an outcome for it (success, 4xx) so a corrected request is not
 * refused as a reused key.
 */
function CreateCommissionForm({ categories }: { categories: OfficerCategory[] }) {
  const id = useId();
  const navigate = useNavigate();
  const { toast } = useToast();
  const idempotencyKey = useRef<string | null>(null);
  const alertsRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<FormState>({
    draft: EMPTY_DRAFT,
    errors: {},
    submitted: false,
    unmapped: [],
    summary: false,
    alert: null,
    submitting: false,
  });
  const { draft, errors, submitting } = state;
  const controlId = (field: CreateField) => `${id}-${field}`;

  const change = <K extends keyof CreateDraft>(field: K, value: CreateDraft[K]) => {
    setState((previous) => {
      const next = { ...previous.draft, [field]: value };
      const errors = { ...previous.errors };
      // Re-check the edited field only; a server error on another field stays until resubmit.
      errors[field] = previous.submitted ? checkField(next, field) : undefined;
      return { ...previous, draft: next, errors };
    });
  };

  /** Moves focus to the first invalid field, or else to the alerts, so the outcome is seen. */
  const focusFirstInvalid = (fieldErrors: FieldErrors) => {
    const field = CREATE_FIELDS.find((name) => fieldErrors[name]);
    // After React has rendered the error state.
    requestAnimationFrame(() => {
      if (!field) {
        alertsRef.current?.focus();
        return;
      }
      const target =
        field === 'type' || field === 'categories'
          ? (document.querySelector<HTMLInputElement>(`[data-field="${field}"] input:checked`) ??
            document.querySelector<HTMLInputElement>(`[data-field="${field}"] input`))
          : document.getElementById(controlId(field));
      target?.focus();
    });
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const check = checkDraft(draft);
    if (!check.ok) {
      setState((previous) => ({
        ...previous,
        errors: check.errors,
        submitted: true,
        unmapped: [],
        summary: true,
        alert: null,
      }));
      focusFirstInvalid(check.errors);
      return;
    }

    setState((previous) => ({
      ...previous,
      errors: {},
      submitted: true,
      unmapped: [],
      summary: false,
      alert: null,
      submitting: true,
    }));
    idempotencyKey.current ??= crypto.randomUUID();
    const result = await createCommission({
      data: { idempotencyKey: idempotencyKey.current, commission: check.commission },
    }).catch(() => ({ ok: false as const, error: { kind: 'unavailable' as const, detail: null } }));

    if (result.ok) {
      idempotencyKey.current = null;
      toast({ title: m.createdToast(result.data.name) });
      await navigate({ to: '/commissions/$slug', params: { slug: result.data.slug } });
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      goToSignIn('/commissions/new');
      return;
    }
    const failure = submitFailure(result.error, draft);
    if (failure.newKey) idempotencyKey.current = null;
    setState((previous) => ({
      ...previous,
      errors: failure.fieldErrors,
      unmapped: failure.unmapped,
      summary:
        failure.unmapped.length > 0 ||
        (result.error.kind === 'problem' && result.error.problem.status === 400),
      alert: failure.alert,
      submitting: false,
    }));
    focusFirstInvalid(failure.fieldErrors);
  };

  const invalidCount = CREATE_FIELDS.filter((field) => errors[field]).length;
  const issuerCode = issuerCodeOf(draft.slug);

  return (
    <Card className="p-0 sm:p-0">
      <form noValidate onSubmit={(event) => void submit(event)} aria-busy={submitting}>
        {/* Disabling the fieldset disables every control while the request is in flight. */}
        <fieldset disabled={submitting} className="m-0 grid min-w-0 gap-6 border-0 p-5 sm:p-7">
          <div ref={alertsRef} tabIndex={-1} className="grid gap-4 outline-none empty:hidden">
            {state.summary && (invalidCount > 0 || state.unmapped.length > 0) ? (
              <Alert variant="destructive">
                <Icon icon={AlertCircleIcon} />
                <AlertTitle>
                  {invalidCount > 0 ? m.fixFields(invalidCount) : m.createError}
                </AlertTitle>
                {state.unmapped.length > 0 ? (
                  <AlertDescription>
                    <p>{m.unmappedErrors}</p>
                    <ul className="mt-1 list-disc pl-5">
                      {state.unmapped.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                ) : null}
              </Alert>
            ) : null}
            {state.alert ? <SubmitAlert alert={state.alert} /> : null}
          </div>

          <FormField
            label={m.name}
            hint={m.nameHint}
            error={errors.name}
            controlId={controlId('name')}
          >
            <Input
              value={draft.name}
              autoComplete="off"
              maxLength={140}
              onChange={(event) => {
                change('name', event.target.value);
              }}
            />
          </FormField>

          <FormField
            label={m.commissionKey}
            error={errors.slug}
            controlId={controlId('slug')}
            hint={
              issuerCode ? (
                <span
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-secondary-foreground"
                >
                  <Icon icon={HashtagIcon} className="mt-0.5 size-3.5 text-muted-foreground" />
                  <span>
                    {m.slugPreviewLead}{' '}
                    <span className="font-mono font-semibold text-foreground">{issuerCode}</span>.{' '}
                    {m.slugPreviewExample}{' '}
                    <span className="font-mono font-semibold text-foreground">
                      {m.referenceExample(issuerCode)}
                    </span>
                    . {m.slugHint}
                  </span>
                </span>
              ) : (
                <span aria-live="polite">{m.slugHint}</span>
              )
            }
          >
            <Input
              value={draft.slug}
              placeholder={m.slugPlaceholder}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={24}
              className="font-mono"
              onChange={(event) => {
                change('slug', normaliseSlug(event.target.value));
              }}
            />
          </FormField>

          <RadioGroup legend={m.typeLabel} error={errors.type} data-field="type">
            <RadioCard
              name="type"
              value="hosted"
              label={m.typeHostedLong}
              description={m.typeHostedHint}
              icon={<Icon icon={ServerStack01Icon} className="size-[17px]" />}
              checked={draft.type === 'hosted'}
              onChange={() => {
                change('type', 'hosted');
              }}
            />
            <RadioCard
              name="type"
              value="federated"
              label={m.typeFederatedLong}
              description={m.typeFederatedHint}
              icon={<Icon icon={Link04Icon} className="size-[17px]" />}
              checked={draft.type === 'federated'}
              onChange={() => {
                change('type', 'federated');
              }}
            />
          </RadioGroup>

          <CheckboxGroup
            legend={m.categoriesLegend}
            hint={m.categoriesHint}
            error={errors.categories}
            data-field="categories"
          >
            <CategoryList
              title={m.categoriesAct}
              categories={categories.filter((category) => category.code.startsWith('act-'))}
              selected={draft.categories}
              onToggle={(codes) => {
                change('categories', codes);
              }}
            />
            <CategoryList
              title={m.categoriesRegs}
              categories={categories.filter((category) => !category.code.startsWith('act-'))}
              selected={draft.categories}
              onToggle={(codes) => {
                change('categories', codes);
              }}
            />
          </CheckboxGroup>
        </fieldset>

        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t px-5 py-4 sm:px-7">
          {submitting ? (
            <Button variant="ghost" disabled>
              {m.cancel}
            </Button>
          ) : (
            <Button asChild variant="ghost">
              <Link to="/commissions">{m.cancel}</Link>
            </Button>
          )}
          <Button type="submit" disabled={submitting} className="min-w-44">
            {submitting ? (
              <>
                <Icon icon={Loading03Icon} className="animate-spin" />
                {m.createSubmitting}
              </>
            ) : (
              m.createSubmit
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SubmitAlert({ alert }: { alert: Alerted }) {
  const copy: Record<Alerted, { title: string; text?: string }> = {
    conflict: { title: m.createConflict },
    error: { title: m.createError, text: m.createErrorText },
    'in-progress': { title: m.createInProgress, text: m.createInProgressText },
    changed: { title: m.createChanged, text: m.createChangedText },
    forbidden: { title: m.createForbidden },
  };
  const { title, text } = copy[alert];
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{title}</AlertTitle>
      {text ? <AlertDescription>{text}</AlertDescription> : null}
      {alert === 'changed' ? (
        <div className="mt-2">
          <Button asChild variant="secondary" size="sm">
            <Link to="/commissions">{m.checkList}</Link>
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}

/** One statute's categories: a bordered list of rows, citation then description. */
function CategoryList({
  title,
  categories,
  selected,
  onToggle,
}: {
  title: string;
  categories: OfficerCategory[];
  selected: string[];
  onToggle: (codes: string[]) => void;
}) {
  const headingId = useId();
  if (categories.length === 0) return null;
  return (
    <div role="group" aria-labelledby={headingId} className="overflow-hidden rounded-xl border">
      <div
        id={headingId}
        className="border-b bg-background px-3.5 py-2.5 text-[13px] font-semibold text-secondary-foreground"
      >
        {title}
      </div>
      <ul className="divide-y">
        {categories.map((category) => {
          const checkboxId = `${headingId}-${category.code}`;
          const checked = selected.includes(category.code);
          return (
            <li key={category.code}>
              <label
                htmlFor={checkboxId}
                className="grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 px-3.5 py-3 transition-colors hover:bg-muted/60 has-checked:bg-brand-faint sm:grid-cols-[auto_6.5rem_1fr]"
              >
                <Checkbox
                  id={checkboxId}
                  name="categories"
                  value={category.code}
                  checked={checked}
                  className="mt-0.5"
                  onChange={() => {
                    onToggle(
                      checked
                        ? selected.filter((code) => code !== category.code)
                        : [...selected, category.code],
                    );
                  }}
                />
                <span className="text-[13px] leading-5 font-medium whitespace-nowrap text-secondary-foreground tabular-nums">
                  {category.citation}
                </span>
                <span className="col-start-2 text-[14.5px] leading-5 sm:col-start-3">
                  {category.description}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CreateSkeleton() {
  return (
    <Page narrow aria-busy="true" aria-label={m.createTitle}>
      <Skeleton className="mb-[22px] h-7 w-64" />
      <Card className="grid gap-7 sm:p-7">
        {[1, 2].map((row) => (
          <div key={row} className="grid gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
        <div className="grid gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </Card>
    </Page>
  );
}
