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
import { logger } from '../utils/logger';

// Allowed MIME types for images
const BASE_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
]);

// Maximum allowed image size (15MB)
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

/**
 * Build redirect validation callback for SSRF protection
 */
function createRedirectValidator(context: string) {
  return (
    options: Record<string, unknown>,
    _responseDetails: { headers: Record<string, string>; statusCode: number }
  ) => {
    const redirectOptions = options as unknown as RedirectOptions;
    const redirectUrl = `${redirectOptions.protocol}//${redirectOptions.hostname}${
      redirectOptions.port ? `:${redirectOptions.port}` : ''
    }${redirectOptions.path || ''}${redirectOptions.search || ''}`;
    try {
      validateUrlInput(redirectUrl);
    } catch (error) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `${context} to unsafe URL blocked: ${redirectUrl}`,
        error
      );
    }
  };
}

/**
 * Extract image URL from OG/Twitter image data that may be a string, object, or array
 */
function extractImageUrlFromData(data: unknown): string | undefined {
  if (Array.isArray(data)) {
    const first = data[0];
    if (typeof first === 'object' && first !== null && 'url' in first) {
      const url = (first as { url: unknown }).url;
      return typeof url === 'string' ? url : undefined;
    }
    if (typeof first === 'string') {
      return first;
    }
  } else if (typeof data === 'object' && data !== null && 'url' in data) {
    const url = (data as { url: unknown }).url;
    return typeof url === 'string' ? url : undefined;
  } else if (typeof data === 'string') {
    return data;
  }
  return undefined;
}

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

      // Create AbortController for request cancellation
      const abortController = new AbortController();

      // If no request is in-flight, create one and store it in the map.
      // This ensures that even if multiple requests arrive concurrently,
      // only one will create the promise.
      const originalPromise = extractMetadataInternal(url, cacheKey, securityOptions, abortController.signal);

      let timedOut = false;

      // Add timeout protection to prevent stuck promises from blocking the map indefinitely
      let timeoutId: NodeJS.Timeout;
      const timeoutPromise = new Promise<ExtractedMetadata>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true; // Mark that timeout has occurred
          // Cancel the ongoing request to prevent resource waste
          abortController.abort();
          reject(new PreviewGeneratorError(
            ErrorType.FETCH_ERROR,
            `In-flight request timeout after ${INFLIGHT_REQUEST_TIMEOUT}ms for URL: ${url}`
          ));
        }, INFLIGHT_REQUEST_TIMEOUT);
      });
      
      // Prevent unhandled rejection if timeout occurs before original promise settles
      originalPromise.catch((error) => {
        // Only log the warning if the timeout has already happened.
        // Otherwise, the main promise race will handle the rejection.
        if (timedOut) {
          logger.warn('Original metadata promise rejected after timeout', {
            operation: 'metadata-extraction',
            url,
            error: error instanceof Error ? error : String(error),
          });
        }
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
          logger.warn('Error during in-flight request cleanup', {
            operation: 'metadata-extraction',
            url,
            error: cleanupError instanceof Error ? cleanupError : String(cleanupError),
          });
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
  securityOptions?: SecurityOptions,
  abortSignal?: AbortSignal
): Promise<ExtractedMetadata> {
  // Validate URL with SSRF protection and security options
  const validatedUrl = await validateUrl(url, securityOptions);

  // Extract Open Graph data
  const ogData = await fetchOpenGraphData(validatedUrl, securityOptions, abortSignal);

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
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, `Invalid URL: ${url}`, error);
  }
}

/**
 * Fetch Open Graph data using open-graph-scraper
 */
async function fetchOpenGraphData(url: string, securityOptions?: SecurityOptions, abortSignal?: AbortSignal): Promise<Record<string, unknown>> {
  try {
    // Create secure axios config with redirect validation and secure agent
    const axiosConfig = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      responseType: 'text' as const, // Ensure we get a string response for HTML parsing
      timeout: securityOptions?.timeout || 8000, // Configurable timeout
      maxRedirects: securityOptions?.maxRedirects ?? 3, // Configurable redirects
      maxContentLength: 1 * 1024 * 1024, // Reduced from 2MB to 1MB for HTML content
      maxBodyLength: 1 * 1024 * 1024, // Ensure body is also limited
      httpAgent: getEnhancedSecureAgentForUrl(url),
      httpsAgent: getEnhancedSecureAgentForUrl(url),
      signal: abortSignal, // Add abort signal for request cancellation
      beforeRedirect: createRedirectValidator('Redirect'),
    };

    // First, try to fetch HTML content
    const response = await axios.get(url, axiosConfig);

    if (typeof response.data !== 'string') {
      throw new Error('Expected HTML response but received non-string data');
    }

    // Extract OG data from HTML
    const { error, result } = await ogs({ html: response.data, url });

    if (error) {
      throw new Error('Failed to parse Open Graph data');
    }

    return result;
  } catch (primaryError) {
    // Log first attempt failure for debugging
    logger.warn('Primary metadata fetch failed, attempting fallback', {
      operation: 'metadata-extraction',
      url,
      error: primaryError instanceof Error ? primaryError.message : String(primaryError),
    });

    // Fallback: Re-fetch HTML with full security protections (secure agent, redirect validation)
    // and parse with ogs({ html }) to avoid ogs making its own unprotected HTTP request
    try {
      const fallbackResponse = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
        responseType: 'text' as const,
        timeout: securityOptions?.timeout || 8000,
        maxRedirects: securityOptions?.maxRedirects ?? 3,
        maxContentLength: 1 * 1024 * 1024,
        maxBodyLength: 1 * 1024 * 1024,
        httpAgent: getEnhancedSecureAgentForUrl(url),
        httpsAgent: getEnhancedSecureAgentForUrl(url),
        signal: abortSignal,
        beforeRedirect: createRedirectValidator('Fallback redirect'),
      });

      if (typeof fallbackResponse.data !== 'string') {
        throw new Error('Expected HTML response but received non-string data');
      }

      const { error: ogError, result } = await ogs({ html: fallbackResponse.data, url });

      if (ogError) {
        throw new Error('Failed to parse Open Graph data from fallback');
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
  let image = extractImageUrlFromData(ogData.ogImage) ?? extractImageUrlFromData(ogData.twitterImage);

  // Ensure image URL is absolute
  if (image && !image.startsWith('http')) {
    try {
      image = new URL(image, url).toString();
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
 * @param abortSignal - Optional abort signal for request cancellation
 * @returns Image buffer
 */
export async function fetchImage(imageUrl: string, securityOptions?: SecurityOptions, abortSignal?: AbortSignal): Promise<Buffer> {
  try {
    // Validate URL with SSRF protection before fetching
    const validatedUrl = await validateUrl(imageUrl, securityOptions);

    // Check SVG allowance
    const allowedMimeTypes = securityOptions?.allowSvg
      ? new Set([...BASE_ALLOWED_MIME_TYPES, 'image/svg+xml'])
      : BASE_ALLOWED_MIME_TYPES;

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
      signal: abortSignal, // Add abort signal for request cancellation
      beforeRedirect: createRedirectValidator('Image redirect'),
    });

    // Check content-type header if available (extract base MIME type, ignoring charset etc.)
    const rawContentType = response.headers?.['content-type']?.toLowerCase();
    const contentType = rawContentType?.split(';')[0]?.trim();
    if (contentType && !allowedMimeTypes.has(contentType)) {
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
