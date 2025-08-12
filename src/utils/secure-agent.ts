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
 * Validates ALL resolved IP addresses to prevent SSRF bypass attacks
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

  // Force 'all' option to get all IP addresses for comprehensive validation
  const lookupOptions: dns.LookupAllOptions = {
    ...(typeof actualOptions === 'object' ? actualOptions : {}),
    all: true
  };

  dns.lookup(hostname, lookupOptions, (err, addresses) => {
    if (err) {
      return actualCallback(err, '' as string, 0 as number);
    }

    // Ensure addresses is always an array
    const addressList = Array.isArray(addresses) ? addresses : [addresses as dns.LookupAddress];
    
    if (addressList.length === 0) {
      const noAddressError = new Error(`No IP addresses resolved for hostname: ${hostname}`);
      return actualCallback(noAddressError as NodeJS.ErrnoException, '', 0);
    }

    // Check ALL resolved addresses for security violations
    const blockedAddresses: string[] = [];
    const safeAddresses: dns.LookupAddress[] = [];

    for (const addr of addressList) {
      if (isPrivateOrReservedIP(addr.address)) {
        blockedAddresses.push(addr.address);
      } else {
        safeAddresses.push(addr);
      }
    }

    // If ANY address is private/reserved, block the entire lookup
    if (blockedAddresses.length > 0) {
      const securityError = new Error(
        `Connection blocked due to private/reserved IP addresses: ${blockedAddresses.join(', ')}. ` +
        `Total resolved: ${addressList.length}, blocked: ${blockedAddresses.length}`
      );
      return actualCallback(
        securityError as NodeJS.ErrnoException, 
        blockedAddresses[0], 
        addressList[0]?.family || 4
      );
    }

    // All addresses are safe, return the first safe address (Node.js standard behavior)
    const firstSafeAddress = safeAddresses[0];
    actualCallback(null, firstSafeAddress.address, firstSafeAddress.family);
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
