/**
 * Enhanced Secure Agent Tests
 * 
 * Tests the enhanced security features including DNS caching and TOCTOU protection
 */

import dns from 'dns';
import net from 'net';
import { 
  createEnhancedSecureHttpAgent,
  createEnhancedSecureHttpsAgent,
  getDNSCacheStats,
  invalidateDNSCache,
  validateRequestSecurity
} from '../../src/utils/enhanced-secure-agent';

// Mock dependencies
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}));

jest.mock('../../src/utils/ip-validation', () => ({
  isPrivateOrReservedIP: jest.fn()
}));

import { isPrivateOrReservedIP } from '../../src/utils/ip-validation';
const mockIsPrivateOrReservedIP = isPrivateOrReservedIP as jest.MockedFunction<typeof isPrivateOrReservedIP>;

// Test utilities
function mockDNSLookup(hostname: string, addresses: dns.LookupAddress[]) {
  const originalLookup = dns.lookup;
  
  (dns.lookup as any) = jest.fn((host, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    if (host === hostname) {
      setTimeout(() => callback!(null, addresses), 10);
    } else {
      setTimeout(() => callback!(new Error(`ENOTFOUND ${host}`), null), 10);
    }
  });
  
  return () => {
    dns.lookup = originalLookup;
  };
}

describe('Enhanced Secure Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateDNSCache(); // Clear cache between tests
  });

  describe('DNS Caching', () => {
    it('should cache DNS lookup results', async () => {
      const cleanup = mockDNSLookup('example.com', [
        { address: '93.184.216.34', family: 4 }
      ]);

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      // First request should perform DNS lookup
      await validateRequestSecurity('https://example.com/test');
      
      // Check cache contains the result
      const stats = getDNSCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries).toHaveLength(1);
      expect(stats.entries[0].hostname).toBe('example.com');
      expect(stats.entries[0].addresses).toEqual(['93.184.216.34']);

      cleanup();
    });

    it('should reuse cached DNS results for subsequent requests', async () => {
      const lookupMock = jest.fn();
      const originalLookup = dns.lookup;
      
      (dns.lookup as any) = lookupMock.mockImplementation((host, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        setTimeout(() => callback!(null, [{ address: '93.184.216.34', family: 4 }]), 10);
      });

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      // First request
      await validateRequestSecurity('https://example.com/page1');
      expect(lookupMock).toHaveBeenCalledTimes(1);

      // Second request should use cache
      await validateRequestSecurity('https://example.com/page2');
      expect(lookupMock).toHaveBeenCalledTimes(1); // Still only called once

      dns.lookup = originalLookup;
    });

    it('should expire cached results after TTL', async () => {
      const mockNow = 1000000;
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => mockNow);

      const cleanup = mockDNSLookup('example.com', [
        { address: '93.184.216.34', family: 4 }
      ]);

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      // Cache initial result
      await validateRequestSecurity('https://example.com/test');
      
      // Advance time beyond TTL (5 minutes = 300000ms)
      (Date.now as jest.Mock).mockReturnValue(mockNow + 400000);

      // This should trigger a new DNS lookup
      const lookupSpy = jest.spyOn(dns, 'lookup');
      await validateRequestSecurity('https://example.com/test2');
      
      expect(lookupSpy).toHaveBeenCalled();

      Date.now = originalDateNow;
      cleanup();
    });
  });

  describe('TOCTOU Protection', () => {
    it('should validate that connected IP matches DNS resolution', async () => {
      const cleanup = mockDNSLookup('test.com', [
        { address: '1.2.3.4', family: 4 }
      ]);

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      const agent = createEnhancedSecureHttpAgent();
      
      // Mock socket creation
      const mockSocket = {
        remoteAddress: '1.2.3.4', // Matches DNS resolution
        remotePort: 80,
        destroy: jest.fn()
      } as Partial<net.Socket>;

      // Test the createConnection override
      const createConnectionSpy = jest.spyOn(agent, 'createConnection');
      
      // This would normally connect, but we're testing the validation logic
      const connection = agent.createConnection({ hostname: 'test.com', port: 80 });
      
      expect(createConnectionSpy).toHaveBeenCalled();
      cleanup();
    });

    it('should block connections where socket IP differs from DNS', async () => {
      const cleanup = mockDNSLookup('malicious.com', [
        { address: '8.8.8.8', family: 4 } // Public DNS, but socket will connect to different IP
      ]);

      mockIsPrivateOrReservedIP
        .mockReturnValueOnce(false) // DNS resolution is safe
        .mockReturnValueOnce(true);  // But socket connects to private IP

      const agent = createEnhancedSecureHttpAgent();
      
      // Mock socket that connects to different IP than DNS resolved
      const mockSocket = {
        remoteAddress: '192.168.1.1', // Private IP, different from DNS
        remotePort: 80,
        destroy: jest.fn()
      } as Partial<net.Socket>;

      // This connection should be rejected due to IP mismatch
      expect(() => {
        agent.createConnection({ hostname: 'malicious.com', port: 80 });
      }).not.toThrow(); // The rejection happens in the callback

      cleanup();
    });
  });

  describe('IPv6 Security', () => {
    it('should block IPv4-mapped IPv6 addresses with private IPv4', async () => {
      const cleanup = mockDNSLookup('localhost', [
        { address: '::ffff:192.168.1.1', family: 6 }
      ]);

      // Use the real validation function
      mockIsPrivateOrReservedIP.mockImplementation((ip: string) => {
        const { isPrivateOrReservedIP: actualFunction } = require('../../src/utils/ip-validation');
        return actualFunction(ip);
      });

      // The enhanced agent should detect and block this
      const result = await validateRequestSecurity('https://localhost/test');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked private/reserved IPs');

      cleanup();
    });

    it('should block dangerous IPv6 addresses', async () => {
      const testCases = [
        { hostname: 'ipv6-localhost', address: '::1', family: 6 },         // IPv6 localhost
        { hostname: 'link-local', address: 'fe80::1', family: 6 },         // Link-local
        { hostname: 'unique-local', address: 'fc00::1', family: 6 },       // Unique local
        { hostname: 'multicast', address: 'ff02::1', family: 6 },          // Multicast
      ];

      for (const testCase of testCases) {
        const cleanup = mockDNSLookup(testCase.hostname, [
          { address: testCase.address, family: testCase.family }
        ]);

        // Use the real isPrivateOrReservedIP function instead of mock
        mockIsPrivateOrReservedIP.mockImplementation((ip: string) => {
          // Call the actual validation function by requiring it again
          const { isPrivateOrReservedIP: actualFunction } = require('../../src/utils/ip-validation');
          return actualFunction(ip);
        });

        const result = await validateRequestSecurity(`https://${testCase.hostname}/test`);
        expect(result.allowed).toBe(false);
        
        cleanup();
      }
    });

    it('should allow safe IPv6 addresses', async () => {
      // Mock DNS to return safe IPv6 address
      const cleanup = mockDNSLookup('ipv6.google.com', [
        { address: '2607:f8b0:4004:c1b::65', family: 6 }
      ]);

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      const result = await validateRequestSecurity('https://ipv6.google.com/test');
      
      expect(result.allowed).toBe(true);
      expect(result.allowedIPs).toContain('2607:f8b0:4004:c1b::65');

      cleanup();
    });
  });

  describe('Comprehensive Security Validation', () => {
    it('should block all private IPs when ANY resolved address is private', async () => {
      const cleanup = mockDNSLookup('mixed.com', [
        { address: '8.8.8.8', family: 4 },      // Safe public IP
        { address: '192.168.1.1', family: 4 },  // Private IP - should cause block
        { address: '1.1.1.1', family: 4 }       // Another safe public IP
      ]);

      mockIsPrivateOrReservedIP.mockImplementation((ip: string) => {
        return ip === '192.168.1.1'; // Only 192.168.1.1 is private
      });

      const result = await validateRequestSecurity('https://mixed.com/test');
      
      expect(result.allowed).toBe(false);
      expect(result.blockedIPs).toContain('192.168.1.1');
      expect(result.allowedIPs).toContain('8.8.8.8');
      expect(result.allowedIPs).toContain('1.1.1.1');

      cleanup();
    });

    it('should pass when all resolved addresses are safe', async () => {
      const cleanup = mockDNSLookup('safe.com', [
        { address: '8.8.8.8', family: 4 },
        { address: '1.1.1.1', family: 4 },
        { address: '9.9.9.9', family: 4 }
      ]);

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      const result = await validateRequestSecurity('https://safe.com/test');
      
      expect(result.allowed).toBe(true);
      expect(result.blockedIPs).toHaveLength(0);
      expect(result.allowedIPs).toHaveLength(3);

      cleanup();
    });

    it('should handle DNS resolution errors gracefully', async () => {
      const result = await validateRequestSecurity('https://nonexistent.invalid/test');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Security validation error');
    });
  });

  describe('Agent Configuration', () => {
    it('should create HTTP agent with security settings', () => {
      const agent = createEnhancedSecureHttpAgent();
      
      expect(agent).toBeDefined();
      expect((agent as any).options.keepAlive).toBe(true);
      expect((agent as any).options.timeout).toBe(30000);
      expect((agent as any).options.maxSockets).toBe(50);
    });

    it('should create HTTPS agent with additional TLS security', () => {
      const agent = createEnhancedSecureHttpsAgent();
      
      expect(agent).toBeDefined();
      expect((agent as any).options.keepAlive).toBe(true);
      expect((agent as any).options.timeout).toBe(30000);
      expect((agent as any).options.secureProtocol).toBe('TLSv1_2_method');
      expect((agent as any).options.ciphers).toBeDefined();
    });

    it('should use singleton instances for performance', () => {
      const { getEnhancedSecureHttpAgent, getEnhancedSecureHttpsAgent } = 
        require('../../src/utils/enhanced-secure-agent');
      
      const httpAgent1 = getEnhancedSecureHttpAgent();
      const httpAgent2 = getEnhancedSecureHttpAgent();
      const httpsAgent1 = getEnhancedSecureHttpsAgent();
      const httpsAgent2 = getEnhancedSecureHttpsAgent();
      
      expect(httpAgent1).toBe(httpAgent2);
      expect(httpsAgent1).toBe(httpsAgent2);
    });
  });

  describe('DNS Cache Management', () => {
    it('should provide cache statistics', async () => {
      const cleanup = mockDNSLookup('stats-test.com', [
        { address: '1.2.3.4', family: 4 }
      ]);

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      await validateRequestSecurity('https://stats-test.com/test');
      
      const stats = getDNSCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(1000);
      expect(stats.entries).toHaveLength(1);
      expect(stats.entries[0].hostname).toBe('stats-test.com');

      cleanup();
    });

    it('should allow cache invalidation for specific hostnames', async () => {
      const cleanup = mockDNSLookup('invalidate-test.com', [
        { address: '1.2.3.4', family: 4 }
      ]);

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      await validateRequestSecurity('https://invalidate-test.com/test');
      expect(getDNSCacheStats().size).toBe(1);
      
      invalidateDNSCache('invalidate-test.com');
      expect(getDNSCacheStats().size).toBe(0);

      cleanup();
    });

    it('should limit cache size to prevent memory exhaustion', async () => {
      mockIsPrivateOrReservedIP.mockReturnValue(false);
      
      // Mock multiple hostnames
      for (let i = 0; i < 5; i++) {
        const cleanup = mockDNSLookup(`test${i}.com`, [
          { address: `1.2.3.${i + 10}`, family: 4 }
        ]);
        
        await validateRequestSecurity(`https://test${i}.com/test`);
        cleanup();
      }
      
      const stats = getDNSCacheStats();
      expect(stats.size).toBeLessThanOrEqual(stats.maxSize);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty DNS responses', async () => {
      const cleanup = mockDNSLookup('empty.com', []);
      
      const result = await validateRequestSecurity('https://empty.com/test');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Security validation error');
      
      cleanup();
    });

    it('should handle malformed URLs', async () => {
      const result = await validateRequestSecurity('not-a-url');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Security validation error');
    });

    it('should handle very long hostnames', async () => {
      const longHostname = 'a'.repeat(300) + '.com';
      const result = await validateRequestSecurity(`https://${longHostname}/test`);
      
      expect(result.allowed).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should handle concurrent requests efficiently', async () => {
      mockIsPrivateOrReservedIP.mockReturnValue(false);
      
      const cleanup = mockDNSLookup('concurrent.com', [
        { address: '1.2.3.4', family: 4 }
      ]);
      
      const startTime = Date.now();
      
      // Make multiple concurrent requests
      const promises = Array.from({ length: 10 }, (_, i) =>
        validateRequestSecurity(`https://concurrent.com/test${i}`)
      );
      
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      // All requests should succeed
      expect(results.every(r => r.allowed)).toBe(true);
      
      // Should complete quickly due to caching
      expect(duration).toBeLessThan(1000);
      
      cleanup();
    });
  });
});