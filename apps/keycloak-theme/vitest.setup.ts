import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans with Vitest globals, which we keep off.
afterEach(cleanup);
