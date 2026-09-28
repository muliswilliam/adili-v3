// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiDocs, apiDocsExamples } from './api-docs';

const endpoints = {
  baseUrl: 'https://api.adili.go.ke',
  tokenEndpoint: 'https://id.adili.go.ke/realms/adili/protocol/openid-connect/token',
};

describe('apiDocsExamples', () => {
  it('addresses the Commission and URL-encodes the file number of the exit', () => {
    expect(apiDocsExamples('tsc', 'https://api.adili.go.ke')).toEqual({
      imports: 'https://api.adili.go.ke/v1/commissions/tsc/roster/imports',
      importReport: 'https://api.adili.go.ke/v1/commissions/tsc/roster/imports/{importId}',
      rejectedRows:
        'https://api.adili.go.ke/v1/commissions/tsc/roster/imports/{importId}/rows?status=rejected',
      exit: 'https://api.adili.go.ke/v1/commissions/tsc/roster/records/TSC%2F2014%2F0457/exit',
      fileNumber: 'TSC/2014/0457',
    });
  });
});

describe('ApiDocs', () => {
  it('sums up the API: base URL, scope, batch size, keys, rate limits and formats', () => {
    render(<ApiDocs slug="psc" endpoints={endpoints} />);
    const facts = screen.getByText('Base URL').closest('dl');
    const text = facts?.textContent ?? '';
    expect(text).toContain('Base URLhttps://api.adili.go.ke');
    expect(text).toContain('Scoperoster:write');
    expect(text).toContain('Batch size1 to 1,000 rows');
    expect(text).toContain('Idempotency-KeyRequired on batches and exits');
    expect(text).toContain('Rate limit120 writes and 600 reads per minute per client');
    expect(text).toContain('FormatsJSON, dates as YYYY-MM-DD');
  });

  it('walks through token, batch, report, exit, errors and rate limits, each with an example', () => {
    render(<ApiDocs slug="psc" endpoints={endpoints} />);
    const titles = [
      'Get a token',
      'Send a batch of roster rows',
      'Fetch the import report',
      'Record an exit',
      'Errors',
      'Rate limits',
    ];
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(titles);
    for (const title of titles) {
      const section = screen.getByRole('region', { name: title });
      expect(within(section).getByRole('group', { name: `${title} example` })).toBeTruthy();
    }
  });

  it("fills the examples with this deployment's endpoints and the Commission", () => {
    render(<ApiDocs slug="psc" endpoints={endpoints} />);
    const example = (name: string) => screen.getByRole('group', { name }).textContent;

    expect(example('Get a token example')).toContain(`curl -X POST '${endpoints.tokenEndpoint}'`);
    expect(example('Get a token example')).toContain('grant_type=client_credentials');

    const batch = example('Send a batch of roster rows example');
    expect(batch).toContain("'https://api.adili.go.ke/v1/commissions/psc/roster/imports'");
    expect(batch).toContain('Idempotency-Key: ');
    expect(batch).toContain('"channel": "api"');
    expect(batch).toContain('"personnelFileNumber": "PSC/2014/0457"');
    expect(batch).toContain('# 202 Accepted');

    expect(example('Fetch the import report example')).toContain('/rows?status=rejected');
    expect(example('Record an exit example')).toContain(
      '/v1/commissions/psc/roster/records/PSC%2F2014%2F0457/exit',
    );
    expect(example('Errors example')).toContain('"rowIndex": 3');
    expect(example('Rate limits example')).toContain('RateLimit-Limit: 120');
    expect(example('Rate limits example')).toContain('Retry-After: 1');
  });

  it('lists what each error status means', () => {
    render(<ApiDocs slug="psc" endpoints={endpoints} />);
    const errors = screen.getByRole('region', { name: 'Errors' });
    const statuses = within(errors)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(statuses).toEqual(['400', '401', '403', '404', '409', '422', '429']);
    expect(screen.getByText(/another import is still running/i)).toBeTruthy();
  });
});
