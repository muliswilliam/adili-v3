import { ToastProvider, TooltipProvider } from '@adili/ui';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { LoadedSection } from '../../server/declarations.server';
import type { Declaration, DeclarationSection } from '../../server/declarations/types';
import { WorkspaceProvider } from './workspace';
import { WorkspaceLayout } from './workspace-layout';

/**
 * Fixtures and a render helper for workspace screens. Mock the router and the server functions
 * in each test file with the factories in `testing-mocks.tsx`.
 */

export const DECLARATION_ID = '9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a';

export function sections(
  completeness: Partial<Record<string, DeclarationSection['completeness']>> = {},
  extra: DeclarationSection[] = [],
): DeclarationSection[] {
  const base: DeclarationSection[] = [
    { key: 'bio', completeness: 'not-started', updatedAt: null, personName: null },
    { key: 'household', completeness: 'not-started', updatedAt: null, personName: null },
    {
      key: 'statement:officer',
      completeness: 'not-started',
      updatedAt: null,
      personName: 'Mwangi Njoroge Kamau',
    },
    ...extra,
    { key: 'other', completeness: 'not-started', updatedAt: null, personName: null },
  ];
  return base.map((section) => ({
    ...section,
    completeness: completeness[section.key] ?? section.completeness,
  }));
}

/** A biennial draft as the mock starts it (S1). */
export function sampleDeclaration(overrides: Partial<Declaration> = {}): Declaration {
  return {
    id: DECLARATION_ID,
    obligationId: '0b1e5a1d-5c0a-4d3e-9f10-000000000001',
    commission: { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
    type: 'biennial',
    statementDate: '2027-11-01',
    incomePeriod: { from: '2025-11-01', to: '2027-11-01', fromSource: 'assumed' },
    status: 'draft',
    schemaVersion: 'declaration.v1',
    draftVersion: 1,
    sections: sections(),
    lastSection: null,
    createdAt: '2026-09-27T08:00:00Z',
    updatedAt: '2026-09-27T08:00:00Z',
    ...overrides,
  };
}

/** The bio as the mock pre-fills it from the roster. */
export function sampleBio(contents: Record<string, unknown> = {}): LoadedSection {
  return {
    key: 'bio',
    completeness: 'not-started',
    draftVersion: 1,
    issues: [],
    contents: {
      name: { surname: 'Kamau', firstName: 'Mwangi', otherNames: 'Njoroge' },
      employment: {
        designation: 'Deputy Principal',
        employer: 'Nyeri High School',
        responsibleCommission: 'tsc',
        personnelFileNumber: 'TSC/999999',
      },
      ...contents,
    },
  };
}

/** Renders a screen inside the workspace provider and layout, as the route does. */
export function renderWorkspace(
  ui: ReactNode,
  { declaration = sampleDeclaration(), step = 'overview', etag = '"1"' } = {},
) {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <WorkspaceProvider declaration={declaration} etag={etag}>
          <WorkspaceLayout step={step}>{ui}</WorkspaceLayout>
        </WorkspaceProvider>
      </TooltipProvider>
    </ToastProvider>,
  );
}

/** A named region, e.g. a section of a screen or a summary card. */
export function region(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

/** The list item a heading names, e.g. a repeater card; `scope` narrows the search. */
export function cardOf(
  name: string,
  { scope = document.body, level }: { scope?: HTMLElement; level?: number } = {},
): HTMLElement {
  const item = within(scope).getByRole('heading', { name, level }).closest('li');
  if (!item) throw new Error(`No card for ${name}`);
  return item;
}

/** Queries within the list item that shows some text, e.g. an attachment row. */
export function rowOf(text: string) {
  const item = screen.getByText(text).closest('li');
  if (!item) throw new Error(`No row for ${text}`);
  return within(item);
}
