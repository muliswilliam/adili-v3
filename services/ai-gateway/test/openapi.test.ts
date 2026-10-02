import { describe, expect, it } from 'vitest';

import { OPENAPI_SCHEMAS } from '../src/openapi.js';
import { TASKS } from '../src/tasks/registry.js';
import { aiLabel, aiLabelSchema, TASK_NAMES } from '../src/tasks/task.js';

/** `summarize-declaration` -> `SummarizeDeclaration`. */
const componentName = (task: string) =>
  task.replace(/(^|-)([a-z])/g, (_match, _dash, letter: string) => letter.toUpperCase());

describe('the contract schemas', () => {
  it.each(TASK_NAMES)("name %s's input and output as the task validates them", (name) => {
    const task = TASKS[name];
    expect(OPENAPI_SCHEMAS[`${componentName(name)}Input`]).toBe(task.input);
    expect(OPENAPI_SCHEMAS[`${componentName(name)}Output`]).toBe(task.jobOutput);
  });

  it.each(TASK_NAMES)("describe %s's job output as the model's output plus the label", (name) => {
    const task = TASKS[name];
    const label = aiLabel(
      {
        task: name,
        promptVersion: 1,
        provider: 'replay',
        model: 'model',
        generatedAt: new Date().toISOString(),
      },
      'en',
    );
    expect(Object.keys(task.jobOutput.shape)).toEqual(['label', ...Object.keys(task.output.shape)]);
    expect(aiLabelSchema.safeParse(label).success).toBe(true);
    expect(task.jobOutput.shape.label).toBe(aiLabelSchema);
  });
});
