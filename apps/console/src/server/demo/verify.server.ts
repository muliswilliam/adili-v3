import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { env } from '../env.server';
import { getDemoSwitch } from './demo.server';
import { VERIFY_STATUSES } from './verify';

/**
 * The demo panel's verify codes: a verifiable document in every verify status, as
 * `pnpm demo:seed --only verify` wrote them to the stack's `.demo/verify.json`, and the tampered
 * slip it wrote beside it. The codes change with every seed from empty and live only on the host
 * that was seeded, so the hosted presenter reads them here. Demo mode and a signed-in demo account
 * only: null (or a 404) otherwise.
 */

/** A file the seed writes beside verify.json: a plain name, never a path. */
const FILE_NAME = /^[\w-]+(\.[\w-]+)*\.pdf$/;

/** One entry of `.demo/verify.json` (demo-seed `VerifyDocument`). */
const verifyDocumentSchema = z.object({
  status: z.enum(VERIFY_STATUSES),
  what: z.string(),
  verificationId: z.string().min(1),
  verifyUrl: z.string(),
  file: z.string().regex(FILE_NAME).optional(),
});
export type DemoVerifyDocument = z.infer<typeof verifyDocumentSchema>;

export type DemoVerifyCodes =
  | { state: 'ready'; documents: DemoVerifyDocument[] }
  /** The verify step has not run on this stack (no verify.json yet). */
  | { state: 'not-seeded' }
  /** verify.json is there but does not read as the seed writes it. */
  | { state: 'unreadable' };

function outputDir(): string {
  return resolve(env().DEMO_OUTPUT_DIR ?? resolve(process.cwd(), '../../.demo'));
}

async function allowed(request: Request): Promise<boolean> {
  const demo = getDemoSwitch();
  return Boolean(demo && (await demo.currentDemoKey(request)));
}

async function readCodes(): Promise<DemoVerifyCodes> {
  let text: string;
  try {
    text = await readFile(resolve(outputDir(), 'verify.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'not-seeded' };
    return { state: 'unreadable' };
  }
  try {
    const parsed = z.array(verifyDocumentSchema).safeParse(JSON.parse(text));
    return parsed.success ? { state: 'ready', documents: parsed.data } : { state: 'unreadable' };
  } catch {
    return { state: 'unreadable' };
  }
}

export async function loadDemoVerifyCodes(request: Request): Promise<DemoVerifyCodes | null> {
  if (!(await allowed(request))) return null;
  return readCodes();
}

/**
 * A file verify.json names (the tampered slip) as an attachment, from the stack's `.demo/`. Only a
 * name verify.json lists is served; 404 for anything else, outside demo mode or without a demo
 * account.
 */
export async function demoVerifyFileResponse(request: Request, name: string): Promise<Response> {
  if (!FILE_NAME.test(name) || !(await allowed(request))) {
    return new Response(null, { status: 404 });
  }
  const codes = await readCodes();
  if (codes.state !== 'ready' || !codes.documents.some((document) => document.file === name)) {
    return new Response(null, { status: 404 });
  }
  let body: Buffer;
  try {
    body = await readFile(resolve(outputDir(), name));
  } catch {
    return new Response('The seed has not written this file on this stack.', { status: 404 });
  }
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
}
