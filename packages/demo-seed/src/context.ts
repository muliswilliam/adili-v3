import { type Apis, apis } from './clients/api.js';
import { Inboxes } from './clients/inboxes.js';
import { KeycloakAdmin } from './clients/keycloak.js';
import type { SeedConfig } from './config.js';
import type { Tokens } from './tokens.js';

/** What every step gets: the stack's clients, demo accounts' tokens and the run's memo. */
export interface SeedContext {
  config: SeedConfig;
  log(message: string): void;
  /** The APIs as the demo account with this `demo_key` (signed in on first use). */
  as(demoKey: string, options?: { fresh?: boolean }): Promise<Apis>;
  /** The demo account's access token, for the few routes with no generated client. */
  token(demoKey: string): Promise<string>;
  /** The APIs without a token, for public routes. */
  anonymous: Apis;
  keycloak: KeycloakAdmin;
  inboxes: Inboxes;
  /**
   * A value computed once per run and shared by the steps that need it (e.g. the synthetic
   * officers). Steps never rely on another step having run in this process: what they memo
   * they can always compute again.
   */
  memo<T>(key: string, compute: () => Promise<T>): Promise<T>;
}

export function createContext(
  config: SeedConfig,
  tokens: Tokens,
  log: (message: string) => void,
): SeedContext {
  const memos = new Map<string, Promise<unknown>>();
  return {
    config,
    log,
    async as(demoKey, options) {
      return apis(config, await tokens.user(demoKey, options));
    },
    token(demoKey) {
      return tokens.user(demoKey);
    },
    anonymous: apis(config),
    keycloak: new KeycloakAdmin(config),
    inboxes: new Inboxes(config),
    memo<T>(key: string, compute: () => Promise<T>): Promise<T> {
      let value = memos.get(key) as Promise<T> | undefined;
      if (!value) {
        value = compute();
        memos.set(key, value);
      }
      return value;
    },
  };
}
