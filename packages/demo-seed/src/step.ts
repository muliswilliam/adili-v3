import type { SeedContext } from './context.js';

/**
 * One step of the demo seed. A step brings one part of the demo to the state it wants, through
 * the services' APIs: it reads what is there first and acts only on what is missing, so running
 * it again changes nothing. It reports what it changed, which is how a re-run proves that.
 *
 * Steps run in the order of `STEPS` (`steps/index.ts`); a later step may rely on everything an
 * earlier one produced. Extending the seed (#618, #619, #620) means adding a step module there.
 */
export interface SeedStep {
  /** Stable, kebab-case: `pnpm demo:seed --only <id>` and `--from <id>` name steps by it. */
  id: string;
  /** What the step makes, for the log. */
  title: string;
  run(context: SeedContext): Promise<StepResult>;
}

export interface StepResult {
  /** Things the step created or changed; 0 on a re-run. */
  changed: number;
  /** Short facts for the log (counts, references), one line each. */
  notes?: string[];
}

export function unchanged(...notes: string[]): StepResult {
  return { changed: 0, notes };
}
