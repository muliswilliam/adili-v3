import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const dashboards = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../infra/observability/signoz',
);

/** Span attributes the ai-gateway sets on a provider call (spec 07c). The dashboard must name them. */
const GEN_AI_ATTRIBUTES = [
  'gen_ai.operation.name',
  'gen_ai.system',
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'gen_ai.request.max_tokens',
  'gen_ai.response.model',
  'gen_ai.response.finish_reasons',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'adili.ai.task',
  'adili.ai.prompt_version',
  'adili.ai.outcome',
  'adili.tenant',
];

describe('SigNoz dashboards', () => {
  const files = readdirSync(dashboards).filter((name) => name.endsWith('.json'));

  it('are JSON with a title and at least one widget', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const dashboard = JSON.parse(readFileSync(join(dashboards, name), 'utf8')) as {
        title?: string;
        widgets?: unknown[];
      };
      expect(dashboard.title).toEqual(expect.any(String));
      expect(dashboard.widgets?.length).toBeGreaterThan(0);
    }
  });

  it('shows the GenAI span attributes from the ai-gateway', () => {
    const text = files.map((name) => readFileSync(join(dashboards, name), 'utf8')).join('\n');
    for (const attribute of GEN_AI_ATTRIBUTES) {
      expect(text).toContain(attribute);
    }
  });
});
