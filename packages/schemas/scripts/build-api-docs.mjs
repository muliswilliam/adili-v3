#!/usr/bin/env node
// Builds the published API reference: static Redoc pages from the committed contracts, plus an
// index. Served on GitHub Pages and on the hosted demo at /api-docs/ (pages.yml, deploy.sh).
//
//   node scripts/build-api-docs.mjs [--out <dir>]     (default: <repo>/dist/api-docs)
//
// Each service's contract is split in two (redocly-scope.cjs): its public `/v1` API, the one
// portals, Commissions and agencies call (ADR-009), and its internal `/internal/v1` API, which only
// other services call (ADR-013). The registry contracts in external/ are what the platform consumes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemas = join(here, '..');
const repoRoot = join(schemas, '..', '..');
const outIndex = process.argv.indexOf('--out');
const out = resolve(outIndex > 0 ? process.argv[outIndex + 1] : join(repoRoot, 'dist', 'api-docs'));
const redocly = join(schemas, 'node_modules', '.bin', 'redocly');
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head']);

/** Brand colours and type from packages/ui (styles.css): `--brand`, `--foreground`, `--font-sans`. */
const THEME = [
  '--theme.openapi.theme.colors.primary.main=#e95a24',
  '--theme.openapi.theme.typography.fontFamily=Inter, ui-sans-serif, system-ui, sans-serif',
  '--theme.openapi.theme.typography.headings.fontFamily=Inter, ui-sans-serif, system-ui, sans-serif',
  '--theme.openapi.theme.sidebar.backgroundColor=#fafaf9',
  '--theme.openapi.hideDownloadButton=false',
];

const specs = (dir) =>
  readdirSync(join(schemas, dir))
    .filter((file) => file.endsWith('.yaml'))
    .sort()
    .map((file) => ({ name: file.replace(/\.yaml$/, ''), root: join(schemas, dir, file) }));

const pages = [
  ...specs('internal').flatMap(({ name, root }) => [
    { section: 'public', name, root, scope: 'public' },
    { section: 'internal', name, root, scope: 'internal' },
  ]),
  ...specs('external').map(({ name, root }) => ({ section: 'registries', name, root })),
];

const work = mkdtempSync(join(tmpdir(), 'adili-api-docs-'));
try {
  writeFileSync(join(work, 'redocly-scope.cjs'), readFileSync(join(here, 'redocly-scope.cjs')));
  const config = [
    'plugins:',
    '  - ./redocly-scope.cjs',
    'apis:',
    ...pages.flatMap((page) => [
      `  ${page.section}-${page.name}:`,
      `    root: ${JSON.stringify(page.root)}`,
      '    decorators:',
      ...(page.scope ? [`      adili/scope: { keep: ${page.scope} }`] : []),
      '      remove-unused-components: on',
    ]),
  ].join('\n');
  writeFileSync(join(work, 'redocly.yaml'), `${config}\n`);

  rmSync(out, { recursive: true, force: true });
  const built = [];
  for (const page of pages) {
    const api = `${page.section}-${page.name}`;
    const bundled = join(work, `${api}.json`);
    run(['bundle', api, '--config', join(work, 'redocly.yaml'), '--ext', 'json', '-o', bundled]);
    const document = JSON.parse(readFileSync(bundled, 'utf8'));
    const operations = Object.values(document.paths ?? {}).reduce(
      (count, item) => count + Object.keys(item).filter((key) => HTTP_METHODS.has(key)).length,
      0,
    );
    if (operations === 0) continue;
    const title = pageTitle(page, document.info.title);
    const description = summary(document.info.description);
    document.info.title = title;
    // Redoc prints "Title (version)": "Declarations (v1)" rather than "(1)".
    document.info.version = /^\d+$/.test(String(document.info.version))
      ? `v${document.info.version}`
      : document.info.version;
    // A way back to the index above the API's own description.
    document.info.description = `[All Adili APIs](../index.html)\n\n${document.info.description ?? ''}`;
    writeFileSync(bundled, JSON.stringify(document));
    mkdirSync(join(out, page.section), { recursive: true });
    run([
      'build-docs',
      bundled,
      '-o',
      join(out, page.section, `${page.name}.html`),
      '--title',
      `${title} · Adili API reference`,
      '--disableGoogleFont',
      ...THEME,
    ]);
    built.push({ ...page, title, operations, description });
  }
  writeFileSync(join(out, 'index.html'), indexPage(built));
  writeFileSync(
    join(out, 'favicon.svg'),
    readFileSync(join(repoRoot, 'apps/portal/public/favicon.svg')),
  );
  console.log(`API reference: ${String(built.length)} pages in ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

function run(args) {
  execFileSync(redocly, args, { cwd: work, stdio: ['ignore', 'ignore', 'inherit'] });
}

/** "ai-gateway API" becomes "AI gateway"; the registries keep their own titles. */
function pageTitle(page, title) {
  if (page.section === 'registries') return title.replace(/ - simulated$/, '');
  const words = title
    .replace(/ API$/, '')
    .split('-')
    .filter((word) => word !== 'api')
    .map((word) => (word === 'ai' ? 'AI' : word));
  const name = words.join(' ').replace(/^./, (first) => first.toUpperCase());
  return page.section === 'public' ? name : `${name} (internal)`;
}

/** The first sentence, for the index card. */
function summary(description = '') {
  const text = description.replace(/\s+/g, ' ').trim();
  const end = text.indexOf('. ');
  return end > 0 ? text.slice(0, end + 1) : text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function indexPage(built) {
  const sections = [
    {
      id: 'public',
      title: 'Public API',
      lead: 'The /v1 routes the portal and console use, and that Commissions, employers and agencies integrate with directly (ADR-009). Every call is authorised by a Keycloak token.',
    },
    {
      id: 'internal',
      title: 'Internal service APIs',
      lead: 'The /internal/v1 routes services call each other with: one hop, service tokens with scopes, and the acting Commission in a header (ADR-013). Not reachable from outside.',
    },
    {
      id: 'registries',
      title: 'Registry contracts we consume',
      lead: 'The government systems the platform checks declarations against. Simulated by the mocks in this demo; the same contracts are tested on both sides.',
    },
  ];
  const cards = (id) =>
    built
      .filter((page) => page.section === id)
      .map(
        (page) => `        <a class="card" href="${page.section}/${page.name}.html">
          <span class="card-title">${escapeHtml(page.title)}</span>
          <span class="card-text">${escapeHtml(page.description)}</span>
          <span class="card-meta">${String(page.operations)} operation${page.operations === 1 ? '' : 's'}</span>
        </a>`,
      )
      .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Adili API reference</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <style>
    :root {
      --background: #fafaf9; --foreground: #1a1a1a; --muted: #5c5a56; --border: #e7e5e2;
      --card: #ffffff; --brand: #e95a24;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      color-scheme: light dark;
    }
    @media (prefers-color-scheme: dark) {
      :root { --background: #141413; --foreground: #f4f3f1; --muted: #a8a6a1; --border: #2c2b29; --card: #1c1c1a; --brand: #f06a36; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--background); color: var(--foreground); }
    main { max-width: 1080px; margin: 0 auto; padding: 56px 24px 80px; }
    header { display: flex; align-items: center; gap: 12px; }
    header img { width: 32px; height: 32px; }
    h1 { font-size: 32px; line-height: 1.2; margin: 24px 0 8px; letter-spacing: -0.01em; }
    .lead { color: var(--muted); font-size: 16px; line-height: 1.6; max-width: 720px; margin: 0; }
    h2 { font-size: 20px; margin: 48px 0 6px; }
    .section-lead { color: var(--muted); font-size: 14px; line-height: 1.6; max-width: 760px; margin: 0 0 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .card { display: flex; flex-direction: column; gap: 6px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--card); color: inherit; text-decoration: none; }
    .card:hover { border-color: var(--brand); }
    .card:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .card-title { font-weight: 600; font-size: 15px; }
    .card-text { color: var(--muted); font-size: 13px; line-height: 1.5; flex: 1; }
    .card-meta { color: var(--brand); font-size: 12px; font-weight: 500; }
    footer { margin-top: 56px; color: var(--muted); font-size: 13px; }
    code { font-size: 0.9em; }
  </style>
</head>
<body>
  <main>
    <header><img src="favicon.svg" alt="" /><strong>Adili Online · DIALs</strong></header>
    <h1>API reference</h1>
    <p class="lead">Every service publishes an OpenAPI 3.1 contract generated from its own code, checked for drift in CI. Our portals use the same public APIs that Commissions and agencies use.</p>
${sections
  .map(
    (section) => `    <h2 id="${section.id}">${section.title}</h2>
    <p class="section-lead">${section.lead}</p>
    <div class="grid">
${cards(section.id)}
    </div>`,
  )
  .join('\n')}
    <footer>Generated from <code>packages/schemas</code> with Redoc.</footer>
  </main>
</body>
</html>
`;
}
