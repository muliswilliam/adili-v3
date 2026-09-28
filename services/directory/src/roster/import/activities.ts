import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';

import type { DirectorySchema } from '../../db/schema.js';
import { applyChunk } from './apply-chunk.js';
import { finaliseImport } from './finalise.js';
import { keepHeartbeating } from './heartbeats.js';
import { flagAbsent } from './flag-absent.js';
import { DocumentsUnavailable, RosterUploads } from './roster-uploads.js';
import { stageImport } from './staging.js';
import {
  type ChunkCounts,
  type ImportRef,
  type ImportResult,
  STORAGE_ERROR,
  type StageResult,
} from './workflow-contract.js';

/**
 * The activities of `RosterImportWorkflow`, hosted by the directory's worker. Every public
 * method is an activity named after it (keep helpers out of this class). Each one is safe to
 * retry: see the functions they delegate to.
 */
@Injectable()
export class RosterImportActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
    private readonly uploads: RosterUploads,
  ) {}

  /**
   * Reads, validates and stages the import's rows; heartbeats throughout, with the rows staged
   * so far.
   */
  async stage(ref: ImportRef): Promise<StageResult> {
    try {
      return await keepHeartbeating(Context.current(), (progress) =>
        stageImport(this.db, this.uploads, ref, { heartbeat: progress }),
      );
    } catch (error) {
      if (error instanceof DocumentsUnavailable) {
        throw ApplicationFailure.retryable(error.message, STORAGE_ERROR);
      }
      throw error;
    }
  }

  /** Applies chunk `chunkIndex` of the import's accepted rows in one transaction. */
  applyChunk(ref: ImportRef, chunkIndex: number): Promise<ChunkCounts> {
    return applyChunk(this.db, ref, chunkIndex);
  }

  /** Flags the records a declared-complete import left out; returns how many it flagged. */
  flagAbsent(ref: ImportRef): Promise<number> {
    return flagAbsent(this.db, ref);
  }

  /** Ends the import: counts, state, summary and event, in one transaction. */
  finalise(ref: ImportRef, result: ImportResult): Promise<void> {
    return finaliseImport(this.db, this.events, ref, result);
  }
}
