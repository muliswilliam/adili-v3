import { afterEach } from 'vitest';

// Testing Library only auto-cleans with Vitest globals, which we keep off. Tests in the node
// environment never load it.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
