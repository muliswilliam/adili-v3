import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { envSchema } from '../src/config.js';

const root = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

// ADR-010 §5: the public verification API reads only its own projection, fed by events. It
// holds no client, address or credential of any other service.
describe('verification-api isolation', () => {
  it('is configured with its own database, broker, cache and token issuer only', () => {
    expect(Object.keys(envSchema.shape).sort()).toEqual(
      [
        'DATABASE_URL',
        'HOST',
        'LOG_LEVEL',
        'NODE_ENV',
        'OIDC_AUDIENCE',
        'OIDC_ISSUER_URL',
        'PORT',
        'RABBITMQ_URL',
        'RATE_LIMITS',
        'TRUSTED_PROXIES',
        'VALKEY_URL',
      ].sort(),
    );
  });

  it('builds no service client and takes no service token', () => {
    const files = sourceFiles(join(root, 'src'));
    expect(files.filter((file) => file.endsWith('.gen.ts'))).toEqual([]);
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /createServiceClient|ServiceTokenClient|mockableClient|openapi-fetch|\bfetch\(/,
      );
    }
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies)).not.toContain('openapi-fetch');
  });
});
