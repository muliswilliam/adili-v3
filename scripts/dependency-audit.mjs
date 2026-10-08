#!/usr/bin/env node
// Fails when pnpm audit reports a high or critical advisory that is not listed in
// infra/security/dependency-audit-allowlist.txt (#372).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowPath = join(root, 'infra/security/dependency-audit-allowlist.txt');
const blocking = new Set(['high', 'critical']);

const allowed = new Set(
  readFileSync(allowPath, 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line.length > 0),
);

const audit = spawnSync('pnpm', ['audit', '--json'], {
  cwd: root,
  encoding: 'utf8',
});
if (audit.error) {
  console.error(audit.error.message);
  process.exit(1);
}
const text = audit.stdout.trim();
const start = text.indexOf('{');
if (start < 0) {
  console.error(audit.stderr || 'pnpm audit did not return JSON');
  process.exit(1);
}

const report = JSON.parse(text.slice(start));
const advisories = Object.entries(report.advisories ?? {});
const blocked = [];
for (const [key, advisory] of advisories) {
  if (!blocking.has(advisory.severity)) continue;
  const ids = [advisory.github_advisory_id, String(advisory.id ?? ''), key].filter(Boolean);
  if (ids.some((id) => allowed.has(id))) continue;
  blocked.push(advisory);
}

if (blocked.length > 0) {
  for (const advisory of blocked) {
    const id = advisory.github_advisory_id ?? advisory.id;
    console.error(`${advisory.severity} ${id} ${advisory.module_name}: ${advisory.title}`);
  }
  console.error(
    `${blocked.length} high or critical ${blocked.length === 1 ? 'advisory is' : 'advisories are'} not in ${allowPath}`,
  );
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `Dependency audit ok (high ${counts.high ?? 0}, critical ${counts.critical ?? 0}, moderate ${counts.moderate ?? 0})`,
);
