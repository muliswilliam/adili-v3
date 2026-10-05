import { randomUUID } from 'node:crypto';

import { type Apis, ok } from '../clients/api.js';
import { waitFor } from '../clients/http.js';
import { uploadFile } from '../clients/uploads.js';
import type { SeedContext } from '../context.js';
import { DEMO_COMMISSIONS } from '../data/commissions.js';
import { EXTRA_PSC_ROWS, TIMED_OFFICERS } from '../data/personas.js';
import { fixtureRoster, type RosterRow, rosterCsv } from '../data/roster.js';
import { syntheticOfficers } from '../data/synthetic.js';
import type { SeedStep } from '../step.js';

/** The roster records a Commission holds now, by personnel file number. */
interface HeldRecord {
  id: string;
  fullName: string;
  designation: string | null;
}

async function heldRecords(api: Apis, slug: string): Promise<Map<string, HeldRecord>> {
  const held = new Map<string, HeldRecord>();
  let cursor: string | undefined;
  do {
    const page = ok(
      await api.directory.GET('/v1/commissions/{slug}/roster/records', {
        params: { path: { slug }, query: { limit: 200, ...(cursor && { cursor }) } },
      }),
      `list ${slug} roster records`,
    );
    for (const record of page.items) {
      held.set(record.personnelFileNumber.toUpperCase(), {
        id: record.id,
        fullName: record.fullName,
        designation: record.designation,
      });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return held;
}

/** Today in Nairobi, `days` ago. */
function nairobiDaysAgo(days: number): string {
  const date = new Date(Date.now() + 3 * 3600_000 - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/**
 * The rows a Commission's roster should hold: its fixture officers (the personas), the PSC extras
 * (the IPRS mismatch), the timed officers and its synthetic officers. A timed officer already on
 * the roster keeps the appointment date it was imported with, so a later run changes nothing.
 */
async function desiredRows(
  context: SeedContext,
  api: Apis,
  slug: string,
  held: Map<string, HeldRecord>,
): Promise<RosterRow[]> {
  const rows: RosterRow[] = [...fixtureRoster(slug)];
  if (slug === 'psc') {
    rows.push(...EXTRA_PSC_ROWS);
    for (const timed of TIMED_OFFICERS) {
      const record = held.get(timed.row.personnelFileNumber.toUpperCase());
      let appointmentDate = nairobiDaysAgo(timed.daysSinceAppointment);
      if (record) {
        const detail = ok(
          await api.directory.GET('/v1/commissions/{slug}/roster/records/{recordId}', {
            params: { path: { slug, recordId: record.id } },
          }),
          `read ${timed.row.personnelFileNumber}`,
        );
        appointmentDate = detail.appointmentDate ?? appointmentDate;
      }
      rows.push({ ...timed.row, appointmentDate });
    }
  }
  rows.push(...((await syntheticOfficers(context)).get(slug) ?? []).map(toRow));
  return rows;
}

function toRow(officer: RosterRow): RosterRow {
  return {
    personnelFileNumber: officer.personnelFileNumber,
    fullName: officer.fullName,
    nationalId: officer.nationalId,
    designation: officer.designation,
    jobGroup: officer.jobGroup,
    reportingEntity: officer.reportingEntity,
    employerCode: officer.employerCode,
    appointmentDate: officer.appointmentDate,
    email: officer.email,
    phone: officer.phone,
  };
}

/**
 * Every Commission's roster, imported by its reporting officer as a roster file (spec 02), the
 * way the console does it. Only the rows the roster lacks are imported, as a partial file (not
 * declared complete), so a re-run imports nothing.
 */
export const rosters: SeedStep = {
  id: 'rosters',
  title: 'Rosters: personas, roster-only officers, timed officers, synthetic volume',
  async run(context) {
    let changed = 0;
    const notes: string[] = [];
    for (const commission of DEMO_COMMISSIONS) {
      const api = await context.as(commission.reportingOfficer.demoKey);
      const held = await heldRecords(api, commission.slug);
      const rows = await desiredRows(context, api, commission.slug, held);
      const missing = rows.filter((row) => {
        const record = held.get(row.personnelFileNumber.toUpperCase());
        return record?.fullName !== row.fullName || record.designation !== row.designation;
      });
      notes.push(
        `${commission.slug}: ${String(rows.length)} rows, ${String(missing.length)} to import`,
      );
      if (missing.length === 0) continue;
      const uploadId = await uploadFile(api, {
        purpose: 'roster-import',
        contentType: 'text/csv',
        fileName: `${commission.slug}-demo-roster.csv`,
        bytes: new TextEncoder().encode(rosterCsv(missing)),
      });
      const started = ok(
        await api.directory.POST('/v1/commissions/{slug}/roster/imports', {
          params: { path: { slug: commission.slug }, header: { 'Idempotency-Key': randomUUID() } },
          body: { channel: 'file', uploadId, declaredComplete: false },
        }),
        `import ${commission.slug} roster`,
      );
      const done = await waitFor(
        `${commission.slug} roster import`,
        async () => {
          const current = ok(
            await api.directory.GET('/v1/commissions/{slug}/roster/imports/{importId}', {
              params: { path: { slug: commission.slug, importId: started.id } },
            }),
            `read ${commission.slug} import`,
          );
          return current.state === 'completed' || current.state === 'failed' ? current : undefined;
        },
        { timeoutMs: 10 * 60_000, intervalMs: 1000 },
      );
      if (done.state === 'failed') {
        throw new Error(`${commission.slug} roster import failed: ${JSON.stringify(done.failure)}`);
      }
      notes.push(`${commission.slug}: imported ${JSON.stringify(done.counts)}`);
      changed += missing.length;
    }
    return { changed, notes };
  },
};
