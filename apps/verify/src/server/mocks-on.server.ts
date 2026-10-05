import { env, envSchema } from './env.server';

/**
 * The development mocks this process answers from instead of the services, by setting name
 * (`REVIEW_MOCK`, ...). Mocks run only under `vite dev`; a production build has none.
 */
export function mocksOn(): string[] {
  if (!import.meta.env.DEV || process.env.NODE_ENV === 'production') return [];
  const config: Record<string, unknown> = env();
  return Object.keys(envSchema.shape).filter(
    (key) => key.endsWith('_MOCK') && config[key] === true,
  );
}
