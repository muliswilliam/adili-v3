// Switches the ai-gateway between the real provider and the recorded demo fixtures (#615).
//
//   pnpm demo:ai anthropic   calls Anthropic (the hosted demo's default)
//   pnpm demo:ai record      calls Anthropic and records every answer into the demo fixtures
//   pnpm demo:ai replay      answers from the demo fixtures only: the fallback with no provider
//   pnpm demo:ai             re-applies the last choice (deploys run this)
//
// The choice is kept in ~/.config/adili/ai-mode so a deploy does not undo a switch to replay.
// The API key comes from /etc/adili/secrets.env, then ~/.config/adili/secrets.env, then the
// environment; it is written to services/ai-gateway/.env (mode 600) and never printed. Without a
// key, anthropic and record fall back to replay with a warning. A running ai-gateway (`pnpm dev`)
// is restarted and the switch is confirmed from its /health/ready.
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATEWAY = join(ROOT, 'services/ai-gateway');
const GATEWAY_ENV = join(GATEWAY, '.env');
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'adili');
const STATE = join(CONFIG_DIR, 'ai-mode');
const SECRETS = ['/etc/adili/secrets.env', join(CONFIG_DIR, 'secrets.env')];
const MODES = ['anthropic', 'record', 'replay'];
/** Relative to services/ai-gateway, where the service runs. */
const FIXTURES_DIR = 'fixtures/demo';

const asked = process.argv[2];
if (asked !== undefined && !MODES.includes(asked)) {
  console.error(`usage: pnpm demo:ai [${MODES.join('|')}]`);
  process.exit(2);
}

const wanted = asked ?? readState() ?? 'anthropic';
if (asked) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(STATE, `${asked}\n`);
}

const key = apiKey();
const mode = wanted !== 'replay' && !key ? 'replay' : wanted;
if (mode !== wanted) {
  console.warn(
    `WARNING: no ANTHROPIC_API_KEY in ${SECRETS.join(' or ')} or the environment; ` +
      'the ai-gateway answers from the recorded demo fixtures (replay) until one is added.',
  );
}

const settings = {
  AI_PROVIDER: mode === 'anthropic' ? 'anthropic' : 'replay',
  AI_REPLAY_MODE: mode === 'record' ? 'record' : 'replay',
  AI_REPLAY_MATCH: 'normalised',
  AI_FIXTURES_DIR: FIXTURES_DIR,
  ...(key && { ANTHROPIC_API_KEY: key }),
};
writeEnv(GATEWAY_ENV, settings);
if (key) chmodSync(GATEWAY_ENV, 0o600);
console.log(`ai-gateway: ${mode} (fixtures services/ai-gateway/${FIXTURES_DIR})`);

await restartIfRunning(mode);

function readState() {
  if (!existsSync(STATE)) return undefined;
  const value = readFileSync(STATE, 'utf8').trim();
  return MODES.includes(value) ? value : undefined;
}

/** The key from the first secrets file that has one, else the environment. */
function apiKey() {
  for (const file of SECRETS) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const value = parseEnv(text).ANTHROPIC_API_KEY;
    if (value) return value;
  }
  return process.env.ANTHROPIC_API_KEY || undefined;
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

/**
 * Sets each key in an existing .env: replaces its line, else fills its commented-out placeholder
 * (`# KEY=` with a value or nothing, not prose that mentions it), else appends.
 */
function writeEnv(file, values) {
  if (!existsSync(file)) {
    console.error(`missing ${file}; run pnpm bootstrap first`);
    process.exit(1);
  }
  const lines = readFileSync(file, 'utf8').replace(/\n$/, '').split('\n');
  for (const [name, value] of Object.entries(values)) {
    const set = lines.findIndex((line) => line.startsWith(`${name}=`));
    const placeholder = lines.findIndex((line) => new RegExp(`^#\\s*${name}=\\S*$`).test(line));
    const index = set >= 0 ? set : placeholder;
    if (index >= 0) lines[index] = `${name}=${value}`;
    else lines.push(`${name}=${value}`);
  }
  writeFileSync(file, `${lines.join('\n')}\n`);
}

/** The running ai-gateway's readiness, on the port its .env gives it. */
function healthUrl() {
  const port = parseEnv(readFileSync(GATEWAY_ENV, 'utf8')).PORT || '4008';
  return `http://localhost:${port}/health/ready`;
}

async function provider() {
  try {
    const response = await fetch(healthUrl(), { signal: AbortSignal.timeout(2_000) });
    return (await response.json())?.info?.aiProvider ?? 'unknown';
  } catch {
    return undefined;
  }
}

/**
 * `pnpm dev` runs the ai-gateway under `node --watch-path=src`, which re-reads .env when it
 * restarts the process: touching the entry point is that restart.
 */
async function restartIfRunning(expected) {
  if ((await provider()) === undefined) {
    console.log('ai-gateway is not running; the switch applies when it starts.');
    return;
  }
  const entry = join(GATEWAY, 'src/main.ts');
  const now = new Date();
  utimesSync(entry, now, now);
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if ((await provider()) === expected) {
      console.log(`ai-gateway restarted on ${expected}.`);
      return;
    }
  }
  console.error(`ai-gateway did not come back on ${expected} within 60 s; check its log.`);
  process.exitCode = 1;
}
