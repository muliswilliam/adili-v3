import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function contractPath(file: string) {
  return fileURLToPath(
    new URL(`../../node_modules/@adili/schemas/internal/${file}`, import.meta.url),
  );
}

/**
 * The first `enum:` list under a component schema in an internal contract (the directory's by
 * default), read from the YAML so tests fail when the contract gains a value the portal does
 * not handle. Reads both block lists and inline `enum: [a, b]` lists.
 */
export function contractEnum(schemaName: string, file = 'directory.yaml'): string[] {
  const lines = readFileSync(contractPath(file), 'utf8').split('\n');
  const start = lines.findIndex((line) => line === `    ${schemaName}:`);
  if (start === -1) throw new Error(`${schemaName} is not in the contract`);
  const enumLine = lines.findIndex(
    (line, index) => index > start && line.trim().startsWith('enum:'),
  );
  const inline = /^enum:\s*\[(.*)\]$/.exec(lines[enumLine]?.trim() ?? '');
  if (inline?.[1] !== undefined) {
    return inline[1].split(',').map((value) => value.trim().replace(/^'|'$/g, ''));
  }
  const indent = (lines[enumLine]?.search(/\S/) ?? 0) + 2;
  const values: string[] = [];
  for (const line of lines.slice(enumLine + 1)) {
    if (line.search(/\S/) !== indent || !line.trim().startsWith('- ')) break;
    values.push(line.trim().slice(2));
  }
  return values;
}
