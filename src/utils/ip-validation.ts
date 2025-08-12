/**
 * IP Address Validation Utilities
 * Centralized SSRF protection for private and reserved IP address ranges
 */

/**
 * Check if an IP address (IPv4 or IPv6) is in a private or reserved range
 * This prevents SSRF attacks by blocking access to internal network resources
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  // IPv6 address detection
  if (ip.includes(':')) {
    return isPrivateOrReservedIPv6(ip);
  }

  // IPv4 address validation
  return isPrivateOrReservedIPv4(ip);
}

/**
 * Check if an IPv4 address is in a private or reserved range
 */
function isPrivateOrReservedIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);

  if (
    octets.length !== 4 ||
    octets.some(isNaN) ||
    octets.some((octet) => octet < 0 || octet > 255)
  ) {
    return true; // Invalid IP format, treat as blocked
  }

  const [a, b] = octets;

  // IPv4 private and reserved ranges
  if (a === 0) return true; // 0.0.0.0/8 (reserved)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16

  // Carrier-Grade NAT (RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10

  // Loopback
  if (a === 127) return true; // 127.0.0.0/8

  // Link-local
  if (a === 169 && b === 254) return true; // 169.254.0.0/16

  // Multicast and reserved
  if (a >= 224) return true; // 224.0.0.0/3

  return false;
}

/**
 * Check if an IPv6 address is in a private or reserved range
 */
function isPrivateOrReservedIPv6(ip: string): boolean {
  try {
    // Normalize IPv6 address - remove brackets if present
    const normalizedIP = ip.replace(/^\[|\]$/g, '').toLowerCase();

    // IPv6 private and reserved ranges
    const privatePrefixes = [
      '::', // Unspecified address
      '::1', // Loopback
      'fe80:', // Link-local
      'fec0:', // Site-local (deprecated but still reserved)
      'ff', // Multicast (ff00::/8)
      'fc', // Unique local addresses (fc00::/7)
      'fd', // Unique local addresses (fd00::/8)
      '2001:db8:', // Documentation prefix
      '2002:', // 6to4 addresses
    ];

    // Check against known private/reserved prefixes
    for (const prefix of privatePrefixes) {
      if (normalizedIP.startsWith(prefix)) {
        return true;
      }
    }

    // Comprehensive check for IPv4-mapped IPv6 addresses
    if (normalizedIP.startsWith('::ffff:')) {
      const ipv4Part = normalizedIP.replace('::ffff:', '');

      // Handle dot notation IPv4 (e.g., ::ffff:192.168.1.1)
      if (ipv4Part.includes('.')) {
        return isPrivateOrReservedIPv4(ipv4Part);
      }

      // Handle hex notation IPv4 (e.g., ::ffff:c0a8:101 for 192.168.1.1)
      if (ipv4Part.length === 8 && /^[0-9a-f]+$/.test(ipv4Part)) {
        const hexPart1 = ipv4Part.slice(0, 4);
        const hexPart2 = ipv4Part.slice(4, 8);

        const octet1 = parseInt(hexPart1.slice(0, 2), 16);
        const octet2 = parseInt(hexPart1.slice(2, 4), 16);
        const octet3 = parseInt(hexPart2.slice(0, 2), 16);
        const octet4 = parseInt(hexPart2.slice(2, 4), 16);

        const reconstructedIPv4 = `${octet1}.${octet2}.${octet3}.${octet4}`;
        return isPrivateOrReservedIPv4(reconstructedIPv4);
      }

      // Handle colon-separated hex notation (e.g., ::ffff:c0a8:101)
      if (ipv4Part.includes(':')) {
        const hexParts = ipv4Part.split(':');
        if (hexParts.length === 2) {
          try {
            const part1 = parseInt(hexParts[0], 16);
            const part2 = parseInt(hexParts[1], 16);

            const octet1 = (part1 >> 8) & 0xff;
            const octet2 = part1 & 0xff;
            const octet3 = (part2 >> 8) & 0xff;
            const octet4 = part2 & 0xff;

            const reconstructedIPv4 = `${octet1}.${octet2}.${octet3}.${octet4}`;
            return isPrivateOrReservedIPv4(reconstructedIPv4);
          } catch {
            // If conversion fails, treat as blocked for security
            return true;
          }
        }
      }

      // If we can't parse the IPv4 part, treat as blocked for security
      return true;
    }

    // Also check for general IPv4-mapped patterns that don't start with ::ffff:
    // Some systems use different mappings
    if (
      normalizedIP.includes('::') &&
      normalizedIP.match(/[0-9a-f]*\.[0-9a-f]*\.[0-9a-f]*\.[0-9a-f]*/)
    ) {
      return true; // Block any suspicious IPv4-like patterns in IPv6
    }

    return false;
  } catch {
    // If parsing fails, treat as blocked for security
    return true;
  }
}