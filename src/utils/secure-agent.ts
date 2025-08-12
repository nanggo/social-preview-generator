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
const secureLookup = (hostname: string, options: unknown, callback?: unknown) => {
  // Support both callback and options parameter patterns
  let actualOptions = {};
  let actualCallback: unknown;

  if (typeof options === 'function') {
    actualCallback = options;
    actualOptions = {};
  } else {
    actualOptions = options || {};
    actualCallback = callback;
  }

  dns.lookup(hostname, actualOptions, (err, address, family) => {
    if (err) {
      return actualCallback(err, address, family);
    }

    // Check if the resolved address is in a private/reserved range
    if (isPrivateOrReservedIP(address)) {
      const securityError = new Error(
        `Connection to private/reserved IP address blocked: ${address}`
      );
      return actualCallback(securityError, address, family);
    }

    // Address is safe, proceed
    actualCallback(null, address, family);
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