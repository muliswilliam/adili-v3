import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type RegistryStatusEntry, RegistryStatusList, RegistryStatusRow } from './registry-status';

const everyState: RegistryStatusEntry[] = [
  { id: 'kra', name: 'KRA', status: 'not-checked' },
  { id: 'ntsa', name: 'NTSA', status: 'checking' },
  { id: 'brs', name: 'BRS', status: 'found', count: 2 },
  { id: 'ardhisasa', name: 'ArdhiSasa', status: 'nothing-found' },
  { id: 'lands', name: 'Lands', status: 'unavailable' },
];

function row(name: string) {
  const item = screen.getByText(name).closest('li');
  if (!item) throw new Error(`No row for ${name}`);
  return within(item);
}

describe('RegistryStatusList', () => {
  it('lists every status in text', () => {
    render(<RegistryStatusList registries={everyState} onRetry={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Registry status' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(row('KRA').getByText('Not checked')).toBeDefined();
    expect(row('NTSA').getByText('Checking…')).toBeDefined();
    expect(row('BRS').getByText('2 suggestions')).toBeDefined();
    expect(row('ArdhiSasa').getByText('Nothing found')).toBeDefined();
    expect(row('Lands').getByText('Not available now')).toBeDefined();
  });

  it('offers a retry named after the registry only while it is unavailable', () => {
    const onRetry = vi.fn();
    render(<RegistryStatusList registries={everyState} onRetry={onRetry} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Lands' }));

    expect(onRetry).toHaveBeenCalledWith('lands');
  });

  it('shows no retry without a handler, and none while disabled', () => {
    const { rerender } = render(<RegistryStatusList registries={everyState} />);
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<RegistryStatusList registries={everyState} onRetry={vi.fn()} disabled />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retry Lands' }).disabled).toBe(
      true,
    );
  });
});

describe('RegistryStatusRow', () => {
  it('says "1 suggestion" in the singular', () => {
    render(
      <ul>
        <RegistryStatusRow name="NTSA" status="found" count={1} />
      </ul>,
    );

    expect(screen.getByText('1 suggestion')).toBeDefined();
  });

  it('takes other copy', () => {
    render(
      <ul>
        <RegistryStatusRow
          name="NTSA"
          status="unavailable"
          onRetry={vi.fn()}
          messages={{
            unavailable: 'Haipatikani sasa',
            retry: 'Jaribu tena',
            retryLabel: (registry) => `Jaribu ${registry} tena`,
          }}
        />
      </ul>,
    );

    expect(screen.getByText('Haipatikani sasa')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Jaribu NTSA tena' }).textContent).toBe(
      'Jaribu tena',
    );
  });
});
