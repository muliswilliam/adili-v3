import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** The email theme's English messages, key to value. */
function messages(): Map<string, string> {
  // The package directory: jsdom gives import.meta.url no file scheme.
  const file = readFileSync(
    join(process.cwd(), 'src/email/messages/messages_en.properties'),
    'utf8',
  );
  const entries = file
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line): [string, string] => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    });
  return new Map(entries);
}

describe('email messages', () => {
  it("tell a law-enforcement officer that the Responsible Commission's access officer decides (Act s.36(2), r.23)", () => {
    const duty = messages().get('adiliRoleDuty.law-enforcement');

    expect(duty).toContain("the Responsible Commission''s access officer decides it");
    expect(duty).not.toContain('EACC');
  });

  it('double every apostrophe, as Java MessageFormat drops a single one', () => {
    for (const [key, value] of messages()) {
      expect(value.replaceAll("''", ''), key).not.toContain("'");
    }
  });
});
