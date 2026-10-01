import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SystemStatusList, SystemStatusRow } from './system-status-row';

function inList(row: React.ReactNode) {
  return render(<SystemStatusList label="Registry checks">{row}</SystemStatusList>);
}

function isHidden(text: string) {
  return screen.getByText(text).closest('[hidden]') !== null;
}

describe('SystemStatusRow', () => {
  it('shows every status as a word with its row copy', () => {
    render(
      <SystemStatusList label="Registry checks">
        <SystemStatusRow name="KRA" status="matched" count={3} />
        <SystemStatusRow name="NTSA" status="mismatched" count={1} />
        <SystemStatusRow name="ArdhiSasa" status="unavailable" />
        <SystemStatusRow name="BRS" status="not-checked" />
        <SystemStatusRow name="IPRS" status="no-id" personName="Amani" />
      </SystemStatusList>,
    );

    const list = screen.getByRole('list', { name: 'Registry checks' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'KRA3 records, all declaredMatched',
      'NTSA1 indicatorMismatched',
      'ArdhiSasaCould not reach ArdhiSasa. Re-checked automatically every hour.Unavailable',
      'BRSChecks run after submission.Not checked',
      'IPRSRegistries cannot be checked for Amani without an ID.No national ID declared',
    ]);
    expect(within(list).getByText('Matched').className).toContain('text-success');
    expect(within(list).getByText('Mismatched').className).toContain('text-warning');
  });

  it('says when the check ran, in Kenyan time', () => {
    inList(<SystemStatusRow name="KRA" status="matched" checkedAt="2026-09-02T11:31:00Z" />);

    expect(screen.getByText('Checked 2 Sep 2026, 14:31')).toBeTruthy();
  });

  it('takes its own row copy and badge', () => {
    inList(
      <SystemStatusRow
        name="KRA"
        status="matched"
        description="PIN on record, compliant, income within 25%"
        badge={<span>Closed</span>}
      />,
    );

    expect(screen.getByText('PIN on record, compliant, income within 25%')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByText('Matched')).toBeNull();
  });

  it('is not a button when there is nothing to expand', () => {
    inList(<SystemStatusRow name="BRS" status="not-checked" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('expands its detail from a button named after the system, with aria-expanded', () => {
    inList(
      <SystemStatusRow name="NTSA" status="mismatched" count={1}>
        <p>Vehicle records</p>
      </SystemStatusRow>,
    );

    const button = screen.getByRole('button', { name: 'NTSA' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(isHidden('Vehicle records')).toBe(true);

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(isHidden('Vehicle records')).toBe(false);
    const detail = screen.getByText('Vehicle records').parentElement;
    expect(button.getAttribute('aria-controls')).toBe(detail?.id);

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on first render when asked', () => {
    inList(
      <SystemStatusRow name="BRS" status="matched" defaultExpanded>
        <p>Directorships</p>
      </SystemStatusRow>,
    );

    expect(screen.getByRole('button', { name: 'BRS' }).getAttribute('aria-expanded')).toBe('true');
    expect(isHidden('Directorships')).toBe(false);
  });

  it('reports changes and leaves the state to its parent when controlled', () => {
    const onExpandedChange = vi.fn();
    inList(
      <SystemStatusRow name="NTSA" status="matched" expanded onExpandedChange={onExpandedChange}>
        <p>Vehicle records</p>
      </SystemStatusRow>,
    );

    expect(isHidden('Vehicle records')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'NTSA' }));

    expect(onExpandedChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'NTSA' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps its action outside the expand button', () => {
    const onPause = vi.fn();
    inList(
      <SystemStatusRow
        name="NTSA"
        status="matched"
        action={
          <button type="button" onClick={onPause}>
            Pause
          </button>
        }
      >
        <p>Breaker rule</p>
      </SystemStatusRow>,
    );

    const toggle = screen.getByRole('button', { name: 'NTSA' });
    const pause = screen.getByRole('button', { name: 'Pause' });
    expect(toggle.contains(pause)).toBe(false);

    fireEvent.click(pause);
    expect(onPause).toHaveBeenCalledOnce();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows its metrics between the copy and the badge, outside the expand button', () => {
    inList(
      <SystemStatusRow
        name="KRA iTax"
        description="PIN, tax compliance and income declared to KRA"
        badge={<span>Closed</span>}
        metrics={<span>41,230 calls</span>}
      >
        <p>Breaker rule</p>
      </SystemStatusRow>,
    );

    const metrics = screen.getByText('41,230 calls');
    const badge = screen.getByText('Closed');
    expect(screen.getByRole('button', { name: 'KRA iTax' }).contains(metrics)).toBe(false);
    expect(metrics.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says it is checking instead of its copy and badge', () => {
    inList(<SystemStatusRow name="NTSA" status="mismatched" count={2} checking />);

    expect(screen.getByRole('status').textContent).toBe('Checking…');
    expect(screen.queryByText('2 indicators')).toBeNull();
    expect(screen.queryByText('Mismatched')).toBeNull();
  });

  it('takes other wording', () => {
    inList(
      <SystemStatusRow
        name="BRS"
        status="not-checked"
        messages={{
          statuses: { 'not-checked': 'Haijakaguliwa' },
          descriptions: { 'not-checked': 'Ukaguzi hufanyika baada ya kuwasilisha.' },
        }}
      />,
    );

    expect(screen.getByText('Haijakaguliwa')).toBeTruthy();
    expect(screen.getByText('Ukaguzi hufanyika baada ya kuwasilisha.')).toBeTruthy();
  });
});

describe('SystemStatusList', () => {
  it('shows its header above the rows', () => {
    render(
      <SystemStatusList
        label="Registry checks for Wanjiku"
        header={<span>Wanjiku Njeri Kamau</span>}
      >
        <SystemStatusRow name="KRA" status="matched" />
      </SystemStatusList>,
    );

    expect(screen.getByText('Wanjiku Njeri Kamau')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Registry checks for Wanjiku' })).toBeTruthy();
  });
});
