import { availableParallelism } from 'node:os';

/** How many tasks Turborepo runs at once when neither `--concurrency` nor TURBO_CONCURRENCY is set. */
export const TURBO_DEFAULT_CONCURRENCY = 10;

/**
 * How many workers one Vitest run may use, so that the runs Turborepo starts side by side share
 * the machine instead of each taking every core.
 *
 * Under Turborepo (it sets TURBO_HASH in each task) the cores are split between the tasks it runs
 * at once: TURBO_CONCURRENCY when set (a count or a percentage of the cores, as Turborepo reads
 * it), else Turborepo's default. Vitest on its own (`pnpm --filter <package> test`, watch mode)
 * keeps Vitest's default of every core but one. VITEST_MAX_WORKERS still overrides both.
 */
export function maxWorkers(
  env: NodeJS.ProcessEnv = process.env,
  cores: number = availableParallelism(),
): number | undefined {
  if (env.TURBO_HASH === undefined) return undefined;
  const concurrency = turboConcurrency(env.TURBO_CONCURRENCY, cores);
  return Math.max(1, Math.floor(cores / concurrency));
}

function turboConcurrency(value: string | undefined, cores: number): number {
  const match = value?.trim().match(/^(\d+)(%?)$/);
  if (!match) return TURBO_DEFAULT_CONCURRENCY;
  const amount = Number(match[1]);
  const tasks = match[2] === '%' ? Math.floor((cores * amount) / 100) : amount;
  return Math.max(1, tasks);
}
