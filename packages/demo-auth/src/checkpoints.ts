/**
 * The demo's checkpoints (#621): whole-stack snapshots `pnpm demo:checkpoints` captures once and
 * `pnpm demo:reset <name>` restores, so any beat of the story starts cold. One list for the seed
 * that captures them, the console's demo panel and the judges' pack.
 */
export interface DemoCheckpoint {
  name: string;
  /** What the stack holds at this checkpoint. */
  state: string;
  /** The beat the presenter starts from here. */
  beat: string;
}

export const DEMO_CHECKPOINTS: readonly DemoCheckpoint[] = [
  {
    name: '0-start',
    state: 'Seeded; Wanjiku has not started her current declaration',
    beat: 'Roster, onboarding and the live filing',
  },
  {
    name: '1-after-filing',
    state: 'Wanjiku submitted: her case is in the PSC queue with its registry flags',
    beat: 'Review: cross-checks and the copilot',
  },
  {
    name: '2-after-review',
    state: 'Wanjiku’s clarification is issued, waiting for her reply',
    beat: 'Clarification reply, determination and actions',
  },
  {
    name: '3-form-m-ready',
    state: 'PSC’s Form M is compiled and reviewed, ready to confirm',
    beat: 'Form M, EACC intake, the national report and open data',
  },
];

export function isDemoCheckpoint(name: string): boolean {
  return DEMO_CHECKPOINTS.some((checkpoint) => checkpoint.name === name);
}
