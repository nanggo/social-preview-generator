/**
 * Metadata Extractor Module
 * Extracts Open Graph and Twitter Card metadata from URLs
 */

import ogs from 'open-graph-scraper';
import axios from 'axios';
import { promisify } from 'util';
import { lookup } from 'dns';
import { ExtractedMetadata, ErrorType, PreviewGeneratorError } from '../types';

const dnsLookup = promisify(lookup);

/**
 * Check if an IPv4 address is in a private or reserved range
 * Note: This function only handles IPv4 addresses. IPv6 support will be added in the future.
 */
function isPrivateOrReservedIP(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  
  if (octets.length !== 4 || octets.some(octet => octet < 0 || octet > 255)) {
    return true; // Invalid IP format, treat as blocked
  }

  const [a, b] = octets;
  
  // IPv4 private ranges
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  
  // Loopback
  if (a === 127) return true; // 127.0.0.0/8
  
  // Link-local
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  
  // Multicast and reserved
  if (a >= 224) return true; // 224.0.0.0/3
  
  // Localhost
  if (ip === '0.0.0.0') return true;
  
  return false;
}

/**
 * Extract metadata from a given URL
 * @param url - The URL to extract metadata from
 * @returns Extracted metadata object
 */
export async function extractMetadata(url: string): Promise<ExtractedMetadata> {
  try {
    // Validate URL with SSRF protection
    const validatedUrl = await validateUrl(url);

    // Extract Open Graph data
    const ogData = await fetchOpenGraphData(validatedUrl);

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
async function validateUrl(url: string): Promise<string> {
  try {
    const urlObj = new URL(url);

    // Ensure protocol is http or https
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Invalid protocol. Only HTTP and HTTPS are supported.');
    }

    // Skip IP validation for well-known domains to avoid unnecessary DNS lookups
    const hostname = urlObj.hostname.toLowerCase();
    const wellKnownDomains = [
      'github.com', 'gitlab.com', 'bitbucket.org', 
      'stackoverflow.com', 'medium.com', 'dev.to',
      'google.com', 'youtube.com', 'twitter.com', 'facebook.com'
    ];
    
    const isWellKnown = wellKnownDomains.some(domain => 
      hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isWellKnown) {
      try {
        // Resolve hostname to IPv4 address only
        // We explicitly request IPv4 (family: 4) to avoid issues with IPv6 addresses
        // which would be incorrectly blocked by our current IP validation logic
        const { address } = await dnsLookup(urlObj.hostname, 4);
        
        // Check if the resolved IPv4 address is in a private/reserved range
        if (isPrivateOrReservedIP(address)) {
          throw new Error(`Access to private/reserved IP address is not allowed: ${address}`);
        }
      } catch (dnsError) {
        if (dnsError instanceof Error && dnsError.message.includes('private/reserved')) {
          throw dnsError; // Re-throw our custom error
        }
        // For DNS resolution failures (including IPv6-only hosts), we'll allow the request to proceed
        // as it will fail naturally at the HTTP level if the host is unreachable
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
async function fetchOpenGraphData(url: string): Promise<any> {
  try {
    // First, try to fetch HTML content
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: 10000,
      maxRedirects: 5,
    });

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
function parseMetadata(ogData: any, url: string): ExtractedMetadata {
  const urlObj = new URL(url);

  // Extract title (prioritize OG title, then Twitter, then HTML title)
  const title =
    ogData.ogTitle || ogData.twitterTitle || ogData.dcTitle || ogData.title || urlObj.hostname;

  // Extract description
  const description =
    ogData.ogDescription ||
    ogData.twitterDescription ||
    ogData.dcDescription ||
    ogData.description ||
    '';

  // Extract image URL (prioritize OG image, then Twitter image)
  let image: string | undefined;
  if (ogData.ogImage) {
    if (Array.isArray(ogData.ogImage)) {
      image = ogData.ogImage[0]?.url || ogData.ogImage[0];
    } else if (typeof ogData.ogImage === 'object') {
      image = ogData.ogImage.url;
    } else {
      image = ogData.ogImage;
    }
  } else if (ogData.twitterImage) {
    if (Array.isArray(ogData.twitterImage)) {
      image = ogData.twitterImage[0]?.url || ogData.twitterImage[0];
    } else if (typeof ogData.twitterImage === 'object') {
      image = ogData.twitterImage.url;
    } else {
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
    ogData.ogSiteName ||
    ogData.twitterSite ||
    ogData.applicationName ||
    urlObj.hostname.replace('www.', '');

  // Extract favicon
  let favicon: string | undefined;
  if (ogData.favicon) {
    favicon = ogData.favicon;
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
  const author = ogData.author || ogData.dcCreator || ogData.twitterCreator || ogData.articleAuthor;

  // Extract published date
  const publishedDate =
    ogData.ogArticlePublishedTime ||
    ogData.articlePublishedTime ||
    ogData.dcDate ||
    ogData.publishedTime;

  // Extract locale
  const locale = ogData.ogLocale || ogData.inLanguage || 'en_US';

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
 * @returns Image buffer
 */
export async function fetchImage(imageUrl: string): Promise<Buffer> {
  try {
    // Maximum allowed image size (15MB)
    const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
    
    // Allowed MIME types for images
    const ALLOWED_MIME_TYPES = new Set([
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 
      'image/webp', 'image/svg+xml', 'image/bmp'
    ]);

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
      },
      timeout: 15000,
      maxRedirects: 5,
      maxContentLength: MAX_IMAGE_SIZE,
      maxBodyLength: MAX_IMAGE_SIZE,
    });

    // Check content-type header if available
    const contentType = response.headers?.['content-type']?.toLowerCase();
    if (contentType && !ALLOWED_MIME_TYPES.has(contentType)) {
      throw new Error(`Unsupported image type: ${contentType}. Only JPEG, PNG, GIF, WebP, SVG, and BMP are allowed.`);
    }

    // Check actual content length
    const contentLength = Buffer.from(response.data).length;
    if (contentLength > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large: ${contentLength} bytes. Maximum allowed: ${MAX_IMAGE_SIZE} bytes.`);
    }

    return Buffer.from(response.data);
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
