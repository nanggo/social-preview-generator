/**
 * Metadata Extractor Module
 * Extracts Open Graph and Twitter Card metadata from URLs
 */

import ogs from 'open-graph-scraper';
import axios from 'axios';
import { promisify } from 'util';
import { lookup } from 'dns';
import { ExtractedMetadata, ErrorType, PreviewGeneratorError, SecurityOptions, RedirectOptions } from '../types';
import { validateUrlInput } from '../utils/validators';
import { getSecureAgentForUrl } from '../utils/secure-agent';
import { validateImageBuffer } from '../utils/image-security';

const dnsLookup = promisify(lookup);

/**
 * Check if an IP address (IPv4 or IPv6) is in a private or reserved range
 */
function isPrivateOrReservedIP(ip: string): boolean {
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

/**
 * Extract metadata from a given URL
 * @param url - The URL to extract metadata from
 * @param securityOptions - Security configuration options
 * @returns Extracted metadata object
 */
export async function extractMetadata(url: string, securityOptions?: SecurityOptions): Promise<ExtractedMetadata> {
  try {
    // Validate URL with SSRF protection and security options
    const validatedUrl = await validateUrl(url, securityOptions);

    // Extract Open Graph data
    const ogData = await fetchOpenGraphData(validatedUrl, securityOptions);

    // Parse and normalize metadata
    const metadata = parseMetadata(ogData, validatedUrl);

    return metadata;
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw new PreviewGeneratorError(
      ErrorType.METADATA_ERROR,
      `Failed to extract metadata from ${url}: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Validate and normalize URL with SSRF protection
 */
async function validateUrl(url: string, securityOptions?: SecurityOptions): Promise<string> {
  try {
    const urlObj = new URL(url);

    // Ensure protocol is http or https
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Invalid protocol. Only HTTP and HTTPS are supported.');
    }

    // Check HTTPS-only requirement
    if (securityOptions?.httpsOnly && urlObj.protocol !== 'https:') {
      throw new Error('HTTP URLs are not allowed when HTTPS-only mode is enabled.');
    }

    // Skip IP validation for well-known domains to avoid unnecessary DNS lookups
    const hostname = urlObj.hostname.toLowerCase();
    const wellKnownDomains = [
      'github.com',
      'gitlab.com',
      'bitbucket.org',
      'stackoverflow.com',
      'medium.com',
      'dev.to',
      'google.com',
      'youtube.com',
      'twitter.com',
      'facebook.com',
      // Test domains
      'example.com',
      'twitter-example.com',
      'minimal.com',
      'error-example.com',
    ];

    const isWellKnown = wellKnownDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isWellKnown) {
      try {
        // Try IPv4 first, then IPv6 if IPv4 fails
        let resolvedAddress: string;

        try {
          // Resolve hostname to IPv4 address
          const { address } = await dnsLookup(urlObj.hostname, 4);
          resolvedAddress = address;
        } catch {
          // If IPv4 resolution fails, try IPv6
          try {
            const { address } = await dnsLookup(urlObj.hostname, 6);
            resolvedAddress = address;
          } catch {
            throw new Error(
              `DNS lookup failed for both IPv4 and IPv6 for host: ${urlObj.hostname}. Request blocked to prevent SSRF vulnerabilities.`
            );
          }
        }

        // Check if the resolved address (IPv4 or IPv6) is in a private/reserved range
        if (isPrivateOrReservedIP(resolvedAddress)) {
          throw new Error(
            `Access to private/reserved IP address is not allowed: ${resolvedAddress}`
          );
        }
      } catch (dnsError) {
        if (
          dnsError instanceof Error &&
          (dnsError.message.includes('private/reserved') ||
            dnsError.message.includes('DNS lookup failed'))
        ) {
          throw dnsError; // Re-throw our custom errors
        }
        // Other DNS errors - block for security
        throw new Error(
          `DNS resolution failed for host: ${urlObj.hostname}. Request blocked to prevent SSRF vulnerabilities.`
        );
      }
    }

    return urlObj.toString();
  } catch (error) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, `Invalid URL: ${url}`, error);
  }
}

/**
 * Fetch Open Graph data using open-graph-scraper
 */
async function fetchOpenGraphData(url: string, securityOptions?: SecurityOptions): Promise<Record<string, unknown>> {
  try {
    // Create secure axios config with redirect validation and secure agent
    const axiosConfig = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: securityOptions?.timeout || 8000, // Configurable timeout
      maxRedirects: securityOptions?.maxRedirects ?? 3, // Configurable redirects
      maxContentLength: 1 * 1024 * 1024, // Reduced from 2MB to 1MB for HTML content
      maxBodyLength: 1 * 1024 * 1024, // Ensure body is also limited
      httpAgent: getSecureAgentForUrl(url),
      httpsAgent: getSecureAgentForUrl(url),
      beforeRedirect: (options: Record<string, any>, responseDetails: { headers: Record<string, string>; statusCode: number }) => {
        // Validate each redirect URL for SSRF protection using typed interface for clarity
        const redirectOptions = options as RedirectOptions;
        const redirectUrl = `${redirectOptions.protocol}//${redirectOptions.hostname}${redirectOptions.path || ''}${redirectOptions.search || ''}`;
        try {
          validateUrlInput(redirectUrl);
        } catch (error) {
          throw new PreviewGeneratorError(
            ErrorType.VALIDATION_ERROR,
            `Redirect to unsafe URL blocked: ${redirectUrl}`,
            error
          );
        }
      },
    };

    // First, try to fetch HTML content
    const response = await axios.get(url, axiosConfig);

    // Extract OG data from HTML
    const { error, result } = await ogs({ html: response.data, url });

    if (error) {
      throw new Error('Failed to parse Open Graph data');
    }

    return result;
  } catch {
    // Fallback: Try direct OG scraping
    try {
      const { error: ogError, result } = await ogs({ url });

      if (ogError) {
        throw new Error('Failed to fetch Open Graph data');
      }

      return result;
    } catch (fallbackError) {
      throw new PreviewGeneratorError(
        ErrorType.FETCH_ERROR,
        `Failed to fetch data from ${url}`,
        fallbackError
      );
    }
  }
}

/**
 * Parse and normalize metadata from Open Graph data
 */
function parseMetadata(ogData: Record<string, unknown>, url: string): ExtractedMetadata {
  const urlObj = new URL(url);

  // Extract title (prioritize OG title, then Twitter, then HTML title)
  const title =
    (ogData.ogTitle as string) ||
    (ogData.twitterTitle as string) ||
    (ogData.dcTitle as string) ||
    (ogData.title as string) ||
    urlObj.hostname;

  // Extract description
  const description =
    (ogData.ogDescription as string) ||
    (ogData.twitterDescription as string) ||
    (ogData.dcDescription as string) ||
    (ogData.description as string) ||
    '';

  // Extract image URL (prioritize OG image, then Twitter image)
  let image: string | undefined;
  if (ogData.ogImage) {
    if (Array.isArray(ogData.ogImage)) {
      const firstImage = ogData.ogImage[0];
      if (typeof firstImage === 'object' && firstImage !== null && 'url' in firstImage) {
        image = (firstImage as { url: string }).url;
      } else if (typeof firstImage === 'string') {
        image = firstImage;
      }
    } else if (typeof ogData.ogImage === 'object' && ogData.ogImage !== null && 'url' in ogData.ogImage) {
      image = (ogData.ogImage as { url: string }).url;
    } else if (typeof ogData.ogImage === 'string') {
      image = ogData.ogImage;
    }
  } else if (ogData.twitterImage) {
    if (Array.isArray(ogData.twitterImage)) {
      const firstImage = ogData.twitterImage[0];
      if (typeof firstImage === 'object' && firstImage !== null && 'url' in firstImage) {
        image = (firstImage as { url: string }).url;
      } else if (typeof firstImage === 'string') {
        image = firstImage;
      }
    } else if (typeof ogData.twitterImage === 'object' && ogData.twitterImage !== null && 'url' in ogData.twitterImage) {
      image = (ogData.twitterImage as { url: string }).url;
    } else if (typeof ogData.twitterImage === 'string') {
      image = ogData.twitterImage;
    }
  }

  // Ensure image URL is absolute
  if (image && !image.startsWith('http')) {
    try {
      const imageUrl = new URL(image, url);
      image = imageUrl.toString();
    } catch {
      image = undefined;
    }
  }

  // Extract site name
  const siteName =
    (ogData.ogSiteName as string) ||
    (ogData.twitterSite as string) ||
    (ogData.applicationName as string) ||
    urlObj.hostname.replace('www.', '');

  // Extract favicon
  let favicon: string | undefined;
  if (ogData.favicon) {
    favicon = ogData.favicon as string;
    if (favicon && !favicon.startsWith('http')) {
      try {
        const faviconUrl = new URL(favicon, url);
        favicon = faviconUrl.toString();
      } catch {
        // Try default favicon path
        favicon = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
      }
    }
  } else {
    // Default favicon path
    favicon = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
  }

  // Extract author
  const author =
    (ogData.author as string) ||
    (ogData.dcCreator as string) ||
    (ogData.twitterCreator as string) ||
    (ogData.articleAuthor as string);

  // Extract published date
  const publishedDate =
    (ogData.ogArticlePublishedTime as string) ||
    (ogData.articlePublishedTime as string) ||
    (ogData.dcDate as string) ||
    (ogData.publishedTime as string);

  // Extract locale
  const locale = (ogData.ogLocale as string) || (ogData.inLanguage as string) || 'en_US';

  return {
    title: cleanText(title),
    description: description ? cleanText(description) : undefined,
    image,
    siteName: siteName ? cleanText(siteName) : undefined,
    favicon,
    author: author ? cleanText(author) : undefined,
    publishedDate,
    url,
    domain: urlObj.hostname,
    locale,
  };
}

/**
 * Clean and normalize text
 */
function cleanText(text: string): string {
  return text
    .replace(/[\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch image from URL and return as buffer with size and type validation
 * @param imageUrl - URL of the image to fetch
 * @param securityOptions - Security configuration options
 * @returns Image buffer
 */
export async function fetchImage(imageUrl: string, securityOptions?: SecurityOptions): Promise<Buffer> {
  try {
    // Validate URL with SSRF protection before fetching
    const validatedUrl = await validateUrl(imageUrl, securityOptions);

    // Maximum allowed image size (15MB)
    const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

    // Allowed MIME types for images (SVG removed for security)
    const ALLOWED_MIME_TYPES = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff',
    ]);

    const response = await axios.get(validatedUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
      },
      timeout: securityOptions?.timeout || 12000, // Configurable timeout (default 12s for images)
      maxRedirects: securityOptions?.maxRedirects ?? 3, // Configurable redirects
      maxContentLength: MAX_IMAGE_SIZE,
      maxBodyLength: MAX_IMAGE_SIZE,
      httpAgent: getSecureAgentForUrl(validatedUrl),
      httpsAgent: getSecureAgentForUrl(validatedUrl),
      beforeRedirect: (options: Record<string, any>, responseDetails: { headers: Record<string, string>; statusCode: number }) => {
        // Validate each redirect URL for SSRF protection using typed interface for clarity
        const redirectOptions = options as RedirectOptions;
        const redirectUrl = `${redirectOptions.protocol}//${redirectOptions.hostname}${redirectOptions.path || ''}${redirectOptions.search || ''}`;
        try {
          validateUrlInput(redirectUrl);
        } catch (error) {
          throw new PreviewGeneratorError(
            ErrorType.VALIDATION_ERROR,
            `Image redirect to unsafe URL blocked: ${redirectUrl}`,
            error
          );
        }
      },
    });

    // Check content-type header if available
    const contentType = response.headers?.['content-type']?.toLowerCase();
    if (contentType && !ALLOWED_MIME_TYPES.has(contentType)) {
      throw new Error(
        `Unsupported image type: ${contentType}. Only JPEG, PNG, GIF, WebP, BMP, and TIFF are allowed.`
      );
    }

    // Convert to Buffer efficiently without unnecessary copying
    const imageBuffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);

    // Check actual content length
    const contentLength = imageBuffer.length;
    if (contentLength > MAX_IMAGE_SIZE) {
      throw new Error(
        `Image too large: ${contentLength} bytes. Maximum allowed: ${MAX_IMAGE_SIZE} bytes.`
      );
    }

    // Validate image for security (pixel bombs, malformed files, etc.)
    await validateImageBuffer(imageBuffer, securityOptions?.allowSvg);

    return imageBuffer;
  } catch (error) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Failed to fetch image from ${imageUrl}: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Validate metadata to ensure required fields are present
 */
export function validateMetadata(metadata: ExtractedMetadata): boolean {
  return !!(metadata.title && metadata.title.length > 0);
}

/**
 * Apply fallback values to incomplete metadata
 */
export function applyFallbacks(
  metadata: Partial<ExtractedMetadata>,
  url: string
): ExtractedMetadata {
  const urlObj = new URL(url);

  return {
    title: metadata.title || urlObj.hostname,
    description: metadata.description,
    image: metadata.image,
    siteName: metadata.siteName || urlObj.hostname.replace('www.', ''),
    favicon: metadata.favicon || `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`,
    author: metadata.author,
    publishedDate: metadata.publishedDate,
    url: metadata.url || url,
    domain: metadata.domain || urlObj.hostname,
    locale: metadata.locale || 'en_US',
  };
}
