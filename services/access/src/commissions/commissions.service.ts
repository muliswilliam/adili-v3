import { Injectable } from '@nestjs/common';

import { Clock } from '../clock.js';
import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import { directoryUnavailable } from '../problems.js';
import { type AccessCommission, toAccessCommission } from './representation.js';

/** The Commissions a Form K can be addressed to, as the directory lists them. */
@Injectable()
export class CommissionsService {
  constructor(
    private readonly directory: DirectoryClient,
    private readonly clock: Clock,
  ) {}

  /** Every active Commission, by name, with the declaration years it can hold. */
  async list(): Promise<AccessCommission[]> {
    let listed;
    try {
      listed = await this.directory.listCommissions();
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
    const now = this.clock.now();
    return listed
      .filter((commission) => commission.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((commission) => toAccessCommission(commission, now));
  }
}
