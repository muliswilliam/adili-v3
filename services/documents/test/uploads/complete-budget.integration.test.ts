import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MalwareScanner, type ScanResult } from '../../src/scanning/malware-scanner.js';
import { CSV } from '../../src/uploads/purposes.js';
import type { Upload, UploadReservation } from '../../src/uploads/representation.js';
import { type Caller, type DocumentsApi, startDocumentsApi } from '../support/documents-api.js';
import { fixture } from '../support/files.js';

/**
 * Completion under a slow, busy or failing scanner: the time budget (shortened here from the
 * service's 60 s), concurrent completions and scanner outages, with real storage and Postgres.
 */
type Scan = (source: AsyncIterable<Uint8Array>, signal: AbortSignal) => Promise<ScanResult>;

class ScriptedScanner extends MalwareScanner {
  behaviour: Scan = drainThen({ infected: false });

  scan(source: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<ScanResult> {
    return this.behaviour(source, signal);
  }
}

function drainThen(result: ScanResult, delayMs = 0): Scan {
  return async (source) => {
    let bytes = 0;
    for await (const chunk of source) bytes += chunk.length;
    expect(bytes).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return result;
  };
}

/** Never answers; rejects only when the budget runs out. */
const silent: Scan = (_, signal) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

const OFFICER: Caller = { sub: 'officer-1', tenant: 'psc', roles: ['reporting-officer'] };
const BUDGET_MS = 500;

const scanner = new ScriptedScanner();
let api: DocumentsApi;

beforeAll(async () => {
  api = await startDocumentsApi({ scanner, completeBudgetMs: BUDGET_MS });
});

afterAll(async () => {
  await api.close();
});

async function upload(): Promise<UploadReservation> {
  const bytes = fixture('roster.csv');
  const response = await api.post(
    '/v1/uploads',
    { purpose: 'roster-import', contentType: CSV, declaredSize: bytes.length },
    OFFICER,
  );
  const reservation = response.json<UploadReservation>();
  const put = await fetch(reservation.uploadUrl, {
    method: 'PUT',
    body: bytes,
    headers: { 'content-type': CSV },
  });
  expect(put.status).toBe(200);
  return reservation;
}

const complete = (id: string) => api.post(`/v1/uploads/${id}/complete`, undefined, OFFICER);

async function quarantined(id: string): Promise<boolean> {
  try {
    await api.s3.send(new HeadObjectCommand({ Bucket: 'quarantine', Key: `roster-import/${id}` }));
    return true;
  } catch {
    return false;
  }
}

describe('completion budget', () => {
  it('rejects with timeout when the scan outlasts the budget, and deletes the object', async () => {
    scanner.behaviour = silent;
    const reservation = await upload();
    const started = Date.now();

    const response = await complete(reservation.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: 'rejected', rejection: 'timeout' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(BUDGET_MS);
    expect(Date.now() - started).toBeLessThan(BUDGET_MS + 5_000);
    expect(await quarantined(reservation.id)).toBe(false);
  });

  it('lets one of two concurrent completions run and answers 409 to the other', async () => {
    scanner.behaviour = drainThen({ infected: false }, 200);
    const reservation = await upload();

    const responses = await Promise.all([complete(reservation.id), complete(reservation.id)]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const conflict = responses.find((response) => response.statusCode === 409);
    expect(conflict?.json<{ type: string }>().type).toBe('upload-completing');
    const done = responses.find((response) => response.statusCode === 200);
    expect(done?.json<Upload>().state).toBe('clean');
  });

  it('answers 503 when the scanner fails, leaving the upload to be completed again', async () => {
    scanner.behaviour = () => Promise.reject(new Error('clamd: connection refused'));
    const reservation = await upload();

    const failed = await complete(reservation.id);

    expect(failed.statusCode).toBe(503);
    expect(failed.json<{ type: string }>().type).toBe('upload-check-unavailable');
    expect(await quarantined(reservation.id)).toBe(true);

    scanner.behaviour = drainThen({ infected: false });
    const retried = await complete(reservation.id);
    expect(retried.statusCode).toBe(200);
    expect(retried.json<Upload>().state).toBe('clean');
  });
});
