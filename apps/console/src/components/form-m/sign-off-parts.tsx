import type { FormMV1 } from '@adili/forms';
import {
  type AutosaveState,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  formatNumber,
  Icon,
  IconTile,
  Input,
  SaveIndicator,
  SegmentedChoice,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import {
  Delete02Icon,
  Message01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons';
import { type SyntheticEvent, useId, useState } from 'react';

import { Field, FORM_M_ANCHORS, Note, PartCard } from './form-m-document';
import { emailTakes } from './manual-fields';
import { messages as fm } from './messages';
import { messages as m } from './sign-off-messages';

/**
 * The commission-admin's editable Part I and Part B of Form M (spec 09 FE-2, S5): the same cards
 * as the read-only document (`form-m-document.tsx`), with fields that save as they are filled.
 */

/** Part I's contact fields, as the commission-admin types them. */
export type PartIValues = Pick<
  FormMV1['partI'],
  'contactDetails' | 'physicalAddress' | 'emailAddress'
>;

function YouFillThis() {
  return (
    <Badge variant="brand">
      <Icon icon={PencilEdit02Icon} />
      {m.youFillThis}
    </Badge>
  );
}

function Saving({
  autosave,
  messages,
}: {
  autosave: AutosaveState;
  messages: typeof m.partISaving;
}) {
  // A refusal for good says why, from the code the save failed with (`throwUnlessSaved`).
  const refused = autosave.failure ? m.saveRefused[autosave.failure.message] : undefined;
  return (
    <div className="flex justify-end">
      <SaveIndicator
        status={autosave.status}
        messages={refused ? { ...messages, error: refused } : messages}
        className="text-[12.5px]"
      />
    </div>
  );
}

/** Part I with the contact details, physical address and email address to fill. */
export function PartIForm({
  partI,
  autosave,
  onChange,
}: {
  partI: FormMV1['partI'];
  autosave: AutosaveState;
  onChange: (values: PartIValues) => void;
}) {
  const [emailTouched, setEmailTouched] = useState(false);
  const values: PartIValues = {
    contactDetails: partI.contactDetails,
    physicalAddress: partI.physicalAddress,
    emailAddress: partI.emailAddress,
  };
  const set = (field: keyof PartIValues) => (event: { target: { value: string } }) => {
    onChange({ ...values, [field]: event.target.value });
  };
  const emailError = emailTouched && !emailTakes(partI.emailAddress) ? m.invalidEmail : undefined;
  return (
    <PartCard id={FORM_M_ANCHORS.partI} title={fm.partI} actions={<YouFillThis />}>
      <div className="grid gap-4 px-5 py-[18px]">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
          <Field roman="(i)" label={fm.partINames.commissionName}>
            {partI.commissionName}
          </Field>
          <Field roman="(v)" label={fm.partINames.period}>
            {fm.period(partI.period.financialYearStart)}
          </Field>
        </dl>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={`(ii) ${fm.partINames.contactDetails}`}>
            <Input
              value={partI.contactDetails}
              maxLength={200}
              autoComplete="tel"
              placeholder={m.contactPlaceholder}
              onChange={set('contactDetails')}
              onBlur={autosave.flush}
            />
          </FormField>
          <FormField label={`(iv) ${fm.partINames.emailAddress}`} error={emailError}>
            <Input
              type="email"
              value={partI.emailAddress}
              maxLength={254}
              autoComplete="email"
              placeholder={m.emailPlaceholder}
              onChange={set('emailAddress')}
              onBlur={() => {
                setEmailTouched(true);
                autosave.flush();
              }}
            />
          </FormField>
        </div>
        <FormField label={`(iii) ${fm.partINames.physicalAddress}`}>
          <Input
            value={partI.physicalAddress}
            maxLength={200}
            autoComplete="street-address"
            onChange={set('physicalAddress')}
            onBlur={autosave.flush}
          />
        </FormField>
        <Saving autosave={autosave} messages={m.partISaving} />
      </div>
    </PartCard>
  );
}

type Complaint = FormMV1['partII']['complaints']['items'][number];

/** Part B as the commission-admin fills it. */
export interface PartBValues {
  registerMaintained: boolean | null;
  items: Complaint[];
}

/** Part B: whether a complaints register is kept, and the complaints received, to fill. */
export function ComplaintsForm({
  complaints,
  autosave,
  onChange,
}: {
  complaints: FormMV1['partII']['complaints'];
  autosave: AutosaveState;
  onChange: (values: PartBValues) => void;
}) {
  // The complaint being added (null) or edited (its index); undefined while the dialog is shut.
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const { registerMaintained, items } = complaints;
  const register = registerMaintained === null ? null : registerMaintained ? 'yes' : 'no';
  return (
    <PartCard id={FORM_M_ANCHORS.complaints} title={fm.partB} actions={<YouFillThis />}>
      <div className="grid gap-4 px-5 py-[18px]">
        <SegmentedChoice
          className="[&>div]:grid [&>div]:max-w-[320px] [&>div]:grid-cols-2 [&_label]:justify-center"
          legend={
            <span className="text-[14.5px] leading-normal font-medium text-foreground">
              <span className="mr-1.5 text-[12.5px] text-muted-foreground">6.</span>
              {fm.registerQuestion}
            </span>
          }
          options={[
            { value: 'yes', label: fm.yes },
            { value: 'no', label: fm.no },
          ]}
          value={register}
          onValueChange={(value) => {
            onChange({ registerMaintained: value === 'yes', items });
          }}
        />
        <p className="text-[14.5px] font-medium">
          <span className="mr-1.5 text-[12.5px] text-muted-foreground">7.</span>
          {fm.complaintsCount} <span className="tabular-nums">{formatNumber(items.length)}</span>
        </p>
      </div>
      {items.length > 0 ? (
        <div className="border-t pb-1.5">
          <Table caption={fm.complaintsCaption} showCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{fm.number}</TableHead>
                <TableHead>{fm.name}</TableHead>
                <TableHead>{fm.designation}</TableHead>
                <TableHead>{fm.complaintNature}</TableHead>
                <TableHead>{fm.complaintStatus}</TableHead>
                <TableHead>
                  <span className="sr-only">{m.rowActions}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={`${item.identifier}-${String(index)}`}>
                  <TableCell className="w-9 align-top text-muted-foreground tabular-nums">
                    {`${String(index + 1)}.`}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="font-medium">{item.name}</div>
                    <div className="font-mono text-[12.5px] text-muted-foreground">
                      {item.identifier}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">{item.designation}</TableCell>
                  <TableCell className="align-top">{item.nature}</TableCell>
                  <TableCell className="align-top">{item.status}</TableCell>
                  <TableCell className="text-right align-top whitespace-nowrap">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={m.editComplaintFor(index + 1)}
                      onClick={() => {
                        setEditing(index);
                      }}
                    >
                      {m.edit}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive-ghost"
                      size="xs"
                      className="px-1.5"
                      aria-label={m.removeComplaint(index + 1)}
                      onClick={() => {
                        onChange({
                          registerMaintained,
                          items: items.filter((_, at) => at !== index),
                        });
                      }}
                    >
                      <Icon icon={Delete02Icon} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Note className="mx-5 mb-4">{fm.noComplaints}</Note>
      )}
      <div className="flex flex-wrap items-center gap-3 px-5 pt-1 pb-[18px]">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setEditing(null);
          }}
        >
          <Icon icon={PlusSignIcon} />
          {m.addComplaint}
        </Button>
        <span className="ml-auto">
          <Saving autosave={autosave} messages={m.partBSaving} />
        </span>
      </div>
      {editing === undefined ? null : (
        <ComplaintDialog
          complaint={editing === null ? null : (items[editing] ?? null)}
          onClose={() => {
            setEditing(undefined);
          }}
          onSave={(complaint) => {
            onChange({
              registerMaintained,
              items:
                editing === null
                  ? [...items, complaint]
                  : items.map((item, at) => (at === editing ? complaint : item)),
            });
            setEditing(undefined);
          }}
        />
      )}
    </PartCard>
  );
}

const FIELDS = ['name', 'designation', 'identifier', 'nature', 'status'] as const;
const MAX: Record<(typeof FIELDS)[number], number> = {
  name: 200,
  designation: 100,
  identifier: 100,
  nature: 300,
  status: 100,
};

/** Adds a complaint to section 7, or edits one: every field is needed. */
function ComplaintDialog({
  complaint,
  onClose,
  onSave,
}: {
  complaint: Complaint | null;
  onClose: () => void;
  onSave: (complaint: Complaint) => void;
}) {
  const formId = useId();
  const [values, setValues] = useState<Complaint>(
    complaint ?? { name: '', designation: '', identifier: '', nature: '', status: '' },
  );
  const [submitted, setSubmitted] = useState(false);
  const labels = m.complaintFields;
  const errorOf = (field: (typeof FIELDS)[number]) =>
    submitted && !values[field].trim() ? m.required(labels[field]) : undefined;
  const input = (field: (typeof FIELDS)[number], placeholder?: string) => (
    <Input
      value={values[field]}
      maxLength={MAX[field]}
      placeholder={placeholder}
      onChange={(event) => {
        setValues({ ...values, [field]: event.target.value });
      }}
    />
  );
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (FIELDS.some((field) => !values[field].trim())) return;
    onSave(Object.fromEntries(FIELDS.map((field) => [field, values[field].trim()])) as Complaint);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile>
            <Icon icon={Message01Icon} />
          </IconTile>
          <DialogTitle>{complaint ? m.complaintDialog.edit : m.complaintDialog.add}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form id={formId} noValidate className="grid gap-4" onSubmit={submit}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label={labels.name} error={errorOf('name')}>
                {input('name')}
              </FormField>
              <FormField label={labels.designation} error={errorOf('designation')}>
                {input('designation')}
              </FormField>
            </div>
            <FormField label={labels.identifier} error={errorOf('identifier')}>
              {input('identifier')}
            </FormField>
            <FormField label={labels.nature} hint={labels.natureHint} error={errorOf('nature')}>
              {input('nature', labels.naturePlaceholder)}
            </FormField>
            <FormField label={labels.status} error={errorOf('status')}>
              {input('status', labels.statusPlaceholder)}
            </FormField>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {m.cancel}
          </Button>
          <Button type="submit" form={formId}>
            {complaint ? m.saveChanges : m.addComplaint}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
