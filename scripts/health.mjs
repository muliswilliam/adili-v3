import { readFileSync } from 'node:fs';

// Prints the readiness of every local service and app, with the mocks each app answers from and
// the AI provider. `--expect-real` (`pnpm demo:check`) also fails while any app serves a mock or
// the ai-gateway is not calling the real provider: the hosted demo's configuration (#615).
const expectReal = process.argv.includes('--expect-real');

/**
 * An app's port from its .env (`PORT`), else the default: on the hosted VM the apps listen behind
 * Caddy (13010-13030) while Caddy's TLS holds 3010-3030.
 */
function appPort(app, fallback) {
  try {
    const env = readFileSync(new URL(`../apps/${app}/.env`, import.meta.url), 'utf8');
    return /^PORT=(\d+)\s*$/m.exec(env)?.[1] ?? fallback;
  } catch {
    return fallback;
  }
}

const targets = [
  ['directory', 'http://localhost:4001/health/ready'],
  ['declarations', 'http://localhost:4002/health/ready'],
  ['review', 'http://localhost:4003/health/ready'],
  ['access', 'http://localhost:4004/health/ready'],
  ['reporting', 'http://localhost:4005/health/ready'],
  ['documents', 'http://localhost:4006/health/ready'],
  ['verification-api', 'http://localhost:4007/health/ready'],
  ['ai-gateway', 'http://localhost:4008/health/ready'],
  ['integration-gateway', 'http://localhost:4009/health/ready'],
  ['notifications', 'http://localhost:4010/health/ready'],
  ['audit', 'http://localhost:4011/health/ready'],
  ['mocks', 'http://localhost:8000/health'],
  ['portal', `http://localhost:${appPort('portal', '3010')}/health`],
  ['console', `http://localhost:${appPort('console', '3020')}/health`],
  ['verify', `http://localhost:${appPort('verify', '3030')}/health`],
];

/** AI providers that answer from the real model; `record` calls it and keeps a fixture. */
const REAL_AI = new Set(['anthropic', 'record']);

/** What the body says about how the process runs, and whether that is the real backend. */
function mode(body) {
  if (Array.isArray(body?.mocks)) {
    return body.mocks.length === 0
      ? { text: 'mocks off', real: true }
      : { text: `mocks on: ${body.mocks.join(', ')}`, real: false };
  }
  const provider = body?.info?.aiProvider;
  if (provider) return { text: `AI provider: ${provider}`, real: REAL_AI.has(provider) };
  return undefined;
}

let failures = 0;
await Promise.all(
  targets.map(async ([name, url]) => {
    let line;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      const body = response.headers.get('content-type')?.includes('json')
        ? await response.json()
        : undefined;
      const down = Object.entries(body?.checks ?? {})
        .filter(([, check]) => check.status !== 'up')
        .map(([check, { error }]) => `${check}: ${error}`);
      line = response.ok ? 'up' : `down (${response.status}) ${down.join('; ')}`;
      if (!response.ok) failures++;
      const how = mode(body);
      if (how) {
        line += `  [${how.text}]`;
        if (expectReal && !how.real) {
          line += '  << expected the real backend';
          failures++;
        }
      }
    } catch (error) {
      line = `unreachable (${error.cause?.code ?? error.name})`;
      failures++;
    }
    return [name, line];
  }),
).then((rows) => {
  for (const [name, line] of rows) console.log(`${name.padEnd(20)} ${line}`);
});

process.exitCode = failures === 0 ? 0 : 1;
