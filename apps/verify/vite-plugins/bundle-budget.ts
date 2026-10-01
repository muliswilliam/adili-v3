import { gzipSync } from 'node:zlib';

import type { Plugin } from 'vite';

/**
 * The most gzipped JavaScript a page may load up front. People check a code on a phone, often
 * on 2G, so a page is React, the router and the page itself (about 130 KB, of which React DOM
 * and TanStack Start are about 100 KB), with anything a visitor may never open (the reference
 * breakdown, the file check) loaded on demand. Lower it when a page gets smaller.
 */
export const PAGE_BUDGET_BYTES = 140 * 1024;

/** What the budget needs of an output chunk. */
export interface BudgetChunk {
  fileName: string;
  isEntry: boolean;
  /** The module the chunk stands for; a route's is `src/routes/<route>.tsx?tsr-split=...`. */
  facadeModuleId: string | null;
  /** Chunks it imports statically, so the browser loads them with it. */
  imports: readonly string[];
  code: string;
}

const ROUTE = /\/src\/routes\/(.+)\.tsx\?tsr-split=/;

/**
 * The gzipped JavaScript each route's page loads up front: the entry, the route's chunk and
 * every chunk either imports statically, each counted once. Dynamic imports are left out.
 */
export function pageSizes(chunks: readonly BudgetChunk[]): Map<string, number> {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const gzipped = new Map<string, number>();
  const size = (fileName: string) => {
    let bytes = gzipped.get(fileName);
    if (bytes === undefined) {
      bytes = gzipSync(byName.get(fileName)?.code ?? '').length;
      gzipped.set(fileName, bytes);
    }
    return bytes;
  };
  const closure = (roots: readonly string[]) => {
    const seen = new Set<string>();
    const visit = (fileName: string) => {
      if (seen.has(fileName)) return;
      seen.add(fileName);
      for (const imported of byName.get(fileName)?.imports ?? []) visit(imported);
    };
    roots.forEach(visit);
    return seen;
  };

  const entries = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName);
  // A route may be split into several chunks (component, pending component, ...).
  const routeChunks = new Map<string, string[]>();
  for (const chunk of chunks) {
    const route = chunk.facadeModuleId ? ROUTE.exec(chunk.facadeModuleId)?.[1] : undefined;
    if (route) routeChunks.set(route, [...(routeChunks.get(route) ?? []), chunk.fileName]);
  }
  const pages = new Map<string, number>();
  for (const [route, fileNames] of routeChunks) {
    let total = 0;
    for (const fileName of closure([...entries, ...fileNames])) total += size(fileName);
    pages.set(route, total);
  }
  return pages;
}

/** The pages whose size is over the budget, with their size. */
export function overBudget(sizes: ReadonlyMap<string, number>, budget: number) {
  return [...sizes].filter(([, bytes]) => bytes > budget);
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** Fails the client build when a page's JavaScript is over `PAGE_BUDGET_BYTES` gzipped. */
export function bundleBudget(budget = PAGE_BUDGET_BYTES): Plugin {
  return {
    name: 'adili:bundle-budget',
    applyToEnvironment: (environment) => environment.name === 'client',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk' ? [output] : [],
      );
      const sizes = pageSizes(chunks);
      for (const [page, bytes] of [...sizes].sort()) {
        this.info(`${page}: ${kb(bytes)} of JavaScript, gzipped (budget ${kb(budget)})`);
      }
      const over = overBudget(sizes, budget);
      if (over.length > 0) {
        this.error(
          `Over the ${kb(budget)} page budget: ${over
            .map(([page, bytes]) => `${page} ${kb(bytes)}`)
            .join(', ')}. Load what the page does not need up front on demand.`,
        );
      }
    },
  };
}
