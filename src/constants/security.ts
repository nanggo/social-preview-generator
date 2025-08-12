/**
 * Centralized Security Constants - Phase 1.5 Advanced Security
 * All security-related limits and configurations in one place
 */

// =============================================================================
// NETWORK SECURITY CONSTANTS
// =============================================================================

/** Private IP ranges to block for SSRF protection */
export const BLOCKED_IP_RANGES = [
  // IPv4 Private ranges
  { start: '0.0.0.0', end: '0.255.255.255', description: 'Current network' },
  { start: '10.0.0.0', end: '10.255.255.255', description: 'Private Class A' },
  { start: '127.0.0.0', end: '127.255.255.255', description: 'Loopback' },
  { start: '169.254.0.0', end: '169.254.255.255', description: 'Link-local' },
  { start: '172.16.0.0', end: '172.31.255.255', description: 'Private Class B' },
  { start: '192.0.0.0', end: '192.0.0.255', description: 'IETF Protocol Assignments' },
  { start: '192.0.2.0', end: '192.0.2.255', description: 'TEST-NET-1' },
  { start: '192.88.99.0', end: '192.88.99.255', description: '6to4 Relay' },
  { start: '192.168.0.0', end: '192.168.255.255', description: 'Private Class C' },
  { start: '198.18.0.0', end: '198.19.255.255', description: 'Network Testing' },
  { start: '198.51.100.0', end: '198.51.100.255', description: 'TEST-NET-2' },
  { start: '203.0.113.0', end: '203.0.113.255', description: 'TEST-NET-3' },
  { start: '224.0.0.0', end: '255.255.255.255', description: 'Multicast/Reserved' },
  
  // Carrier-Grade NAT (RFC 6598)
  { start: '100.64.0.0', end: '100.127.255.255', description: 'Carrier-Grade NAT' },
] as const;

/** Blocked IPv6 ranges */
export const BLOCKED_IPV6_RANGES = [
  '::1/128',        // Loopback
  '::/128',         // Unspecified
  'fc00::/7',       // Unique Local
  'fe80::/10',      // Link-local
  'ff00::/8',       // Multicast
] as const;

/** Allowed protocols for URLs */
export const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

/** Blocked protocols (security threats) */
export const BLOCKED_PROTOCOLS = [
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'ftp:',
  'blob:',
  'about:',
] as const;

// =============================================================================
// IMAGE PROCESSING SECURITY CONSTANTS
// =============================================================================

/** Maximum allowed pixels for image processing (64 megapixels) */
export const MAX_INPUT_PIXELS = 64 * 1024 * 1024;

/** Maximum image dimensions */
export const MAX_IMAGE_WIDTH = 8192;
export const MAX_IMAGE_HEIGHT = 8192;

/** Maximum file size (15MB) */
export const MAX_FILE_SIZE = 15 * 1024 * 1024;

/** Maximum SVG content size (1MB) */
export const MAX_SVG_SIZE = 1 * 1024 * 1024;

/** Sharp processing timeout (30 seconds) */
export const PROCESSING_TIMEOUT = 30_000;

/** Allowed image formats (whitelist approach) */
export const ALLOWED_IMAGE_FORMATS = new Set([
  'jpeg', 'jpg', 'png', 'webp', 'gif', 'bmp', 'tiff'
] as const);

/** Maximum DPI to prevent memory exhaustion */
export const MAX_DPI = 600;

// =============================================================================
// TEXT VALIDATION SECURITY CONSTANTS  
// =============================================================================

/** Maximum text content length */
export const MAX_TEXT_LENGTH = 10_000;

/** Maximum color value length */
export const MAX_COLOR_LENGTH = 100;

/** Maximum URL length */
export const MAX_URL_LENGTH = 2048;

/** Dangerous HTML/Script patterns to block */
export const DANGEROUS_HTML_PATTERNS = [
  // Script injection
  /<script/gi,
  /<\/script>/gi,
  /javascript:/gi,
  /vbscript:/gi,
  
  // HTML injection
  /<iframe/gi,
  /<object/gi,
  /<embed/gi,
  /<applet/gi,
  /<meta/gi,
  /<link/gi,
  /<style/gi,
  
  // Event handlers
  /on\w+\s*=/gi,
  
  // Expression patterns
  /expression\(/gi,
  /eval\(/gi,
  /function\s*\(/gi,
  
  // URL encoded patterns
  /%3Cscript/gi,
  /javascript%3A/gi,
] as const;

/** Dangerous CSS patterns to block */
export const DANGEROUS_CSS_PATTERNS = [
  /[<>]/g,           // HTML tags
  /javascript:/gi,   // JavaScript protocol
  /expression\(/gi,  // CSS expressions (IE)
  /data:/gi,         // Data URIs
  /url\(/gi,         // URL functions
  /import/gi,        // CSS imports
  /@/g,              // CSS at-rules
  /\/\*/g,           // CSS comments
  /\*\//g,           // CSS comment ends
  /;/g,              // CSS statement terminators
  /\}/g,             // CSS block terminators
  /\{/g,             // CSS block starters
  /\\/g,             // Escape sequences
] as const;

/** Suspicious keyword patterns */
export const SUSPICIOUS_PATTERNS = [
  /script/gi,
  /eval/gi,
  /function/gi,
  /return/gi,
  /alert/gi,
  /prompt/gi,
  /confirm/gi,
  /document/gi,
  /window/gi,
  /console/gi,
  /xhr/gi,
  /fetch/gi,
] as const;

// =============================================================================
// UNICODE SECURITY CONSTANTS
// =============================================================================

/** ASCII control characters to remove (except \t, \n, \r) */
// eslint-disable-next-line no-control-regex
export const ASCII_CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Extended ASCII control characters */
export const EXTENDED_ASCII_CONTROL_CHARS = /[\x80-\x9f]/g;

/** Unicode Bidirectional Text Control Characters (Bidi attack prevention) */
export const BIDI_CONTROL_CHARS = {
  RIGHT_TO_LEFT_OVERRIDE: /\u202E/g,
  LEFT_TO_RIGHT_OVERRIDE: /\u202D/g,
  LEFT_TO_RIGHT_MARK: /\u200E/g,
  RIGHT_TO_LEFT_MARK: /\u200F/g,
  ARABIC_LETTER_MARK: /\u061C/g,
  LEFT_TO_RIGHT_ISOLATE: /\u2066/g,
  RIGHT_TO_LEFT_ISOLATE: /\u2067/g,
  FIRST_STRONG_ISOLATE: /\u2068/g,
  POP_DIRECTIONAL_ISOLATE: /\u2069/g,
} as const;

/** Zero-width and formatting characters */
export const ZERO_WIDTH_CHARS = {
  ZERO_WIDTH_SPACE: /\u200B/g,
  ZERO_WIDTH_NON_JOINER: /\u200C/g,
  ZERO_WIDTH_JOINER: /\u200D/g,
  ZERO_WIDTH_NO_BREAK_SPACE: /\uFEFF/g,
  SOFT_HYPHEN: /\u00AD/g,
  COMBINING_GRAPHEME_JOINER: /\u034F/g,
} as const;

/** Other dangerous Unicode characters */
export const DANGEROUS_UNICODE_CHARS = {
  MONGOLIAN_VOWEL_SEPARATOR: /\u180E/g,
  LINE_SEPARATOR: /\u2028/g,
  PARAGRAPH_SEPARATOR: /\u2029/g,
  VARIATION_SELECTORS: /[\uFE00-\uFE0F]/g,
} as const;

// =============================================================================
// SVG SECURITY CONSTANTS
// =============================================================================

/** SVG tags allowed for security (whitelist) */
export const ALLOWED_SVG_TAGS = [
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc',
] as const;

/** SVG tags forbidden for security (blacklist) */
export const FORBIDDEN_SVG_TAGS = [
  'script', 'object', 'embed', 'iframe', 'frame', 'frameset',
  'link', 'meta', 'base', 'form', 'input', 'button', 'select',
  'textarea', 'video', 'audio', 'source', 'track', 'canvas',
  'applet', 'param', 'foreignObject',
  
  // Animation and interaction tags
  'animate', 'animateTransform', 'animateMotion', 'set',
  
  // External reference tags
  'use', 'image', 'textPath', 'marker', 'symbol',
  
  // CSS injection vectors
  'style',
] as const;

/** SVG attributes allowed for security (whitelist) */
export const ALLOWED_SVG_ATTRIBUTES = [
  // Basic identification (safe)
  'id', 'class',
  
  // Geometric positioning and sizing (safe)
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'd', 'points',
  
  // Safe styling attributes
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'fill-opacity', 'stroke-opacity', 'opacity', 'visibility', 'display',
  
  // Transform (geometric only, no external refs)
  'transform',
  
  // SVG viewport (safe)
  'viewBox', 'preserveAspectRatio',
  
  // Namespace declarations (required for valid SVG)
  'xmlns',
  
  // Gradient-specific safe attributes
  'gradientUnits', 'gradientTransform', 'spreadMethod',
  'stop-color', 'stop-opacity', 'offset',
  
  // Text positioning and styling (safe)
  'text-anchor', 'dominant-baseline', 'font-family', 'font-size',
  'font-weight', 'font-style', 'text-decoration', 'letter-spacing',
  'word-spacing', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust',
] as const;

/** SVG attributes forbidden for security (blacklist) */
export const FORBIDDEN_SVG_ATTRIBUTES = [
  // CSS injection vectors
  'style',
  
  // External resource loading
  'href', 'xlink:href', 'src', 'data', 'action',
  
  // External namespace declarations
  'xmlns:xlink',
  
  // Dangerous reference attributes
  'clip-path', 'mask', 'filter',
] as const;

/** Allowed SVG URI pattern (only fragment identifiers) */
export const ALLOWED_SVG_URI_PATTERN = /^#/;

/** Allowed SVG namespaces */
export const ALLOWED_SVG_NAMESPACES = ['http://www.w3.org/2000/svg'] as const;

// =============================================================================
// SHARP SECURITY CONSTANTS
// =============================================================================

/** Sharp memory cache settings */
export const SHARP_CACHE_CONFIG = {
  memory: 150,  // 150MB memory cache
  files: 30,    // 30 files cache
  items: 300,   // 300 operations cache
} as const;

/** Sharp security configuration */
export const SHARP_SECURITY_CONFIG = {
  limitInputPixels: MAX_INPUT_PIXELS,
  sequentialRead: true,
  density: 300,
  failOnError: true,  // Security: fail fast on corrupted/malicious images
  stripMetadata: true,
} as const;

// =============================================================================
// URL VALIDATION CONSTANTS
// =============================================================================

/** Suspicious URL query parameters */
export const SUSPICIOUS_URL_PARAMS = [
  'callback',
  'jsonp',
  'eval',
  'script',
] as const;

// =============================================================================
// NETWORK/CONNECTION SECURITY CONSTANTS
// =============================================================================

/** HTTP/HTTPS connection timeouts */
export const HTTP_TIMEOUT = 30_000; // 30 seconds

/** Maximum concurrent connections per agent */
export const MAX_CONCURRENT_CONNECTIONS = 50;

/** DNS cache TTL in milliseconds */
export const DNS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Maximum DNS cache size */
export const MAX_DNS_CACHE_SIZE = 1000;

/** Security configuration object */
export const SECURITY_CONFIG = {
  HTTP_TIMEOUT,
  MAX_CONCURRENT_CONNECTIONS,
  DNS_CACHE_TTL,
  MAX_DNS_CACHE_SIZE,
  PROCESSING_TIMEOUT,
  MAX_INPUT_PIXELS,
} as const;

// =============================================================================
// VALIDATION LIMITS
// =============================================================================

/** Dimension validation limits */
export const DIMENSION_LIMITS = {
  MIN_WIDTH: 100,
  MIN_HEIGHT: 100,
  MAX_WIDTH: 4096,
  MAX_HEIGHT: 4096,
} as const;

/** Quality validation limits */
export const QUALITY_LIMITS = {
  MIN: 1,
  MAX: 100,
} as const;

/** Template validation */
export const ALLOWED_TEMPLATES = ['modern', 'classic', 'minimal', 'custom'] as const;

// =============================================================================
// SECURITY EXPORT
// =============================================================================

/** Combined security limits for easy access */
export const SECURITY_LIMITS = {
  // Network
  MAX_URL_LENGTH,
  ALLOWED_PROTOCOLS,
  BLOCKED_PROTOCOLS,
  
  // Images
  MAX_INPUT_PIXELS,
  MAX_IMAGE_WIDTH,
  MAX_IMAGE_HEIGHT,
  MAX_FILE_SIZE,
  MAX_SVG_SIZE,
  MAX_DPI,
  PROCESSING_TIMEOUT,
  ALLOWED_IMAGE_FORMATS: Array.from(ALLOWED_IMAGE_FORMATS),
  
  // Text
  MAX_TEXT_LENGTH,
  MAX_COLOR_LENGTH,
  
  // Templates
  ALLOWED_TEMPLATES: [...ALLOWED_TEMPLATES],
  
  // Dimensions
  ...DIMENSION_LIMITS,
  
  // Quality
  ...QUALITY_LIMITS,
} as const;

export type SecurityLimits = typeof SECURITY_LIMITS;