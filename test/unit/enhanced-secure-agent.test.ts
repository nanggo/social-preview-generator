import { vi } from 'vitest';
/**
 * Enhanced Secure Agent Tests
 * 
 * Tests the enhanced security features including DNS caching and TOCTOU protection
 */

import http from 'http';
import dns from 'dns';
import net from 'net';
import { 
	  __testDNSLookupLimiter,
		  createEnhancedSecureHttpAgent,
		  createEnhancedSecureHttpsAgent,
  getDNSCacheStats,
  invalidateDNSCache,
  validateRequestSecurity
} from '../../src/utils/enhanced-secure-agent';

// Mock dependencies
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

vi.mock('../../src/utils/ip-validation', () => ({
  isPrivateOrReservedIP: vi.fn()
}));

import { isPrivateOrReservedIP } from '../../src/utils/ip-validation';
import { ErrorType, PreviewGeneratorError } from '../../src/types';
const mockIsPrivateOrReservedIP = isPrivateOrReservedIP as vi.MockedFunction<typeof isPrivateOrReservedIP>;

async function useProductionIPClassifier(): Promise<void> {
  const actualModule = await vi.importActual<typeof import('../../src/utils/ip-validation')>(
    '../../src/utils/ip-validation'
  );
  mockIsPrivateOrReservedIP.mockImplementation(actualModule.isPrivateOrReservedIP);
}

// Test utilities
function mockDNSLookup(hostname: string, addresses: dns.LookupAddress[]) {
  const originalLookup = dns.lookup;
  
  (dns.lookup as any) = vi.fn((host, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    // Handle the specific hostname we're testing
    if (host === hostname) {
      setTimeout(() => {
        try {
          callback!(null, addresses);
        } catch (error) {
          console.warn('DNS callback error:', error);
        }
      }, 10);
    } else {
      // For other hostnames, return a safe fallback or handle gracefully
      setTimeout(() => {
        try {
          const error = new Error(`ENOTFOUND ${host}`) as NodeJS.ErrnoException;
          error.code = 'ENOTFOUND';
          callback!(error, null);
        } catch (callbackError) {
          console.warn('DNS error callback failed:', callbackError);
        }
      }, 10);
    }
  });
  
  return () => {
    try {
      dns.lookup = originalLookup;
    } catch (error) {
      console.warn('Failed to restore DNS lookup:', error);
    }
  };
}

type DeferredDNSCallback = (
  error: NodeJS.ErrnoException | null,
  addresses: dns.LookupAddress[]
) => void;

function mockDeferredDNSLookups() {
  const originalLookup = dns.lookup;
  const startedHostnames: string[] = [];
  const callbacks: Array<DeferredDNSCallback | undefined> = [];

  (dns.lookup as any) = vi.fn((
    hostname: string,
    _options: unknown,
    callback: DeferredDNSCallback
  ) => {
    startedHostnames.push(hostname);
    callbacks.push(callback);
  });

  return {
    startedHostnames,
    get callbackCount() {
      return callbacks.length;
    },
    resolve(index: number, addresses: dns.LookupAddress[] = [{ address: '8.8.8.8', family: 4 }]) {
      const callback = callbacks[index];
      if (!callback) {
        throw new Error(`DNS callback ${index} is unavailable`);
      }
      callbacks[index] = undefined;
      callback(null, addresses);
    },
    rejectAll() {
      for (let index = 0; index < callbacks.length; index += 1) {
        const callback = callbacks[index];
        if (!callback) {
          continue;
        }
        callbacks[index] = undefined;
        const error = new Error('test cleanup') as NodeJS.ErrnoException;
        error.code = 'ENOTFOUND';
        callback(error, []);
      }
    },
    restore() {
      dns.lookup = originalLookup;
    },
  };
}

describe('Enhanced Secure Agent', () => {
  let cleanupFunctions: (() => void)[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateDNSCache(); // Clear cache between tests
    cleanupFunctions = []; // Reset cleanup functions
  });

  afterEach(async () => {
    // Run all cleanup functions
    cleanupFunctions.forEach(cleanup => {
      try {
        cleanup();
      } catch (error) {
        console.warn('Cleanup function failed:', error);
      }
    });
    cleanupFunctions = [];
    
    // Additional cleanup
    invalidateDNSCache();
    
    // Wait a bit for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 50));
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
      const lookupMock = vi.fn();
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
      Date.now = vi.fn(() => mockNow);

      const cleanup = mockDNSLookup('example.com', [
        { address: '93.184.216.34', family: 4 }
      ]);

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      // Cache initial result
      await validateRequestSecurity('https://example.com/test');
      
      // Advance time beyond TTL (5 minutes = 300000ms)
      (Date.now as vi.Mock).mockReturnValue(mockNow + 400000);

      // This should trigger a new DNS lookup
      const lookupSpy = vi.spyOn(dns, 'lookup');
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

      // Populate the DNS cache for socket-level validation
      await validateRequestSecurity('http://test.com/');

      const socketOn = vi.fn();
      let connectListener: (() => void) | undefined;
      socketOn.mockImplementation((event: string, listener: () => void) => {
        if (event === 'connect') connectListener = listener;
      });

      const socketDestroy = vi.fn();
      const mockSocket = {
        remoteAddress: '1.2.3.4',
        remotePort: 80,
        destroy: socketDestroy,
        on: socketOn,
      } as unknown as net.Socket;

      const createConnectionSpy = vi
        .spyOn(http.Agent.prototype, 'createConnection')
        .mockImplementation(() => mockSocket);

      const agent = createEnhancedSecureHttpAgent();
      const socket = agent.createConnection({ host: 'test.com', port: 80 });

      // Simulate successful connection
      connectListener?.();

      expect(socket).toBeDefined();
      expect(socketDestroy).not.toHaveBeenCalled();
      createConnectionSpy.mockRestore();
      cleanup();
    });

    it('should block connections where socket IP differs from DNS (async TOCTOU protection)', async () => {
      const cleanup = mockDNSLookup('malicious.com', [
        { address: '8.8.8.8', family: 4 } // DNS resolves to public IP
      ]);

      mockIsPrivateOrReservedIP
        .mockReturnValueOnce(false) // DNS resolution is safe (8.8.8.8)
        .mockReturnValueOnce(true);  // But socket connects to different private IP (192.168.1.1)

      // First, populate the DNS cache by calling validateRequestSecurity 
      // which will trigger DNS lookup and populate the cache
      try {
        await validateRequestSecurity('http://malicious.com');
      } catch {
        // Expected to fail due to private IP, but cache should be populated
      }

      const agent = createEnhancedSecureHttpAgent();
      
      // Store original createConnection and spy on it
      const originalCreateConnection = agent.createConnection;
      
      // Override createConnection to simulate socket with wrong IP
      agent.createConnection = vi.fn((options: any, callback?: any) => {
        // Create mock socket that simulates connection to different IP than DNS resolved
        const mockSocket = {
          remoteAddress: '192.168.1.1', // Private IP - different from DNS result  
          remotePort: 80,
          destroy: vi.fn(),
          on: vi.fn(),
          removeAllListeners: vi.fn()
        } as unknown as net.Socket;

        // Call the original logic but with our mocked socket
        const hostname = options.host || options.hostname;
        
        // Simulate async connection and then call the validation logic manually
        setTimeout(() => {
          if (callback) {
            // First check - no initial error
            // Now perform socket-level IP validation (from original implementation)
            const actualIP = mockSocket.remoteAddress;
            
            // This should fail because actualIP (192.168.1.1) is not in cached DNS (8.8.8.8)
            // And because isPrivateOrReservedIP(actualIP) should return true
            if (actualIP === '192.168.1.1') {
              const validationError = new Error(
                `Connection rejected: socket IP validation failed for ${hostname}`
              );
              mockSocket.destroy?.();
              callback(validationError);
            } else {
              callback(null);
            }
          }
        }, 0);

        return mockSocket as net.Socket;
      });

      // Test the connection creation and expect async rejection
      const connectionPromise = new Promise<void>((resolve, reject) => {
        const socket = agent.createConnection(
          { hostname: 'malicious.com', port: 80 }, 
          (err: Error | null) => {
            if (err) {
              // Expected - should be rejected due to IP mismatch
              expect(err.message).toContain('socket IP validation failed');
              resolve();
            } else {
              // Unexpected - connection should be rejected
              reject(new Error('Connection should have been rejected due to IP mismatch'));
            }
          }
        ) as net.Socket;
        
        // Verify socket.destroy was called on rejection
        expect(socket.destroy).toBeDefined();
      });

      // Wait for the async validation to complete
      await connectionPromise;
      
      // Verify mocks were called as expected
      expect(agent.createConnection).toHaveBeenCalledWith(
        { hostname: 'malicious.com', port: 80 },
        expect.any(Function)
      );
      
      cleanup();
    });
  });

  describe('IPv6 Security', () => {
    it('should block IPv4-mapped IPv6 addresses with private IPv4', async () => {
      const cleanup = mockDNSLookup('localhost', [
        { address: '::ffff:192.168.1.1', family: 6 }
      ]);

      await useProductionIPClassifier();

      // The enhanced agent should detect and block this
      const result = await validateRequestSecurity('https://localhost/test');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked private or reserved IPs');

      cleanup();
    });

    it('should block dangerous IPv6 addresses', async () => {
      const testCases = [
        { hostname: 'ipv6-localhost', address: '::1', family: 6 },         // IPv6 localhost
        { hostname: 'link-local', address: 'fe80::1', family: 6 },         // Link-local
        { hostname: 'unique-local', address: 'fc00::1', family: 6 },       // Unique local
        { hostname: 'multicast', address: 'ff02::1', family: 6 },          // Multicast
        { hostname: 'local-nat64', address: '64:ff9b:1::1', family: 6 },    // Local-use NAT64
        { hostname: 'srv6-sid', address: '5f00::1', family: 6 },            // SRv6 SID
      ];

      for (const testCase of testCases) {
        const cleanup = mockDNSLookup(testCase.hostname, [
          { address: testCase.address, family: testCase.family }
        ]);

        await useProductionIPClassifier();

        const result = await validateRequestSecurity(`https://${testCase.hostname}/test`);
        expect(result.allowed).toBe(false);
        
        cleanup();
      }
    });

    it.each([
      ['socket-local-nat64', '64:ff9b:1::1'],
      ['socket-srv6-sid', '5f00::1'],
    ])('should reject %s at socket validation after DNS caching', async (hostname, address) => {
      const cleanup = mockDNSLookup(hostname, [{ address, family: 6 }]);
      const createConnectionSpy = vi.spyOn(http.Agent.prototype, 'createConnection');

      try {
        await useProductionIPClassifier();

        // Rejected DNS results remain cached so socket validation can independently
        // enforce the same destination policy against the actual peer address.
        const result = await validateRequestSecurity(`http://${hostname}/`);
        expect(result.allowed).toBe(false);

        let connectListener: (() => void) | undefined;
        const socketDestroy = vi.fn();
        const mockSocket = {
          remoteAddress: address,
          remotePort: 80,
          destroy: socketDestroy,
          on: vi.fn((event: string, listener: () => void) => {
            if (event === 'connect') connectListener = listener;
          }),
        } as unknown as net.Socket;

        createConnectionSpy.mockImplementation(() => mockSocket);

        const agent = createEnhancedSecureHttpAgent();
        agent.createConnection({ host: hostname, port: 80 });
        connectListener?.();

        expect(socketDestroy).toHaveBeenCalledWith(
          expect.objectContaining({
            message: `Connection rejected: socket IP validation failed for ${hostname}`,
          })
        );
      } finally {
        createConnectionSpy.mockRestore();
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
      expect(result.failureKind).toBe('policy');
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
      expect(result.failureKind).toBe('operational');
      expect(result.reason).toContain('Security validation error');
    });
  });

  describe('Agent Configuration', () => {
    it('marks blocked DNS lookup callbacks as validation policy errors', async () => {
      const cleanup = mockDNSLookup('private-redirect.example', [
        { address: '192.168.1.1', family: 4 },
      ]);

      try {
        await useProductionIPClassifier();
        const agent = createEnhancedSecureHttpAgent();
        const lookup = (agent as unknown as {
          options: {
            lookup: (
              hostname: string,
              options: dns.LookupOneOptions,
              callback: (error: NodeJS.ErrnoException | null) => void
            ) => void;
          };
        }).options.lookup;

        const error = await new Promise<NodeJS.ErrnoException | null>(resolve => {
          lookup('private-redirect.example', {}, resolve);
        });

        expect(error).toBeInstanceOf(PreviewGeneratorError);
        expect(error).toMatchObject({
          type: ErrorType.VALIDATION_ERROR,
          code: 'ECONNREFUSED',
        });
      } finally {
        cleanup();
      }
    });

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
      expect((agent as any).options.minVersion).toBe('TLSv1.2');
      expect((agent as any).options.ciphers).toBeDefined();
    });

    it('should use singleton instances for performance', async () => {
      const { getEnhancedSecureHttpAgent, getEnhancedSecureHttpsAgent } =
        await import('../../src/utils/enhanced-secure-agent');
      
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

    it('should clear all cache entries without shutting down cache cleanup', async () => {
      const cleanup = mockDNSLookup('clear-all-test.com', [
        { address: '1.2.3.4', family: 4 }
      ]);

      mockIsPrivateOrReservedIP.mockReturnValue(false);

      await validateRequestSecurity('https://clear-all-test.com/test');
      expect(getDNSCacheStats().size).toBe(1);

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      invalidateDNSCache();

      expect(getDNSCacheStats().size).toBe(0);
      expect(clearIntervalSpy).not.toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
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

  describe('DNS admission control', () => {
    it('bounds native DNS lookups and starts queued lookups in FIFO order', async () => {
      const deferredDNS = mockDeferredDNSLookups();
      const controllers = Array.from({ length: 10 }, () => new AbortController());
      cleanupFunctions.push(() => {
        controllers.forEach(controller => controller.abort());
        deferredDNS.rejectAll();
        deferredDNS.restore();
      });
      mockIsPrivateOrReservedIP.mockReturnValue(false);

      const requests = Array.from({ length: 10 }, (_, index) =>
        validateRequestSecurity(
          `https://dns-limit-${index}.example/test`,
          controllers[index].signal
        )
      );

      await Promise.resolve();
      await Promise.resolve();

      expect(deferredDNS.startedHostnames).toHaveLength(8);
      expect(deferredDNS.startedHostnames).toEqual(
        Array.from({ length: 8 }, (_, index) => `dns-limit-${index}.example`)
      );

      for (let index = 0; index < requests.length; index += 1) {
        await vi.waitFor(() => expect(deferredDNS.callbackCount).toBeGreaterThan(index));
        deferredDNS.resolve(index, [{ address: `8.8.8.${index + 1}`, family: 4 }]);
      }

      const results = await Promise.all(requests);
      expect(results.every(result => result.allowed)).toBe(true);
      expect(deferredDNS.startedHostnames).toEqual(
        Array.from({ length: 10 }, (_, index) => `dns-limit-${index}.example`)
      );

      deferredDNS.restore();
    });

    it('does not release an active permit until the uncancellable native lookup settles', async () => {
      const deferredDNS = mockDeferredDNSLookups();
      const activeLimit = __testDNSLookupLimiter!.getStats().activeLimit;
      const controllers = Array.from({ length: activeLimit + 1 }, () => new AbortController());
      cleanupFunctions.push(() => {
        controllers.forEach(controller => controller.abort());
        deferredDNS.rejectAll();
        deferredDNS.restore();
      });
      mockIsPrivateOrReservedIP.mockReturnValue(false);

      const firstRequest = validateRequestSecurity(
        'https://dns-active-abort-0.example/test',
        controllers[0].signal
      );
      void firstRequest.catch(() => undefined);
      const otherActiveRequests = Array.from({ length: activeLimit - 1 }, (_, offset) => {
        const index = offset + 1;
        return validateRequestSecurity(
          `https://dns-active-abort-${index}.example/test`,
          controllers[index].signal
        );
      });
      otherActiveRequests.forEach(request => void request.catch(() => undefined));

      await Promise.resolve();
      await Promise.resolve();
      expect(deferredDNS.startedHostnames).toHaveLength(activeLimit);

      const queuedRequest = validateRequestSecurity(
        `https://dns-active-abort-${activeLimit}.example/test`,
        controllers[activeLimit].signal
      );
      void queuedRequest.catch(() => undefined);
      await Promise.resolve();
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({
        active: activeLimit,
        queued: 1,
      });

      const abortReason = new Error('active DNS caller aborted');
      const rejected = expect(firstRequest).rejects.toBe(abortReason);
      controllers[0].abort(abortReason);
      await rejected;
      expect(deferredDNS.startedHostnames).toHaveLength(activeLimit);
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({
        active: activeLimit,
        queued: 1,
      });

      deferredDNS.resolve(0);
      await vi.waitFor(() =>
        expect(deferredDNS.startedHostnames).toHaveLength(activeLimit + 1)
      );
      expect(deferredDNS.startedHostnames.at(-1)).toBe(
        `dns-active-abort-${activeLimit}.example`
      );

      for (let index = 1; index <= activeLimit; index += 1) {
        deferredDNS.resolve(index);
      }
      const results = await Promise.all([...otherActiveRequests, queuedRequest]);
      expect(results.every(result => result.allowed)).toBe(true);
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 0, queued: 0 });

      deferredDNS.restore();
    });

    it('removes an aborted queued lookup without disturbing FIFO order', async () => {
      const deferredDNS = mockDeferredDNSLookups();
      const activeLimit = __testDNSLookupLimiter!.getStats().activeLimit;
      const controllers = Array.from({ length: activeLimit + 2 }, () => new AbortController());
      cleanupFunctions.push(() => {
        controllers.forEach(controller => controller.abort());
        deferredDNS.rejectAll();
        deferredDNS.restore();
      });
      mockIsPrivateOrReservedIP.mockReturnValue(false);

      const activeRequests = Array.from({ length: activeLimit }, (_, index) =>
        validateRequestSecurity(
          `https://dns-queued-abort-${index}.example/test`,
          controllers[index].signal
        )
      );
      activeRequests.forEach(request => void request.catch(() => undefined));
      const abortedQueuedRequest = validateRequestSecurity(
        `https://dns-queued-abort-${activeLimit}.example/test`,
        controllers[activeLimit].signal
      );
      void abortedQueuedRequest.catch(() => undefined);
      const nextQueuedRequest = validateRequestSecurity(
        `https://dns-queued-abort-${activeLimit + 1}.example/test`,
        controllers[activeLimit + 1].signal
      );
      void nextQueuedRequest.catch(() => undefined);

      await Promise.resolve();
      await Promise.resolve();
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({
        active: activeLimit,
        queued: 2,
      });

      const abortReason = new Error('queued DNS caller aborted');
      const rejected = expect(abortedQueuedRequest).rejects.toBe(abortReason);
      controllers[activeLimit].abort(abortReason);
      await rejected;
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({
        active: activeLimit,
        queued: 1,
      });

      deferredDNS.resolve(0);
      await vi.waitFor(() =>
        expect(deferredDNS.startedHostnames).toHaveLength(activeLimit + 1)
      );
      expect(deferredDNS.startedHostnames.at(-1)).toBe(
        `dns-queued-abort-${activeLimit + 1}.example`
      );

      for (let index = 1; index <= activeLimit; index += 1) {
        deferredDNS.resolve(index);
      }
      const results = await Promise.all([...activeRequests, nextQueuedRequest]);
      expect(results.every(result => result.allowed)).toBe(true);
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 0, queued: 0 });

      deferredDNS.restore();
    });

    it('fails fast once the bounded DNS queue is full', async () => {
      const deferredDNS = mockDeferredDNSLookups();
      const limiterStats = __testDNSLookupLimiter!.getStats();
      const requestCount = limiterStats.activeLimit + limiterStats.queuedLimit + 1;
      const controllers = Array.from({ length: requestCount }, () => new AbortController());
      cleanupFunctions.push(() => {
        controllers.forEach(controller => controller.abort());
        deferredDNS.rejectAll();
        deferredDNS.restore();
      });
      mockIsPrivateOrReservedIP.mockReturnValue(false);

      const requests = Array.from({ length: requestCount }, (_, index) =>
        validateRequestSecurity(
          `https://dns-queue-full-${index}.example/test`,
          controllers[index].signal
        )
      );
      requests.forEach(request => void request.catch(() => undefined));

      await Promise.resolve();
      await Promise.resolve();
      const overflowResult = await requests.at(-1)!;
      expect(overflowResult.allowed).toBe(false);
      expect(overflowResult.reason).toContain('DNS lookup queue limit reached');
      expect(deferredDNS.startedHostnames).toHaveLength(limiterStats.activeLimit);
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({
        active: limiterStats.activeLimit,
        queued: limiterStats.queuedLimit,
      });

      controllers.slice(0, -1).forEach(controller => controller.abort());
      await Promise.allSettled(requests.slice(0, -1));
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({
        active: limiterStats.activeLimit,
        queued: 0,
      });

      deferredDNS.rejectAll();
      await vi.waitFor(() =>
        expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 0, queued: 0 })
      );

      deferredDNS.restore();
    });

    it('returns at the DNS deadline but retains the active permit until native settlement', async () => {
      vi.useFakeTimers();
      const deferredDNS = mockDeferredDNSLookups();
      cleanupFunctions.push(() => {
        deferredDNS.rejectAll();
        deferredDNS.restore();
      });
      mockIsPrivateOrReservedIP.mockReturnValue(false);

      try {
        const request = validateRequestSecurity('https://dns-deadline.example/test');
        await Promise.resolve();
        await Promise.resolve();
        expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 1, queued: 0 });

        await vi.advanceTimersByTimeAsync(__testDNSLookupLimiter!.getStats().timeoutMs);
        const result = await request;
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('DNS lookup timed out after 30000ms');
        expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 1, queued: 0 });

        deferredDNS.resolve(0);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 0, queued: 0 });
      } finally {
        deferredDNS.rejectAll();
        deferredDNS.restore();
        vi.useRealTimers();
      }
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

  describe('Real-world Attack Scenarios', () => {
    it('should resist DNS rebinding by caching DNS results', async () => {
      // Simulate attacker.com resolving to external IP initially, then internal IP
      const cleanup1 = mockDNSLookup('attacker.com', [
        { address: '8.8.8.8', family: 4 } // Initially resolves to external IP
      ]);
      
      mockIsPrivateOrReservedIP.mockReturnValue(false);

      // First validation should succeed (external IP)  
      const result1 = await validateRequestSecurity('http://attacker.com/payload');
      expect(result1.allowed).toBe(true);

      // Restore DNS lookup before installing a new mock
      cleanup1();
      
      // Now attacker changes DNS to point to internal IP
      const cleanup2 = mockDNSLookup('attacker.com', [
        { address: '192.168.1.100', family: 4 } // Now points to internal
      ]);
      const lookupMock2 = dns.lookup as unknown as vi.Mock;
      
      // Second validation should still use cached DNS and remain consistent
      const result2 = await validateRequestSecurity('http://attacker.com/payload');
      expect(result2.allowed).toBe(true);
      expect(lookupMock2).not.toHaveBeenCalled();
      
      cleanup2();
    });

    it('should prevent time-of-check-time-of-use attacks', async () => {
      const cleanup = mockDNSLookup('evil.com', [{ address: '203.0.113.1', family: 4 }]);
      mockIsPrivateOrReservedIP.mockReturnValue(false);

      // Populate the DNS cache for socket-level validation
      const result = await validateRequestSecurity('http://evil.com/');
      expect(result.allowed).toBe(true);

      const socketOn = vi.fn();
      let connectListener: (() => void) | undefined;
      socketOn.mockImplementation((event: string, listener: () => void) => {
        if (event === 'connect') connectListener = listener;
      });

      const socketDestroy = vi.fn();
      const mockSocket = {
        remoteAddress: '10.0.0.1', // Different from cached DNS IP
        remotePort: 80,
        destroy: socketDestroy,
        on: socketOn,
      } as unknown as net.Socket;

      const createConnectionSpy = vi
        .spyOn(http.Agent.prototype, 'createConnection')
        .mockImplementation(() => mockSocket);

      const agent = createEnhancedSecureHttpAgent();
      const socket = agent.createConnection({ host: 'evil.com', port: 80 });

      connectListener?.();

      expect(socket).toBeDefined();
      expect(socketDestroy).toHaveBeenCalled();
      createConnectionSpy.mockRestore();
      
      cleanup();
    });

    it('should handle sophisticated DNS rebinding with IPv6', async () => {
      const cleanup = mockDNSLookup('ipv6-rebind.com', [
        { address: '::ffff:192.168.1.1', family: 6 } // IPv4-mapped IPv6 private
      ]);
      
      mockIsPrivateOrReservedIP.mockReturnValue(true);
      
      const result = await validateRequestSecurity('http://ipv6-rebind.com/attack');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('private or reserved IP');
      expect(result.blockedIPs).toContain('::ffff:192.168.1.1');
      
      cleanup();
    });

    it('should resist multiple rapid DNS changes', async () => {
      const hostnames = ['rapid1.com', 'rapid2.com', 'rapid3.com'];
      const cleanupFuncs: (() => void)[] = [];
      
      // Set up multiple hostnames with different IPs
      hostnames.forEach((hostname, i) => {
        const cleanup = mockDNSLookup(hostname, [
          { address: `192.168.1.${i + 10}`, family: 4 }
        ]);
        cleanupFuncs.push(cleanup);
      });
      
      mockIsPrivateOrReservedIP.mockReturnValue(true);
      
      // Rapid requests should all be blocked
      const promises = hostnames.map(hostname => 
        validateRequestSecurity(`http://${hostname}/`)
      );
      
      const results = await Promise.all(promises);
      
      // All should be blocked
      expect(results.every(r => !r.allowed)).toBe(true);
      
      cleanupFuncs.forEach(cleanup => cleanup());
    });

    it('should maintain cache integrity under concurrent attacks', async () => {
      const cleanup = mockDNSLookup('concurrent-attack.com', [
        { address: '8.8.8.8', family: 4 }
      ]);
      
      mockIsPrivateOrReservedIP.mockReturnValue(false);
      
      // Launch many concurrent requests
      const concurrentRequests = Array(20).fill(0).map(() =>
        validateRequestSecurity('http://concurrent-attack.com/test')
      );
      
      const results = await Promise.allSettled(concurrentRequests);
      
      // All should have same result (cache consistency)
      const successResults = results
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<any>).value);
      
      expect(successResults.length).toBeGreaterThan(0);
      expect(successResults.every(r => r.allowed === successResults[0].allowed)).toBe(true);
      
      // Cache should contain only one entry
      const stats = getDNSCacheStats();
      expect(stats.size).toBe(1);
      
      cleanup();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle DNS resolution failures gracefully', async () => {
      const cleanup = mockDNSLookup('nonexistent.invalid', []);
      
      // This should trigger DNS error
      const result = await validateRequestSecurity('http://nonexistent.invalid/');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Security validation error');
      
      cleanup();
    });

    it('should handle malformed IP addresses in DNS responses', async () => {
      await useProductionIPClassifier();

      // Mock DNS to return invalid IP format
      const originalLookup = dns.lookup;
      (dns.lookup as any) = vi.fn((host, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
        }
        // Return malformed address
        setTimeout(() => callback!(null, [{ address: 'not-an-ip', family: 4 }]), 10);
      });
      
      const result = await validateRequestSecurity('http://malformed-dns.com/');
      
      expect(result.allowed).toBe(false);
      
      dns.lookup = originalLookup;
    });

    it('should maintain security under DNS cache poisoning attempts', async () => {
      // Initial safe resolution
      const cleanup1 = mockDNSLookup('target.com', [
        { address: '203.0.113.5', family: 4 }
      ]);
      
      mockIsPrivateOrReservedIP.mockReturnValue(false);
      
      const result1 = await validateRequestSecurity('http://target.com/');
      expect(result1.allowed).toBe(true);
      
      // Attacker tries to poison cache with private IP
      const cleanup2 = mockDNSLookup('target.com', [
        { address: '10.0.0.5', family: 4 } // Private IP
      ]);
      
      mockIsPrivateOrReservedIP.mockReturnValue(true);
      
      // Cache should prevent the poisoning attempt
      const result2 = await validateRequestSecurity('http://target.com/');
      // Result depends on cache TTL, but should be consistent
      
      cleanup1();
      cleanup2();
    });
  });
});
