import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config = {
  APP_URL: 'http://localhost:3020',
  DEMO_MODE: true,
  DEMO_TICKET_SECRET: 'test-demo-ticket-secret' as string | undefined,
  DEMO_OUTPUT_DIR: '' as string | undefined,
  RABBITMQ_URL: 'amqp://localhost',
};
vi.mock('../env.server', () => ({ env: () => config }));

const getSession = vi.fn<() => Promise<{ accessToken: string } | null>>();
vi.mock('../bff.server', () => ({ getBff: () => ({ getSession }) }));

const { demoVerifyFileResponse, loadDemoVerifyCodes } = await import('./verify.server');

const request = () => new Request(`${config.APP_URL}/`);
const TAMPERED = 'tampered-acknowledgement-slip.pdf';
const DOCUMENTS = [
  {
    status: 'valid',
    what: "Otieno Odhiambo's acknowledgement slip",
    verificationId: 'ADL-VALID',
    verifyUrl: 'https://verify.test/v/ADL-VALID',
  },
  {
    status: 'revoked',
    what: 'JSC clarification letter, issued in error and withdrawn',
    verificationId: 'ADL-REVOKED',
    verifyUrl: 'https://verify.test/v/ADL-REVOKED',
  },
  {
    status: 'expired',
    what: 'JSC access package past its validity',
    verificationId: 'ADL-EXPIRED',
    verifyUrl: 'https://verify.test/v/ADL-EXPIRED',
  },
  {
    status: 'hash-mismatch',
    what: "Tampered copy of Otieno's slip",
    verificationId: 'ADL-VALID',
    verifyUrl: 'https://verify.test/v/ADL-VALID',
    file: TAMPERED,
  },
];

let dir: string;

function signedInAs(demoKey: string | null) {
  if (!demoKey) {
    getSession.mockResolvedValue(null);
    return;
  }
  const claims = Buffer.from(JSON.stringify({ demo_key: demoKey })).toString('base64url');
  getSession.mockResolvedValue({ accessToken: `e30.${claims}.sig` });
}

function seeded() {
  writeFileSync(join(dir, 'verify.json'), JSON.stringify(DOCUMENTS));
  writeFileSync(join(dir, TAMPERED), '%PDF-1.7 tampered');
  writeFileSync(join(dir, 'secret.pdf'), '%PDF-1.7 not listed');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adili-demo-'));
  config.DEMO_MODE = true;
  config.DEMO_OUTPUT_DIR = dir;
  signedInAs('reporting-officer');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('demo verify codes', () => {
  it('reads every status the seed wrote, the revoked and expired ones too', async () => {
    seeded();
    const codes = await loadDemoVerifyCodes(request());
    expect(codes).toEqual({ state: 'ready', documents: DOCUMENTS });
  });

  it('says when the verify step has not run on this stack', async () => {
    expect(await loadDemoVerifyCodes(request())).toEqual({ state: 'not-seeded' });
  });

  it('says when verify.json does not read as the seed writes it', async () => {
    writeFileSync(join(dir, 'verify.json'), JSON.stringify([{ status: 'lost' }]));
    expect(await loadDemoVerifyCodes(request())).toEqual({ state: 'unreadable' });
    writeFileSync(join(dir, 'verify.json'), '{not json');
    expect(await loadDemoVerifyCodes(request())).toEqual({ state: 'unreadable' });
  });

  it('is null outside demo mode or without a demo account', async () => {
    seeded();
    signedInAs(null);
    expect(await loadDemoVerifyCodes(request())).toBeNull();
    config.DEMO_MODE = false;
    signedInAs('reporting-officer');
    expect(await loadDemoVerifyCodes(request())).toBeNull();
  });
});

describe('demo verify files', () => {
  it('serves the tampered slip verify.json names as an attachment', async () => {
    seeded();
    const response = await demoVerifyFileResponse(request(), TAMPERED);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${TAMPERED}"`);
    expect(await response.text()).toBe('%PDF-1.7 tampered');
  });

  it('serves only files verify.json names, never a path', async () => {
    seeded();
    expect((await demoVerifyFileResponse(request(), 'secret.pdf')).status).toBe(404);
    expect((await demoVerifyFileResponse(request(), '../verify.json')).status).toBe(404);
    expect((await demoVerifyFileResponse(request(), 'verify.json')).status).toBe(404);
  });

  it('is a 404 outside demo mode or without a demo account', async () => {
    seeded();
    signedInAs(null);
    expect((await demoVerifyFileResponse(request(), TAMPERED)).status).toBe(404);
    config.DEMO_MODE = false;
    signedInAs('reporting-officer');
    expect((await demoVerifyFileResponse(request(), TAMPERED)).status).toBe(404);
  });
});
