#!/usr/bin/env node
// Smoke-checks an app's production build under its real Content Security Policy (#686): starts
// the built server (.output/server/index.mjs) with no backends, opens its public routes in Chrome,
// then imports every client chunk from a page, as the router would, so each route's code runs its
// module setup under the CSP even though its page needs a session. Fails on any CSP violation,
// uncaught error or chunk that does not load, and on a CSP that allows 'unsafe-eval'.
//   pnpm --filter @adili/console smoke:csp      (builds first; SMOKE_SKIP_BUILD=1 to reuse a build)
//   SMOKE_ROUTES=/a,/b  extra routes to open    CHROME_PATH=...  a Chrome other than the installed one
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const appDir = resolve(process.cwd());
const { name } = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));

/** The public routes of each app: pages that render without a session or a backend. */
const ROUTES = {
  '@adili/console': ['/', '/health', '/smoke-csp-no-such-page'],
  '@adili/portal': ['/', '/open-data/about', '/health', '/smoke-csp-no-such-page'],
};
const routes = [
  ...(ROUTES[name] ?? ['/']),
  ...(process.env.SMOKE_ROUTES?.split(',').filter(Boolean) ?? []),
];

if (process.env.SMOKE_SKIP_BUILD !== '1') {
  const build = spawnSync(
    'pnpm',
    ['turbo', 'run', 'build', `--filter=${name}`, '--output-logs=errors-only'],
    {
      cwd: appDir,
      stdio: 'inherit',
    },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const entry = join(appDir, '.output/server/index.mjs');
const assetsDir = join(appDir, '.output/public/assets');
if (!existsSync(entry)) {
  console.error(`No production build at ${entry}; run without SMOKE_SKIP_BUILD.`);
  process.exit(1);
}

const port = await freePort();
const origin = `http://localhost:${port}`;
// Nothing listens on port 9 (discard): every backend, Keycloak and Valkey are unreachable, so a
// page can only show what it renders on its own. The app's .env.example names every variable.
const unreachable = 'http://127.0.0.1:9';
const env = Object.fromEntries(
  readFileSync(join(appDir, '.env.example'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => {
      const [key, ...rest] = line.split('=');
      const value = rest.join('=');
      if (/^https?:\/\//.test(value)) return [key, unreachable];
      if (/^(redis|amqp):\/\//.test(value))
        return [key, value.replace(/@?[^/@]+$/, '@127.0.0.1:9')];
      return [key, value];
    }),
);
const server = spawn(process.execPath, [entry], {
  cwd: appDir,
  env: { ...process.env, ...env, NODE_ENV: 'production', PORT: String(port), APP_URL: origin },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

const problems = [];
let browser;
try {
  await waitForServer(`${origin}/health`);
  browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
  );
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(
        `${event.effectiveDirective} blocked ${event.blockedURI || '(inline)'} at ${event.sourceFile}:${event.lineNumber}`,
      );
    });
  });
  page.on('pageerror', (error) => problems.push(`${page.url()}: uncaught ${error.stack ?? error}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
      problems.push(`${page.url()}: ${message.text()}`);
    }
  });

  for (const route of routes) {
    const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    const status = response?.status() ?? 0;
    const csp = response?.headers()['content-security-policy'] ?? '';
    const isPage = (response?.headers()['content-type'] ?? '').startsWith('text/html');
    console.log(`${status} ${route}`);
    if (status >= 500) problems.push(`${route}: HTTP ${status}`);
    if (isPage) {
      if (!/script-src 'nonce-[^']+' 'strict-dynamic'/.test(csp) || csp.includes('unsafe-eval')) {
        problems.push(`${route}: not the app's CSP: ${csp || '(none)'}`);
      }
      // Let hydration and the route's effects run.
      await page.waitForTimeout(500);
      problems.push(
        ...(await page.evaluate(() => window.__cspViolations)).map((v) => `${route}: ${v}`),
      );
    }
  }

  // Every client chunk, imported by a module script carrying the page's nonce, as the router's
  // own imports are trusted through 'strict-dynamic'.
  await page.goto(`${origin}${routes[0]}`, { waitUntil: 'networkidle' });
  const chunks = readdirSync(assetsDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => `/assets/${file}`);
  const failed = await page.evaluate(async (urls) => {
    const nonce = document.querySelector('script[nonce]')?.nonce;
    window.__smokeChunks = urls;
    const done = new Promise((resolve) => (window.__smokeDone = resolve));
    const script = document.createElement('script');
    script.type = 'module';
    if (nonce) script.nonce = nonce;
    script.textContent = `
      const failed = [];
      for (const url of window.__smokeChunks) {
        try { await import(url); } catch (error) { failed.push(url + ': ' + error); }
      }
      window.__smokeDone(failed);`;
    document.head.append(script);
    return Promise.race([
      done,
      new Promise((resolve) =>
        setTimeout(() => resolve(['the import script did not run']), 30_000),
      ),
    ]);
  }, chunks);
  console.log(`imported ${chunks.length - failed.length}/${chunks.length} client chunks`);
  problems.push(...failed.map((failure) => `chunk ${failure}`));
  await page.waitForTimeout(500);
  problems.push(...(await page.evaluate(() => window.__cspViolations)).map((v) => `chunks: ${v}`));
} catch (error) {
  problems.push(String(error?.stack ?? error));
} finally {
  await browser?.close();
  await stopServer();
}

if (problems.length > 0) {
  console.error(`\n${name}: ${problems.length} problem(s) under the CSP:`);
  for (const problem of problems) console.error(`- ${problem}`);
  console.error(`\nServer log:\n${serverLog}`);
  process.exit(1);
}
console.log(`${name}: no CSP violations or uncaught errors`);

/** Stops the server, killing it if it has not exited within 2 s (it keeps retrying Valkey). */
async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolveExit) => server.once('exit', resolveExit));
  server.kill('SIGTERM');
  const timer = setTimeout(() => server.kill('SIGKILL'), 2_000);
  await exited;
  clearTimeout(timer);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolvePort(free));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the server exited (${server.exitCode})`);
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`the server did not answer ${url} within 30 s`);
}
