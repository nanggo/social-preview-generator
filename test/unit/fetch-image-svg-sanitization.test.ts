import { vi } from 'vitest';
import axios from 'axios';
import sharp from 'sharp';
import { fetchImage } from '../../src/core/metadata-extractor';

vi.mock('axios');
vi.mock('../../src/utils/enhanced-secure-agent', () => ({
  getEnhancedSecureAgentForUrl: vi.fn(() => undefined),
  validateRequestSecurity: vi.fn().mockResolvedValue({
    allowed: true,
    blockedIPs: [],
    allowedIPs: [],
  }),
}));

const mockedAxios = vi.mocked(axios);
const imageUrl = 'https://example.com/preview.svg';

async function fetchSvg(svg: string): Promise<Buffer> {
  mockedAxios.get.mockResolvedValueOnce({
    data: Buffer.from(svg),
    headers: { 'content-type': 'image/svg+xml' },
  });

  return fetchImage(imageUrl, { allowSvg: true });
}

describe('fetchImage SVG sanitization boundary', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it('returns cleaned SVG bytes after removing forbidden elements and external references', async () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
        <style>@import url("https://attacker.example/styles.css");</style>
        <foreignObject width="10" height="10">
          <div xmlns="http://www.w3.org/1999/xhtml">untrusted HTML</div>
        </foreignObject>
        <rect id="safe-shape" width="10" height="10" fill="#00f"
          filter="url(https://example.com/f.svg#x)" />
      </svg>
    `;

    const result = (await fetchSvg(svg)).toString('utf8');

    expect(result).toContain('<svg');
    expect(result).toContain('id="safe-shape"');
    expect(result).toContain('fill="#00f"');
    expect(result).not.toMatch(/<style|@import|<foreignObject|untrusted HTML/i);
    expect(result).not.toContain('filter=');
    expect(result).not.toContain('https://example.com/f.svg#x');
  });

  it.each([
    [
      'paint-server URL',
      '<rect width="10" height="10" fill="url(https://example.com/f.svg#x)"/>',
      'fill=',
    ],
    [
      'file URL',
      '<rect width="10" height="10" clip-path="url(file:///etc/passwd)"/>',
      'clip-path=',
    ],
    [
      'protocol-relative URL',
      '<rect width="10" height="10" stroke="url(//attacker.example/stroke.svg#x)"/>',
      'stroke=',
    ],
    ['data URL', '<rect width="10" height="10" fill="data:image/svg+xml,external"/>', 'fill='],
  ])('strips an alternate external %s payload', async (_name, element, attribute) => {
    const result = (
      await fetchSvg(`<svg xmlns="http://www.w3.org/2000/svg">${element}</svg>`)
    ).toString('utf8');

    expect(result).toContain('<rect');
    expect(result).not.toContain(attribute);
    expect(result).not.toMatch(
      /https:\/\/example\.com\/f\.svg#x|file:\/\/\/etc\/passwd|attacker\.example|data:image/
    );
  });

  it('preserves legitimate SVG elements and attributes', async () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">
        <defs>
          <linearGradient id="brand-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#123456"/>
            <stop offset="1" stop-color="#abcdef"/>
          </linearGradient>
        </defs>
        <rect id="background" width="120" height="60"
          fill="url('#brand-gradient')" stroke="black" stroke-width="2"/>
        <text x="10" y="35" font-size="20" fill="red">Safe preview</text>
      </svg>
    `;

    const result = (await fetchSvg(svg)).toString('utf8');

    expect(result).toContain('<linearGradient');
    expect(result).toContain('id="brand-gradient"');
    expect(result).toContain('id="background"');
    expect(result).toContain('Safe preview');
    expect(result).toContain('viewBox="0 0 120 60"');
    expect(result).toContain('fill="url(\'#brand-gradient\')"');
    expect(result).toContain('stroke="black"');
    expect(result).toContain('fill="red"');

    const renderedMetadata = await sharp(Buffer.from(result)).metadata();
    expect(renderedMetadata.format).toBe('svg');
    expect(renderedMetadata.width).toBe(120);
    expect(renderedMetadata.height).toBe(60);
  });

  it('returns raster bytes unchanged', async () => {
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 12, g: 34, b: 56, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    mockedAxios.get.mockResolvedValueOnce({
      data: png,
      headers: { 'content-type': 'image/png' },
    });

    const result = await fetchImage('https://example.com/preview.png', { allowSvg: true });

    expect(result).toEqual(png);
  });
});
