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
import { PreviewGeneratorError } from '../types';
import { createSecurityPolicyError } from './security-policy-error';

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
  failureKind?: 'policy' | 'operational';
}

const MAX_ACTIVE_DNS_LOOKUPS = 8;
const MAX_QUEUED_DNS_LOOKUPS = 1000;
const DNS_LOOKUP_TIMEOUT_MS = SECURITY_CONFIG.HTTP_TIMEOUT;
const MAX_GLOBAL_FREE_SOCKETS = Math.max(
  1,
  Math.floor(SECURITY_CONFIG.MAX_CONCURRENT_CONNECTIONS / 5)
);

type ReleaseDNSLookupPermit = () => void;

interface DNSLookupQueueEntry {
  signal: AbortSignal;
  resolve: (release: ReleaseDNSLookupPermit) => void;
  reject: (error: unknown) => void;
  onAbort: () => void;
}

let activeDNSLookups = 0;
const dnsLookupQueue: DNSLookupQueueEntry[] = [];

function createDNSLookupError(message: string, code: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  error.syscall = 'getaddrinfo';
  return error;
}

function createNetworkPolicyError(
  message: string
): PreviewGeneratorError & NodeJS.ErrnoException {
  const error = createSecurityPolicyError(
    message
  ) as PreviewGeneratorError & NodeJS.ErrnoException;
  error.code = 'ECONNREFUSED';
  return error;
}

function getDNSLookupAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? createDNSLookupError('DNS lookup aborted', 'ABORT_ERR');
}

function createDNSLookupReleasePermit(): ReleaseDNSLookupPermit {
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    activeDNSLookups = Math.max(0, activeDNSLookups - 1);
    drainDNSLookupQueue();
  };
}

function grantDNSLookupPermit(entry: DNSLookupQueueEntry): boolean {
  entry.signal.removeEventListener('abort', entry.onAbort);
  if (entry.signal.aborted) {
    entry.reject(getDNSLookupAbortReason(entry.signal));
    return false;
  }

  activeDNSLookups += 1;
  entry.resolve(createDNSLookupReleasePermit());
  return true;
}

function drainDNSLookupQueue(): void {
  while (activeDNSLookups < MAX_ACTIVE_DNS_LOOKUPS && dnsLookupQueue.length > 0) {
    const entry = dnsLookupQueue.shift();
    if (entry) {
      grantDNSLookupPermit(entry);
    }
  }
}

function acquireDNSLookupPermit(signal: AbortSignal): Promise<ReleaseDNSLookupPermit> {
  if (signal.aborted) {
    return Promise.reject(getDNSLookupAbortReason(signal));
  }

  if (activeDNSLookups < MAX_ACTIVE_DNS_LOOKUPS && dnsLookupQueue.length === 0) {
    activeDNSLookups += 1;
    return Promise.resolve(createDNSLookupReleasePermit());
  }

  if (dnsLookupQueue.length >= MAX_QUEUED_DNS_LOOKUPS) {
    return Promise.reject(
      createDNSLookupError(
        `DNS lookup queue limit reached (${MAX_QUEUED_DNS_LOOKUPS}). Server is busy, please try again later.`,
        'EAI_AGAIN'
      )
    );
  }

  return new Promise<ReleaseDNSLookupPermit>((resolve, reject) => {
    const entry: DNSLookupQueueEntry = {
      signal,
      resolve,
      reject,
      onAbort: () => {
        const index = dnsLookupQueue.indexOf(entry);
        if (index !== -1) {
          dnsLookupQueue.splice(index, 1);
        }
        signal.removeEventListener('abort', entry.onAbort);
        reject(getDNSLookupAbortReason(signal));
      },
    };

    dnsLookupQueue.push(entry);
    signal.addEventListener('abort', entry.onAbort, { once: true });
    drainDNSLookupQueue();
  });
}

interface DNSLookupAbortContext {
  signal: AbortSignal;
  aborted: Promise<never>;
  cleanup: () => void;
}

function createDNSLookupAbortContext(callerSignal?: AbortSignal): DNSLookupAbortContext {
  const controller = new AbortController();
  const abort = (error: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(error);
    }
  };
  const onCallerAbort = () => {
    abort(callerSignal?.reason ?? createDNSLookupError('DNS lookup aborted', 'ABORT_ERR'));
  };

  if (callerSignal?.aborted) {
    onCallerAbort();
  } else {
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  }

  const timeoutId = controller.signal.aborted
    ? undefined
    : setTimeout(() => {
        abort(
          createDNSLookupError(
            `DNS lookup timed out after ${DNS_LOOKUP_TIMEOUT_MS}ms`,
            'EAI_AGAIN'
          )
        );
      }, DNS_LOOKUP_TIMEOUT_MS);
  timeoutId?.unref?.();

  const aborted = new Promise<never>((_, reject) => {
    if (controller.signal.aborted) {
      reject(getDNSLookupAbortReason(controller.signal));
      return;
    }

    controller.signal.addEventListener(
      'abort',
      () => reject(getDNSLookupAbortReason(controller.signal)),
      { once: true }
    );
  });

  return {
    signal: controller.signal,
    aborted,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
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
    // Adaptive cleanup interval based on TTL (cleanup every TTL/10, min 10s, max 60s)
    const cleanupIntervalMs = Math.max(10000, Math.min(60000, this.defaultTTL / 10));
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
    this.cleanupInterval.unref();
  }

  /**
   * Get cached DNS result or perform fresh lookup
   */
  async lookup(hostname: string, callerSignal?: AbortSignal): Promise<dns.LookupAddress[]> {
    const cacheKey = hostname.toLowerCase();
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (callerSignal?.aborted) {
      throw callerSignal.reason ?? createDNSLookupError('DNS lookup aborted', 'ABORT_ERR');
    }

    // Return cached result if valid
    if (cached && now - cached.timestamp < cached.ttl) {
      return cached.addresses;
    }

    const abortContext = createDNSLookupAbortContext(callerSignal);
    const controlledLookup = (async () => {
      const release = await acquireDNSLookupPermit(abortContext.signal);
      let nativeLookupStarted = false;

      try {
        if (abortContext.signal.aborted) {
          throw getDNSLookupAbortReason(abortContext.signal);
        }

        // A prior queued lookup may have populated the cache while this caller waited.
        const queuedCached = this.cache.get(cacheKey);
        const queuedNow = Date.now();
        if (queuedCached && queuedNow - queuedCached.timestamp < queuedCached.ttl) {
          return queuedCached.addresses;
        }

        const nativeLookup = this.performFreshLookup(hostname, cacheKey);
        nativeLookupStarted = true;

        // dns.lookup cannot be cancelled. Keep the permit until its callback settles,
        // even if the caller's deadline or AbortSignal wins the outer race.
        return await nativeLookup.finally(release);
      } finally {
        if (!nativeLookupStarted) {
          release();
        }
      }
    })();

    try {
      return await Promise.race([controlledLookup, abortContext.aborted]);
    } finally {
      abortContext.cleanup();
    }
  }

  private performFreshLookup(hostname: string, cacheKey: string): Promise<dns.LookupAddress[]> {
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
          timestamp: Date.now(),
          ttl: this.defaultTTL,
          hostname
        };

        // Manage cache size with LRU eviction
        if (this.cache.size >= this.maxCacheSize) {
          // Remove multiple old entries if near capacity to prevent frequent evictions
          const entriesToRemove = Math.max(1, Math.floor(this.maxCacheSize * 0.1)); // Remove 10%
          let removed = 0;
          for (const [key] of this.cache.entries()) {
            if (removed >= entriesToRemove) break;
            this.cache.delete(key);
            removed++;
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
   * Clean up expired entries and enforce size limits
   */
  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    // Find expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= entry.ttl) {
        toDelete.push(key);
      }
    }

    // Remove expired entries
    toDelete.forEach(key => this.cache.delete(key));

    // If still over capacity after expiry cleanup, perform LRU eviction
    if (this.cache.size > this.maxCacheSize * 0.9) { // Start cleanup at 90% capacity
      const excessEntries = this.cache.size - Math.floor(this.maxCacheSize * 0.8); // Target 80% capacity
      let removed = 0;
      
      for (const [key] of this.cache.entries()) {
        if (removed >= excessEntries) break;
        this.cache.delete(key);
        removed++;
      }
      
      logger.debug(`DNS cache cleanup: removed ${toDelete.length} expired + ${removed} LRU entries, ${this.cache.size} remaining`);
    } else {
      logger.debug(`DNS cache cleanup: removed ${toDelete.length} expired entries, ${this.cache.size} remaining`);
    }
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
   * Clear cached DNS entries without shutting down cleanup lifecycle.
   */
  clear(): void {
    this.cache.clear();
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
    if (isPrivateOrReservedIP(addr.address)) {
      blockedIPs.push(addr.address);
    } else {
      allowedIPs.push(addr.address);
    }
  }

  return {
    allowed: blockedIPs.length === 0,
    blockedIPs,
    allowedIPs,
    failureKind: blockedIPs.length > 0 ? 'policy' : undefined,
    reason: blockedIPs.length > 0 
      ? `Blocked private or reserved IPs: ${blockedIPs.join(', ')}`
      : undefined
  };
}

/**
 * Enhanced secure DNS lookup with caching and comprehensive validation
 */
const enhancedSecureLookup: NonNullable<http.AgentOptions['lookup']> = (
  hostname,
  options,
  callback
): void => {
  const returnAllAddresses = options.all === true;

  const returnLookupError = (error: NodeJS.ErrnoException): void => {
    if (returnAllAddresses) {
      callback(error, []);
      return;
    }

    // Never return actual IPs in lookup errors - use placeholder values.
    callback(error, '0.0.0.0', 4);
  };

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

        const securityError = createNetworkPolicyError(
          `Connection blocked: ${validation.reason}. ` +
          `Total resolved: ${addresses.length}, blocked: ${validation.blockedIPs.length}`
        );

        return returnLookupError(securityError);
      }

      if (returnAllAddresses) {
        // Node's autoSelectFamily path requests `all: true` and requires the
        // two-argument callback form. Return copies so consumers cannot mutate
        // the validated cache entries.
        callback(
          null,
          addresses.map(({ address, family }) => ({ address, family }))
        );
        return;
      }

      // Return first safe address - only from validated allowed IPs
      const firstSafeAddress = addresses.find(addr => 
        validation.allowedIPs.includes(addr.address)
      );
      
      // If no safe address found, this is a critical error
      if (!firstSafeAddress) {
        const criticalError = createNetworkPolicyError(
          `Critical security error: No safe addresses found for ${hostname}`
        );
        return returnLookupError(criticalError);
      }

      logger.debug('DNS lookup successful', {
        hostname,
        address: firstSafeAddress.address,
        family: firstSafeAddress.family,
        totalAddresses: addresses.length
      });

      callback(null, firstSafeAddress.address, firstSafeAddress.family);
    })
    .catch(err => {
      logger.error('DNS lookup failed', { hostname, error: err });
      returnLookupError(err as NodeJS.ErrnoException);
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
    logger.warn('Socket IP validation failed: no cached DNS results', { 
      hostname, 
      actualIP 
    });
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

function getHostnameForValidation(options: unknown): string {
  if (!options || typeof options !== 'object') return '';

  const opts = options as { host?: unknown; hostname?: unknown };
  const rawHost = typeof opts.hostname === 'string' ? opts.hostname : typeof opts.host === 'string' ? opts.host : '';

  if (!rawHost) return '';

  // Bracketed IPv6, optionally with port: [::1] or [::1]:443
  if (rawHost.startsWith('[')) {
    const endBracket = rawHost.indexOf(']');
    if (endBracket !== -1) {
      return rawHost.slice(1, endBracket);
    }
  }

  // Unbracketed IPv6 (no port): ::1
  if (net.isIP(rawHost) === 6) return rawHost;

  // host:port (single colon). If multiple colons, assume it's IPv6 and return as-is.
  const firstColon = rawHost.indexOf(':');
  const lastColon = rawHost.lastIndexOf(':');
  if (firstColon !== -1 && firstColon === lastColon) {
    return rawHost.slice(0, firstColon);
  }

  return rawHost;
}

interface SocketBudgetAgent extends http.Agent {
  addRequest(request: http.ClientRequest, options: http.ClientRequestArgs): void;
  options: http.AgentOptions;
  totalSocketCount: number;
}

type AgentSocket = Parameters<http.Agent['keepSocketAlive']>[0];

function countGlobalFreeSockets(agent: http.Agent): number {
  return Object.values(agent.freeSockets).reduce((count, sockets) => {
    if (!sockets) return count;
    return count + sockets.filter(socket => !socket.destroyed).length;
  }, 0);
}

function getGlobalFreeSocketLimit(agent: http.Agent): number {
  return Math.min(MAX_GLOBAL_FREE_SOCKETS, Math.max(0, agent.maxTotalSockets - 1));
}

function hasPendingRequests(agent: http.Agent): boolean {
  return Object.values(agent.requests).some(requests => (requests?.length ?? 0) > 0);
}

function hasReusableSocket(agent: http.Agent, originName: string): boolean {
  return agent.freeSockets[originName]?.some(socket => !socket.destroyed) ?? false;
}

function evictFreeSocket(agent: http.Agent, excludedOriginName: string): boolean {
  for (const [originName, sockets] of Object.entries(agent.freeSockets)) {
    if (originName === excludedOriginName || !sockets) continue;

    const socket = sockets.find(candidate => !candidate.destroyed);
    if (socket) {
      socket.destroy();
      return true;
    }
  }

  return false;
}

function installGlobalSocketBudget<T extends http.Agent>(agent: T): T {
  const managedAgent = agent as T & SocketBudgetAgent;
  const originalKeepSocketAlive = agent.keepSocketAlive as unknown as (
    socket: AgentSocket
  ) => boolean;
  const originalAddRequest = managedAgent.addRequest;

  managedAgent.keepSocketAlive = function(
    this: SocketBudgetAgent,
    socket: AgentSocket
  ): boolean {
    // Node's maxFreeSockets is per origin. Enforce a separate global budget so
    // idle origins cannot consume maxTotalSockets and starve new work.
    if (
      hasPendingRequests(this) ||
      countGlobalFreeSockets(this) >= getGlobalFreeSocketLimit(this)
    ) {
      return false;
    }

    return originalKeepSocketAlive.call(this, socket);
  };

  managedAgent.addRequest = function(
    this: SocketBudgetAgent,
    request: http.ClientRequest,
    options: http.ClientRequestArgs
  ): void {
    const normalizedOptions = { ...options, ...this.options } as http.ClientRequestArgs;
    if (normalizedOptions.socketPath) {
      normalizedOptions.path = normalizedOptions.socketPath;
    }
    const originName = this.getName(normalizedOptions);

    // A same-origin idle socket can be reused without increasing the total.
    // Otherwise retire one idle socket before Node queues the new origin.
    if (
      this.totalSocketCount >= this.maxTotalSockets &&
      !hasReusableSocket(this, originName)
    ) {
      evictFreeSocket(this, originName);
    }

    originalAddRequest.call(this, request, options);
  };

  return agent;
}

/**
 * Create enhanced secure HTTP agent
 */
export function createEnhancedSecureHttpAgent(): http.Agent {
  const agent = installGlobalSocketBudget(new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: SECURITY_CONFIG.MAX_CONCURRENT_CONNECTIONS,
    maxTotalSockets: SECURITY_CONFIG.MAX_CONCURRENT_CONNECTIONS,
    maxFreeSockets: MAX_GLOBAL_FREE_SOCKETS,
    timeout: SECURITY_CONFIG.HTTP_TIMEOUT,
    lookup: enhancedSecureLookup,
  }));

  // Override createConnection for socket-level validation
  const originalCreateConnection = agent.createConnection;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent.createConnection = function(options: any, callback?: any) {
    const normalizedOptions =
      options && typeof options === 'object' && typeof options.hostname === 'string' && !options.host
        ? { ...options, host: options.hostname }
        : options;

    const hostname = getHostnameForValidation(normalizedOptions);
    const socket = originalCreateConnection.call(this, normalizedOptions, callback);
    if (!socket) {
      throw new Error(`Failed to create connection socket for ${hostname}`);
    }

    // Listen for the 'connect' event to perform validation after connection is established
    socket.on('connect', () => {
      // Perform socket-level IP validation after connection
      if (!validateSocketIP(socket as net.Socket, hostname)) {
        const validationError = createNetworkPolicyError(
          `Connection rejected: socket IP validation failed for ${hostname}`
        );
        logger.warn('TOCTOU protection triggered: destroying connection', {
          hostname,
          remoteAddress: (socket as net.Socket).remoteAddress
        });
        socket.destroy(validationError);
        return;
      }

      logger.debug('Socket IP validation passed', {
        hostname,
        remoteAddress: (socket as net.Socket).remoteAddress,
        remotePort: (socket as net.Socket).remotePort
      });
    });

    return socket;
  };

  return agent;
}

/**
 * Create enhanced secure HTTPS agent
 */
export function createEnhancedSecureHttpsAgent(): https.Agent {
  const agent = installGlobalSocketBudget(new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: SECURITY_CONFIG.MAX_CONCURRENT_CONNECTIONS,
    maxTotalSockets: SECURITY_CONFIG.MAX_CONCURRENT_CONNECTIONS,
    maxFreeSockets: MAX_GLOBAL_FREE_SOCKETS,
    timeout: SECURITY_CONFIG.HTTP_TIMEOUT,
    lookup: enhancedSecureLookup,
    // TLS security settings
    minVersion: 'TLSv1.2',
    ciphers: 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384',
    honorCipherOrder: true,
    checkServerIdentity: (hostname: string, cert: tls.PeerCertificate) => {
      // Perform additional hostname verification
      const result = tls.checkServerIdentity(hostname, cert);
      if (result) return result;

      // Additional checks can be added here
      logger.debug('TLS certificate validation passed', { hostname });
      return undefined;
    }
  }));

  // Override createConnection for socket-level validation  
  const originalCreateConnection = agent.createConnection;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent.createConnection = function(options: any, callback?: any) {
    const normalizedOptions =
      options && typeof options === 'object' && typeof options.hostname === 'string' && !options.host
        ? { ...options, host: options.hostname }
        : options;

    const hostname = getHostnameForValidation(normalizedOptions);
    const socket = originalCreateConnection.call(this, normalizedOptions, callback);
    if (!socket) {
      throw new Error(`Failed to create TLS connection socket for ${hostname}`);
    }

    // Listen for the 'secureConnect' event for TLS sockets
    socket.on('secureConnect', () => {
      // Perform socket-level IP validation after TLS connection
      if (!validateSocketIP(socket as tls.TLSSocket, hostname)) {
        const validationError = createNetworkPolicyError(
          `TLS connection rejected: socket IP validation failed for ${hostname}`
        );
        logger.warn('TOCTOU protection triggered: destroying TLS connection', {
          hostname,
          remoteAddress: (socket as tls.TLSSocket).remoteAddress
        });
        socket.destroy(validationError);
        return;
      }

      logger.debug('TLS socket IP validation passed', {
        hostname,
        remoteAddress: (socket as tls.TLSSocket).remoteAddress,
        remotePort: (socket as tls.TLSSocket).remotePort
      });
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
    dnsCache.clear();
    logger.info('DNS cache completely cleared');
  }
}

/**
 * Advanced security validation for HTTP requests
 */
export async function validateRequestSecurity(
  url: string,
  abortSignal?: AbortSignal
): Promise<SecurityValidationResult> {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Perform DNS lookup and validation
    const addresses = await dnsCache.lookup(hostname, abortSignal);
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
    if (abortSignal?.aborted) {
      throw abortSignal.reason ?? error;
    }
    logger.error('Security validation failed', { url, error: error as Error });
    return {
      allowed: false,
      blockedIPs: [],
      allowedIPs: [],
      failureKind: 'operational',
      reason: `Security validation error: ${(error as Error).message}`
    };
  }
}

/** Test-only visibility for deterministic DNS admission-control assertions. */
export const __testDNSLookupLimiter = process.env.NODE_ENV === 'test'
  ? {
      getStats: () => ({
        active: activeDNSLookups,
        queued: dnsLookupQueue.length,
        activeLimit: MAX_ACTIVE_DNS_LOOKUPS,
        queuedLimit: MAX_QUEUED_DNS_LOOKUPS,
        timeoutMs: DNS_LOOKUP_TIMEOUT_MS,
      }),
    }
  : undefined;

// Export cleanup function for application-level resource management
// Applications should call this during graceful shutdown
export const cleanup = () => dnsCache.destroy();
