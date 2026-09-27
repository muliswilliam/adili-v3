import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import KcPage from './KcPage';
import { stories } from './stories';

describe('every page state', () => {
  it.each(Object.entries(stories))('%s renders with a single h1', async (_name, story) => {
    render(<KcPage kcContext={story()} />);

    const headings = await screen.findAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).not.toBe('');
  });
});
