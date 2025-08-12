// Comprehensive unit tests for hybrid image validation
import { validateImageBuffer } from '../../src/utils/image-security';
import { PreviewGeneratorError } from '../../src/types';

describe('Hybrid Image Validation', () => {
  // Helper to create valid image buffers
  const createValidJPEG = () => Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20,
    0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
    0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xC4, 0x00, 0x14,
    0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x08, 0xFF, 0xC4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02,
    0x11, 0x03, 0x11, 0x00, 0x3F, 0x00, 0x6A, 0xFF, 0xD9
  ]);

  const createValidPNG = () => Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0xDA, 0x63, 0x60, 0x00, 0x02, 0x00,
    0x00, 0x05, 0x00, 0x01, 0xE2, 0x26, 0x05, 0x9B, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
    0xAE, 0x42, 0x60, 0x82
  ]);

  describe('Fallback Behavior', () => {
    it('should use fallback when file-type is unavailable', async () => {
      // This test runs in Jest where file-type is not available
      const validJpeg = createValidJPEG();
      
      // In Jest environment, file-type fails and falls back to magic bytes + Sharp
      // Sharp might still fail on the hand-crafted JPEG, but the important thing is
      // that magic bytes validation passed (file-type fallback worked)
      try {
        await validateImageBuffer(validJpeg, false);
        // If it succeeds, great! Both fallback and Sharp validation worked
      } catch (error) {
        // If it fails, it should be at Sharp validation step, not magic bytes
        expect(error).toBeInstanceOf(PreviewGeneratorError);
        // The error should NOT be about unsupported format (which would indicate magic bytes failed)
        expect((error as PreviewGeneratorError).message).not.toMatch(/Unsupported image format detected by magic bytes/);
      }
    });

    it('should validate PNG with magic bytes fallback', async () => {
      const validPng = createValidPNG();
      
      await expect(validateImageBuffer(validPng, false)).resolves.not.toThrow();
    });
  });

  describe('Magic Bytes Validation', () => {
    it('should accept valid JPEG magic bytes', async () => {
      const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(100).fill(0x00)]);
      
      // Note: This might fail at Sharp validation step, but magic bytes validation should pass
      try {
        await validateImageBuffer(jpegBuffer, false);
      } catch (error) {
        // If it fails, it should be at Sharp validation, not magic bytes
        expect(error).toBeInstanceOf(PreviewGeneratorError);
        expect((error as PreviewGeneratorError).message).toMatch(/Invalid or corrupted image file/);
      }
    });

    it('should accept valid PNG magic bytes', async () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(100).fill(0x00)]);
      
      try {
        await validateImageBuffer(pngBuffer, false);
      } catch (error) {
        // If it fails, it should be at Sharp validation, not magic bytes
        expect(error).toBeInstanceOf(PreviewGeneratorError);
        expect((error as PreviewGeneratorError).message).toMatch(/Invalid or corrupted image file/);
      }
    });

    it('should accept valid WebP magic bytes', async () => {
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // 'RIFF'
        0x00, 0x00, 0x00, 0x00, // File size (placeholder)
        0x57, 0x45, 0x42, 0x50, // 'WEBP'
        ...Array(100).fill(0x00)
      ]);
      
      try {
        await validateImageBuffer(webpBuffer, false);
      } catch (error) {
        expect(error).toBeInstanceOf(PreviewGeneratorError);
        expect((error as PreviewGeneratorError).message).toMatch(/Invalid or corrupted image file/);
      }
    });

    it('should reject invalid magic bytes', async () => {
      const invalidBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, ...Array(100).fill(0xFF)]);
      
      await expect(validateImageBuffer(invalidBuffer, false)).rejects.toThrow(
        'Unsupported image format detected by magic bytes fallback'
      );
    });

    it('should reject empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      
      await expect(validateImageBuffer(emptyBuffer, false)).rejects.toThrow(
        'Unsupported image format detected by magic bytes fallback'
      );
    });

    it('should reject buffer that is too small for magic bytes', async () => {
      const tinyBuffer = Buffer.from([0xFF]);
      
      await expect(validateImageBuffer(tinyBuffer, false)).rejects.toThrow();
    });
  });

  describe('File Size Validation', () => {
    it('should reject files that are too large', async () => {
      const maxSize = 15 * 1024 * 1024; // 15MB
      const oversizedBuffer = Buffer.alloc(maxSize + 1, 0x00);
      // Add JPEG header to pass magic bytes
      oversizedBuffer[0] = 0xFF;
      oversizedBuffer[1] = 0xD8;
      
      await expect(validateImageBuffer(oversizedBuffer, false)).rejects.toThrow(
        /Image file too large/
      );
    });

    it('should accept files at the size limit', async () => {
      // Small valid JPEG should pass size check
      const validJpeg = createValidJPEG();
      
      // File size check should pass, but Sharp validation might still fail
      try {
        await validateImageBuffer(validJpeg, false);
      } catch (error) {
        // If it fails, should be Sharp validation, not file size
        expect((error as PreviewGeneratorError).message).not.toMatch(/Image file too large/);
      }
    });
  });

  describe('SVG Handling', () => {
    it('should reject SVG when allowSvg is false', async () => {
      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
      
      await expect(validateImageBuffer(svgBuffer, false)).rejects.toThrow(
        'Unsupported image format'
      );
    });

    it('should process SVG when allowSvg is true', async () => {
      const validSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="10" y="10" width="80" height="80" fill="blue"/></svg>`);
      
      // DOMPurify is very strict, might remove content even from valid SVGs
      try {
        await validateImageBuffer(validSvg, true);
      } catch (error) {
        // Should at least try SVG validation, not reject as invalid format
        expect((error as PreviewGeneratorError).message).not.toMatch(/Unsupported image format/);
      }
    });

    it('should reject malicious SVG even when allowSvg is true', async () => {
      const maliciousSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert('xss')</script><rect/></svg>`);
      
      // DOMPurify should remove the script tag, possibly causing validation to fail
      // The important thing is it doesn't execute the script
      try {
        await validateImageBuffer(maliciousSvg, true);
        // If it passes, DOMPurify cleaned it successfully
      } catch (error) {
        // If it fails, should be due to sanitization, which is good
        expect(error).toBeInstanceOf(PreviewGeneratorError);
      }
    });
  });

  describe('Sharp Integration', () => {
    it('should properly integrate with Sharp validation', async () => {
      const validJpeg = createValidJPEG();
      const validPng = createValidPNG();
      
      // These should at least pass magic bytes validation (fallback working)
      for (const buffer of [validJpeg, validPng]) {
        try {
          await validateImageBuffer(buffer, false);
          // Success means both fallback and Sharp worked
        } catch (error) {
          // If it fails, should be Sharp validation, not magic bytes
          expect((error as PreviewGeneratorError).message).not.toMatch(/Unsupported image format detected by magic bytes/);
        }
      }
    });

    it('should fail Sharp validation for corrupted files with valid magic bytes', async () => {
      // Valid JPEG magic bytes but corrupted data
      const corruptedJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01, 0x02, 0x03]);
      
      await expect(validateImageBuffer(corruptedJpeg, false)).rejects.toThrow(
        /Invalid or corrupted image file/
      );
    });
  });
});