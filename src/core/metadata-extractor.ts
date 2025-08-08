/**
 * Metadata Extractor Module
 * Extracts Open Graph and Twitter Card metadata from URLs
 */

import ogs from 'open-graph-scraper';
import axios from 'axios';
import { ExtractedMetadata, ErrorType, PreviewGeneratorError } from '../types';

/**
 * Extract metadata from a given URL
 * @param url - The URL to extract metadata from
 * @returns Extracted metadata object
 */
export async function extractMetadata(url: string): Promise<ExtractedMetadata> {
  try {
    // Validate URL
    const validatedUrl = validateUrl(url);
    
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
 * Validate and normalize URL
 */
function validateUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    
    // Ensure protocol is http or https
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Invalid protocol. Only HTTP and HTTPS are supported.');
    }
    
    return urlObj.toString();
  } catch (error) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Invalid URL: ${url}`,
      error
    );
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
        'Accept': 'text/html,application/xhtml+xml',
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
  } catch (error) {
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
    ogData.ogTitle || 
    ogData.twitterTitle || 
    ogData.dcTitle ||
    ogData.title ||
    urlObj.hostname;
  
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
  const author = 
    ogData.author || 
    ogData.dcCreator ||
    ogData.twitterCreator ||
    ogData.articleAuthor;
  
  // Extract published date
  const publishedDate = 
    ogData.ogArticlePublishedTime ||
    ogData.articlePublishedTime ||
    ogData.dcDate ||
    ogData.publishedTime;
  
  // Extract locale
  const locale = 
    ogData.ogLocale || 
    ogData.inLanguage ||
    'en_US';
  
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
 * Fetch image from URL and return as buffer
 * @param imageUrl - URL of the image to fetch
 * @returns Image buffer
 */
export async function fetchImage(imageUrl: string): Promise<Buffer> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
      },
      timeout: 15000,
      maxRedirects: 5,
    });
    
    return Buffer.from(response.data);
  } catch (error) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Failed to fetch image from ${imageUrl}`,
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