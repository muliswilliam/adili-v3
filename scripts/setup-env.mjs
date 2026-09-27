// Copies every committed `.env.example` to `.env` when missing. An existing `.env` keeps its
// values; keys added to the example since are appended with their defaults.
import { appendFileSync, copyFileSync, existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';

const examples = globSync('{apps,services,mocks}/**/.env.example', {
  exclude: (path) => path.includes('node_modules'),
});

for (const example of examples) {
  const target = join(dirname(example), '.env');
  if (!existsSync(target)) {
    copyFileSync(example, target);
    console.log(`created ${target}`);
    continue;
  }
  const current = parseEnv(readFileSync(target, 'utf8'));
  const missing = readFileSync(example, 'utf8')
    .split('\n')
    .filter((line) => {
      const key = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
      return key !== undefined && !(key in current);
    });
  if (missing.length === 0) {
    console.log(`kept    ${target}`);
    continue;
  }
  const existing = readFileSync(target, 'utf8');
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(target, `${separator}${missing.join('\n')}\n`);
  const keys = missing.map((line) => line.slice(0, line.indexOf('=')));
  console.log(`updated ${target} (added ${keys.join(', ')})`);
}
