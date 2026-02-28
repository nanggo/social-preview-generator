# 📸 Social Preview Generator

> Generate beautiful social media preview images from any URL

[![npm version](https://img.shields.io/npm/v/@nanggo/social-preview.svg)](https://www.npmjs.com/package/@nanggo/social-preview)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/nanggo/social-preview-generator/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/nanggo/social-preview-generator/actions/workflows/npm-publish.yml)

## ✨ Features

- 🔍 **Automatic Metadata Extraction** - Extracts Open Graph and Twitter Card metadata from any URL
- 🎨 **Beautiful Templates** - Modern, customizable templates for stunning previews
- 🖼️ **Smart Image Processing** - Automatically processes and optimizes images
- 🔄 **Intelligent Fallbacks** - Generates attractive previews even when metadata is missing
- ⚡ **High Performance** - Built with Sharp for blazing-fast image processing
- 🎯 **TypeScript Support** - Full TypeScript support with comprehensive type definitions
- 🌏 **Korean Language Support** - Optimized for Korean text rendering

## 📦 Installation

```bash
npm install @nanggo/social-preview
```

## 🚀 Quick Start

```javascript
const { generatePreview } = require('@nanggo/social-preview');

// Simple usage
const imageBuffer = await generatePreview('https://github.com');

// Save to file
const fs = require('fs').promises;
await fs.writeFile('preview.jpg', imageBuffer);
```

## 📖 API

### `generatePreview(url, options?)`

Generates a social preview image from a URL.

#### Parameters

- `url` (string): The URL to generate a preview for
- `options` (PreviewOptions): Optional configuration

#### Returns

- `Promise<Buffer>`: Image buffer in JPEG format

### Options

```typescript
interface PreviewOptions {
  template?: 'modern' | 'classic' | 'minimal';  // Template to use (default: 'modern')
  width?: number;                                // Image width (default: 1200)
  height?: number;                               // Image height (default: 630)
  quality?: number;                              // JPEG quality 1-100 (default: 90)
  cache?: boolean;                               // Cache generated results in memory (default: false)
  fallback?: {
    strategy?: 'auto' | 'custom' | 'generate';   // Fallback strategy
    image?: string;                               // Custom fallback image path
    text?: string;                                // Custom fallback text
  };
  colors?: {
    background?: string;                          // Background color
    text?: string;                                // Text color
    accent?: string;                              // Accent color
  };
}
```

## 💡 Examples

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
    text: '#ffffff'
  },
  quality: 95
});
```

### With Fallback

```javascript
const buffer = await generatePreview('https://example.com', {
  fallback: {
    strategy: 'generate',
    text: 'My Custom Preview'
  }
});
```

## 🎨 Templates

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

## 🏗️ Architecture

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

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Sharp](https://sharp.pixelplumbing.com/) - High performance image processing
- [Open Graph Scraper](https://github.com/jshemas/openGraphScraper) - Metadata extraction
- [Axios](https://axios-http.com/) - HTTP client

## 🔗 Links

- [npm Package](https://www.npmjs.com/package/@nanggo/social-preview)
- [GitHub Repository](https://github.com/nanggo/social-preview-generator)
- [Report Issues](https://github.com/nanggo/social-preview-generator/issues)

---

Made with ❤️ by [nanggo](https://github.com/nanggo)
