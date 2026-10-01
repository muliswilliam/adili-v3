// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AccessRequest } from '../../server/access/types';
import { SubmittedRequest } from './submitted-request';
import { IDS, seededRequest } from './testing';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);

function show(request: AccessRequest) {
  render(
    <ToastProvider>
      <SubmittedRequest request={request} />
    </ToastProvider>,
  );
}

describe('SubmittedRequest (S2)', () => {
  it('shows the ARQ reference and the acknowledgement', async () => {
    const request = await seededRequest(IDS.submitted);
    show(request);
    expect(screen.getByRole('heading', { name: 'Request submitted' })).toBeTruthy();
    expect(screen.getByText(request.reference)).toBeTruthy();
    expect(
      screen.getByText(
        'Acknowledged 2 Oct 2026. The Commission has 30 days to decide. You will be notified.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View request' }).getAttribute('href')).toBe(
      `/access/requests/${request.id}`,
    );
    expect(screen.queryByText(/Your identity will be verified/)).toBeNull();
  });

  it('tells a passport applicant the Commission checks their identity first', async () => {
    show(await seededRequest(IDS.pending));
    expect(screen.getByText(/Your identity will be verified by the Commission/)).toBeTruthy();
  });
});
