import { randomUUID } from 'node:crypto';

// Runs before each integration test file loads the service's config. A task queue of the file's
// own keeps other suites' workers (with other database schemas) and a local dev server away
// from its roster imports on the shared Temporal.
process.env.TEMPORAL_TASK_QUEUE = `directory-test-${randomUUID()}`;
