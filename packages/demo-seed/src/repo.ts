import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** The monorepo's root: the seed reads fixtures from it and runs the services' demo scripts. */
export const REPO_ROOT = join(import.meta.dirname, '../../..');

const run = promisify(execFile);

/**
 * Runs a service's own demo script (`pnpm --filter <package> <script> ...args`) for what no API
 * does, and returns the last line it printed (`changed` or `unchanged` by convention).
 */
export async function serviceScript(
  pkg: string,
  script: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await run('pnpm', ['--silent', '--filter', pkg, script, ...args], {
    cwd: REPO_ROOT,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim().split('\n').at(-1) ?? '';
}

/**
 * Runs one of the repo's own scripts (`node <path>`, from the repo root) with extra environment,
 * and returns the last line it printed (`changed` or `unchanged` by convention).
 */
export async function repoScript(
  path: string,
  env: Readonly<Record<string, string>>,
): Promise<string> {
  const { stdout } = await run(process.execPath, [path], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim().split('\n').at(-1) ?? '';
}
