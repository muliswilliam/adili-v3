#!/usr/bin/env node
// Fails unless every compose service that can reach a network with a route off the host is named
// in infra/security/egress-allowlist.txt, and each named service actually can (#372). A network
// has no route off the host when it is internal, or when it has no IP masquerade (host-ports,
// which only publishes ports to the host).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowPath = join(root, 'infra/security/egress-allowlist.txt');
const compose = join(root, 'infra/compose/docker-compose.yml');

const allowed = readFileSync(allowPath, 'utf8')
  .split('\n')
  .map((line) => line.replace(/#.*/, '').trim())
  .filter((line) => line.length > 0);

const rendered = spawnSync('docker', ['compose', '-f', compose, 'config', '--format', 'json'], {
  cwd: root,
  encoding: 'utf8',
});
if (rendered.status !== 0) {
  console.error(rendered.stderr || 'docker compose config failed');
  process.exit(rendered.status ?? 1);
}

const config = JSON.parse(rendered.stdout);
const networks = config.networks ?? {};
const problems = [];

/** No route off the host: internal, or no masquerade so nothing is NATed out. */
const offHostRoute = (network) =>
  network?.internal !== true &&
  network?.driver_opts?.['com.docker.network.bridge.enable_ip_masquerade'] !== 'false';

for (const [name, network] of Object.entries(networks)) {
  if (name === 'egress') {
    if (network.internal === true) problems.push('egress network is internal');
    continue;
  }
  if (offHostRoute(network)) problems.push(`network ${name} has a route off the host`);
}

const canEgress = [];
for (const [name, service] of Object.entries(config.services ?? {})) {
  const attached = Object.keys(service.networks ?? {});
  const open = attached.some((network) => offHostRoute(networks[network]));
  if (open) canEgress.push(name);
}

const allowedSet = new Set(allowed);
const egressSet = new Set(canEgress);
for (const name of canEgress) {
  if (!allowedSet.has(name)) problems.push(`${name} can egress but is not on the allow-list`);
}
for (const name of allowed) {
  if (!egressSet.has(name)) problems.push(`${name} is on the allow-list but cannot egress`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

console.log(`Egress policy ok (${canEgress.sort().join(', ')})`);
