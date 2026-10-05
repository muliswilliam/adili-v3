import type { SeedContext } from './context.js';
import type { SeedStep } from './step.js';

export interface RunOptions {
  /** Run only these steps. */
  only?: readonly string[];
  /** Skip the steps before this one. */
  from?: string;
}

export interface StepReport {
  id: string;
  changed: number;
  seconds: number;
}

/** Picks the steps a run asks for, in order; unknown ids are an error, not a silent no-op. */
export function selectSteps(steps: readonly SeedStep[], options: RunOptions): SeedStep[] {
  const ids = new Set(steps.map((step) => step.id));
  for (const id of [...(options.only ?? []), ...(options.from ? [options.from] : [])]) {
    if (!ids.has(id)) throw new Error(`Unknown seed step "${id}". Steps: ${[...ids].join(', ')}`);
  }
  const start = options.from ? steps.findIndex((step) => step.id === options.from) : 0;
  return steps
    .slice(start)
    .filter((step) => !options.only || options.only.length === 0 || options.only.includes(step.id));
}

/** Runs the steps one after another; the first failure stops the run. */
export async function runSteps(
  context: SeedContext,
  steps: readonly SeedStep[],
): Promise<StepReport[]> {
  const reports: StepReport[] = [];
  for (const step of steps) {
    const started = performance.now();
    context.log(`▸ ${step.id}: ${step.title}`);
    const result = await step.run(context);
    const seconds = (performance.now() - started) / 1000;
    for (const note of result.notes ?? []) context.log(`    ${note}`);
    context.log(
      `  ${result.changed === 0 ? 'unchanged' : `${String(result.changed)} changed`} in ${seconds.toFixed(1)}s`,
    );
    reports.push({ id: step.id, changed: result.changed, seconds });
  }
  return reports;
}
