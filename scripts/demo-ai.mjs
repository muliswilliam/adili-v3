// Switches the ai-gateway between the real provider and the recorded demo fixtures (#615).
//
//   pnpm demo:ai anthropic   calls Anthropic (the hosted demo's default)
//   pnpm demo:ai record      calls Anthropic and records every answer into the demo fixtures
//   pnpm demo:ai replay      answers from the demo fixtures only: the fallback with no provider
//   pnpm demo:ai             re-applies the last choice (deploys run this)
//
// The choice is kept in ~/.config/adili/ai-mode so a deploy does not undo a switch to replay.
// The provider settings come from /etc/adili/secrets.env, then ~/.config/adili/secrets.env, then
// the environment: ANTHROPIC_API_KEY, or for a self-hosted LLM Gateway ANTHROPIC_AUTH_TOKEN with
// ANTHROPIC_BASE_URL, plus ANTHROPIC_STRUCTURED_OUTPUT, ANTHROPIC_ATTACHMENTS and AI_MODEL. They
// are written to services/ai-gateway/.env (mode 600) and never printed. Without a key or token,
// anthropic and record fall back to replay with a warning. A running ai-gateway (`pnpm dev`) is
// restarted and the switch is confirmed from its /health/ready.
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
/** Read from the secrets files and environment, never printed. */
const PROVIDER_SETTINGS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_STRUCTURED_OUTPUT',
  'ANTHROPIC_ATTACHMENTS',
  'AI_MODEL',
];
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

const credentials = providerSettings();
const key = Boolean(credentials.ANTHROPIC_API_KEY || credentials.ANTHROPIC_AUTH_TOKEN);
const mode = wanted !== 'replay' && !key ? 'replay' : wanted;
if (mode !== wanted) {
  console.warn(
    `WARNING: no ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in ${SECRETS.join(' or ')} or the ` +
      'environment; the ai-gateway answers from the recorded demo fixtures (replay) until one ' +
      'is added.',
  );
}

const settings = {
  AI_PROVIDER: mode === 'anthropic' ? 'anthropic' : 'replay',
  AI_REPLAY_MODE: mode === 'record' ? 'record' : 'replay',
  AI_REPLAY_MATCH: 'normalised',
  AI_FIXTURES_DIR: FIXTURES_DIR,
};
// With a credential, the provider settings are exactly the sources' (a gateway token left over
// from an earlier setup would otherwise outrank a new API key); without one, .env keeps its own.
writeEnv(GATEWAY_ENV, settings, key ? credentials : {});
if (key) chmodSync(GATEWAY_ENV, 0o600);
console.log(`ai-gateway: ${mode} (fixtures services/ai-gateway/${FIXTURES_DIR})`);

await restartIfRunning(mode);

function readState() {
  if (!existsSync(STATE)) return undefined;
  const value = readFileSync(STATE, 'utf8').trim();
  return MODES.includes(value) ? value : undefined;
}

/** Each provider setting from the first secrets file that has it, else the environment. */
function providerSettings() {
  const files = SECRETS.map((file) => {
    try {
      return parseEnv(readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  });
  const values = {};
  for (const name of PROVIDER_SETTINGS) {
    const value = files.find((file) => file[name])?.[name] || process.env[name];
    if (value) values[name] = value;
  }
  return values;
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
 * Sets each key in an existing .env (see setLine). With `provider` given, every provider setting
 * it lacks is commented out.
 */
function writeEnv(file, values, provider) {
  if (!existsSync(file)) {
    console.error(`missing ${file}; run pnpm bootstrap first`);
    process.exit(1);
  }
  const lines = readFileSync(file, 'utf8').replace(/\n$/, '').split('\n');
  for (const [name, value] of Object.entries(values)) setLine(lines, name, value);
  if (Object.keys(provider).length > 0) {
    for (const name of PROVIDER_SETTINGS) {
      if (name in provider) setLine(lines, name, provider[name]);
      else unsetLine(lines, name);
    }
  }
  writeFileSync(file, `${lines.join('\n')}\n`);
}

/**
 * Replaces the key's line, else fills its commented-out placeholder (`# KEY=` with a value or
 * nothing, not prose that mentions it), else appends.
 */
function setLine(lines, name, value) {
  const set = lines.findIndex((line) => line.startsWith(`${name}=`));
  const placeholder = lines.findIndex((line) => new RegExp(`^#\\s*${name}=\\S*$`).test(line));
  const index = set >= 0 ? set : placeholder;
  if (index >= 0) lines[index] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
}

/** Turns a set key back into an empty placeholder, so the service default applies. */
function unsetLine(lines, name) {
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index >= 0) lines[index] = `# ${name}=`;
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
