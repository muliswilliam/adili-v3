import { nairobiToday } from '../../components/form-m/financial-year';
import { env } from '../env.server';

/**
 * Today in Nairobi, the day the Form M workspace, EACC's intake and the national report count from; with the
 * reporting mock in development, the mock's day, so the pages and the mock agree. Server only.
 */
export async function reportingToday(): Promise<string> {
  if (import.meta.env.DEV && env().REPORTING_MOCK) {
    return (await import('./mock.server')).mockReportingToday();
  }
  return nairobiToday();
}
