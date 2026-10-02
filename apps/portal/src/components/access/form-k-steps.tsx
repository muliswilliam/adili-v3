import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Combobox,
  FieldError,
  FormField,
  Icon,
  Input,
  Label,
  ScopePicker,
  Textarea,
} from '@adili/ui';
import { Alert02Icon, LockIcon, PencilEdit02Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { type ReactNode, useId } from 'react';

import { day, FORM_K_COPY as COPY, STEPS } from '../../access/copy';
import { displayPhone } from '../../access/format';
import {
  DECLARATION_TEXT,
  type FormKDraft,
  type FormKStep,
  type StepErrors,
  TEXT_MAX,
} from '../../access/form-k';
import type { Applicant } from '../../server/access-requests.server';
import type { AccessCommission } from '../../server/access/types';
import { PartRow, PartRows, ScopeRows } from './request-parts';

/** What every step gets: the draft, a way to change it, and the errors to show on it. */
export interface StepProps {
  draft: FormKDraft;
  update: (change: (draft: FormKDraft) => FormKDraft) => void;
  errors: StepErrors;
}

/** The DOM id of a draft field's control, so the wizard can focus the first one at fault. */
export const fieldId = (path: string) => `form-k-${path.replace(/\./g, '-')}`;

function OptionalTag() {
  return (
    <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">{COPY.optional}</span>
  );
}

/** Step 1: the Responsible Commission, from those an applicant can address. */
export function CommissionStep({
  draft,
  update,
  errors,
  commissions,
}: StepProps & { commissions: AccessCommission[] }) {
  const chosen = commissions.find((commission) => commission.slug === draft.commission);
  return (
    <div className="grid gap-4">
      <FormField
        label={COPY.commissionLabel}
        hint={COPY.commissionHint}
        error={errors.commission}
        controlId={fieldId('commission')}
      >
        <Combobox
          options={commissions.map((commission) => ({
            value: commission.slug,
            label: commission.name,
          }))}
          value={draft.commission}
          placeholder={COPY.commissionPlaceholder}
          emptyText={COPY.commissionNone}
          onValueChange={(slug) => {
            const next = commissions.find((commission) => commission.slug === slug);
            update((current) => ({
              ...current,
              commission: slug,
              // Years the new Commission does not hold cannot be asked of it.
              scope: {
                ...current.scope,
                years: current.scope.years.filter((year) => next?.years.includes(year)),
              },
            }));
          }}
        />
      </FormField>
      {chosen?.years.length === 0 ? (
        <Alert variant="warning">
          <Icon icon={Alert02Icon} />
          <AlertDescription>{COPY.noYears(chosen.name)}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function AccountItem({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="text-[15px] font-medium break-words">{children}</dd>
    </div>
  );
}

function identityTerm(applicant: Applicant) {
  const { identityDocument } = applicant;
  if (identityDocument.kind === 'national-id') return COPY.nationalId;
  return identityDocument.country ? COPY.passportOf(identityDocument.country) : COPY.passport;
}

/** The particulars Form K takes from the applicant's account, which the wizard cannot change. */
export function AccountParticulars({ applicant }: { applicant: Applicant }) {
  return (
    <section aria-labelledby="form-k-account" className="rounded-xl bg-muted p-4 sm:p-5">
      <h3
        id="form-k-account"
        className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4"
      >
        <Icon icon={LockIcon} />
        {COPY.fromAccount}
      </h3>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <AccountItem term={COPY.name}>{applicant.name}</AccountItem>
        <AccountItem term={identityTerm(applicant)}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{applicant.identityDocument.number}</span>
            {applicant.identityStatus === 'verified' ? (
              <Badge variant="success">
                <Icon icon={Tick02Icon} strokeWidth={2.4} />
                {COPY.verified}
              </Badge>
            ) : (
              <Badge variant="warning">{COPY.pendingVerification}</Badge>
            )}
          </span>
        </AccountItem>
        <AccountItem term={COPY.telephone}>
          {applicant.telephone ? displayPhone(applicant.telephone) : '-'}
        </AccountItem>
        <AccountItem term={COPY.email}>{applicant.email ?? '-'}</AccountItem>
      </dl>
    </section>
  );
}

/** Step 2: Part I, the applicant's particulars; addresses and occupation are theirs to enter. */
export function ParticularsStep({
  draft,
  update,
  errors,
  applicant,
}: StepProps & { applicant: Applicant }) {
  return (
    <Card className="gap-5">
      <AccountParticulars applicant={applicant} />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label={COPY.postalAddress}
          error={errors.postalAddress}
          controlId={fieldId('postalAddress')}
        >
          <Input
            value={draft.postalAddress}
            autoComplete="street-address"
            maxLength={250}
            onChange={(event) => {
              const value = event.target.value;
              update((current) => ({ ...current, postalAddress: value }));
            }}
          />
        </FormField>
        <FormField
          label={COPY.physicalAddress}
          error={errors.physicalAddress}
          controlId={fieldId('physicalAddress')}
        >
          <Input
            value={draft.physicalAddress}
            maxLength={250}
            onChange={(event) => {
              const value = event.target.value;
              update((current) => ({ ...current, physicalAddress: value }));
            }}
          />
        </FormField>
      </div>
      <FormField
        label={COPY.occupation}
        error={errors.occupation}
        controlId={fieldId('occupation')}
      >
        <Input
          value={draft.occupation}
          autoComplete="organization-title"
          maxLength={150}
          onChange={(event) => {
            const value = event.target.value;
            update((current) => ({ ...current, occupation: value }));
          }}
        />
      </FormField>
    </Card>
  );
}

type OfficerField = keyof FormKDraft['officer'];

/** Step 3: Part II, the public officer whose declaration is sought. */
export function OfficerStep({ draft, update, errors }: StepProps) {
  const set = (field: OfficerField) => (event: { target: { value: string } }) => {
    const value = event.target.value;
    update((current) => ({ ...current, officer: { ...current.officer, [field]: value } }));
  };
  return (
    <Card className="gap-5">
      <FormField
        label={COPY.officerName}
        error={errors['officer.name']}
        controlId={fieldId('officer.name')}
      >
        <Input value={draft.officer.name} maxLength={250} onChange={set('name')} />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label={COPY.entity}
          hint={COPY.entityHint}
          error={errors['officer.entity']}
          controlId={fieldId('officer.entity')}
          className="sm:row-span-2 sm:grid-rows-subgrid"
        >
          <Input value={draft.officer.entity} maxLength={250} onChange={set('entity')} />
        </FormField>
        <FormField
          label={
            <>
              {COPY.workStation}
              <OptionalTag />
            </>
          }
          error={errors['officer.workStation']}
          controlId={fieldId('officer.workStation')}
          className="sm:row-span-2 sm:grid-rows-subgrid"
        >
          <Input value={draft.officer.workStation} maxLength={250} onChange={set('workStation')} />
        </FormField>
      </div>
      <FormField
        label={
          <>
            {COPY.fileNumber}
            <OptionalTag />
          </>
        }
        hint={COPY.fileNumberHint}
        error={errors['officer.personnelFileNumber']}
        controlId={fieldId('officer.personnelFileNumber')}
      >
        <Input
          value={draft.officer.personnelFileNumber}
          maxLength={40}
          autoComplete="off"
          onChange={set('personnelFileNumber')}
        />
      </FormField>
    </Card>
  );
}

/** A long answer with a character counter that turns red past the limit. */
function LongText({
  path,
  label,
  hint,
  optional = false,
  value,
  error,
  onChange,
}: {
  path: string;
  label: string;
  hint?: string;
  optional?: boolean;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = fieldId(path);
  const hintId = useId();
  const errorId = useId();
  const counterId = useId();
  const over = value.trim().length > TEXT_MAX;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>
          {label}
          {optional ? <OptionalTag /> : null}
        </Label>
        <span
          id={counterId}
          className={cn(
            'text-xs tabular-nums',
            over ? 'font-semibold text-destructive' : 'text-muted-foreground',
          )}
        >
          {COPY.counter(value.trim().length, TEXT_MAX)}
        </span>
      </div>
      {hint ? (
        <p id={hintId} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <Textarea
        id={id}
        rows={4}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? hintId : null, counterId, error ? errorId : null]
          .filter(Boolean)
          .join(' ')}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

type InformationField = keyof FormKDraft['information'];

/** Step 4: Part III, what the applicant wants and why. */
export function InformationStep({ draft, update, errors }: StepProps) {
  const set = (field: InformationField) => (value: string) => {
    update((current) => ({
      ...current,
      information: { ...current.information, [field]: value },
    }));
  };
  return (
    <Card className="gap-5">
      <LongText
        path="information.informationSought"
        label={COPY.informationSought}
        value={draft.information.informationSought}
        error={errors['information.informationSought']}
        onChange={set('informationSought')}
      />
      <LongText
        path="information.reason"
        label={COPY.reason}
        hint={COPY.reasonHint}
        value={draft.information.reason}
        error={errors['information.reason']}
        onChange={set('reason')}
      />
      <LongText
        path="information.otherInformation"
        label={COPY.otherInformation}
        optional
        value={draft.information.otherInformation}
        error={errors['information.otherInformation']}
        onChange={set('otherInformation')}
      />
    </Card>
  );
}

/** Step 5: the scope, from the years the Commission holds. */
export function ScopeStep({ draft, update, errors, years }: StepProps & { years: number[] }) {
  return (
    <Card>
      <ScopePicker
        name="form-k-scope"
        value={draft.scope}
        years={years}
        clarifications
        errors={{ years: errors['scope.years'], sections: errors['scope.sections'] }}
        onChange={(scope) => {
          update((current) => ({ ...current, scope }));
        }}
      />
    </Card>
  );
}

function ReviewPart({
  title,
  step,
  onEdit,
  children,
}: {
  title: string;
  step: FormKStep;
  onEdit: (step: FormKStep) => void;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-b border-border py-5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={COPY.editPart(title)}
          onClick={() => {
            onEdit(step);
          }}
        >
          <Icon icon={PencilEdit02Icon} />
          {COPY.edit}
        </Button>
      </div>
      {children}
    </section>
  );
}

/** Step 6: Form K as it will be filed, part by part, and Part IV's declaration of truth. */
export function DeclareStep({
  draft,
  update,
  errors,
  applicant,
  commission,
  now,
  onEdit,
}: StepProps & {
  applicant: Applicant;
  commission: AccessCommission | undefined;
  now: number;
  onEdit: (step: FormKStep) => void;
}) {
  const { officer, information } = draft;
  const declareId = fieldId('declared');
  const errorId = useId();
  return (
    <div className="grid gap-5">
      <Card>
        <ReviewPart title={STEPS.commission.nav.en} step="commission" onEdit={onEdit}>
          <p className="text-[14.5px]">{commission?.name ?? '-'}</p>
        </ReviewPart>
        <ReviewPart title={STEPS.particulars.nav.en} step="particulars" onEdit={onEdit}>
          <PartRows>
            <PartRow term={COPY.name}>{applicant.name}</PartRow>
            <PartRow term={identityTerm(applicant)}>{applicant.identityDocument.number}</PartRow>
            <PartRow term={COPY.postalAddress}>{draft.postalAddress.trim()}</PartRow>
            <PartRow term={COPY.physicalAddress}>{draft.physicalAddress.trim()}</PartRow>
            <PartRow term={COPY.telephone}>
              {applicant.telephone ? displayPhone(applicant.telephone) : '-'}
            </PartRow>
            <PartRow term={COPY.email}>{applicant.email ?? '-'}</PartRow>
            <PartRow term={COPY.occupation}>{draft.occupation.trim()}</PartRow>
          </PartRows>
        </ReviewPart>
        <ReviewPart title={STEPS.officer.nav.en} step="officer" onEdit={onEdit}>
          <PartRows>
            <PartRow term={COPY.officerName}>{officer.name.trim()}</PartRow>
            <PartRow term={COPY.entity}>{officer.entity.trim()}</PartRow>
            {officer.workStation.trim() ? (
              <PartRow term={COPY.workStation}>{officer.workStation.trim()}</PartRow>
            ) : null}
            {officer.personnelFileNumber.trim() ? (
              <PartRow term={COPY.fileNumber}>{officer.personnelFileNumber.trim()}</PartRow>
            ) : null}
          </PartRows>
        </ReviewPart>
        <ReviewPart title={STEPS.information.nav.en} step="information" onEdit={onEdit}>
          <PartRows>
            <PartRow term={COPY.informationSought}>{information.informationSought.trim()}</PartRow>
            <PartRow term={COPY.reason}>{information.reason.trim()}</PartRow>
            {information.otherInformation.trim() ? (
              <PartRow term={COPY.otherInformation}>{information.otherInformation.trim()}</PartRow>
            ) : null}
          </PartRows>
        </ReviewPart>
        <ReviewPart title={STEPS.scope.nav.en} step="scope" onEdit={onEdit}>
          <ScopeRows scope={draft.scope} />
        </ReviewPart>
      </Card>
      <div
        className={cn(
          'grid gap-2 rounded-2xl p-4 sm:p-5',
          errors.declared
            ? 'bg-destructive-subtle/60 inset-ring-1 inset-ring-destructive/40'
            : 'bg-brand-subtle/60 inset-ring-1 inset-ring-brand/20',
        )}
      >
        <div className="flex gap-3">
          <Checkbox
            id={declareId}
            checked={draft.declared}
            aria-invalid={errors.declared ? true : undefined}
            aria-describedby={errors.declared ? errorId : undefined}
            className="mt-0.5"
            onChange={(event) => {
              const checked = event.target.checked;
              update((current) => ({ ...current, declared: checked }));
            }}
          />
          <div className="grid gap-1">
            <label htmlFor={declareId} className="cursor-pointer text-[14.5px] leading-snug">
              {DECLARATION_TEXT}
            </label>
            <p className="text-[13px] text-muted-foreground">
              {COPY.declaredBy(day(new Date(now).toISOString()), applicant.name)}
            </p>
          </div>
        </div>
        {errors.declared ? (
          <FieldError id={errorId} className="pl-[30px]">
            {errors.declared}
          </FieldError>
        ) : null}
      </div>
    </div>
  );
}
