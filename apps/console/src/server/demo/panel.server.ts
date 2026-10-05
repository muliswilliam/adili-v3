import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DEMO_CHECKPOINTS, type DemoCheckpoint, isDemoCheckpoint } from '@adili/demo-auth';

import { env } from '../env.server';
import { getDemoSwitch } from './demo.server';

/**
 * The console's demo panel (#621): resets the stack to a checkpoint and takes a registry mock
 * offline, as thin wrappers over `pnpm demo:reset` (the configured script) and the mocks'
 * `/demo/registries` routes. Demo mode only, and only for a signed-in demo account: everything
 * here answers null (the panel is absent) otherwise.
 */

/** The registries the mocks can pause (mocks/config/faults.py), as the panel names them. */
export const DEMO_REGISTRIES = [
  { system: 'kra', label: 'KRA' },
  { system: 'ntsa', label: 'NTSA' },
  { system: 'brs', label: 'BRS' },
  { system: 'ardhisasa', label: 'ArdhiSasa' },
] as const;

export type DemoRegistry = (typeof DEMO_REGISTRIES)[number]['system'];

export interface DemoRegistryState {
  system: DemoRegistry;
  label: string;
  /** null when the mocks did not answer. */
  paused: boolean | null;
}

export interface DemoPanelState {
  checkpoints: DemoCheckpoint[];
  /**
   * `button`: the panel resets (the Azure host, through the systemd restart). `command`: it shows
   * `pnpm demo:reset <checkpoint>` to run with `pnpm dev` stopped (a local stack).
   */
  reset: 'button' | 'command';
  registries: DemoRegistryState[];
}

export type DemoResetResult = { ok: true } | { ok: false; message: string };

/** The panel is the signed-in demo account's, in demo mode; null for anyone else. */
async function demoAccount(request: Request): Promise<string | null> {
  const demo = getDemoSwitch();
  if (!demo) return null;
  return demo.currentDemoKey(request);
}

export async function loadDemoPanel(request: Request): Promise<DemoPanelState | null> {
  if (!(await demoAccount(request))) return null;
  const config = env();
  return {
    checkpoints: [...DEMO_CHECKPOINTS],
    reset: config.DEMO_RESET_SCRIPT ? 'button' : 'command',
    registries: await Promise.all(
      DEMO_REGISTRIES.map(async ({ system, label }) => ({
        system,
        label,
        paused: await registryPaused(config.DEMO_MOCKS_URL, system),
      })),
    ),
  };
}

async function registryPaused(mocksUrl: string, system: DemoRegistry): Promise<boolean | null> {
  try {
    const response = await fetch(new URL(`demo/registries/${system}`, withSlash(mocksUrl)), {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { paused?: unknown };
    return typeof body.paused === 'boolean' ? body.paused : null;
  } catch {
    return null;
  }
}

/** Pauses or resumes a registry mock; answers its state after, or null (not allowed, or down). */
export async function setRegistryPaused(
  request: Request,
  system: DemoRegistry,
  paused: boolean,
): Promise<boolean | null> {
  if (!(await demoAccount(request))) return null;
  const { DEMO_MOCKS_URL } = env();
  const action = paused ? 'pause' : 'resume';
  try {
    const response = await fetch(
      new URL(`demo/registries/${system}/${action}`, withSlash(DEMO_MOCKS_URL)),
      { method: 'POST', signal: AbortSignal.timeout(3000) },
    );
    return response.ok ? paused : null;
  } catch {
    return null;
  }
}

const run = promisify(execFile);

/**
 * Asks for a reset to a checkpoint. The script checks the checkpoint is complete, leaves the
 * request and restarts the apps, this console with them; the restore runs while they are down.
 * Answers once the restart is asked for, so the page can wait for the console to come back.
 */
export async function requestDemoReset(
  request: Request,
  checkpoint: string,
): Promise<DemoResetResult | null> {
  if (!(await demoAccount(request))) return null;
  const { DEMO_RESET_SCRIPT } = env();
  if (!DEMO_RESET_SCRIPT) {
    return { ok: false, message: `Run pnpm demo:reset ${checkpoint} with pnpm dev stopped.` };
  }
  if (!isDemoCheckpoint(checkpoint)) {
    return { ok: false, message: `No checkpoint ${checkpoint}.` };
  }
  try {
    await run(DEMO_RESET_SCRIPT, ['--detach', checkpoint], { timeout: 60_000 });
    return { ok: true };
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    // The script's first line says why (e.g. no such checkpoint on this host).
    const detail = typeof stderr === 'string' ? stderr.trim().split('\n')[0] : undefined;
    return {
      ok: false,
      message: detail?.trim() ? detail : `The reset to ${checkpoint} could not start.`,
    };
  }
}

function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
