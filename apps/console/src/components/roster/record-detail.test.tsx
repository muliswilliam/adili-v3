// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import type { RosterRecord } from '../../server/directory/client';
import { RecordDetail } from './record-detail';

const FIRST = '0191f8d2-0000-7000-8000-00000000000a';
const LAST = '0191f8d2-0000-7000-8000-00000000000b';

function record(overrides: Partial<RosterRecord> = {}): RosterRecord {
  return {
    id: '0191f8d2-0000-7000-8000-000000000001',
    personnelFileNumber: 'PSC/2019/0412',
    fullName: 'Achieng Otieno',
    nationalIdMasked: '•••••123',
    nationalId: '27481123',
    designation: 'Senior Accountant',
    jobGroup: 'L',
    reportingEntity: {
      id: '0191f8d2-0000-7000-8000-0000000000e1',
      name: 'State Department for Devolution',
    },
    appointmentDate: '2019-03-01',
    email: 'achieng.otieno@psc.go.ke',
    phone: '+254712345678',
    state: 'not_onboarded',
    absentFromLatestImport: false,
    flaggedByImportId: null,
    flaggedAt: null,
    ofr: null,
    onboardedAt: null,
    identityMismatchAt: null,
    exitDate: null,
    source: 'file',
    firstSeenImportId: FIRST,
    lastSeenImportId: LAST,
    imports: [
      { importId: LAST, startedAt: '2026-09-21T06:40:00Z', outcome: 'unchanged' },
      { importId: FIRST, startedAt: '2026-08-01T06:40:00Z', outcome: 'created' },
    ],
    createdAt: '2026-08-01T06:41:00Z',
    updatedAt: '2026-09-21T06:41:00Z',
    ...overrides,
  };
}

describe('RecordDetail', () => {
  it('shows every field, the national ID in full', () => {
    render(<RecordDetail record={record()} readOnly={false} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Achieng Otieno' })).toBeTruthy();
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByText('27481123')).toBeTruthy();
    expect(within(details).queryByText('•••••123')).toBeNull();
    expect(within(details).getByText('State Department for Devolution')).toBeTruthy();
    expect(within(details).getByText('1 Mar 2019')).toBeTruthy();
    expect(within(details).getByText('+254 712 345 678')).toBeTruthy();
    expect(within(details).queryByText(/Locked/)).toBeNull();
  });

  it('says a missing optional field was not provided', () => {
    render(<RecordDetail record={record({ email: null, phone: null })} readOnly={false} />);
    expect(screen.getAllByText('Not provided')).toHaveLength(2);
  });

  it('locks name and national ID once the officer has onboarded', () => {
    render(<RecordDetail record={record({ state: 'onboarded' })} readOnly={false} />);
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getAllByText('Locked')).toHaveLength(2);
  });

  it('dates the first and last imports that saw the record', () => {
    render(<RecordDetail record={record()} readOnly={false} />);
    const status = screen.getByRole('region', { name: 'Status' });
    expect(within(status).getByText('1 Aug 2026')).toBeTruthy();
    expect(within(status).getByText('21 Sep 2026')).toBeTruthy();
    expect(within(status).getByText('File import')).toBeTruthy();
  });

  it('explains the flag with the date of the complete import', () => {
    render(
      <RecordDetail
        record={record({
          absentFromLatestImport: true,
          flaggedByImportId: LAST,
          flaggedAt: '2026-09-21T06:45:00Z',
        })}
        readOnly
      />,
    );
    expect(screen.getByText('Not in the complete import of 21 Sep 2026.')).toBeTruthy();
    expect(screen.getByText('The reporting officer decides whether they have left.')).toBeTruthy();
  });

  it('says when an exited officer left', () => {
    render(
      <RecordDetail
        record={record({ state: 'exited', exitDate: '2026-09-30' })}
        readOnly={false}
      />,
    );
    expect(screen.getByText('Exited on 30 Sep 2026.')).toBeTruthy();
  });

  it('lists the imports that touched the record with their outcome', () => {
    render(
      <RecordDetail
        record={record({
          imports: [
            { importId: LAST, startedAt: '2026-09-21T06:40:00Z', outcome: 'rejected' },
            { importId: FIRST, startedAt: '2026-08-01T06:40:00Z', outcome: 'created' },
          ],
        })}
        readOnly={false}
      />,
    );
    const history = screen.getByRole('region', { name: 'Import history' });
    const entries = within(history).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    const [latest, first] = entries;
    if (!latest || !first) throw new Error('missing history entries');
    expect(within(latest).getByText('Rejected')).toBeTruthy();
    expect(
      within(latest).getByText(/Identity is locked once the officer has onboarded/),
    ).toBeTruthy();
    expect(within(first).getByText('Created')).toBeTruthy();
  });

  it('explains a failed identity check and marks it in the heading and status', () => {
    render(
      <RecordDetail
        record={{ ...record(), identityMismatchAt: '2026-09-24T11:20:00Z' } as RosterRecord}
        readOnly={false}
      />,
    );
    const callout = screen.getByText('Identity check failed on 24 Sep 2026, 14:20.');
    expect(callout.closest('[role="status"]')).toBeTruthy();
    expect(
      screen.getByText(
        'Name or national ID does not match the national register. Correct it in your next import.',
      ),
    ).toBeTruthy();
    const status = screen.getByRole('region', { name: 'Status' });
    expect(within(status).getByText('Identity check')).toBeTruthy();
    expect(screen.getAllByText('Identity check failed')).toHaveLength(2);
  });

  it('shows the officer reference and onboarded date of an onboarded officer', () => {
    render(
      <ToastProvider>
        <RecordDetail
          record={
            {
              ...record({ state: 'onboarded' }),
              ofr: 'OFR-0482913-H',
              onboardedAt: '2026-09-26T07:42:00Z',
            } as RosterRecord
          }
          readOnly={false}
        />
      </ToastProvider>,
    );
    const status = screen.getByRole('region', { name: 'Status' });
    expect(within(status).getByText('OFR-0482913-H')).toBeTruthy();
    expect(within(status).getByRole('button', { name: 'Copy officer reference' })).toBeTruthy();
    expect(within(status).getByText('26 Sep 2026, 10:42')).toBeTruthy();
  });

  it('copies the officer reference and announces it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    onTestFinished(() => {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    });
    render(
      <ToastProvider>
        <RecordDetail
          record={{ ...record({ state: 'onboarded' }), ofr: 'OFR-0482913-H' } as RosterRecord}
          readOnly={false}
        />
      </ToastProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy officer reference' }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('OFR-0482913-H');
    expect(screen.getByText('Officer reference copied').closest('[role="status"]')).toBeTruthy();
  });

  it('says nothing about identity checks while none has failed', () => {
    render(<RecordDetail record={record()} readOnly={false} />);
    expect(screen.queryByText(/Identity check/)).toBeNull();
  });
});
