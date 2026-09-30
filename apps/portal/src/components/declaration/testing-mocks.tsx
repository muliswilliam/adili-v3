import type { ReactNode } from 'react';
import { vi } from 'vitest';

/**
 * Module mocks for workspace tests. Kept free of app imports so a mocked module's factory can
 * load it without a cycle:
 *
 *   vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
 *   vi.mock('../../server/declarations', async () =>
 *     (await import('./testing-mocks')).serverMock(),
 *   );
 *
 * Screens with the submit flow also mock `../../server/submission` (`submissionMock`) and
 * `../../server/step-up` (`stepUpMock`); the success page mocks `../../server/submission` and
 * `../download` (`downloadMock`).
 */

export const navigate = vi.fn();
export const invalidate = vi.fn(() => Promise.resolve());

export function routerMock() {
  return {
    Link: ({
      to,
      params,
      children,
      ...props
    }: {
      to: string;
      params?: Record<string, string>;
      children: ReactNode;
    }) => {
      let href = to;
      for (const [name, value] of Object.entries(params ?? {})) {
        href = href.replace(`$${name}`, encodeURIComponent(value));
      }
      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate }),
  };
}

export function serverMock() {
  return {
    getDeclaration: vi.fn(),
    getDeclarationSection: vi.fn(),
    saveDeclarationSection: vi.fn(),
    startMyDeclaration: vi.fn(),
    getMyDeclarations: vi.fn(),
    discardMyDeclaration: vi.fn(),
    linkDeclarationAttachment: vi.fn(),
    unlinkDeclarationAttachment: vi.fn(),
    getDeclarationSummary: vi.fn(),
    requestRegistryLookups: vi.fn(),
    listDeclarationSuggestions: vi.fn(),
    acceptDeclarationSuggestion: vi.fn(),
    dismissDeclarationSuggestion: vi.fn(),
    extractDeclarationAttachment: vi.fn(),
  };
}

export function submissionMock() {
  return {
    submitMyDeclaration: vi.fn(),
    getMySubmission: vi.fn(),
    getMyAcknowledgement: vi.fn(),
    reissueMyAcknowledgement: vi.fn(),
    getMySlipContext: vi.fn(),
  };
}

export function downloadMock() {
  return { downloadFrom: vi.fn() };
}

export function stepUpMock() {
  return { getStepUpStatus: vi.fn() };
}
