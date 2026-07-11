/**
 * IP Address Validation Tests
 * Tests the production SSRF address classifier at CIDR boundaries.
 */

import { isPrivateOrReservedIP } from '../../src/utils/ip-validation';

describe('IP Address Validation', () => {
  describe('IPv4 private and reserved address detection', () => {
    it.each([
      ['0.0.0.0', true],
      ['0.255.255.255', true],
      ['1.0.0.0', false],
      ['9.255.255.255', false],
      ['10.0.0.0', true],
      ['10.255.255.255', true],
      ['11.0.0.0', false],
      ['100.63.255.255', false],
      ['100.64.0.0', true],
      ['100.127.255.255', true],
      ['100.128.0.0', false],
      ['126.255.255.255', false],
      ['127.0.0.0', true],
      ['127.255.255.255', true],
      ['128.0.0.0', false],
      ['169.253.255.255', false],
      ['169.254.0.0', true],
      ['169.254.255.255', true],
      ['169.255.0.0', false],
      ['172.15.255.255', false],
      ['172.16.0.0', true],
      ['172.31.255.255', true],
      ['172.32.0.0', false],
      ['192.0.0.0', true],
      ['192.0.0.255', true],
      ['192.0.1.0', false],
      ['192.0.1.255', false],
      ['192.0.2.0', true],
      ['192.0.2.255', true],
      ['192.0.3.0', false],
      ['192.88.98.255', false],
      ['192.88.99.0', true],
      ['192.88.99.255', true],
      ['192.88.100.0', false],
      ['192.167.255.255', false],
      ['192.168.0.0', true],
      ['192.168.255.255', true],
      ['192.169.0.0', false],
      ['198.17.255.255', false],
      ['198.18.0.0', true],
      ['198.19.255.255', true],
      ['198.20.0.0', false],
      ['198.51.99.255', false],
      ['198.51.100.0', true],
      ['198.51.100.255', true],
      ['198.51.101.0', false],
      ['203.0.112.255', false],
      ['203.0.113.0', true],
      ['203.0.113.255', true],
      ['203.0.114.0', false],
      ['223.255.255.255', false],
      ['224.0.0.0', true],
      ['255.255.255.255', true],
    ])('classifies %s as blocked=%s', (address, blocked) => {
      expect(isPrivateOrReservedIP(address)).toBe(blocked);
    });

    it.each(['8.8.8.8', '1.1.1.1', '208.67.222.222', '74.125.224.72'])(
      'allows public address %s',
      (address) => {
        expect(isPrivateOrReservedIP(address)).toBe(false);
      }
    );

    it.each([
      '',
      '256.1.1.1',
      '1.1.1',
      '1.1.1.1.1',
      'not.an.ip',
      '01.2.3.4',
      '1e0.2.3.4',
      '1..3.4',
      ' 8.8.8.8',
    ])('fails closed for malformed IPv4 input %j', (address) => {
      expect(isPrivateOrReservedIP(address)).toBe(true);
    });
  });

  describe('IPv6 private and reserved address detection', () => {
    it.each([
      ['::', true],
      ['::1', true],
      ['[::1]', true],
      ['fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
      ['fc00::', true],
      ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
      ['fe00::', false],
      ['fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
      ['fe80::', true],
      ['febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
      ['fec0::', true],
      ['feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
      ['ff00::', true],
      ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
      ['2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', false],
      ['2001:db8::', true],
      ['2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', true],
      ['2001:db9::', false],
      ['2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
      ['2002::', true],
      ['2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
      ['2003::', false],
    ])('classifies %s as blocked=%s', (address, blocked) => {
      expect(isPrivateOrReservedIP(address)).toBe(blocked);
    });

    it.each([
      '2001:4860:4860::8888',
      '2606:4700:4700::1111',
      '[2606:4700:4700::1111]',
      '2a00:1450:4014:80c::200e',
    ])('allows public address %s', (address) => {
      expect(isPrivateOrReservedIP(address)).toBe(false);
    });

    it('handles case-insensitive and scoped IPv6 forms', () => {
      expect(isPrivateOrReservedIP('Fe80::1')).toBe(true);
      expect(isPrivateOrReservedIP('fe80::1%lo0')).toBe(true);
    });

    it.each(['::ffff:192.168.1.1', '::ffff:c0a8:101', '::ffff:198.19.255.255', '::ffff:c613:ffff'])(
      'blocks IPv4-mapped reserved address %s',
      (address) => {
        expect(isPrivateOrReservedIP(address)).toBe(true);
      }
    );

    it.each(['::ffff:8.8.8.8', '::ffff:808:808'])(
      'allows IPv4-mapped public address %s',
      (address) => {
        expect(isPrivateOrReservedIP(address)).toBe(false);
      }
    );

    it.each([
      '::ffff:0:127.0.0.1',
      '::ffff:0:7f00:1',
      '::ffff:0:192.168.1.1',
      '0:0:0:0:ffff:0:c0a8:101',
    ])('blocks IPv4-translated reserved address %s', (address) => {
      expect(isPrivateOrReservedIP(address)).toBe(true);
    });

    it.each(['::ffff:0:8.8.8.8', '::ffff:0:808:808'])(
      'allows IPv4-translated public address %s',
      (address) => {
        expect(isPrivateOrReservedIP(address)).toBe(false);
      }
    );

    it.each(['64:ff9b::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::192.168.1.1'])(
      'blocks well-known NAT64 aliases for reserved IPv4 address %s',
      (address) => {
        expect(isPrivateOrReservedIP(address)).toBe(true);
      }
    );

    it.each(['64:ff9b::8.8.8.8', '64:ff9b::808:808'])(
      'allows well-known NAT64 aliases for public IPv4 address %s',
      (address) => {
        expect(isPrivateOrReservedIP(address)).toBe(false);
      }
    );

    it.each(['::192.168.1.1', '::8.8.8.8'])(
      'blocks deprecated IPv4-compatible address %s',
      (address) => {
        expect(isPrivateOrReservedIP(address)).toBe(true);
      }
    );

    it.each([
      'invalid::ipv6',
      'gggg::1',
      '2606:4700::zzzz',
      '[2606:4700:4700::1111',
      '2606:4700:4700::1111]',
      '2606:4700::1111::1',
    ])('fails closed for malformed IPv6 input %j', (address) => {
      expect(isPrivateOrReservedIP(address)).toBe(true);
    });
  });
});
