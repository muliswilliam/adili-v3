import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DemoBar } from './demo-bar';

const ACCOUNTS = [
  {
    demoKey: 'reviewer',
    name: 'Achieng Njeri',
    role: 'Reviewer',
    organisation: 'PSC',
    purpose: 'Review queue',
  },
  { demoKey: 'eacc-analyst', name: 'Baraka Mutua', role: 'EACC analyst', purpose: 'Intake' },
];

describe('DemoBar', () => {
  it('says the data is synthetic and who is signed in', () => {
    render(<DemoBar accounts={ACCOUNTS} current="reviewer" />);

    const bar = screen.getByRole('region', { name: 'Demo' });
    expect(bar.textContent).toContain('DEMO');
    expect(bar.textContent).toContain('synthetic data');
    expect(screen.getByRole('button', { name: /Acting as Achieng Njeri/ })).toBeTruthy();
  });

  it('offers Act as when no demo account is signed in', () => {
    render(<DemoBar accounts={ACCOUNTS} current={null} />);

    expect(screen.getByRole('button', { name: 'Act as' })).toBeTruthy();
  });

  it('posts the picked account to the switch route', async () => {
    const submit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
    });
    render(<DemoBar accounts={ACCOUNTS} current="reviewer" />);
    const form = screen.getByRole('region', { name: 'Demo' }).querySelector('form');
    form?.addEventListener('submit', submit);

    await userEvent.click(screen.getByRole('button', { name: /Acting as/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Baraka Mutua/ }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalledOnce();
    });
    expect(form?.getAttribute('action')).toBe('/auth/demo-switch');
    expect(form?.getAttribute('method')).toBe('post');
    expect(new FormData(form ?? undefined).get('as')).toBe('eacc-analyst');
  });

  it('opens its menu above the page and keeps it within the window, scrolling inside', async () => {
    const { container } = render(<DemoBar variant="inline" accounts={ACCOUNTS} current={null} />);

    await userEvent.click(screen.getByRole('button', { name: /Act as/ }));

    const menu = await screen.findByRole('menu');
    // Portalled to the body, so no header or card stacks over it.
    expect(container.contains(menu)).toBe(false);
    expect(menu.className).toContain(
      'max-h-[min(var(--radix-dropdown-menu-content-available-height),560px)]',
    );
    expect(menu.className).toContain('overflow-y-auto');
  });
});
