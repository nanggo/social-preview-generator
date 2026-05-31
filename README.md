# Social Preview Generator

Generate Open Graph/social preview images from URLs or known page metadata.

[![npm version](https://img.shields.io/npm/v/@nanggo/social-preview.svg)](https://www.npmjs.com/package/@nanggo/social-preview)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/nanggo/social-preview-generator/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/nanggo/social-preview-generator/actions/workflows/npm-publish.yml)

## Features

- Extract Open Graph and Twitter Card metadata from a URL
- Generate images directly from supplied metadata for static publishing flows
- Render with built-in `modern`, `classic`, and `minimal` templates
- Process and optimize images with Sharp
- Fall back to generated previews when metadata is incomplete
- Ship TypeScript definitions
- Support Korean text rendering

## Installation

```bash
npm install @nanggo/social-preview
```

## Quick Start

```javascript
const { generatePreview } = require('@nanggo/social-preview');

const imageBuffer = await generatePreview('https://github.com');

const fs = require('fs').promises;
await fs.writeFile('preview.jpg', imageBuffer);
```

## API

### `generatePreview(url, options?)`

Generates a social preview image from a URL.

#### Parameters

- `url` (string): The URL to generate a preview for
- `options` (PreviewOptions): Optional configuration

#### Returns

- `Promise<Buffer>`: Image buffer in JPEG format

### `generatePreviewFromMetadata(metadata, options?)`

Generates a social preview image from metadata you already have. It does not fetch or scrape the
page URL, which makes it useful for static blog publishing pipelines where title, description,
canonical URL, and cover image are known at publish/build time.

#### Parameters

- `metadata` (PreviewMetadataInput): Page or post metadata to render
- `options` (PreviewOptions): Optional configuration

#### Returns

- `Promise<Buffer>`: Image buffer in JPEG format

### Options

```typescript
interface PreviewOptions {
  template?: 'modern' | 'classic' | 'minimal'; // Template to use (default: 'modern')
  width?: number; // Image width (default: 1200)
  height?: number; // Image height (default: 630)
  quality?: number; // JPEG quality 1-100 (default: 90)
  cache?: boolean; // Cache generated results in memory (default: false)
  fallback?: {
    strategy?: 'auto' | 'custom' | 'generate'; // Fallback strategy
    image?: string; // Custom fallback image path
    text?: string; // Custom fallback text
  };
  colors?: {
    background?: string; // Background color
    text?: string; // Text color
    accent?: string; // Accent color
  };
}
```

### Static Blog Publishing

Generate the image once while publishing a post, then point `og:image` at the written file.

```javascript
const { generatePreviewFromMetadata } = require('@nanggo/social-preview');
const fs = require('fs').promises;

const buffer = await generatePreviewFromMetadata(
  {
    title: 'How to Generate Open Graph Images',
    description: 'Create a social preview image while publishing a blog post.',
    siteName: 'My Blog',
    url: 'https://example.com/posts/open-graph-images',
    image: 'https://example.com/images/open-graph-cover.jpg',
  },
  {
    template: 'modern',
    width: 1200,
    height: 630,
    quality: 90,
  }
);

await fs.writeFile('public/og/open-graph-images.jpg', buffer);
```

## Examples

### Basic Usage

```javascript
const { generatePreview } = require('@nanggo/social-preview');

async function createPreview() {
  const buffer = await generatePreview('https://www.npmjs.com');
  await fs.writeFile('npm-preview.jpg', buffer);
}
```

### Custom Styling

```javascript
const buffer = await generatePreview('https://example.com', {
  template: 'modern',
  colors: {
    background: '#2c3e50',
    accent: '#3498db',
    text: '#ffffff',
  },
  quality: 95,
});
```

### With Fallback

```javascript
const buffer = await generatePreview('https://example.com', {
  fallback: {
    strategy: 'generate',
    text: 'My Custom Preview',
  },
});
```

## Templates

### Modern (Default)

- Clean, contemporary design
- Gradient overlays
- Centered text layout
- Perfect for tech and modern websites

### Classic

- Traditional card layout
- Image on top, text below
- Great for news and blog sites

### Minimal

- Simple, text-focused design
- Minimal decorations
- Ideal for documentation sites

## Architecture

```
social-preview-generator/
├── src/
│   ├── core/
│   │   ├── metadata-extractor.ts        # URL metadata extraction
│   │   ├── image-generator.ts           # Image generation engine
│   │   ├── overlay-generator.ts         # SVG text overlay generation
│   │   └── template-image-processing.ts # Template-specific image processing
│   ├── templates/
│   │   ├── modern.ts                    # Modern template
│   │   ├── classic.ts                   # Classic template
│   │   ├── minimal.ts                   # Minimal template
│   │   ├── shared.ts                    # Shared layout helpers
│   │   └── registry.ts                  # Template registry
│   ├── utils/                           # Shared utilities & security
│   ├── constants/                       # Security limits & font config
│   ├── types/
│   │   └── index.ts                     # TypeScript definitions
│   └── index.ts                         # Main entry point
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Sharp](https://sharp.pixelplumbing.com/) - High performance image processing
- [Open Graph Scraper](https://github.com/jshemas/openGraphScraper) - Metadata extraction
- [Axios](https://axios-http.com/) - HTTP client

## Links

- [npm Package](https://www.npmjs.com/package/@nanggo/social-preview)
- [GitHub Repository](https://github.com/nanggo/social-preview-generator)
- [Report Issues](https://github.com/nanggo/social-preview-generator/issues)

---

Made by [nanggo](https://github.com/nanggo)
