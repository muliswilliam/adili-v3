// Copies every committed `.env.example` to `.env` when missing. Never overwrites.
import { copyFileSync, existsSync, globSync } from 'node:fs';
import { dirname, join } from 'node:path';

const examples = globSync('{apps,services,mocks}/**/.env.example', {
  exclude: (path) => path.includes('node_modules'),
});

for (const example of examples) {
  const target = join(dirname(example), '.env');
  if (existsSync(target)) {
    console.log(`kept    ${target}`);
  } else {
    copyFileSync(example, target);
    console.log(`created ${target}`);
  }
}
