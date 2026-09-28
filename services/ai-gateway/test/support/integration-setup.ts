import { randomUUID } from 'node:crypto';

// Each test file runs its own worker against its own database schema; a task queue of its own
// keeps another file's worker from picking up its jobs. Set before the config is imported.
process.env.AI_TASK_QUEUE = `ai-gateway-test-${randomUUID()}`;
