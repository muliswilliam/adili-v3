import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans with Vitest globals, which we keep off.
afterEach(cleanup);

// `waitFor` and `findBy*` wait up to 1s by default, which a loaded machine (every package's tests
// at once) can pass while polls and transitions settle. They return as soon as the state is
// there, so a longer limit only slows a test that would fail anyway. As in the portal and verify.
configure({ asyncUtilTimeout: 5_000 });
