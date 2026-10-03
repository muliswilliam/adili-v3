// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildOpenDataRelease,
  buildOpenDataSnapshot,
  loadOpenDataRelease,
  publishOpenDataRelease,
  withdrawOpenDataRelease,
} from '../../server/open-data-releases.server';
import {
  mockReportingClient,
  resetReportingMock as resetFormMMock,
  setReportingMockLatency,
} from '../../server/reporting/mock.server';
import { setEaccIntakeMockLatency } from '../../server/reporting/eacc-mock.server';
import { resetNcrMock } from '../../server/reporting/ncr-mock.server';
import { resetReleasesMock } from '../../server/reporting/releases-mock.server';
import { ReleaseActions } from './release-actions';
import { ReleaseView } from './release-view';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={params?.releaseId ? to.replace('$releaseId', params.releaseId) : to} {...props}>
      {children}
    </a>
  ),
}));

const client = (roles: string[], name: string) =>
  mockReportingClient(roles, {
    name,
    subject: `user-${name.toLowerCase().replace(/\W+/g, '-')}`,
    tenant: 'eacc',
  });
const analyst = () => client(['eacc-analyst'], 'Brian Otieno');
const supervisor = () => client(['eacc-supervisor'], 'Esther Chebet');

/** FY 2025/2026 snapshot v1 (withdrawn) and v2 (published), the `history` seed. */
const WITHDRAWN_V1 = '0199c000-0000-7000-8000-000000000001';
const PUBLISHED_V2 = '0199c000-0000-7000-8000-000000000002';
const ANNUAL_V1 = '0199c000-0000-7000-8000-000000000003';

async function preview2026(): Promise<string> {
  const built = await buildOpenDataSnapshot(analyst(), 2026, crypto.randomUUID());
  if (!built.ok) throw new Error('build failed');
  return built.data.id;
}

/**
 * The release page as the route wires it: the view with its header actions, calling the loaders
 * as `as` (the signed-in user); `isSupervisor` is what the console knows of their roles.
 */
async function renderRelease(
  releaseId: string,
  { as = supervisor, isSupervisor = true }: { as?: typeof analyst; isSupervisor?: boolean } = {},
) {
  const publish = vi.fn((id: string, key: string) => publishOpenDataRelease(as(), id, key));
  const withdraw = vi.fn((id: string, reason: string, key: string) =>
    withdrawOpenDataRelease(as(), id, reason, key),
  );
  const rebuild = vi.fn((fy: number, kind: 'annual' | 'snapshot', key: string) =>
    buildOpenDataRelease(as(), fy, kind, key),
  );
  const onRebuilt = vi.fn();
  const result = await loadOpenDataRelease(as(), releaseId);
  render(
    <TooltipProvider>
      <ToastProvider>
        <ReleaseView
          result={result}
          links={{ publicPage: null, verifyBase: null }}
          supervisor={isSupervisor}
          actions={(view) => (
            <ReleaseActions
              view={view}
              supervisor={isSupervisor}
              publish={publish}
              withdraw={withdraw}
              rebuild={rebuild}
              onRebuilt={onRebuilt}
              onUnauthenticated={() => undefined}
            />
          )}
        />
      </ToastProvider>
    </TooltipProvider>,
  );
  return { publish, withdraw, rebuild, onRebuilt };
}

/** The `index`th element, which the test needs to exist. */
function nth(elements: HTMLElement[], index: number): HTMLElement {
  const element = elements[index];
  if (!element) throw new Error(`no element ${String(index)}`);
  return element;
}

const statusOf = async (releaseId: string) => {
  const detail = await loadOpenDataRelease(analyst(), releaseId);
  return detail.ok ? detail.data.release : null;
};

beforeEach(() => {
  resetFormMMock('2026-10-03');
  setReportingMockLatency(0);
  setEaccIntakeMockLatency(0);
  resetNcrMock('not-built');
  resetReleasesMock('history');
  invalidate.mockReset();
});

describe('#353 actions are for EACC supervisors', () => {
  it('shows an analyst no Publish on a preview, and says a supervisor publishes it', async () => {
    await renderRelease(await preview2026(), { as: analyst, isSupervisor: false });

    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull();
    expect(screen.getByText('Not public. An EACC supervisor publishes it.')).toBeTruthy();
  });

  it('shows an analyst no Withdraw on a published release', async () => {
    await renderRelease(PUBLISHED_V2, { as: analyst, isSupervisor: false });

    expect(screen.queryByRole('button', { name: /Withdraw/ })).toBeNull();
  });

  it('shows a supervisor Publish on a preview, without the banner', async () => {
    await renderRelease(await preview2026());

    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.queryByText('Not public. An EACC supervisor publishes it.')).toBeNull();
  });

  it('shows a supervisor Withdraw on a published release, and no Publish', async () => {
    await renderRelease(PUBLISHED_V2);

    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });
});

describe('#353 S6 publish', () => {
  it('confirms with the consequences, then publishes', async () => {
    const id = await preview2026();
    await renderRelease(id);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = screen.getByRole('dialog', { name: 'Publish FY 2026/2027 snapshot v1?' });
    expect(dialog.textContent).toContain('This will be public immediately.');
    expect(dialog.textContent).toContain('A manifest is issued as a Public verifiable document.');
    expect(dialog.textContent).toContain('It cannot be edited.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));

    expect(await screen.findByText('Published. It is public now.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invalidate).toHaveBeenCalled();
    expect(await statusOf(id)).toMatchObject({
      status: 'published',
      publishedBy: { name: 'Esther Chebet' },
    });
  });

  it('cancels without publishing', async () => {
    const id = await preview2026();
    const { publish } = await renderRelease(id);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(publish).not.toHaveBeenCalled();
    expect((await statusOf(id))?.status).toBe('preview');
  });

  it('says nothing was published when documents cannot be reached, and retries with the same key', async () => {
    const id = await preview2026();
    resetReleasesMock('documents-unavailable', { keep: true });
    const { publish } = await renderRelease(id);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }));

    const dialog = screen.getByRole('dialog');
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'The documents service could not be reached. Nothing was published. Try again.',
    );
    expect((await statusOf(id))?.status).toBe('preview');

    resetReleasesMock('history', { keep: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Published. It is public now.')).toBeTruthy();
    expect(publish.mock.calls[1]?.[1]).toBe(publish.mock.calls[0]?.[1]);
  });

  it('keeps the key when the dialog is closed after no answer and opened again', async () => {
    const id = await preview2026();
    resetReleasesMock('documents-unavailable', { keep: true });
    const { publish } = await renderRelease(id);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }));
    await within(screen.getByRole('dialog')).findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }));
    await within(screen.getByRole('dialog')).findByRole('alert');

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[1]).toBe(publish.mock.calls[0]?.[1]);
  });

  it('a refusal ends the key: the next opening sends a new one', async () => {
    const id = await preview2026();
    const { publish } = await renderRelease(id, { as: analyst, isSupervisor: true });

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }));
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toBe(
      'Only an EACC supervisor can publish a release.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }));
    await within(screen.getByRole('dialog')).findByRole('alert');

    expect(publish.mock.calls[1]?.[1]).not.toBe(publish.mock.calls[0]?.[1]);
  });

  it('reloads when the release was published meanwhile (`release-not-preview`)', async () => {
    const id = await preview2026();
    await renderRelease(id);
    await publishOpenDataRelease(supervisor(), id, crypto.randomUUID());

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByText(
        'This release is no longer a preview. The page shows it as it is now.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invalidate).toHaveBeenCalled();
  });

  it('says another annual release of the year is published (`annual-release-published`)', async () => {
    resetNcrMock('approved');
    await withdrawOpenDataRelease(supervisor(), ANNUAL_V1, 'Wrong.', crypto.randomUUID());
    const v2 = await buildOpenDataRelease(supervisor(), 2025, 'annual', crypto.randomUUID());
    const v3 = await buildOpenDataRelease(supervisor(), 2025, 'annual', crypto.randomUUID());
    if (!v2.ok || !v3.ok) throw new Error('build failed');
    await publishOpenDataRelease(supervisor(), v2.data.id, crypto.randomUUID());
    await renderRelease(v3.data.id);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }));

    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toBe(
      'Another FY 2025/2026 annual release is published. Withdraw it first, then publish this one.',
    );
  });
});

describe('#353 S7 withdraw', () => {
  it('requires a reason, then withdraws with it', async () => {
    const { withdraw } = await renderRelease(PUBLISHED_V2);

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog', { name: 'Withdraw FY 2025/2026 snapshot v2?' });
    expect(dialog.textContent).toContain('It stays online, marked withdrawn with your reason.');
    expect(dialog.textContent).toContain('Its files can still be downloaded.');
    expect(within(dialog).getByText('Shown publicly. 0/1000')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    expect(
      within(dialog).getByText('Enter a reason. It is shown publicly with the release.'),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole('textbox', { name: 'Reason' }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(withdraw).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), {
      target: { value: 'The Nyeri board was left out.' },
    });
    expect(within(dialog).getByText('Shown publicly. 29/1000')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    expect(await screen.findByText('Withdrawn. The reason is public.')).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
    expect(await statusOf(PUBLISHED_V2)).toMatchObject({
      status: 'withdrawn',
      withdrawnBy: { name: 'Esther Chebet' },
      withdrawnReason: 'The Nyeri board was left out.',
    });
  });

  it('counts a reason of spaces as no reason', async () => {
    const { withdraw } = await renderRelease(PUBLISHED_V2);

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), {
      target: { value: '   ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    expect(
      within(dialog).getByText('Enter a reason. It is shown publicly with the release.'),
    ).toBeTruthy();
    expect(withdraw).not.toHaveBeenCalled();
  });

  it('says nothing was withdrawn when documents cannot be reached', async () => {
    resetReleasesMock('documents-unavailable', { keep: true });
    await renderRelease(PUBLISHED_V2);

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), {
      target: { value: 'Wrong totals.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'The documents service could not be reached. Nothing was withdrawn. Try again.',
    );
    expect((await statusOf(PUBLISHED_V2))?.status).toBe('published');
  });

  it('reloads when a retry after no answer comes back with another reason (422)', async () => {
    const { withdraw } = await renderRelease(PUBLISHED_V2);
    // The first withdrawal went through, but its answer never came back.
    let first = true;
    withdraw.mockImplementation(async (id, reason, key) => {
      const answer = await withdrawOpenDataRelease(supervisor(), id, reason, key);
      if (!first) return answer;
      first = false;
      return { ok: false, error: { kind: 'unavailable', detail: null } };
    });

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog');
    const reason = () => within(dialog).getByRole('textbox', { name: 'Reason' });
    fireEvent.change(reason(), { target: { value: 'Wrong totals.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await within(dialog).findByRole('alert');
    fireEvent.change(reason(), { target: { value: 'Wrong totals for Nyeri.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    expect(
      await screen.findByText(
        'Your earlier request was recorded. The page shows the release as it is now.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invalidate).toHaveBeenCalled();
  });
});

describe('#353 S7 version history', () => {
  it('lists every version of the year and kind, the withdrawn one with its reason', async () => {
    await renderRelease(PUBLISHED_V2);

    const versions = screen.getByRole('region', { name: 'Versions' });
    const items = within(versions).getAllByRole('listitem', { name: /^v\d/ });
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(['v2', 'v1']);
    expect(items[0]?.textContent).toContain('Viewing');
    expect(items[0]?.textContent).toContain('Published');
    expect(within(nth(items, 1)).getByRole('link', { name: 'v1' }).getAttribute('href')).toBe(
      `/eacc/open-data/${WITHDRAWN_V1}`,
    );
    expect(items[1]?.querySelector('blockquote')?.textContent).toContain('counted twice');
    expect(items[1]?.textContent).toContain('Withdrawn 19 Feb 2026');
  });

  it('links a withdrawn release to the version that replaced it, and offers no rebuild', async () => {
    await renderRelease(WITHDRAWN_V1, { as: analyst, isSupervisor: false });

    const banner = screen
      .getByText(/^Withdrawn 19 Feb 2026 by/)
      .closest<HTMLElement>('[role="alert"]');
    if (!banner) throw new Error('no withdrawn banner');
    expect(within(banner).getByRole('link', { name: 'Open v2' }).getAttribute('href')).toBe(
      `/eacc/open-data/${PUBLISHED_V2}`,
    );
    expect(screen.queryByRole('button', { name: /^Build v/ })).toBeNull();
  });

  it('builds the next version of the latest withdrawn release, and opens it', async () => {
    resetNcrMock('draft');
    await withdrawOpenDataRelease(supervisor(), PUBLISHED_V2, 'Wrong.', crypto.randomUUID());
    const { rebuild, onRebuilt } = await renderRelease(PUBLISHED_V2, {
      as: analyst,
      isSupervisor: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Build v3' }));

    await waitFor(() => {
      expect(onRebuilt).toHaveBeenCalled();
    });
    expect(rebuild).toHaveBeenCalledWith(2025, 'snapshot', expect.any(String));
    expect(onRebuilt.mock.calls[0]?.[0]).toMatchObject({ version: 3, status: 'preview' });
    expect(await screen.findByText('v3 built. Preview only.')).toBeTruthy();
  });

  it('says why a rebuild stopped', async () => {
    await withdrawOpenDataRelease(supervisor(), PUBLISHED_V2, 'Wrong.', crypto.randomUUID());
    resetReleasesMock('reconciliation-failed', { keep: true });
    await renderRelease(PUBLISHED_V2);

    fireEvent.click(screen.getByRole('button', { name: 'Build v3' }));

    expect(await screen.findByText('v3 was not built.')).toBeTruthy();
    expect(screen.getByText(/^National totals did not match their source/)).toBeTruthy();
  });

  it('says an annual release was published on NCR approval', async () => {
    resetNcrMock('approved');
    resetReleasesMock('history');
    await renderRelease(ANNUAL_V1);

    expect(screen.getByRole('main').textContent).toMatch(/Published [^·]+ on NCR approval/);
  });
});
