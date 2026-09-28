import { describe, expect, it } from 'vitest';

import { FakePersonContacts } from './fake-person-contacts.js';
import { ContactLookupError } from './person-contacts.js';
import { PersonContactsCache } from './person-contacts-cache.js';

const PERSON = '0199a8f0-1111-7000-8000-000000000001';
const OTHER = '0199a8f0-2222-7000-8000-000000000002';
const MINUTE = 60_000;

function setup(options: { maxEntries?: number } = {}) {
  let now = 1_000_000;
  const source = new FakePersonContacts();
  source.set(PERSON, { email: 'wanjiku@example.go.ke', phone: '+254712345678' });
  source.set(OTHER, { email: null, phone: '+254722000000' });
  const cache = new PersonContactsCache(source, {
    ttlMs: 10 * MINUTE,
    maxEntries: options.maxEntries ?? 1_000,
    now: () => now,
  });
  return {
    source,
    cache,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('PersonContactsCache', () => {
  it('answers from the cache for 10 minutes after a lookup', async () => {
    const { source, cache, advance } = setup();

    await cache.lookup(PERSON);
    advance(10 * MINUTE - 1);
    const contacts = await cache.lookup(PERSON);

    expect(contacts).toEqual({ email: 'wanjiku@example.go.ke', phone: '+254712345678' });
    expect(source.lookups).toEqual([PERSON]);
  });

  it('looks up again once the 10 minutes are over', async () => {
    const { source, cache, advance } = setup();

    await cache.lookup(PERSON);
    source.set(PERSON, { email: 'new@example.go.ke', phone: null });
    advance(10 * MINUTE);
    const contacts = await cache.lookup(PERSON);

    expect(contacts).toEqual({ email: 'new@example.go.ke', phone: null });
    expect(source.lookups).toEqual([PERSON, PERSON]);
  });

  it('keeps a changed contact until the entry expires (TTL is the only invalidation)', async () => {
    const { source, cache, advance } = setup();

    await cache.lookup(PERSON);
    source.set(PERSON, { email: 'new@example.go.ke', phone: null });
    advance(5 * MINUTE);

    await expect(cache.lookup(PERSON)).resolves.toEqual({
      email: 'wanjiku@example.go.ke',
      phone: '+254712345678',
    });
  });

  it('caches a person without contacts too', async () => {
    const { source, cache } = setup();
    const unknown = '0199a8f0-3333-7000-8000-000000000003';

    await cache.lookup(unknown);
    const contacts = await cache.lookup(unknown);

    expect(contacts).toEqual({ email: null, phone: null });
    expect(source.lookups).toEqual([unknown]);
  });

  it('keeps people apart', async () => {
    const { cache } = setup();

    await cache.lookup(PERSON);

    await expect(cache.lookup(OTHER)).resolves.toEqual({ email: null, phone: '+254722000000' });
  });

  it('does not cache a failed lookup', async () => {
    const { source, cache } = setup();
    source.failNext(new ContactLookupError('directory answered 503'));

    await expect(cache.lookup(PERSON)).rejects.toBeInstanceOf(ContactLookupError);
    await expect(cache.lookup(PERSON)).resolves.toMatchObject({ phone: '+254712345678' });
    expect(source.lookups).toEqual([PERSON, PERSON]);
  });

  it('shares one lookup between concurrent callers', async () => {
    const { source, cache } = setup();

    const [sms, email] = await Promise.all([cache.lookup(PERSON), cache.lookup(PERSON)]);

    expect(sms).toEqual(email);
    expect(source.lookups).toEqual([PERSON]);
  });

  it('drops the oldest entry beyond its capacity', async () => {
    const { source, cache } = setup({ maxEntries: 1 });

    await cache.lookup(PERSON);
    await cache.lookup(OTHER);
    await cache.lookup(PERSON);

    expect(source.lookups).toEqual([PERSON, OTHER, PERSON]);
  });
});
