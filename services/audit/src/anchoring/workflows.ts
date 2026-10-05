import { proxyActivities } from '@temporalio/workflow';

import type { AnchoringActivities } from './activities.js';
import type { AnchoringResult, ChainRef } from './contract.js';

const { chainsToAnchor, anchorChain, chainsToVerify, verifyChain } =
  proxyActivities<AnchoringActivities>({
    startToCloseTimeout: '5 minutes',
    retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
  });

/**
 * `auditAnchoring` (ADR-008 Pipeline steps 5 and 6), started daily by its schedule: anchors every
 * chain of the days that ended and have none, then verifies the last week's anchored chains
 * again, signatures included. History holds tenant keys, days and counts only.
 */
export async function auditAnchoring(): Promise<AnchoringResult> {
  const tampered: ChainRef[] = [];
  let anchored = 0;
  for (const chain of await chainsToAnchor()) {
    if (await anchorChain(chain)) anchored += 1;
    else tampered.push(chain);
  }
  const toVerify = await chainsToVerify();
  for (const chain of toVerify) {
    if (!(await verifyChain(chain))) tampered.push(chain);
  }
  return { anchored, verified: toVerify.length, tampered };
}
