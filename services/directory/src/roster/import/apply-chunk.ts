import { type Database, withTenant } from '@adili/data-access';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import type { DirectorySchema } from '../../db/schema.js';
import type { NormalisedRosterRow, RowError, RowNote } from '../row-validation.js';
import {
  type ImportChannel,
  type ImportRowOutcome,
  reportingEntities,
  rosterImportRows,
  rosterImports,
  rosterRecords,
} from '../schema.js';
import { recomputeRosterSummary } from '../summary.js';
import { IMPORT_SUBJECT } from './staging.js';
import type { ChunkCounts, ImportRef } from './workflow-contract.js';

const NOTHING_APPLIED: ChunkCounts = { created: 0, updated: 0, unchanged: 0, rejected: 0 };

/** The fields of a record an import row sets. */
interface RecordValues {
  personnelFileNumber: string;
  fullName: string;
  nationalId: string;
  designation: string | null;
  jobGroup: string | null;
  reportingEntityId: string | null;
  appointmentDate: string | null;
  email: string | null;
  phone: string | null;
}

type ExistingRecord = RecordValues & {
  id: string;
  state: typeof rosterRecords.$inferSelect.state;
  stateBeforeExit: typeof rosterRecords.$inferSelect.stateBeforeExit;
  emailSource: typeof rosterRecords.$inferSelect.emailSource;
  phoneSource: typeof rosterRecords.$inferSelect.phoneSource;
};

/** What applying one row does to the roster. */
type Decision =
  | { kind: 'create'; values: RecordValues }
  /** `reactivates`: the state an exited record goes back to; null for a record not exited. */
  | {
      kind: 'update';
      recordId: string;
      values: RecordValues;
      reactivates: 'not_onboarded' | 'onboarded' | null;
    }
  | { kind: 'unchanged'; recordId: string }
  | { kind: 'locked'; recordId: string; errors: RowError[] };

/**
 * Applies one chunk of an import's accepted rows in one transaction: creates reporting entities
 * named for the first time, creates or updates records by personnel file number (case-insensitive),
 * rejects rows that would change an onboarded record's identity (`identity-locked`), re-activates
 * exited records, marks every record with a row as seen in this import, moves the roster summary
 * by what changed, and marks the rows applied with their outcome, noting national IDs that are
 * on another Commission's roster too.
 *
 * Idempotent: only rows not yet applied are applied, and the import row is locked first, so a
 * re-run (after a crash, or racing a straggling attempt) applies nothing twice and returns zeros.
 */
export async function applyChunk(
  db: Database<DirectorySchema>,
  ref: ImportRef,
  chunkIndex: number,
): Promise<ChunkCounts> {
  return withTenant(db, { tenant: ref.tenant, subject: IMPORT_SUBJECT }, async (tx) => {
    const [current] = await tx
      .select({ state: rosterImports.state, channel: rosterImports.channel })
      .from(rosterImports)
      .where(and(eq(rosterImports.id, ref.importId), eq(rosterImports.tenant, ref.tenant)))
      .for('update');
    if (current?.state !== 'processing') return NOTHING_APPLIED;

    const staged = await tx
      .select({ rowNumber: rosterImportRows.rowNumber, normalised: rosterImportRows.normalised })
      .from(rosterImportRows)
      .where(
        and(
          eq(rosterImportRows.importId, ref.importId),
          eq(rosterImportRows.chunkIndex, chunkIndex),
          eq(rosterImportRows.status, 'accepted'),
          isNull(rosterImportRows.appliedAt),
        ),
      )
      .orderBy(rosterImportRows.rowNumber);
    const rows = staged.flatMap(({ rowNumber, normalised }) =>
      normalised ? [{ rowNumber, normalised }] : [],
    );
    if (rows.length === 0) return NOTHING_APPLIED;

    const entityIds = await reportingEntityIds(
      tx,
      ref.tenant,
      rows.map((row) => row.normalised.reportingEntity),
    );
    const existing = await recordsByFileNumber(
      tx,
      ref.tenant,
      rows.map((row) => row.normalised.personnelFileNumber),
    );
    const decisions = rows.map((row) => {
      const entity = row.normalised.reportingEntity;
      const values = recordValues(
        row.normalised,
        entity ? requireId(entityIds, entityKey(entity)) : null,
      );
      const record = existing.get(fileNumberKey(values.personnelFileNumber));
      return {
        rowNumber: row.rowNumber,
        nationalId: values.nationalId,
        decision: decide(keepDeclarantContacts(values, record), record),
      };
    });

    const created = await createRecords(
      tx,
      ref,
      current.channel,
      decisions.flatMap(({ decision }) => (decision.kind === 'create' ? [decision.values] : [])),
    );
    await updateRecords(
      tx,
      ref,
      current.channel,
      decisions.flatMap(({ decision }) => (decision.kind === 'update' ? [decision] : [])),
    );
    await markSeen(
      tx,
      ref,
      decisions.flatMap(({ decision }) =>
        decision.kind === 'unchanged' || decision.kind === 'locked' ? [decision.recordId] : [],
      ),
    );
    await recomputeRosterSummary(tx, ref.tenant);
    const elsewhere = await nationalIdsOnOtherRosters(
      tx,
      decisions.flatMap(({ nationalId, decision }) =>
        decision.kind === 'locked' ? [] : [nationalId],
      ),
    );

    const counts: ChunkCounts = { ...NOTHING_APPLIED };
    const outcomes = decisions.map(({ rowNumber, nationalId, decision }) => {
      const notes = elsewhere.has(nationalId) ? [NATIONAL_ID_ON_ANOTHER_ROSTER] : [];
      switch (decision.kind) {
        case 'create': {
          counts.created += 1;
          const recordId = requireId(created, fileNumberKey(decision.values.personnelFileNumber));
          return rowOutcome(rowNumber, 'created', recordId, notes);
        }
        case 'update':
          counts.updated += 1;
          return rowOutcome(rowNumber, 'updated', decision.recordId, notes);
        case 'unchanged':
          counts.unchanged += 1;
          return rowOutcome(rowNumber, 'unchanged', decision.recordId, notes);
        case 'locked':
          counts.rejected += 1;
          return {
            row_number: rowNumber,
            status: 'rejected',
            outcome: null,
            record_id: decision.recordId,
            errors: decision.errors,
            notes: [],
          };
      }
    });
    await tx.execute(sql`
      update roster_import_rows as target set
        status = source.status,
        outcome = source.outcome,
        record_id = source.record_id,
        errors = source.errors,
        notes = source.notes,
        applied_at = now()
      from jsonb_to_recordset(${JSON.stringify(outcomes)}::jsonb) as source(
        row_number integer,
        status text,
        outcome text,
        record_id uuid,
        errors jsonb,
        notes jsonb
      )
      where target.import_id = ${ref.importId} and target.row_number = source.row_number
    `);
    await tx
      .update(rosterImports)
      .set({ processedRows: sql`${rosterImports.processedRows} + ${rows.length}` })
      .where(eq(rosterImports.id, ref.importId));
    return counts;
  });
}

/**
 * The decision for one row. A row for an onboarded record may not change its identity (national
 * ID, full name); the row is rejected whole and the record keeps every field. That holds for an
 * exited record that had onboarded too, since re-activating it restores `onboarded`. A row for
 * an exited record re-activates it (`updateRecords`), so it is an update even with the same
 * values.
 */
function decide(values: RecordValues, existing: ExistingRecord | undefined): Decision {
  if (!existing) return { kind: 'create', values };
  if (activeState(existing) === 'onboarded') {
    const errors = identityChanges(existing, values);
    if (errors.length > 0) return { kind: 'locked', recordId: existing.id, errors };
  }
  if (existing.state === 'exited') {
    return { kind: 'update', recordId: existing.id, values, reactivates: activeState(existing) };
  }
  return sameValues(existing, values)
    ? { kind: 'unchanged', recordId: existing.id }
    : { kind: 'update', recordId: existing.id, values, reactivates: null };
}

/**
 * The row's values with the record's declarant-sourced contacts in place of the row's. A contact
 * the declarant supplied and verified at onboarding (the roster had none) is theirs: an import
 * does not overwrite or clear it, whatever the row says. Roster-sourced contacts follow the rows.
 */
function keepDeclarantContacts(
  values: RecordValues,
  existing: ExistingRecord | undefined,
): RecordValues {
  if (!existing) return values;
  return {
    ...values,
    email: existing.emailSource === 'declarant' ? existing.email : values.email,
    phone: existing.phoneSource === 'declarant' ? existing.phone : values.phone,
  };
}

/** The record's state, or for an exited record the state a re-activation gives it back. */
function activeState(record: ExistingRecord): 'not_onboarded' | 'onboarded' {
  if (record.state === 'exited') return record.stateBeforeExit ?? 'not_onboarded';
  return record.state;
}

function identityChanges(existing: RecordValues, values: RecordValues): RowError[] {
  const errors: RowError[] = [];
  if (existing.nationalId !== values.nationalId) {
    errors.push({
      field: 'nationalId',
      code: 'identity-locked',
      message: 'The officer has onboarded, so their national ID cannot change through an import',
    });
  }
  if (existing.fullName !== values.fullName) {
    errors.push({
      field: 'fullName',
      code: 'identity-locked',
      message: 'The officer has onboarded, so their full name cannot change through an import',
    });
  }
  return errors;
}

const RECORD_FIELDS = [
  'personnelFileNumber',
  'fullName',
  'nationalId',
  'designation',
  'jobGroup',
  'reportingEntityId',
  'appointmentDate',
  'email',
  'phone',
] as const satisfies readonly (keyof RecordValues)[];

function sameValues(existing: RecordValues, values: RecordValues): boolean {
  return RECORD_FIELDS.every((field) => existing[field] === values[field]);
}

function recordValues(row: NormalisedRosterRow, reportingEntityId: string | null): RecordValues {
  return {
    personnelFileNumber: row.personnelFileNumber,
    fullName: row.fullName,
    nationalId: row.nationalId,
    designation: row.designation,
    jobGroup: row.jobGroup,
    reportingEntityId,
    appointmentDate: row.appointmentDate,
    email: row.email,
    phone: row.phone,
  };
}

function rowOutcome(
  rowNumber: number,
  outcome: ImportRowOutcome,
  recordId: string,
  notes: RowNote[],
) {
  return {
    row_number: rowNumber,
    status: 'accepted',
    outcome,
    record_id: recordId,
    errors: [],
    notes,
  };
}

/**
 * The same national ID on another Commission's roster is allowed (people transfer; slice 03
 * resolves who the declarant is) and noted on the row, without naming the other Commission.
 */
const NATIONAL_ID_ON_ANOTHER_ROSTER: RowNote = {
  field: 'nationalId',
  code: 'national-id-on-another-roster',
  message:
    "This national ID is also on another Commission's roster. That is allowed, for officers who moved; the row was applied.",
};

/**
 * Which of the national IDs are on another Commission's roster, through a database function that
 * sees other rosters for the length of its query and answers with one boolean per ID asked about
 * (migration 0020); it takes the importing tenant from this transaction's context, which it
 * leaves as it was.
 */
async function nationalIdsOnOtherRosters(
  tx: Transaction,
  nationalIds: string[],
): Promise<Set<string>> {
  if (nationalIds.length === 0) return new Set();
  const { rows } = await tx.execute<{ found: boolean[] }>(sql`
    select roster_national_ids_on_other_rosters(${sql.param(nationalIds)}::text[]) as found
  `);
  const found = rows[0]?.found ?? [];
  return new Set(nationalIds.filter((_, index) => found[index] === true));
}

/** Personnel file numbers identify records case-insensitively. */
function fileNumberKey(fileNumber: string): string {
  return fileNumber.toLowerCase();
}

/** Reporting entities are identified by lower-cased, whitespace-collapsed name. */
function entityKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

function requireId(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`No id for ${key}`);
  return id;
}

/**
 * Ids of the named reporting entities by name (and normalised name), creating those seen for the
 * first time with the name as written in their first row.
 */
async function reportingEntityIds(
  tx: Transaction,
  tenant: string,
  names: (string | null)[],
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const name of names) {
    if (name !== null && !byKey.has(entityKey(name))) byKey.set(entityKey(name), name);
  }
  if (byKey.size === 0) return new Map();
  await tx
    .insert(reportingEntities)
    .values([...byKey].map(([normalisedName, name]) => ({ tenant, name, normalisedName })))
    .onConflictDoNothing({ target: [reportingEntities.tenant, reportingEntities.normalisedName] });
  const rows = await tx
    .select({ id: reportingEntities.id, normalisedName: reportingEntities.normalisedName })
    .from(reportingEntities)
    .where(
      and(
        eq(reportingEntities.tenant, tenant),
        inArray(reportingEntities.normalisedName, [...byKey.keys()]),
      ),
    );
  return new Map(rows.map((row) => [row.normalisedName, row.id]));
}

/**
 * The tenant's records with these file numbers, locked until the commit, by file number key.
 * Locked in id order, as everywhere records are locked (exits, flag absent), so two transactions
 * locking overlapping records never deadlock.
 */
async function recordsByFileNumber(
  tx: Transaction,
  tenant: string,
  fileNumbers: string[],
): Promise<Map<string, ExistingRecord>> {
  const rows = await tx
    .select({
      id: rosterRecords.id,
      state: rosterRecords.state,
      stateBeforeExit: rosterRecords.stateBeforeExit,
      personnelFileNumber: rosterRecords.personnelFileNumber,
      fullName: rosterRecords.fullName,
      nationalId: rosterRecords.nationalId,
      designation: rosterRecords.designation,
      jobGroup: rosterRecords.jobGroup,
      reportingEntityId: rosterRecords.reportingEntityId,
      appointmentDate: rosterRecords.appointmentDate,
      email: rosterRecords.email,
      phone: rosterRecords.phone,
      emailSource: rosterRecords.emailSource,
      phoneSource: rosterRecords.phoneSource,
    })
    .from(rosterRecords)
    .where(
      and(
        eq(rosterRecords.tenant, tenant),
        inArray(sql`lower(${rosterRecords.personnelFileNumber})`, fileNumbers.map(fileNumberKey)),
      ),
    )
    .orderBy(rosterRecords.id)
    .for('update');
  return new Map(rows.map((row) => [fileNumberKey(row.personnelFileNumber), row]));
}

/** Inserts new records; returns their ids by file number key. */
async function createRecords(
  tx: Transaction,
  ref: ImportRef,
  channel: ImportChannel,
  values: RecordValues[],
): Promise<Map<string, string>> {
  if (values.length === 0) return new Map();
  const rows = await tx
    .insert(rosterRecords)
    .values(
      values.map((value) => ({
        ...value,
        tenant: ref.tenant,
        source: channel,
        firstSeenImportId: ref.importId,
        lastSeenImportId: ref.importId,
      })),
    )
    .returning({ id: rosterRecords.id, personnelFileNumber: rosterRecords.personnelFileNumber });
  return new Map(rows.map((row) => [fileNumberKey(row.personnelFileNumber), row.id]));
}

/**
 * Writes the rows' values to their records in one statement. An exited record is re-activated:
 * back to the state it had before its exit (`onboarded` stays onboarded, spec #27), without its
 * exit date.
 */
async function updateRecords(
  tx: Transaction,
  ref: ImportRef,
  channel: ImportChannel,
  updates: { recordId: string; values: RecordValues }[],
): Promise<void> {
  if (updates.length === 0) return;
  const source = updates.map(({ recordId, values }) => ({
    id: recordId,
    personnel_file_number: values.personnelFileNumber,
    full_name: values.fullName,
    national_id: values.nationalId,
    designation: values.designation,
    job_group: values.jobGroup,
    reporting_entity_id: values.reportingEntityId,
    appointment_date: values.appointmentDate,
    email: values.email,
    phone: values.phone,
  }));
  await tx.execute(sql`
    update roster_records as target set
      personnel_file_number = source.personnel_file_number,
      full_name = source.full_name,
      national_id = source.national_id,
      designation = source.designation,
      job_group = source.job_group,
      reporting_entity_id = source.reporting_entity_id,
      appointment_date = source.appointment_date,
      email = source.email,
      phone = source.phone,
      state = case
        when target.state = 'exited' then coalesce(target.state_before_exit, 'not_onboarded')
        else target.state
      end,
      state_before_exit = null,
      exit_date = case when target.state = 'exited' then null else target.exit_date end,
      source = ${channel},
      last_seen_import_id = ${ref.importId},
      updated_at = now()
    from jsonb_to_recordset(${JSON.stringify(source)}::jsonb) as source(
      id uuid,
      personnel_file_number text,
      full_name text,
      national_id text,
      designation text,
      job_group text,
      reporting_entity_id uuid,
      appointment_date date,
      email text,
      phone text
    )
    where target.id = source.id and target.tenant = ${ref.tenant}
  `);
}

/** Records the import saw without changing them; `updated_at` stays as it was. */
async function markSeen(tx: Transaction, ref: ImportRef, recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return;
  await tx.execute(sql`
    update roster_records set last_seen_import_id = ${ref.importId}
    where ${and(eq(rosterRecords.tenant, ref.tenant), inArray(rosterRecords.id, recordIds))}
  `);
}
