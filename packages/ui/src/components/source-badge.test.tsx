import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { describeSource, SourceBadge } from './source-badge';

const AT = '2026-09-26T07:32:00Z';

describe('describeSource', () => {
  it('names the registry, the date and the identifier', () => {
    expect(describeSource({ kind: 'ntsa', at: AT, reference: 'KCA 123A' })).toBe(
      'From NTSA, 26 Sep 2026 · KCA 123A',
    );
    expect(describeSource({ kind: 'ardhisasa', at: AT })).toBe('From ArdhiSasa, 26 Sep 2026');
  });

  it('names the file and page for a document', () => {
    expect(
      describeSource({ kind: 'document', at: AT, reference: 'logbook-KCB782M.pdf, page 1' }),
    ).toBe('Read from logbook-KCB782M.pdf, page 1, 26 Sep 2026');
    expect(describeSource({ kind: 'document', at: AT })).toBe('Read from a document, 26 Sep 2026');
  });
});

describe('SourceBadge', () => {
  it('shows every source by name, with its details in the accessible name', () => {
    render(
      <>
        <SourceBadge kind="kra" at={AT} reference="PIN A00•••••76K" />
        <SourceBadge kind="ntsa" at={AT} reference="KCA 123A" />
        <SourceBadge kind="brs" at={AT} reference="PVT-AB12CD3E" />
        <SourceBadge kind="ardhisasa" at={AT} reference="Uasin Gishu/Kimumu/2231" />
        <SourceBadge kind="document" at={AT} reference="logbook-KCB782M.pdf, page 1" />
      </>,
    );

    const badges = screen.getAllByRole('img');
    expect(badges.map((badge) => badge.textContent)).toEqual([
      'KRA',
      'NTSA',
      'BRS',
      'ArdhiSasa',
      'Document',
    ]);
    expect(
      screen.getByRole('img', { name: 'Source: From NTSA, 26 Sep 2026 · KCA 123A' }),
    ).toBeDefined();
    expect(
      screen.getByRole('img', {
        name: 'Source: Read from logbook-KCB782M.pdf, page 1, 26 Sep 2026',
      }),
    ).toBeDefined();
    for (const badge of badges) expect(badge.tabIndex).toBe(0);
  });

  it('shows the date and identifier in a tooltip on focus', () => {
    render(<SourceBadge kind="brs" at={AT} reference="PVT-AB12CD3E" />);

    fireEvent.focus(screen.getByRole('img'));

    expect(screen.getByRole('tooltip').textContent).toBe('From BRS, 26 Sep 2026 · PVT-AB12CD3E');
  });

  it('takes other copy', () => {
    render(
      <SourceBadge
        kind="document"
        at={AT}
        name="Hati"
        labelPrefix="Chanzo"
        describe={({ reference }) => `Imesomwa kutoka ${reference ?? ''}`}
        reference="deed.pdf"
      />,
    );

    expect(screen.getByRole('img', { name: 'Chanzo: Imesomwa kutoka deed.pdf' }).textContent).toBe(
      'Hati',
    );
  });
});
