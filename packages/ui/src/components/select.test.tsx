import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './select';

describe('Select', () => {
  it('is a labelled native select that reports changes', async () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Type" defaultValue="" onChange={onChange}>
        <option value="">All types</option>
        <option value="hosted">Hosted</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'Type' });
    await userEvent.selectOptions(select, 'hosted');

    expect((select as HTMLSelectElement).value).toBe('hosted');
    expect(onChange).toHaveBeenCalledOnce();
  });
});
