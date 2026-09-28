// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { getDeclarationSection } from '../../server/declarations';
import {
  DeclarationNotFound,
  loadSectionFor,
  requireDeclarationId,
  SectionUnavailable,
  settleLoad,
  statementKey,
} from './route-helpers';
import { loginHref } from '../sign-in';

vi.mock('@tanstack/react-router', async () => ({
  ...(await import('./testing-mocks')).routerMock(),
  notFound: () => new Error('not found'),
  redirect: (options: unknown) => options,
}));
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());

describe('workspace route helpers', () => {
  it('404s malformed ids and person keys', () => {
    expect(requireDeclarationId('9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a')).toBe(
      '9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a',
    );
    expect(() => requireDeclarationId('nope')).toThrow('not found');
    expect(statementKey('officer')).toBe('statement:officer');
    expect(statementKey('child:9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a')).toBe(
      'statement:child:9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a',
    );
    expect(() => statementKey('cousin:1')).toThrow('not found');
  });

  it('sends the declarant back to the page after signing in', () => {
    expect(loginHref('/declarations/d-1/bio')).toBe(
      '/auth/login?returnTo=%2Fdeclarations%2Fd-1%2Fbio',
    );
  });

  it('signs a signed-out declarant in with a full page load, even on in-app navigation', async () => {
    // /auth/login is a server route: rendering it in the browser router shows Not Found.
    vi.mocked(getDeclarationSection).mockResolvedValue({ status: 'unauthenticated' });

    await expect(
      loadSectionFor('9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a', 'bio', '/declarations/d-1/bio'),
    ).rejects.toEqual({
      href: '/auth/login?returnTo=%2Fdeclarations%2Fd-1%2Fbio',
      reloadDocument: true,
    });
  });

  it('settles any loader result the same way', () => {
    expect(() => settleLoad({ status: 'unauthenticated' }, '/declarations/d-1/summary')).toThrow();
    expect(() => settleLoad({ status: 'not-found' }, '/declarations/d-1/summary')).toThrow(
      'not found',
    );
    expect(settleLoad({ status: 'unavailable' }, '/declarations/d-1/summary')).toEqual({
      status: 'unavailable',
    });
  });

  it('404s a section the draft does not have', async () => {
    vi.mocked(getDeclarationSection).mockResolvedValue({ status: 'not-found' });

    await expect(
      loadSectionFor('9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a', 'bio', '/declarations/d-1/household'),
    ).rejects.toThrow('not found');
  });

  it('renders the unavailable and not-found states', () => {
    render(<SectionUnavailable />);
    expect(screen.getByRole('alert').textContent).toContain('We could not load this section');

    render(<DeclarationNotFound />);
    expect(screen.getByRole('heading', { name: 'Declaration not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your dashboard' }).getAttribute('href')).toBe(
      '/',
    );
  });
});
