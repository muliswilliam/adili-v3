import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans with Vitest globals, which we keep off.
afterEach(cleanup);

// See the portal's setup: a loaded machine can pass the 1s default while states settle.
configure({ asyncUtilTimeout: 5_000 });
