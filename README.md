# Social Preview Generator

**English** | [한국어](https://github.com/nanggo/social-preview-generator/blob/master/docs/README.ko.md)

Turn a public HTTP(S) URL into a secure, consistent social preview JPEG—no JSX or Next.js route
required.

`generatePreview(url)` fetches Open Graph and Twitter Card metadata, blocks private and reserved
network targets, applies a built-in template, and returns a JPEG `Buffer`.

[![npm version](https://img.shields.io/npm/v/@nanggo/social-preview.svg)](https://www.npmjs.com/package/@nanggo/social-preview)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/nanggo/social-preview-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/nanggo/social-preview-generator/actions/workflows/ci.yml)

## Highlights

- Convert a public URL to a JPEG `Buffer` in one call
- Extract Open Graph and Twitter Card metadata automatically
- Guard outbound fetches against private, loopback, reserved, and mixed-DNS targets
- Run in server-side Node.js without React, JSX, a browser, or an image API route
- Render supplied metadata directly when a URL fetch is unnecessary
- Choose from `modern`, `classic`, `minimal`, and `article` templates
- Use CommonJS, ESM, or TypeScript
- Render Korean text with server-side font fallbacks

## When this package fits

| Good fit                                                                                      | Consider another tool when                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Link directories, bookmark services, curation tools, and other products that start with a URL | You already have all data and want free-form React/JSX design |
| CMS, static-site, or batch jobs that write preview files ahead of time                        | You need a browser or Edge runtime                            |
| Node.js services that accept public URLs and need guarded network defaults                    | You need JavaScript-rendered pages from a headless browser    |
| Workflows that need a `Buffer` or file instead of an HTTP image response                      | You want to build and maintain a custom image route           |

## Requirements

- Node.js 22.13+ on the 22.x line, or Node.js 24+
- A server-side Node.js runtime; this package depends on Sharp and is not a browser library

## Installation

```bash
npm install @nanggo/social-preview
```

## URL to JPEG in one call

```javascript
const { writeFile } = require('node:fs/promises');
const { generatePreview } = require('@nanggo/social-preview');

async function main() {
  const image = await generatePreview('https://github.com');
  await writeFile('preview.jpg', image);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

ESM named imports are also supported:

```javascript
import { generatePreview } from '@nanggo/social-preview';
```

## Secondary: render known metadata

Use `generatePreviewFromMetadata` when your publishing or build pipeline already knows the title,
canonical URL, description, and optional image.

```javascript
const { mkdir, writeFile } = require('node:fs/promises');
const { generatePreviewFromMetadata } = require('@nanggo/social-preview');

async function main() {
  const image = await generatePreviewFromMetadata(
    {
      title: 'How to Generate Open Graph Images',
      description: 'Create a social preview while publishing a blog post.',
      siteName: 'My Blog',
      url: 'https://example.com/posts/open-graph-images',
      image: 'https://example.com/images/open-graph-cover.jpg',
    },
    {
      template: 'modern',
      colors: { accent: '#2563EB' },
    }
  );

  await mkdir('public/og', { recursive: true });
  await writeFile('public/og/open-graph-images.jpg', image);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

The page URL is not fetched in this mode. A remote `image` can still be fetched when the selected
template uses it.

## Templates

| Template  | Best for                           | Notes                                                     |
| --------- | ---------------------------------- | --------------------------------------------------------- |
| `modern`  | Products and general-purpose cards | Centered content with a contemporary overlay              |
| `classic` | News and blog links                | Traditional image-and-text card                           |
| `minimal` | Documentation and text-led pages   | Restrained, text-focused layout                           |
| `article` | Articles and editorial content     | Optional mobile summary; does not use remote cover images |

The `article` template enables its mobile summary when a description exists. Set
`mobilePreview: false` for a text-only article card.

## API

| Export                                                       | Returns                     | Purpose                                                             |
| ------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------- |
| `generatePreview(url, options?)`                             | `Promise<Buffer>`           | Fetch metadata from a URL and return a JPEG                         |
| `generatePreviewFromMetadata(metadata, options?)`            | `Promise<Buffer>`           | Render caller-provided metadata                                     |
| `generatePreviewWithDetails(url, options?)`                  | `Promise<GeneratedPreview>` | URL rendering with metadata, dimensions, template, and cache status |
| `generatePreviewFromMetadataWithDetails(metadata, options?)` | `Promise<GeneratedPreview>` | Metadata rendering with full result details                         |
| `generateImageWithTemplate(metadata, template, options)`     | `Promise<Buffer>`           | Render with a caller-provided `TemplateConfig`                      |

`PreviewMetadataInput` requires `title` and `url`. Optional fields include `description`,
`image`, `siteName`, `favicon`, `author`, `publishedDate`, `domain`, and `locale`.

All current generation methods return JPEG data. `GeneratedPreview.format` is always `'jpeg'` at
runtime; the wider exported TypeScript union is retained for compatibility.

Detailed methods return:

```typescript
interface GeneratedPreview {
  buffer: Buffer;
  format: 'png' | 'jpeg' | 'webp'; // currently always 'jpeg'
  dimensions: { width: number; height: number };
  metadata: ExtractedMetadata;
  template: string;
  cached: boolean;
}
```

### Custom templates

A custom template can use the package's default text overlay:

```javascript
const { writeFile } = require('node:fs/promises');
const { generateImageWithTemplate } = require('@nanggo/social-preview');

async function main() {
  const image = await generateImageWithTemplate(
    {
      title: 'A custom social card',
      description: 'Rendered with caller-provided layout and typography.',
      url: 'https://example.com/custom-card',
    },
    {
      name: 'brand-card',
      layout: { padding: 64, imagePosition: 'none' },
      typography: {
        title: { fontSize: 64, fontWeight: '700', lineHeight: 1.1, maxLines: 2 },
        description: { fontSize: 28, lineHeight: 1.3, maxLines: 2 },
      },
    },
    {
      width: 1200,
      height: 630,
      colors: {
        background: '#0F172A',
        accent: '#2563EB',
        text: '#FFFFFF',
      },
    }
  );

  await writeFile('custom-preview.jpg', image);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

A custom `overlayGenerator` is trusted, synchronous caller code. Do not populate it from
untrusted JSON. Its SVG result must be a string no larger than 1 MiB in UTF-8 bytes.

### Advanced utilities

| Export                           | Purpose                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| `getInflightRequestStats()`      | Inspect request coalescing without exposing URLs               |
| `clearInflightRequests()`        | Clear request coalescing state; pending work may be duplicated |
| `startCacheCleanup(intervalMs?)` | Start metadata and preview cache cleanup                       |
| `stopCacheCleanup()`             | Stop the cleanup interval                                      |
| `isCacheCleanupRunning()`        | Check cleanup state                                            |
| `getCacheStats()`                | Inspect internal Sharp cache statistics                        |
| `clearAllCaches()`               | Clear internal Sharp caches                                    |
| `shutdownSharpCaches()`          | Stop and clear internal Sharp caches                           |

## Common options

```typescript
interface PreviewOptions {
  template?: 'modern' | 'classic' | 'minimal' | 'article'; // default: 'modern'
  mobilePreview?: boolean; // article only; defaults to true when description exists
  width?: number; // 100-4096, default: 1200
  height?: number; // 100-4096, default: 630
  quality?: number; // integer 1-100, default: 90
  cache?: boolean; // default: false
  fallback?: {
    strategy?: 'auto' | 'generate';
    text?: string;
  };
  colors?: {
    primary?: string;
    secondary?: string;
    background?: string;
    text?: string;
    accent?: string;
    overlay?: string;
  };
  security?: {
    httpsOnly?: boolean; // reject HTTP URLs; default: false
    allowSvg?: boolean; // permit sanitized remote SVG images; default: false
    maxRedirects?: number; // integer 0-10, default: 3
    timeout?: number; // total request deadline in milliseconds, 1-30000
  };
}
```

The exported TypeScript definitions are the source of truth for the full option and template
shapes.

## Errors

Validation, fetching, metadata, rendering, templates, and cache failures use
`PreviewGeneratorError` with an `ErrorType`.

```javascript
const { ErrorType, PreviewGeneratorError, generatePreview } = require('@nanggo/social-preview');

async function main() {
  try {
    await generatePreview('https://example.com');
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      console.error(error.type, error.message);
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Security and resource limits

- Only HTTP(S) URLs are accepted. Leading and trailing whitespace is removed, URL credentials are
  rejected, fragments are ignored, and C0/C1 control characters are blocked. Both the trimmed input
  and canonical URL are limited to 2,048 characters.
- Private, loopback, link-local, and other reserved IP destinations are blocked before a socket is
  created. Hostnames with private or mixed public/private DNS results are also rejected.
- HTTPS-to-HTTP redirects are rejected when `security.httpsOnly` is enabled.
- Remote SVG images are disabled by default and sanitized when explicitly enabled.
- Metadata text fields are limited to 10,000 characters. Template numeric fields, CSS font weights,
  and gradient size are validated before Sharp work begins.
- Generated SVGs are limited to 1 MiB each and 16 MiB total retained SVG-cache bytes.
- Generated previews larger than 16 MiB render normally but are not cached. The preview cache
  retains at most 64 MiB of image buffers.
- `getInflightRequestStats().keys` contains non-reversible, process-local request IDs rather than
  URLs. IDs change after a process restart.

These controls reduce risk but do not replace application-level authentication, authorization,
rate limiting, or workload isolation when arbitrary users can request renders.

## Contributing

Contributions are welcome. Fork the repository, create a focused branch, run the relevant checks,
and open a pull request.

## License

MIT — see [LICENSE](LICENSE).
