import { describe, it } from 'node:test';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

import { serverImportsPlugin } from './server-imports.js';

const rule = serverImportsPlugin.rules['no-client-server-imports'];
const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/** Runs the rule over one group of cases. */
const run = ({ valid = [], invalid = [] }) =>
  tester.run('no-client-server-imports', rule, { valid, invalid });

describe('adili/no-client-server-imports', () => {
  it('allows type-only imports, and imports between server modules', () => {
    run({
      valid: [
        // Type-only imports are erased before the bundle is built.
        { code: `import type { Row } from './rows.server';`, filename: 'view.tsx' },
        { code: `import { type Row } from './rows.server'; let r: Row;`, filename: 'view.tsx' },
        { code: `export type { Row } from './rows.server';`, filename: 'view.ts' },
        { code: `export { type Row } from './rows.server';`, filename: 'view.ts' },
        // A server module may import another server module.
        { code: `import { load } from './rows.server'; load();`, filename: 'a/load.server.ts' },
        { code: `import { load } from './rows.server'; load();`, filename: 'a/load.server.tsx' },
      ],
    });
  });

  it('allows server values inside code the client bundle strips', () => {
    run({
      valid: [
        // A server function's handler is replaced by an RPC stub in the client bundle.
        {
          code: `
            import { createServerFn } from '@tanstack/react-start';
            import { load } from './rows.server';
            export const rows = createServerFn({ method: 'GET' })
              .inputValidator((id: string) => id)
              .handler(({ data }) => load(data));
          `,
          filename: 'server/rows.ts',
        },
        {
          code: `
            import { createServerOnlyFn } from '@tanstack/react-start';
            import { env } from './env.server';
            export const secret = createServerOnlyFn(() => env.SECRET);
          `,
          filename: 'server/secret.ts',
        },
        {
          code: `
            import { createMiddleware } from '@tanstack/react-start';
            import { session } from './session.server';
            export const auth = createMiddleware().server(({ next }) => next({ context: session() }));
          `,
          filename: 'server/auth.ts',
        },
        {
          code: `
            import { createIsomorphicFn } from '@tanstack/react-start';
            import { now } from './clock.server';
            export const today = createIsomorphicFn().server(() => now()).client(() => new Date());
          `,
          filename: 'lib/today.ts',
        },
        // A server route's handlers are left out of the client bundle.
        {
          code: `
            import { createFileRoute } from '@tanstack/react-router';
            import { health } from '../server/health.server';
            export const Route = createFileRoute('/health')({
              server: { handlers: { GET: () => health() } },
            });
          `,
          filename: 'routes/health.ts',
        },
        // The client bundle strips a server function's validator along with its handler.
        {
          code: `
            import { createServerFn } from '@tanstack/react-start';
            import { parse } from './rows.server';
            export const rows = createServerFn().validator((d) => parse(d)).handler(() => 1);
            export const old = createServerFn().inputValidator((d) => parse(d)).handler(() => 1);
          `,
          filename: 'server/rows.ts',
        },
        {
          code: `
            import { createMiddleware } from '@tanstack/react-start';
            import { schema } from './rows.server';
            export const m = createMiddleware().validator(schema).server(({ next }) => next());
          `,
          filename: 'server/m.ts',
        },
      ],
    });
  });

  it('allows server values in helpers that only stripped code uses', () => {
    run({
      valid: [
        // Module-level code that only server-only code uses is dropped once that code is stripped.
        {
          code: `
            import { createServerFn } from '@tanstack/react-start';
            import { getBff, KINDS } from './bff.server';
            const input = z.object({ kind: z.enum(KINDS) });
            async function session() { return getBff().session(); }
            const viewer = async () => (await session()).user;
            export const getViewer = createServerFn()
              .validator(input)
              .handler(() => viewer());
          `,
          filename: 'server/viewer.ts',
        },
        {
          code: `
            import { createFileRoute } from '@tanstack/react-router';
            const MOCKS = [{ title: async () => (await import('../server/mock.server')).title() }];
            export const Route = createFileRoute('/api/files')({
              server: { handlers: { GET: () => MOCKS[0].title() } },
            });
          `,
          filename: 'routes/api/files.ts',
        },
        // Helpers that call each other, and a helper nothing uses.
        {
          code: `
            import { createServerFn } from '@tanstack/react-start';
            import { load } from './rows.server';
            function a(n) { return n ? b(n - 1) : load(); }
            function b(n) { return a(n); }
            function unused() { return load(); }
            export const rows = createServerFn().handler(() => a(2));
          `,
          filename: 'server/rows.ts',
        },
      ],
    });
  });

  it('ignores specifiers that only look like server modules', () => {
    run({
      valid: [
        // Specifiers that only look like server modules.
        { code: `import { a } from './observer'; a();`, filename: 'view.ts' },
        { code: `import { a } from './server'; a();`, filename: 'view.ts' },
        { code: `import { a } from './rows.server-types'; a();`, filename: 'view.ts' },
        { code: `import { a } from '@tanstack/react-start/server'; a();`, filename: 'view.ts' },
      ],
    });
  });

  it('reports server values that client code imports', () => {
    run({
      invalid: [
        // #538: a page read constants from a server module.
        {
          code: `import { KINDS } from '../server/open-data.server'; export const n = KINDS.length;`,
          filename: 'components/open-data-preview.tsx',
          errors: [
            { messageId: 'value', data: { name: 'KINDS', source: '../server/open-data.server' } },
          ],
        },
        {
          code: `import { type Row, LIMIT } from './rows.server'; let r: Row; export const l = LIMIT;`,
          filename: 'view.tsx',
          errors: [{ messageId: 'value' }],
        },
        {
          code: `import * as rows from './rows.server'; rows.load();`,
          filename: 'view.ts',
          errors: 1,
        },
        { code: `import load from './rows.server.ts'; load();`, filename: 'view.ts', errors: 1 },
        {
          code: `import './rows.server';`,
          filename: 'view.ts',
          errors: [{ messageId: 'sideEffect' }],
        },
        {
          code: `export { LIMIT } from './rows.server';`,
          filename: 'view.ts',
          errors: [{ messageId: 'reexport' }],
        },
        {
          code: `export * from './rows.server';`,
          filename: 'view.ts',
          errors: [{ messageId: 'reexport' }],
        },
        {
          code: `void import('./rows.server');`,
          filename: 'view.ts',
          errors: [{ messageId: 'dynamic' }],
        },
      ],
    });
  });

  it('reports server values that reach the client past a server function', () => {
    run({
      invalid: [
        // Used inside a server function and outside it: only the outside use is reported.
        {
          code: `
            import { createServerFn } from '@tanstack/react-start';
            import { load, LIMIT } from './rows.server';
            export const rows = createServerFn().handler(() => load(LIMIT));
            export const limit = LIMIT;
          `,
          filename: 'server/rows.ts',
          errors: [
            { messageId: 'value', data: { name: 'LIMIT', source: './rows.server' }, line: 5 },
          ],
        },
        // A helper the browser can still reach: exported, or used by client code.
        {
          code: `
            import { createServerFn } from '@tanstack/react-start';
            import { env } from './env.server';
            export function mocksOn() { return env().MOCKS; }
            export const health = createServerFn().handler(() => mocksOn());
          `,
          filename: 'routes/health.ts',
          errors: [{ messageId: 'value', line: 4 }],
        },
        {
          code: `
            import { createServerFn } from '@tanstack/react-start';
            import { LIMIT } from './rows.server';
            const limit = () => LIMIT;
            export const rows = createServerFn().handler(() => limit());
            export function Page() { return limit(); }
          `,
          filename: 'routes/rows.tsx',
          errors: [{ messageId: 'value', line: 4 }],
        },
        {
          code: `
            import { LIMIT } from './rows.server';
            function limit() { return LIMIT; }
            export { limit };
          `,
          filename: 'view.ts',
          errors: 1,
        },
        // `.client()` of an isomorphic function, and a route's component, run in the browser.
        {
          code: `
            import { createIsomorphicFn } from '@tanstack/react-start';
            import { now } from './clock.server';
            export const today = createIsomorphicFn().client(() => now());
          `,
          filename: 'lib/today.ts',
          errors: 1,
        },
        {
          code: `
            import { createFileRoute } from '@tanstack/react-router';
            import { LIMIT } from '../server/rows.server';
            export const Route = createFileRoute('/rows')({ loader: () => LIMIT });
          `,
          filename: 'routes/rows.tsx',
          errors: 1,
        },
        // A `.handler()` that is not on a server function is not stripped.
        {
          code: `import { load } from './rows.server'; export const x = other().handler(() => load());`,
          filename: 'view.ts',
          errors: 1,
        },
        // Unused value imports still pull the module into the client graph.
        { code: `import { load } from './rows.server';`, filename: 'view.ts', errors: 1 },
      ],
    });
  });
});
