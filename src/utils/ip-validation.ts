/**
 * IP Address Validation Utilities
 * Centralized SSRF protection for private and reserved IP address ranges
 */

import net from 'net';
import { BLOCKED_IP_RANGES, BLOCKED_IPV6_RANGES } from '../constants/security';

const blockedAddresses = new net.BlockList();
const IPV4_EMBEDDED_IPV6_PREFIXES = [
  '::ffff:', // IPv4-mapped
  '::ffff:0:', // IPv4-translated
  '64:ff9b::', // Well-known NAT64
] as const;

for (const { network, prefix } of BLOCKED_IP_RANGES) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');

  for (const ipv6Prefix of IPV4_EMBEDDED_IPV6_PREFIXES) {
    blockedAddresses.addSubnet(`${ipv6Prefix}${network}`, 96 + prefix, 'ipv6');
  }
}

for (const cidr of BLOCKED_IPV6_RANGES) {
  const separator = cidr.lastIndexOf('/');
  const network = cidr.slice(0, separator);
  const prefix = Number(cidr.slice(separator + 1));

  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

function normalizeIPAddress(ip: string): string | null {
  if (typeof ip !== 'string' || ip.length === 0) {
    return null;
  }

  const startsWithBracket = ip.startsWith('[');
  const endsWithBracket = ip.endsWith(']');

  if (startsWithBracket !== endsWithBracket) {
    return null;
  }

  if (startsWithBracket && endsWithBracket) {
    const unwrapped = ip.slice(1, -1);
    return unwrapped.includes('[') || unwrapped.includes(']') ? null : unwrapped;
  }

  return ip.includes('[') || ip.includes(']') ? null : ip;
}

/**
 * Check if an IP address (IPv4 or IPv6) is in a private or reserved range.
 * Malformed addresses fail closed so unexpected DNS output cannot bypass SSRF protection.
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  const normalizedIP = normalizeIPAddress(ip);

  if (!normalizedIP) {
    return true;
  }

  const family = net.isIP(normalizedIP);

  if (family === 0) {
    return true;
  }

  return blockedAddresses.check(normalizedIP, family === 4 ? 'ipv4' : 'ipv6');
}
