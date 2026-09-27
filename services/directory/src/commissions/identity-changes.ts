import type { LoggerService } from '@nestjs/common';

/**
 * The identity provider changes one unit of work has made, each with the call that puts it
 * back. Keycloak has no transactions, so when a later step fails the unit of work undoes its
 * changes, newest first, leaving identity state matching the database that rolled back.
 */
export class IdentityChanges {
  private readonly undos: { change: string; undo: () => Promise<void> }[] = [];

  constructor(private readonly logger: LoggerService) {}

  /** Records a change that has been made, and how to undo it. */
  made(change: string, undo: () => Promise<void>): void {
    this.undos.push({ change, undo });
  }

  /**
   * Undoes every recorded change, newest first, and forgets them. Never throws: an undo that
   * fails (the identity provider is down, typically) is logged as an error for an operator and
   * the rest are still attempted. A retry of the request converges from whatever is left.
   */
  async undo(): Promise<void> {
    for (let entry = this.undos.pop(); entry; entry = this.undos.pop()) {
      try {
        await entry.undo();
      } catch (error) {
        this.logger.error(
          { err: error, change: entry.change },
          'Could not undo an identity change after a failed unit of work; fix the account by hand',
        );
      }
    }
  }
}
