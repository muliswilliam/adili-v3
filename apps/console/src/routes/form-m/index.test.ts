import { isRedirect } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FormMResult, FormMWorkspace } from '../../server/form-m.server';

const getFormMWorkspace =
  vi.fn<(input: { data: { slug: string; fy?: number } }) => Promise<FormMResult<FormMWorkspace>>>();
vi.mock('../../server/form-m', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getFormMWorkspace: (input: { data: { slug: string; fy?: number } }) => getFormMWorkspace(input),
  compileFormM: vi.fn(),
}));

const { loadFormM } = await import('./index');

const workspace = (fy: number): FormMResult<FormMWorkspace> => ({
  ok: true,
  data: { today: '2026-10-03', periods: [], fy, report: null },
});
const context = { workspace: {}, tenant: 'psc' };

beforeEach(() => {
  getFormMWorkspace.mockReset();
});

describe('the Form M route loader', () => {
  it("loads the year asked for, as the viewer's own Commission", async () => {
    getFormMWorkspace.mockResolvedValue(workspace(2025));
    expect(await loadFormM({ fy: 2025 }, context, '/form-m?fy=2025')).toEqual(workspace(2025));
    expect(getFormMWorkspace).toHaveBeenCalledWith({ data: { slug: 'psc', fy: 2025 } });
  });

  it('redirects an unlisted ?fy= to the default year under /form-m', async () => {
    // The service has no period for 2019, so the workspace opened its default year instead.
    getFormMWorkspace.mockResolvedValue(workspace(2025));
    const thrown = await loadFormM({ fy: 2019 }, context, '/form-m?fy=2019').catch(
      (error: unknown) => error,
    );
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ options: { to: '/form-m', search: {}, replace: true } });
  });

  it('opens the default year without ?fy=', async () => {
    getFormMWorkspace.mockResolvedValue(workspace(2025));
    expect(await loadFormM({}, context, '/form-m')).toEqual(workspace(2025));
  });

  it('fetches nothing without the workspace', async () => {
    expect(await loadFormM({ fy: 2025 }, { workspace: null, tenant: 'psc' }, '/form-m')).toBeNull();
    expect(getFormMWorkspace).not.toHaveBeenCalled();
  });
});
