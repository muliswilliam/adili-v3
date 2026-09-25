// Prints the readiness of every local service and app.
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
  ['portal', 'http://localhost:3010/'],
  ['console', 'http://localhost:3020/'],
  ['verify', 'http://localhost:3030/'],
];

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
