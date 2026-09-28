import { composeStories } from '@storybook/react-vite';
import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';

type StoriesModule = Parameters<typeof composeStories>[0];

const modules = import.meta.glob<StoriesModule>('./components/*.stories.tsx', { eager: true });

// Every story renders, so a story cannot silently break when its component changes.
describe.each(Object.entries(modules))('%s', (_path, module) => {
  const stories = composeStories(module) as Record<string, ComponentType>;
  it.each(Object.entries(stories))('%s renders', (_name, Story) => {
    const { container } = render(<Story />);

    expect(container.firstElementChild).not.toBeNull();
  });
});
