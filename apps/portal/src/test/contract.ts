import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONTRACT = fileURLToPath(
  new URL('../../node_modules/@adili/schemas/internal/directory.yaml', import.meta.url),
);

/**
 * The first `enum:` list under a component schema in the directory contract, read from the YAML
 * so tests fail when the contract gains a value the portal does not handle.
 */
export function contractEnum(schemaName: string): string[] {
  const lines = readFileSync(CONTRACT, 'utf8').split('\n');
  const start = lines.findIndex((line) => line === `    ${schemaName}:`);
  if (start === -1) throw new Error(`${schemaName} is not in the contract`);
  const enumLine = lines.findIndex((line, index) => index > start && line.trim() === 'enum:');
  const indent = (lines[enumLine]?.search(/\S/) ?? 0) + 2;
  const values: string[] = [];
  for (const line of lines.slice(enumLine + 1)) {
    if (line.search(/\S/) !== indent || !line.trim().startsWith('- ')) break;
    values.push(line.trim().slice(2));
  }
  return values;
}
