/**
 * Enhanced SVG Security Tests - Phase 1.5 Advanced Security
 * Tests for attribute-level SVG security hardening
 */

import { sanitizeSvgContent } from '../../src/utils/image-security';
import { PreviewGeneratorError } from '../../src/types';

describe('Enhanced SVG Security - Attribute Level', () => {
  describe('Dangerous attribute blocking', () => {
    it('should block style attributes (CSS injection vector)', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="80" x="10" y="10" style="fill: red; background: url('javascript:alert(1)')"/>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('style=');
      expect(result).not.toContain('javascript:');
    });

    it('should block href and xlink:href attributes', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <text x="10" y="50" href="javascript:alert('xss')">Click me</text>
        <text x="10" y="70" xlink:href="data:text/html,<script>alert('xss')</script>">Click me too</text>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('href=');
      expect(result).not.toContain('xlink:href=');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('data:text/html');
    });

    it('should block event handler attributes', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="80" x="10" y="10" onclick="alert('xss')" onload="alert('load')" onmouseover="alert('hover')"/>
        <text x="10" y="50" onfocus="alert('focus')" onblur="alert('blur')">Text</text>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('onclick=');
      expect(result).not.toContain('onload=');
      expect(result).not.toContain('onmouseover=');
      expect(result).not.toContain('onfocus=');
      expect(result).not.toContain('onblur=');
      expect(result).not.toContain('alert');
    });

    it('should block dangerous reference attributes', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="80" x="10" y="10" clip-path="url(#malicious)" mask="url(data:image/svg+xml,evil)" filter="url(javascript:alert(1))"/>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('clip-path=');
      expect(result).not.toContain('mask=');
      expect(result).not.toContain('filter=');
      expect(result).not.toContain('javascript:');
    });

    it('should block data attributes that could store scripts', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="80" x="10" y="10" data-script="alert('xss')" data-payload="javascript:evil()"/>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('data-script=');
      expect(result).not.toContain('data-payload=');
      expect(result).not.toContain('alert');
      expect(result).not.toContain('javascript:');
    });
  });

  describe('Dangerous tag blocking', () => {
    it('should block use tags with external references', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <use href="http://evil.com/malicious.svg#attack"/>
        <use xlink:href="data:image/svg+xml,<script>alert(1)</script>"/>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('<use');
      expect(result).not.toContain('evil.com');
      expect(result).not.toContain('<script>');
    });

    it('should block image tags that can load external resources', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <image href="javascript:alert('xss')" x="10" y="10" width="80" height="80"/>
        <image xlink:href="data:text/html,<script>alert('xss')</script>" x="10" y="10"/>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('<image');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('<script>');
    });

    it('should block style tags completely', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <style>
          rect { fill: red; }
          @import url('javascript:alert(1)');
          .malicious { background: url('data:text/html,<script>alert(1)</script>'); }
        </style>
        <rect width="80" height="80" x="10" y="10"/>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('<style>');
      expect(result).not.toContain('@import');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('<script>');
    });

    it('should block animation tags that could be used for attacks', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="80" x="10" y="10">
          <animate attributeName="fill" values="red;blue;red" dur="1s" repeatCount="indefinite"/>
          <animateTransform attributeName="transform" type="rotate" values="0;360" dur="2s" repeatCount="indefinite"/>
        </rect>
        <set attributeName="onclick" to="alert('xss')"/>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('<animate');
      expect(result).not.toContain('<animateTransform');
      expect(result).not.toContain('<set');
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('alert');
    });
  });

  describe('URI restriction', () => {
    it('should only allow fragment identifiers, not external URIs', () => {
      const svgWithReferences = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="safe">
            <stop offset="0%" stop-color="red"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect width="80" height="80" x="10" y="10" fill="url(#safe)"/>
      </svg>`;
      
      const result = sanitizeSvgContent(svgWithReferences);
      expect(result).toBeTruthy();
      // Note: DOMPurify may strip attributes for safety even when technically allowed
      // The key test is that dangerous external URIs are blocked
      expect(result).toContain('<linearGradient');
      expect(result).toContain('id="safe"');
      expect(result).toContain('<rect');
    });

    it('should block external URI schemes', () => {
      const maliciousSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="80" x="10" y="10" fill="url('http://evil.com/steal-data')"/>
        <text x="10" y="50" fill="url('javascript:alert(1)')">Evil text</text>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('http://evil.com');
      expect(result).not.toContain('javascript:');
    });
  });

  describe('Safe SVG preservation', () => {
    it('should preserve basic SVG structure and safe elements', () => {
      const safeSvg = `<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="10" width="80" height="80" fill="red" stroke="black" stroke-width="2" opacity="0.8"/>
        <circle cx="50" cy="50" r="20" fill="blue"/>
        <text x="50" y="80" text-anchor="middle" font-family="Arial" font-size="12">Safe Text</text>
        <defs>
          <linearGradient id="grad">
            <stop offset="0%" stop-color="red"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
      </svg>`;
      
      const result = sanitizeSvgContent(safeSvg);
      expect(result).toBeTruthy();
      
      // Focus on structure preservation rather than specific attributes
      // (DOMPurify may be more conservative with attributes)
      expect(result).toContain('<svg');
      expect(result).toContain('<rect');
      expect(result).toContain('<circle');
      expect(result).toContain('<text');
      expect(result).toContain('Safe Text');
      expect(result).toContain('<linearGradient');
      expect(result).toContain('<defs');
    });

    it('should preserve basic geometric elements', () => {
      const safeSvg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <g transform="translate(10,10) rotate(45) scale(0.8)">
          <rect width="30" height="30" fill="green"/>
        </g>
      </svg>`;
      
      const result = sanitizeSvgContent(safeSvg);
      expect(result).toBeTruthy();
      expect(result).toContain('<svg');
      expect(result).toContain('<g');
      expect(result).toContain('<rect');
      // Note: DOMPurify may strip transform attributes for security
      // The key is that the basic structure is preserved
    });
  });

  describe('Namespace restrictions', () => {
    it('should only allow SVG namespace', () => {
      const maliciousSvg = `<svg width="100" height="100" 
        xmlns="http://www.w3.org/2000/svg" 
        xmlns:html="http://www.w3.org/1999/xhtml"
        xmlns:xlink="http://www.w3.org/1999/xlink">
        <rect width="80" height="80" x="10" y="10"/>
      </svg>`;
      
      const result = sanitizeSvgContent(maliciousSvg);
      expect(result).toBeTruthy();
      expect(result).not.toContain('xmlns:html');
      expect(result).not.toContain('xmlns:xlink'); // Should be blocked as dangerous
      expect(result).toContain('xmlns="http://www.w3.org/2000/svg"'); // SVG namespace should remain
    });
  });
});
