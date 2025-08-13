/**
 * Metadata Extractor Module
 * Extracts Open Graph and Twitter Card metadata from URLs
 */

import ogs from 'open-graph-scraper';
import axios from 'axios';
import { ExtractedMetadata, ErrorType, PreviewGeneratorError, SecurityOptions, RedirectOptions } from '../types';
import { validateUrlInput } from '../utils/validators';
import { getEnhancedSecureAgentForUrl, validateRequestSecurity } from '../utils/enhanced-secure-agent';
import { validateImageBuffer } from '../utils/image-security';
import { metadataCache } from '../utils/cache';

// In-flight request management to prevent cache stampede
// Limit the size to prevent memory exhaustion DoS attacks
const MAX_INFLIGHT_REQUESTS = 1000;
// Timeout for in-flight requests to prevent stuck promises from blocking the map indefinitely
const INFLIGHT_REQUEST_TIMEOUT = process.env.NODE_ENV === 'test' ? 1000 : 30000; // 1s for tests, 30s for production
const inflightRequests = new Map<string, Promise<ExtractedMetadata>>();

/**
 * Get statistics about in-flight requests for monitoring/debugging
 * @returns Object containing in-flight request statistics
 */
export function getInflightRequestStats(): { 
  count: number; 
  keys: string[];
  maxLimit: number;
  utilizationPercent: number;
} {
  return {
    count: inflightRequests.size,
    keys: Array.from(inflightRequests.keys()),
    maxLimit: MAX_INFLIGHT_REQUESTS,
    utilizationPercent: Math.round((inflightRequests.size / MAX_INFLIGHT_REQUESTS) * 100)
  };
}

/**
 * Clear all in-flight requests (useful for testing or cleanup)
 * WARNING: This will cause pending requests to potentially duplicate work
 */
export function clearInflightRequests(): void {
  inflightRequests.clear();
}

/**
 * Test helper to access internal inflightRequests map
 * WARNING: Only for testing purposes
 */
export const __test_inflightRequests = process.env.NODE_ENV === 'test' ? inflightRequests : undefined;

/**
 * Extract metadata from a given URL
 * @param url - The URL to extract metadata from
 * @param securityOptions - Security configuration options
 * @returns Extracted metadata object
 */
export async function extractMetadata(url: string, securityOptions?: SecurityOptions): Promise<ExtractedMetadata> {
  try {
    // Create cache key based on URL and security options
    // Sort object entries to ensure deterministic cache key generation
    const options = securityOptions || {};
    const sortedOptions = Object.fromEntries(Object.entries(options).sort());
    const cacheKey = `${url}:${JSON.stringify(sortedOptions)}`;
    
    // Check cache first
    const cachedMetadata = metadataCache.get(cacheKey);
    if (cachedMetadata) {
      return cachedMetadata;
    }

    // Check if there's already an in-flight request for this cache key
    let metadataPromise = inflightRequests.get(cacheKey);

    if (!metadataPromise) {
      // Check if we've reached the maximum number of in-flight requests (DoS protection)
      if (inflightRequests.size >= MAX_INFLIGHT_REQUESTS) {
        throw new PreviewGeneratorError(
          ErrorType.FETCH_ERROR,
          `In-flight requests limit reached (${MAX_INFLIGHT_REQUESTS}). Server is busy, please try again later.`
        );
      }

      // If no request is in-flight, create one and store it in the map.
      // This ensures that even if multiple requests arrive concurrently,
      // only one will create the promise.
      const originalPromise = extractMetadataInternal(url, cacheKey, securityOptions);
      // Prevent unhandled rejection if timeout occurs before original promise settles
      originalPromise.catch(() => {});
      
      // Add timeout protection to prevent stuck promises from blocking the map indefinitely
      let timeoutId: NodeJS.Timeout;
      const timeoutPromise = new Promise<ExtractedMetadata>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new PreviewGeneratorError(
            ErrorType.FETCH_ERROR,
            `In-flight request timeout after ${INFLIGHT_REQUEST_TIMEOUT}ms for URL: ${url}`
          ));
        }, INFLIGHT_REQUEST_TIMEOUT);
      });
      
      // Race the original promise against the timeout.
      // We attach .finally() to the race itself to ensure the timeout is cleared
      // as soon as the race is decided, preventing a memory leak from lingering timers.
      metadataPromise = Promise.race([originalPromise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId!);
      });
      inflightRequests.set(cacheKey, metadataPromise);

      // The creator of the promise is responsible for cleaning it up from the map
      // once it settles (resolves or rejects).
      metadataPromise.finally(() => {
        try {
          // To avoid race conditions, only delete if the promise in the map is still this one.
          if (inflightRequests.get(cacheKey) === metadataPromise) {
            inflightRequests.delete(cacheKey);
          }
        } catch (cleanupError) {
          // Silently handle cleanup errors to prevent unhandled promise rejections
          console.warn('Error during in-flight request cleanup:', cleanupError);
        }
      }).catch(() => {
        // Prevent unhandled promise rejection warnings
        // The actual error will be handled by the caller
      });
    }

    // Wait for the (either existing or new) request to complete and return its result.
    return metadataPromise;
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
 * Internal metadata extraction function
 * Separated to handle in-flight request management properly
 */
async function extractMetadataInternal(
  url: string,
  cacheKey: string,
  securityOptions?: SecurityOptions
): Promise<ExtractedMetadata> {
  // Validate URL with SSRF protection and security options
  const validatedUrl = await validateUrl(url, securityOptions);

  // Extract Open Graph data
  const ogData = await fetchOpenGraphData(validatedUrl, securityOptions);

  // Parse and normalize metadata
  const metadata = parseMetadata(ogData, validatedUrl);

  // Cache the result
  metadataCache.set(cacheKey, metadata);

  return metadata;
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

    // Enhanced security validation with TOCTOU protection
    const securityValidation = await validateRequestSecurity(url);
    if (!securityValidation.allowed) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `URL blocked by security validation: ${securityValidation.reason}`,
        { 
          url, 
          blockedIPs: securityValidation.blockedIPs,
          allowedIPs: securityValidation.allowedIPs
        }
      );
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
      httpAgent: getEnhancedSecureAgentForUrl(url),
      httpsAgent: getEnhancedSecureAgentForUrl(url),
      beforeRedirect: (options: Record<string, any>, _responseDetails: { headers: Record<string, string>; statusCode: number }) => {
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

    // Allowed MIME types for images (SVG conditionally allowed based on security settings)
    const ALLOWED_MIME_TYPES = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff',
    ]);

    // Add SVG to allowed types only if explicitly permitted
    if (securityOptions?.allowSvg) {
      ALLOWED_MIME_TYPES.add('image/svg+xml');
    }

    const response = await axios.get(validatedUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
      },
      timeout: securityOptions?.timeout || 12000, // Configurable timeout (default 12s for images)
      maxRedirects: securityOptions?.maxRedirects ?? 3, // Configurable redirects
      maxContentLength: MAX_IMAGE_SIZE,
      maxBodyLength: MAX_IMAGE_SIZE,
      httpAgent: getEnhancedSecureAgentForUrl(validatedUrl),
      httpsAgent: getEnhancedSecureAgentForUrl(validatedUrl),
      beforeRedirect: (options: Record<string, any>, _responseDetails: { headers: Record<string, string>; statusCode: number }) => {
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
