import {
  Badge,
  Button,
  Icon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import {
  ArrowRight02Icon,
  Download04Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons';
import { Fragment, type ReactNode } from 'react';

import { messages as m } from './messages';
import { REQUIRED_COLUMNS, TEMPLATE_COLUMNS, type TemplateColumn } from './template-columns';
import { useTemplateDownload } from './use-template-download';
import { WizardCard, WizardFoot, WizardSection, WizardTitle } from './wizard-card';

/** An identifier as it appears in the file (the prototype's `code.c`). */
export function ColumnName({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-px font-mono text-[0.9em] whitespace-nowrap text-foreground">
      {children}
    </code>
  );
}

/** Step 1: the template downloads and the columns it has. */
export function WizardTemplateStep({ onNext }: { onNext: () => void }) {
  const download = useTemplateDownload('/roster/import');
  return (
    <WizardCard>
      <WizardSection className="grid gap-4">
        <div>
          <WizardTitle>{m.templateTitle}</WizardTitle>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
            {m.templateIntroBefore} <RequiredList /> {m.templateIntroAfter}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void download('csv')}>
            <Icon icon={Download04Icon} />
            {m.downloadCsvTemplate}
          </Button>
          <Button variant="secondary" onClick={() => void download('xlsx')}>
            <Icon icon={Download04Icon} />
            {m.downloadXlsxTemplate}
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Icon icon={InformationCircleIcon} className="size-3.5" />
          {m.templateTip}
        </p>
      </WizardSection>
      <div className="border-t">
        <div className="hidden min-[700px]:block">
          <ColumnsTable />
        </div>
        <div className="min-[700px]:hidden">
          <ColumnsList />
        </div>
      </div>
      <WizardFoot>
        <Button className="ml-auto" onClick={onNext}>
          {m.haveFile}
          <Icon icon={ArrowRight02Icon} />
        </Button>
      </WizardFoot>
    </WizardCard>
  );
}

/** "`a`, `b` and `c`" */
function RequiredList() {
  return REQUIRED_COLUMNS.map((name, index) => (
    <Fragment key={name}>
      {index > 0
        ? index === REQUIRED_COLUMNS.length - 1
          ? ` ${m.templateIntroAnd} `
          : ', '
        : null}
      <ColumnName>{name}</ColumnName>
    </Fragment>
  ));
}

function RequiredBadge({ column }: { column: TemplateColumn }) {
  return column.required ? (
    <Badge variant="brand">{m.required}</Badge>
  ) : (
    <span className="text-muted-foreground">{m.optional}</span>
  );
}

/** Digits-only examples (IDs, phone numbers) read better in the monospace face. */
function Example({ value }: { value: string }) {
  return /^[\d ]+$/.test(value) ? <span className="font-mono text-[0.94em]">{value}</span> : value;
}

function ColumnsTable() {
  return (
    <Table caption={m.columnsCaption}>
      <TableHeader>
        <TableRow>
          <TableHead>{m.columnName}</TableHead>
          <TableHead>{m.columnRequired}</TableHead>
          <TableHead>{m.columnFormat}</TableHead>
          <TableHead>{m.columnExample}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {TEMPLATE_COLUMNS.map((column) => (
          <TableRow key={column.name}>
            <TableHead scope="row" className="font-normal">
              <ColumnName>{column.name}</ColumnName>
            </TableHead>
            <TableCell>
              <RequiredBadge column={column} />
            </TableCell>
            <TableCell className="max-w-[320px] text-[14px]">{column.format}</TableCell>
            <TableCell className="text-[14px] whitespace-nowrap">
              <Example value={column.example} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 700px the table becomes a list of cards. */
function ColumnsList() {
  return (
    <ul aria-label={m.columnsCaption}>
      {TEMPLATE_COLUMNS.map((column) => (
        <li key={column.name} className="grid gap-1.5 border-b px-5 py-3.5 last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <ColumnName>{column.name}</ColumnName>
            <span className="text-[13px]">
              <RequiredBadge column={column} />
            </span>
          </div>
          <p className="text-[13.5px] text-secondary-foreground">{column.format}</p>
          <p className="text-[13px] text-muted-foreground">
            {m.columnExample}: <Example value={column.example} />
          </p>
        </li>
      ))}
    </ul>
  );
}
