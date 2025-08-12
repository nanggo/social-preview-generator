/**
 * Enhanced Secure HTTP/HTTPS Agent implementation
 * 
 * Addresses TOCTOU (Time-of-Check-Time-of-Use) vulnerabilities in DNS rebinding protection
 * by implementing DNS result caching and socket-level IP validation
 */

import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import tls from 'tls';
import { isPrivateOrReservedIP } from './ip-validation';
import { logger } from './logger';
import { SECURITY_CONFIG } from '../constants/security';

interface CachedDNSResult {
  addresses: dns.LookupAddress[];
  timestamp: number;
  ttl: number; // in milliseconds
  hostname: string;
}

interface SecurityValidationResult {
  allowed: boolean;
  blockedIPs: string[];
  allowedIPs: string[];
  reason?: string;
}

/**
 * DNS Cache with TTL support
 * Prevents TOCTOU attacks by ensuring consistent IP resolution
 */
class SecureDNSCache {
  private cache = new Map<string, CachedDNSResult>();
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes
  private readonly maxCacheSize = 1000;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Get cached DNS result or perform fresh lookup
   */
  async lookup(hostname: string): Promise<dns.LookupAddress[]> {
    const cacheKey = hostname.toLowerCase();
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    // Return cached result if valid
    if (cached && now - cached.timestamp < cached.ttl) {
      return cached.addresses;
    }

    // Perform fresh DNS lookup
    return new Promise((resolve, reject) => {
      const lookupOptions: dns.LookupAllOptions = {
        all: true,
        family: 0 // Both IPv4 and IPv6
      };

      dns.lookup(hostname, lookupOptions, (err, addresses) => {
        if (err) {
          return reject(err);
        }

        const addressList = Array.isArray(addresses) ? addresses : [addresses as dns.LookupAddress];
        
        if (addressList.length === 0) {
          return reject(new Error(`No IP addresses resolved for hostname: ${hostname}`));
        }

        // Cache the result
        const cacheEntry: CachedDNSResult = {
          addresses: addressList,
          timestamp: now,
          ttl: this.defaultTTL,
          hostname
        };

        // Manage cache size
        if (this.cache.size >= this.maxCacheSize) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey) {
            this.cache.delete(oldestKey);
          }
        }

        this.cache.set(cacheKey, cacheEntry);
        resolve(addressList);
      });
    });
  }

  /**
   * Get cached IP addresses for hostname (used for socket validation)
   */
  getCachedIPs(hostname: string): string[] | null {
    const cached = this.cache.get(hostname.toLowerCase());
    const now = Date.now();

    if (cached && now - cached.timestamp < cached.ttl) {
      return cached.addresses.map(addr => addr.address);
    }

    return null;
  }

  /**
   * Invalidate cache entry for hostname
   */
  invalidate(hostname: string): void {
    this.cache.delete(hostname.toLowerCase());
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= entry.ttl) {
        toDelete.push(key);
      }
    }

    toDelete.forEach(key => this.cache.delete(key));

    logger.debug(`DNS cache cleanup: removed ${toDelete.length} expired entries, ${this.cache.size} remaining`);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      entries: Array.from(this.cache.entries()).map(([hostname, entry]) => ({
        hostname,
        addresses: entry.addresses.map(a => a.address),
        age: Date.now() - entry.timestamp,
        ttl: entry.ttl
      }))
    };
  }

  /**
   * Clear cache and cleanup
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}

// Global DNS cache instance
const dnsCache = new SecureDNSCache();

/**
 * Validate IP addresses for security violations
 */
function validateIPAddresses(addresses: dns.LookupAddress[]): SecurityValidationResult {
  const blockedIPs: string[] = [];
  const allowedIPs: string[] = [];

  for (const addr of addresses) {
    // Check for various dangerous IP ranges
    if (isPrivateOrReservedIP(addr.address)) {
      blockedIPs.push(addr.address);
    }
    // Additional IPv6 checks for IPv4-mapped addresses
    else if (addr.family === 6 && addr.address.startsWith('::ffff:')) {
      const ipv4Part = addr.address.substring(7); // Remove '::ffff:' prefix
      if (isPrivateOrReservedIP(ipv4Part)) {
        blockedIPs.push(addr.address);
      } else {
        allowedIPs.push(addr.address);
      }
    }
    // Additional dangerous IPv6 ranges
    else if (addr.family === 6) {
      const ip = addr.address.toLowerCase();
      if (
        ip.startsWith('::1') ||           // Localhost
        ip.startsWith('fe80:') ||         // Link-local
        ip.startsWith('fc00:') ||         // Unique local
        ip.startsWith('fd00:') ||         // Unique local
        ip.startsWith('ff00:')            // Multicast
      ) {
        blockedIPs.push(addr.address);
      } else {
        allowedIPs.push(addr.address);
      }
    } else {
      allowedIPs.push(addr.address);
    }
  }

  return {
    allowed: blockedIPs.length === 0,
    blockedIPs,
    allowedIPs,
    reason: blockedIPs.length > 0 
      ? `Blocked private/reserved IPs: ${blockedIPs.join(', ')}`
      : undefined
  };
}

/**
 * Enhanced secure DNS lookup with caching and comprehensive validation
 */
const enhancedSecureLookup = (
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions | number | undefined,
  callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
): void => {
  // Normalize parameters
  let actualCallback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void;

  if (typeof options === 'function') {
    actualCallback = options as unknown as (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number
    ) => void;
  } else {
    actualCallback = (callback || (() => {})) as (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number
    ) => void;
  }

  // Use cached/fresh DNS lookup
  dnsCache.lookup(hostname)
    .then(addresses => {
      // Validate all resolved addresses
      const validation = validateIPAddresses(addresses);
      
      if (!validation.allowed) {
        logger.warn('DNS lookup blocked', {
          hostname,
          reason: validation.reason,
          blockedIPs: validation.blockedIPs,
          allowedIPs: validation.allowedIPs
        });

        const securityError = new Error(
          `Connection blocked: ${validation.reason}. ` +
          `Total resolved: ${addresses.length}, blocked: ${validation.blockedIPs.length}`
        ) as NodeJS.ErrnoException;
        securityError.code = 'ECONNREFUSED';

        return actualCallback(securityError, validation.blockedIPs[0] || '', addresses[0]?.family || 4);
      }

      // Return first safe address
      const firstSafeAddress = addresses.find(addr => 
        validation.allowedIPs.includes(addr.address)
      ) || addresses[0];

      logger.debug('DNS lookup successful', {
        hostname,
        address: firstSafeAddress.address,
        family: firstSafeAddress.family,
        totalAddresses: addresses.length
      });

      actualCallback(null, firstSafeAddress.address, firstSafeAddress.family);
    })
    .catch(err => {
      logger.error('DNS lookup failed', { hostname, error: err });
      actualCallback(err as NodeJS.ErrnoException, '', 0);
    });
};

/**
 * Socket-level IP validation for TOCTOU protection
 * Re-validates the actual connected IP against cached DNS results
 */
function validateSocketIP(socket: net.Socket, hostname: string): boolean {
  const actualIP = socket.remoteAddress;
  if (!actualIP) {
    logger.warn('Socket IP validation failed: no remote address', { hostname });
    return false;
  }

  // Get the cached IP addresses for this hostname
  const cachedIPs = dnsCache.getCachedIPs(hostname);
  if (!cachedIPs) {
    logger.warn('Socket IP validation failed: no cached DNS results', { hostname, actualIP });
    return false;
  }

  // Check if the actual connected IP matches one of the cached DNS results
  if (!cachedIPs.includes(actualIP)) {
    logger.warn('Socket IP validation failed: IP mismatch', {
      hostname,
      actualIP,
      cachedIPs,
      reason: 'Connected IP does not match DNS resolution'
    });
    return false;
  }

  // Re-validate the actual IP for security
  if (isPrivateOrReservedIP(actualIP)) {
    logger.warn('Socket IP validation failed: private/reserved IP', {
      hostname,
      actualIP,
      reason: 'Connected to private/reserved IP address'
    });
    return false;
  }

  return true;
}

/**
 * Create enhanced secure HTTP agent
 */
export function createEnhancedSecureHttpAgent(): http.Agent {
  const agent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: SECURITY_CONFIG.MAX_CONCURRENT_CONNECTIONS,
    maxFreeSockets: Math.floor(SECURITY_CONFIG.MAX_CONCURRENT_CONNECTIONS / 5),
    timeout: SECURITY_CONFIG.HTTP_TIMEOUT,
    lookup: enhancedSecureLookup,
  });

  // Override createConnection for socket-level validation
  const originalCreateConnection = agent.createConnection;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent.createConnection = function(options: any, callback?: any) {
    const hostname = options.host || options.hostname;
    
    // Create the connection normally first
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const socket = originalCreateConnection.call(this, options, (err: Error | null) => {
      if (err) {
        return callback?.(err);
      }

      // Perform socket-level IP validation after connection
      if (!validateSocketIP(socket as net.Socket, hostname)) {
        const validationError = new Error(
          `Connection rejected: socket IP validation failed for ${hostname}`
        );
        socket.destroy();
        return callback?.(validationError);
      }

      logger.debug('Socket IP validation passed', {
        hostname,
        remoteAddress: (socket as net.Socket).remoteAddress,
        remotePort: (socket as net.Socket).remotePort
      });

      callback?.(null);
    });

    return socket;
  };

  return agent;
}

/**
 * Create enhanced secure HTTPS agent
 */
export function createEnhancedSecureHttpsAgent(): https.Agent {
  const agent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: SECURITY_CONFIG.MAX_CONCURRENT_CONNECTIONS,
    maxFreeSockets: Math.floor(SECURITY_CONFIG.MAX_CONCURRENT_CONNECTIONS / 5),
    timeout: SECURITY_CONFIG.HTTP_TIMEOUT,
    lookup: enhancedSecureLookup,
    // Additional TLS security settings
    secureProtocol: 'TLSv1_2_method',
    ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384',
    honorCipherOrder: true,
    checkServerIdentity: (hostname: string, cert: any) => {
      // Perform additional hostname verification
      const result = tls.checkServerIdentity(hostname, cert);
      if (result) return result;

      // Additional checks can be added here
      logger.debug('TLS certificate validation passed', { hostname });
      return undefined;
    }
  });

  // Override createConnection for socket-level validation
  const originalCreateConnection = agent.createConnection;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent.createConnection = function(options: any, callback?: any) {
    const hostname = options.host || options.hostname;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const socket = originalCreateConnection.call(this, options, (err: Error | null) => {
      if (err) {
        return callback?.(err);
      }

      // Perform socket-level IP validation
      if (!validateSocketIP(socket as tls.TLSSocket, hostname)) {
        const validationError = new Error(
          `TLS connection rejected: socket IP validation failed for ${hostname}`
        );
        socket.destroy();
        return callback?.(validationError);
      }

      logger.debug('TLS socket IP validation passed', {
        hostname,
        remoteAddress: (socket as tls.TLSSocket).remoteAddress,
        remotePort: (socket as tls.TLSSocket).remotePort
      });

      callback?.(null);
    });

    return socket;
  };

  return agent;
}

/**
 * Singleton instances for performance
 */
let defaultEnhancedHttpAgent: http.Agent | undefined;
let defaultEnhancedHttpsAgent: https.Agent | undefined;

export function getEnhancedSecureHttpAgent(): http.Agent {
  if (!defaultEnhancedHttpAgent) {
    defaultEnhancedHttpAgent = createEnhancedSecureHttpAgent();
  }
  return defaultEnhancedHttpAgent;
}

export function getEnhancedSecureHttpsAgent(): https.Agent {
  if (!defaultEnhancedHttpsAgent) {
    defaultEnhancedHttpsAgent = createEnhancedSecureHttpsAgent();
  }
  return defaultEnhancedHttpsAgent;
}

/**
 * Get appropriate enhanced secure agent based on protocol
 */
export function getEnhancedSecureAgentForUrl(url: string): http.Agent | https.Agent {
  const urlObj = new URL(url);
  return urlObj.protocol === 'https:' ? getEnhancedSecureHttpsAgent() : getEnhancedSecureHttpAgent();
}

/**
 * DNS cache management functions
 */
export function getDNSCacheStats() {
  return dnsCache.getStats();
}

export function invalidateDNSCache(hostname?: string) {
  if (hostname) {
    dnsCache.invalidate(hostname);
    logger.info(`DNS cache invalidated for hostname: ${hostname}`);
  } else {
    dnsCache.destroy();
    logger.info('DNS cache completely cleared');
  }
}

/**
 * Advanced security validation for HTTP requests
 */
export async function validateRequestSecurity(url: string): Promise<SecurityValidationResult> {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Perform DNS lookup and validation
    const addresses = await dnsCache.lookup(hostname);
    const validation = validateIPAddresses(addresses);

    if (!validation.allowed) {
      logger.warn('Request blocked by security validation', {
        url,
        hostname,
        reason: validation.reason,
        blockedIPs: validation.blockedIPs
      });
    }

    return validation;
  } catch (error) {
    logger.error('Security validation failed', { url, error: error as Error });
    return {
      allowed: false,
      blockedIPs: [],
      allowedIPs: [],
      reason: `Security validation error: ${(error as Error).message}`
    };
  }
}

// Cleanup on process exit
process.on('SIGTERM', () => dnsCache.destroy());
process.on('SIGINT', () => dnsCache.destroy());