import { z } from 'zod';

/**
 * Demo-only short windows (#371): a demo stack seeds states that legally take weeks (a
 * clarification past its reply window, a ladder past its notice) by shortening the window a
 * service computes when it starts one. A shortened window is stored like a legal one, so the
 * deadline the screens show and the timer a workflow waits on stay the same; only windows started
 * while the setting is on are short. Off unless the service runs with `DEMO_MODE=true`, never in
 * production.
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** `P[nD][T[nH][nM][nS]]`: days and smaller, so every duration has one length in milliseconds. */
const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** The length of an ISO-8601 duration of days, hours, minutes and seconds; null when not one. */
export function isoDurationMs(value: string): number | null {
  const match = ISO_DURATION.exec(value);
  if (!match || value === 'P' || value.endsWith('T')) return null;
  const [, days, hours, minutes, seconds] = match;
  const ms =
    Number(days ?? 0) * DAY_MS +
    Number(hours ?? 0) * HOUR_MS +
    Number(minutes ?? 0) * MINUTE_MS +
    Number(seconds ?? 0) * SECOND_MS;
  return ms > 0 ? ms : null;
}

/** An optional demo window setting: an ISO-8601 duration (`PT2M`), parsed to milliseconds. */
export const demoWindowSetting = z
  .string()
  .transform((value, ctx) => {
    const ms = isoDurationMs(value);
    if (ms === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Must be a positive ISO-8601 duration of days to seconds, e.g. PT2M or P1DT12H',
      });
      return z.NEVER;
    }
    return ms;
  })
  .optional();

/**
 * `DEMO_WINDOW_TENANTS`: the Commissions (tenant keys, comma-separated) whose windows the demo
 * window settings shorten; unset, every Commission's. One demo stack can then hold a state past a
 * short window in one Commission and the same state inside its legal window in another, with no
 * restart between them.
 */
export const demoWindowTenantsSetting = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((tenant) => tenant.trim())
      .filter((tenant) => tenant !== ''),
  )
  .optional();

/**
 * The demo window (milliseconds) for a window started in `tenant`: `windowMs` when set and the
 * tenant is among `tenants` (or `tenants` is unset), else undefined, i.e. the legal window.
 */
export function demoWindowFor(
  windowMs: number | undefined,
  tenants: readonly string[] | undefined,
  tenant: string,
): number | undefined {
  if (windowMs === undefined) return undefined;
  return tenants === undefined || tenants.includes(tenant) ? windowMs : undefined;
}

/** `DEMO_MODE`: off by default; demo window settings are refused unless it is on. */
export const demoModeSetting = z.stringbool().default(false);

/**
 * Refuses demo window settings (`keys`) unless `DEMO_MODE` is on, and always in production, so a
 * forgotten setting cannot shorten a legal window on a real deployment.
 */
export function refuseDemoWindowsOutsideDemo(
  env: { NODE_ENV: string; DEMO_MODE: boolean } & Record<string, unknown>,
  keys: readonly string[],
  ctx: z.RefinementCtx,
): void {
  const set = keys.filter((key) => env[key] !== undefined);
  if (set.length === 0) return;
  if (env.NODE_ENV === 'production') {
    for (const key of set) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'Demo windows are refused in production',
      });
    }
  } else if (!env.DEMO_MODE) {
    for (const key of set) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'Set DEMO_MODE=true to use demo windows',
      });
    }
  }
}
