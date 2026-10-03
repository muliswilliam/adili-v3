import { Inject, Injectable } from '@nestjs/common';

import type { KeyedRegistryAdapter, RegistryAdapter } from '../adapter-kit/registry-adapter.js';
import { getFromRegistry, segment } from './registry-http.js';
import {
  type BrsDirectorships,
  brsDirectorshipsSchema,
  brsPersonDirectorshipsSchema,
  hrEmployerSuppliersSchema,
  type SupplierAnswer,
  supplierAnswerSchema,
} from './registry-records.js';
import { REGISTRY_URLS, type RegistryUrls } from './registry-urls.js';

/**
 * BRS (external/brs.yaml `listDirectorshipsByPerson`): the companies a national ID directs or
 * holds shares in. None is a found answer with no directorships, never not found.
 */
@Injectable()
export class BrsDirectorshipsAdapter implements RegistryAdapter<BrsDirectorships> {
  readonly system = 'brs';
  readonly operation = 'directorships';
  readonly schema = brsDirectorshipsSchema;

  constructor(@Inject(REGISTRY_URLS) private readonly urls: RegistryUrls) {}

  fetch(nationalId: string, signal: AbortSignal): Promise<BrsDirectorships | null> {
    const url = `${this.urls.brs}/v1/persons/${segment(nationalId)}/directorships`;
    return getFromRegistry('BRS', url, brsPersonDirectorshipsSchema, signal);
  }
}

/** The supplier check's subject: one employer and one company (neither is personal data). */
export interface SupplierSubject {
  employerCode: string;
  registrationNumber: string;
}

const sameRegistration = (a: string, b: string) =>
  a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase();

/**
 * The employer-supplier check: whether a company is on an employer's supplier list
 * (external/hr.yaml `listSuppliersByEmployer`). It answers a BRS question (does an officer's
 * company supply their employer) but calls HR, so it is its own system, `hr-suppliers`: HR
 * failing opens its circuit, not BRS's, and it has its own rate limit, cache entries, pause and
 * coverage row. The subject is the employer and company (`SupplierSubject`). An employer HR does
 * not know has no suppliers: false, never not found.
 */
@Injectable()
export class SupplierCheckAdapter implements KeyedRegistryAdapter<SupplierAnswer, SupplierSubject> {
  readonly system = 'hr-suppliers';
  readonly operation = 'supplies';
  readonly schema = supplierAnswerSchema;

  constructor(@Inject(REGISTRY_URLS) private readonly urls: RegistryUrls) {}

  /** Employer codes have no `:` (`EMPLOYER_CODE`), so the key reads back one way only. */
  subjectKey({ employerCode, registrationNumber }: SupplierSubject): string {
    return `${employerCode}:${registrationNumber}`;
  }

  async fetch(
    { employerCode, registrationNumber }: SupplierSubject,
    signal: AbortSignal,
  ): Promise<SupplierAnswer | null> {
    const url = `${this.urls.hr}/v1/employers/${segment(employerCode)}/suppliers`;
    const list = await getFromRegistry('HR', url, hrEmployerSuppliersSchema, signal);
    const supplies = (list?.registration_numbers ?? []).some((number) =>
      sameRegistration(number, registrationNumber),
    );
    return { supplies };
  }
}
