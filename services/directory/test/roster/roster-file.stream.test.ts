import { Readable } from 'node:stream';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { parseRosterFile } from '../../src/roster/roster-file.js';

const ROWS = 1_000_000;

setFlagsFromString('--expose-gc');
/** Full collection, so heap samples measure what is retained rather than garbage. */
const gc = runInNewContext('gc') as () => void;

const HEADER =
  'personnel_file_number,full_name,national_id,designation,job_group,reporting_entity,appointment_date,email,phone\n';

/** A synthetic roster CSV produced on the fly, 1,000 rows per chunk; never held whole. */
function* syntheticRoster(rows: number): Generator<Buffer> {
  yield Buffer.from(HEADER);
  for (let start = 0; start < rows; start += 1000) {
    let chunk = '';
    for (let index = start; index < Math.min(start + 1000, rows); index += 1) {
      const phone = index % 10 === 0 ? `07${String(index % 100_000_000).padStart(8, '0')}` : '';
      chunk += `PF/${index},Officer Number ${index},${10_000_000 + index},Clerk,B${index % 9},Station ${index % 500},15/06/2015,officer${index}@example.go.ke,${phone}\n`;
    }
    yield Buffer.from(chunk);
  }
}

describe('parseRosterFile: large files', () => {
  it(
    `streams a ${ROWS.toLocaleString('en')}-row CSV with bounded memory`,
    { timeout: 180_000 },
    async () => {
      const file = await parseRosterFile(Readable.from(syntheticRoster(ROWS)), 'csv', {
        today: '2026-09-28',
      });
      if (!file.ok) throw new Error('expected a readable file');

      gc();
      const baseline = process.memoryUsage().heapUsed;
      let peak = baseline;
      let count = 0;
      for await (const row of file.rows) {
        count += 1;
        if (row.status === 'rejected') throw new Error(JSON.stringify(row.errors));
        if (count % 100_000 === 0) {
          gc();
          peak = Math.max(peak, process.memoryUsage().heapUsed);
        }
      }

      expect(count).toBe(ROWS);
      expect(file.totals).toEqual({ rows: ROWS, accepted: ROWS, rejected: 0 });
      // Rows are not kept; only the in-file duplicate keys (file number and national ID per row)
      // are, about 100 MB at the one-million-row limit. Keeping the rows would take gigabytes.
      expect(peak - baseline).toBeLessThan(200 * 1024 * 1024);
    },
  );
});
