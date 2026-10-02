// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { COPIES_COPY, HISTORY_COPY } from '../../access/history-copy';
import { TransparencySkeleton } from './transparency-skeleton';

describe('TransparencySkeleton', () => {
  it.each([HISTORY_COPY.loading, COPIES_COPY.loading])('says what is loading: %s', (label) => {
    render(<TransparencySkeleton label={label} />);
    expect(screen.getByRole('status', { name: label }).getAttribute('aria-busy')).toBe('true');
  });
});
