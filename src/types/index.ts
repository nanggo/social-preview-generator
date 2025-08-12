/**
 * Type definitions for Social Preview Generator
 */

/**
 * Main options for generating preview images
 */
export interface PreviewOptions {
  /** Template to use for generating the preview */
  template?: TemplateType;
  /** Width of the generated image in pixels */
  width?: number;
  /** Height of the generated image in pixels */
  height?: number;
  /** Fallback options when metadata is missing */
  fallback?: FallbackOptions;
  /** Enable/disable caching */
  cache?: boolean;
  /** Image quality (1-100) */
  quality?: number;
  /** Custom font configurations */
  fonts?: FontConfig[];
  /** Custom colors for the template */
  colors?: ColorConfig;
  /** Security options */
  security?: SecurityOptions;
}

/**
 * Security configuration options
 */
export interface SecurityOptions {
  /** Force HTTPS-only requests (reject HTTP URLs) */
  httpsOnly?: boolean;
  /** Allow SVG images (disabled by default for security) */
  allowSvg?: boolean;
  /** Maximum allowed redirects (default: 3) */
  maxRedirects?: number;
  /** Request timeout in milliseconds (default: 8000 for HTML, 12000 for images) */
  timeout?: number;
}

/**
 * Available template types
 */
export type TemplateType = 'modern' | 'classic' | 'minimal' | 'custom';

/**
 * Fallback options for handling missing metadata
 */
export interface FallbackOptions {
  /** Strategy for handling missing data */
  strategy?: 'auto' | 'custom' | 'generate';
  /** Path to custom fallback image */
  image?: string;
  /** Category for auto-selecting fallback images */
  category?: 'tech' | 'business' | 'lifestyle' | 'news' | 'general';
  /** Custom text to use when generating fallback */
  text?: string;
  /** Background color for generated fallback */
  backgroundColor?: string;
}

/**
 * Metadata extracted from URL
 */
export interface ExtractedMetadata {
  /** Page title */
  title: string;
  /** Page description */
  description?: string;
  /** OG image URL */
  image?: string;
  /** Website name */
  siteName?: string;
  /** Favicon URL */
  favicon?: string;
  /** Author name */
  author?: string;
  /** Published date */
  publishedDate?: string;
  /** URL of the page */
  url: string;
  /** Domain of the website */
  domain?: string;
  /** Language of the content */
  locale?: string;
}

/**
 * Font configuration
 */
export interface FontConfig {
  /** Font family name */
  family: string;
  /** Path to font file */
  path?: string;
  /** Font weight */
  weight?:
    | 'normal'
    | 'bold'
    | '100'
    | '200'
    | '300'
    | '400'
    | '500'
    | '600'
    | '700'
    | '800'
    | '900';
  /** Font style */
  style?: 'normal' | 'italic';
}

/**
 * Color configuration for templates
 */
export interface ColorConfig {
  /** Primary color */
  primary?: string;
  /** Secondary color */
  secondary?: string;
  /** Background color */
  background?: string;
  /** Text color */
  text?: string;
  /** Accent color */
  accent?: string;
  /** Overlay color with opacity */
  overlay?: string;
}

/**
 * Template configuration
 */
export interface TemplateConfig {
  /** Template name */
  name: string;
  /** Layout configuration */
  layout: LayoutConfig;
  /** Typography settings */
  typography: TypographyConfig;
  /** Effects and styling */
  effects?: EffectsConfig;
  /** Image processing configuration */
  imageProcessing?: {
    /** Brightness adjustment for background images (0.0 - 1.0, where 1.0 is original) */
    brightness?: number;
    /** Blur radius for background images */
    blur?: number;
    /** Contrast adjustment for background images (0.0 - 2.0, where 1.0 is original) */
    contrast?: number;
    /** Saturation adjustment for background images (0.0 - 2.0, where 1.0 is original) */
    saturation?: number;
    /** Whether template requires transparent canvas when no image available */
    requiresTransparentCanvas?: boolean;
  };
  /** Custom overlay generator function */
  overlayGenerator?: (
    metadata: ExtractedMetadata,
    width: number,
    height: number,
    options: PreviewOptions,
    template?: TemplateConfig
  ) => string;
}

/**
 * Layout configuration for templates
 */
export interface LayoutConfig {
  /** Padding around content */
  padding: number;
  /** Title position */
  titlePosition?: 'top' | 'center' | 'bottom' | 'left' | 'right';
  /** Description position */
  descriptionPosition?: 'below-title' | 'bottom' | 'none';
  /** Image position */
  imagePosition?: 'background' | 'left' | 'right' | 'top' | 'none';
  /** Logo/favicon position */
  logoPosition?:
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right'
    | 'bottom-center'
    | 'none';
}

/**
 * Typography configuration
 */
export interface TypographyConfig {
  /** Title font settings */
  title: {
    fontSize: number;
    fontWeight?: string;
    lineHeight?: number;
    maxLines?: number;
  };
  /** Description font settings */
  description?: {
    fontSize: number;
    fontWeight?: string;
    lineHeight?: number;
    maxLines?: number;
  };
  /** Site name font settings */
  siteName?: {
    fontSize: number;
    fontWeight?: string;
  };
}

/**
 * Visual effects configuration
 */
export interface EffectsConfig {
  /** Gradient overlay */
  gradient?: {
    type: 'linear' | 'radial' | 'none';
    colors: string[];
    direction?: string;
    opacity?: number;
  };
  /** Blur effect */
  blur?: {
    radius: number;
    areas?: 'background' | 'overlay' | 'all' | 'none';
  };
  /** Shadow effects */
  shadow?: {
    text?: boolean;
    box?: boolean;
  };
  /** Border radius */
  borderRadius?: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Enable memory cache */
  memory?: boolean;
  /** Enable file system cache */
  filesystem?: boolean;
  /** Cache TTL in seconds */
  ttl?: number;
  /** Maximum cache size in MB */
  maxSize?: number;
  /** Cache directory path */
  directory?: string;
}

/**
 * Image processing options
 */
export interface ImageProcessingOptions {
  /** Resize options */
  resize?: {
    width: number;
    height: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  };
  /** Compression format */
  format?: 'png' | 'jpeg' | 'webp';
  /** Compression quality */
  quality?: number;
  /** Background color for transparent images */
  background?: string;
}

/**
 * Result of preview generation
 */
export interface GeneratedPreview {
  /** Image buffer */
  buffer: Buffer;
  /** Image format */
  format: 'png' | 'jpeg' | 'webp';
  /** Image dimensions */
  dimensions: {
    width: number;
    height: number;
  };
  /** Metadata used for generation */
  metadata: ExtractedMetadata;
  /** Template used */
  template: string;
  /** Whether result was cached */
  cached: boolean;
}

/**
 * Error types
 */
export enum ErrorType {
  /** Failed to fetch URL */
  FETCH_ERROR = 'FETCH_ERROR',
  /** Failed to extract metadata */
  METADATA_ERROR = 'METADATA_ERROR',
  /** Failed to process image */
  IMAGE_ERROR = 'IMAGE_ERROR',
  /** Template not found */
  TEMPLATE_ERROR = 'TEMPLATE_ERROR',
  /** Invalid options provided */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** Cache operation failed */
  CACHE_ERROR = 'CACHE_ERROR',
}

/**
 * Custom error class for preview generation
 */
export class PreviewGeneratorError extends Error {
  type: ErrorType;
  details?: unknown;

  constructor(type: ErrorType, message: string, details?: unknown) {
    super(message);
    this.name = 'PreviewGeneratorError';
    this.type = type;
    this.details = details;
  }
}
