import { Redis } from 'iovalkey';

/** Key-value storage for sessions and login transactions, with per-entry expiry. */
export interface SessionStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class ValkeySessionStore implements SessionStore {
  private readonly client: Redis;

  constructor(url: string, keyPrefix: string) {
    this.client = new Redis(url, { keyPrefix, maxRetriesPerRequest: 1 });
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}

/** In-process store for tests. */
export class MemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}
