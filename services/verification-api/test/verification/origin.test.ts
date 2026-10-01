import { describe, expect, it } from 'vitest';

import { coarseNetwork } from '../../src/verification/origin.js';

describe('coarseNetwork keeps only the network an address belongs to', () => {
  it.each([
    ['203.0.113.7', '203.0.113.0/24'],
    ['198.51.100.254', '198.51.100.0/24'],
    ['::ffff:203.0.113.7', '203.0.113.0/24'],
    ['2001:db8:abcd:12::1', '2001:db8:abcd::/48'],
    ['2001:0db8:00ab:ffff:1:2:3:4', '2001:db8:ab::/48'],
    ['2001:db8::1', '2001:db8:0::/48'],
    ['::1', '0:0:0::/48'],
    ['fe80::1%eth0', 'fe80:0:0::/48'],
  ])('%s -> %s', (ip, network) => {
    expect(coarseNetwork(ip)).toBe(network);
  });

  it.each([[undefined], [''], ['not-an-ip'], ['203.0.113'], ['2001:db8:::1']])(
    'answers null for %s',
    (ip) => {
      expect(coarseNetwork(ip)).toBeNull();
    },
  );
});
