// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockAuditClient,
  mockAuditPersonsClient,
  resetAuditMock,
} from '../../server/audit/mock.server';
import type { AuditEventPage } from '../../server/audit/types';
import {
  getAuditEvent,
  getAuditPersonName,
  listAuditEvents,
} from '../../server/audit-trail.server';
import type { ServiceResult } from '../../server/service-call';
import { AuditEventsView } from './audit-events-view';

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock('../../server/audit-trail', () => ({
  getAuditEventDetail: vi.fn(),
  getAuditSubjectName: vi.fn(),
}));

const client = () => mockAuditClient(['auditor']);
const loadEvent = (eventId: string) => getAuditEvent(client(), eventId);
const loadPersonName = (personId: string) =>
  getAuditPersonName(mockAuditPersonsClient(['auditor']), personId);

async function page(): Promise<ServiceResult<AuditEventPage>> {
  return listAuditEvents(client(), {}, 50);
}

function renderView(
  result: ServiceResult<AuditEventPage> | null,
  onFiltersChange = vi.fn(),
  filters = {},
) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <AuditEventsView
          result={result}
          filters={filters}
          onFiltersChange={onFiltersChange}
          firstPage
          loadEvent={loadEvent}
          loadPersonName={loadPersonName}
        />
      </ToastProvider>
    </TooltipProvider>,
  );
  return onFiltersChange;
}

beforeEach(() => {
  resetAuditMock();
});

/** The one element of a list of one. */
function only(elements: HTMLElement[]): HTMLElement {
  const [element] = elements;
  if (!element || elements.length !== 1)
    throw new Error(`Expected one element, got ${String(elements.length)}`);
  return element;
}

/** A drawer fact (term and value) by its term. */
function factOf(term: HTMLElement): HTMLElement {
  const fact = term.parentElement;
  if (!fact) throw new Error('A term outside a fact');
  return fact;
}

describe('AuditEventsView', () => {
  it('lists each event with its kind, actor, subject and chain', async () => {
    renderView(await page());
    const table = screen.getByRole('table', { name: 'Audit events, newest first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(5);
    expect(within(table).getAllByText('review.case.viewed')).not.toHaveLength(0);
    expect(within(table).getAllByText('Verify lookup')).not.toHaveLength(0);
    expect(within(table).getAllByText('Sign-in')).not.toHaveLength(0);
    expect(within(table).getAllByText('review-case')[0]).toBeTruthy();
  });

  it('applies the kind at once, and the other filters together', () => {
    const onChange = renderView({ ok: true, data: { items: [], nextCursor: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Reads' }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'read' });

    fireEvent.change(screen.getByLabelText('Tenant', { exact: false }), {
      target: { value: 'psc' },
    });
    fireEvent.change(screen.getByLabelText('Action', { exact: false }), {
      target: { value: 'declaration.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: undefined,
      tenant: 'psc',
      actor: undefined,
      subjectPersonId: undefined,
      action: 'declaration.',
      from: undefined,
      to: undefined,
    });
  });

  it('refuses a person that is not an id', () => {
    const onChange = renderView({ ok: true, data: { items: [], nextCursor: null } });
    fireEvent.change(screen.getByLabelText('Person', { exact: false }), {
      target: { value: 'Wanjiku' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByText('Enter a person id (a UUID).')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens an event in full, with its place in the chain and its data', async () => {
    renderView(await page());
    fireEvent.click(
      only(screen.getAllByRole('button', { name: 'review.case.viewed' }).slice(0, 1)),
    );
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Place in the chain')).toBeTruthy();
    expect(await within(drawer).findByText('Event data')).toBeTruthy();
    expect(within(drawer).getByText('review-case · ', { exact: false })).toBeTruthy();
  });

  it('names the person the event is about, and the app the reviewer read it through', async () => {
    renderView(await page());
    fireEvent.click(
      only(screen.getAllByRole('button', { name: 'review.case.viewed' }).slice(0, 1)),
    );
    const drawer = await screen.findByRole('dialog');
    const person = factOf(within(drawer).getByText('Person the data is about'));
    expect(await within(person).findByText('Wanjiku Kamau')).toBeTruthy();
    // The id stays, for the Person filter.
    expect(within(person).getByText('7d3f9b2a-4c1e-4f8a-9b6d-2e5a1c3f7b90')).toBeTruthy();
    const through = factOf(within(drawer).getByText('Through'));
    expect(within(through).getByText('Console')).toBeTruthy();
  });

  it('shows the id alone when the person cannot be named', async () => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <AuditEventsView
            result={await page()}
            filters={{}}
            onFiltersChange={vi.fn()}
            firstPage
            loadEvent={loadEvent}
            loadPersonName={() =>
              Promise.resolve({ ok: false, error: { kind: 'unavailable', detail: null } })
            }
          />
        </ToastProvider>
      </TooltipProvider>,
    );
    fireEvent.click(
      only(screen.getAllByRole('button', { name: 'review.case.viewed' }).slice(0, 1)),
    );
    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByText('Event data');
    expect(within(drawer).queryByText('Wanjiku Kamau')).toBeNull();
    expect(within(drawer).getByText('7d3f9b2a-4c1e-4f8a-9b6d-2e5a1c3f7b90')).toBeTruthy();
  });

  it('loads an opened event once, however often it renders', async () => {
    const load = vi.fn(loadEvent);
    render(
      <TooltipProvider>
        <ToastProvider>
          <AuditEventsView
            result={await page()}
            filters={{}}
            onFiltersChange={vi.fn()}
            firstPage
            loadEvent={(eventId) => load(eventId)}
            loadPersonName={loadPersonName}
          />
        </ToastProvider>
      </TooltipProvider>,
    );
    fireEvent.click(
      only(screen.getAllByRole('button', { name: 'review.case.viewed' }).slice(0, 1)),
    );
    await screen.findByText('Event data');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('says when nothing matches the filters, and clears them', () => {
    const onChange = renderView({ ok: true, data: { items: [], nextCursor: null } }, vi.fn(), {
      kind: 'auth',
    });
    expect(screen.getByText('No events match')).toBeTruthy();
    fireEvent.click(only(screen.getAllByRole('button', { name: 'Clear' }).slice(-1)));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('says when the trail did not load', () => {
    renderView({ ok: false, error: { kind: 'unavailable', detail: null } });
    expect(screen.getByText('The audit trail did not load')).toBeTruthy();
  });
});
