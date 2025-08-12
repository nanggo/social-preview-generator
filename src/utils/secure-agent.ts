/**
 * Secure HTTP/HTTPS Agent implementation
 * Prevents DNS rebinding and SSRF attacks by validating IP addresses at connection time
 */

import http from 'http';
import https from 'https';
import dns from 'dns';
import { isPrivateOrReservedIP } from './ip-validation';

/**
 * Secure DNS lookup function that blocks private/reserved IP addresses
 */
const secureLookup = (
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions | number | undefined,
  callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
): void => {
  // Normalize parameters to support both (host, cb) and (host, opts, cb)
  let actualOptions: dns.LookupOneOptions | dns.LookupAllOptions | number | undefined = {};
  let actualCallback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void;

  if (typeof options === 'function') {
    actualCallback = options as unknown as (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number
    ) => void;
    actualOptions = {};
  } else {
    actualOptions = options ?? {};
    actualCallback = (callback || (() => {})) as (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number
    ) => void;
  }

  dns.lookup(hostname, actualOptions as any, (err, address, family) => {
    if (err) {
      return actualCallback(err, address as unknown as string, family as unknown as number);
    }

    // Check if the resolved address is in a private/reserved range
    if (typeof address === 'string' && isPrivateOrReservedIP(address)) {
      const securityError = new Error(
        `Connection to private/reserved IP address blocked: ${address}`
      );
      return actualCallback(securityError as NodeJS.ErrnoException, address, family as number);
    }

    // Address is safe, proceed
    actualCallback(null, address as string, family as number);
  });
};

/**
 * Create secure HTTP agent with private IP blocking
 */
export function createSecureHttpAgent(): http.Agent {
  return new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 30000,
    lookup: secureLookup,
  });
}

/**
 * Create secure HTTPS agent with private IP blocking
 */
export function createSecureHttpsAgent(): https.Agent {
  return new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 30000,
    lookup: secureLookup,
  });
}

/**
 * Get default secure agents (singleton pattern for performance)
 */
let defaultHttpAgent: http.Agent | undefined;
let defaultHttpsAgent: https.Agent | undefined;

export function getSecureHttpAgent(): http.Agent {
  if (!defaultHttpAgent) {
    defaultHttpAgent = createSecureHttpAgent();
  }
  return defaultHttpAgent;
}

export function getSecureHttpsAgent(): https.Agent {
  if (!defaultHttpsAgent) {
    defaultHttpsAgent = createSecureHttpsAgent();
  }
  return defaultHttpsAgent;
}

/**
 * Get appropriate secure agent based on protocol
 */
export function getSecureAgentForUrl(url: string): http.Agent | https.Agent {
  const urlObj = new URL(url);
  return urlObj.protocol === 'https:' ? getSecureHttpsAgent() : getSecureHttpAgent();
}
