import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { type FigureFormatter, FigureChip, type ResolvedFigure } from './figure-chip';

const figures: Record<string, ResolvedFigure> = {
  'national.filingRate': { label: 'National filing rate 2027', value: '91.2%' },
  'fy2026.commission.cpsb047.nonFilerRate': {
    label: 'Nairobi non-filer rate 2026',
    value: '4.1%',
  },
};
const format: FigureFormatter = (key) => figures[key] ?? null;

describe('FigureChip', () => {
  it('shows an aggregate key as its human label and value, through the formatter', () => {
    render(
      <FigureChip aggregateKey="national.filingRate" format={format} onShow={() => undefined} />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Figure National filing rate 2027: 91.2%. Show in table',
      }),
    ).toBeTruthy();
    expect(screen.getByText('91.2%').tagName).toBe('B');
  });

  it('shows the figure in the table when pressed', async () => {
    const onShow = vi.fn();
    render(
      <FigureChip
        aggregateKey="fy2026.commission.cpsb047.nonFilerRate"
        format={format}
        onShow={onShow}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Nairobi non-filer rate 2026/ }));

    expect(onShow).toHaveBeenCalledWith('fy2026.commission.cpsb047.nonFilerRate');
  });

  it('is plain text without onShow, for a read-only document', () => {
    render(<FigureChip aggregateKey="national.filingRate" format={format} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/National filing rate 2027/).textContent).toBe(
      'National filing rate 2027: 91.2%',
    );
  });

  it('says "Figure not found" for a key the formatter cannot resolve, and is not pressable', () => {
    const onShow = vi.fn();
    render(<FigureChip aggregateKey="commission.xyz.filingRate" format={format} onShow={onShow} />);

    const chip = screen.getByText('Figure not found').parentElement;
    expect(screen.queryByRole('button')).toBeNull();
    expect(chip?.getAttribute('title')).toBe('commission.xyz.filingRate');
    expect(chip?.dataset.state).toBe('not-found');
  });

  it('takes other wording', () => {
    render(
      <FigureChip
        aggregateKey="national.filingRate"
        format={format}
        onShow={() => undefined}
        messages={{ name: (label, value) => `Takwimu ${label}: ${value}. Onyesha jedwalini` }}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Takwimu National filing rate 2027: 91.2%. Onyesha jedwalini',
      }),
    ).toBeTruthy();
  });

  it('passes native attributes and the ref to whichever element renders', () => {
    const button = createRef<HTMLElement>();
    const span = createRef<HTMLElement>();
    render(
      <>
        <FigureChip
          aggregateKey="national.filingRate"
          format={format}
          onShow={() => undefined}
          ref={button}
          data-testid="pressable"
          aria-describedby="note"
        />
        <FigureChip aggregateKey="nope" format={format} ref={span} id="missing" />
      </>,
    );

    expect(button.current?.tagName).toBe('BUTTON');
    expect(screen.getByTestId('pressable').getAttribute('aria-describedby')).toBe('note');
    expect(span.current?.id).toBe('missing');
  });
});
