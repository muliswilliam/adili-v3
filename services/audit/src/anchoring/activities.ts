import { Injectable, Logger } from '@nestjs/common';

import { Anchoring } from './anchoring.js';
import type { ChainRef } from './contract.js';

/** How many days of anchored chains each daily run verifies again. */
export const REVERIFY_DAYS = 7;

/**
 * The activities of the daily anchoring (`auditAnchoring`), hosted by the audit worker. Every
 * public method is an activity named after it; each is safe to retry.
 */
@Injectable()
export class AnchoringActivities {
  private readonly logger = new Logger(AnchoringActivities.name);

  constructor(private readonly anchoring: Anchoring) {}

  /** The chains of ended days still to anchor. */
  async chainsToAnchor(): Promise<ChainRef[]> {
    return this.anchoring.unanchoredChains();
  }

  /** Anchors one chain; false when it was tampered with, and so left unanchored. */
  async anchorChain(chain: ChainRef): Promise<boolean> {
    const outcome = await this.anchoring.anchor(chain);
    return outcome.status !== 'tampered';
  }

  /** The anchored chains of the last week, to verify again. */
  async chainsToVerify(): Promise<ChainRef[]> {
    return this.anchoring.anchoredChains(REVERIFY_DAYS);
  }

  /** Verifies one anchored chain and its signature; false, and an alert logged, when tampered. */
  async verifyChain(chain: ChainRef): Promise<boolean> {
    const verification = await this.anchoring.verify(chain);
    if (verification.status === 'intact') return true;
    // The alert (architecture §12: audit chain verification failure).
    this.logger.error(
      { chain, problems: verification.problems },
      'Audit chain verification failed',
    );
    return false;
  }
}
