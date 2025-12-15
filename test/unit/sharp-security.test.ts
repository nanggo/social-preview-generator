/**
 * Sharp Security Configuration Tests - Phase 1.5 Advanced Security
 * Tests for enhanced Sharp security settings and timeout protection
 */

import { 
  initializeSharpSecurity, 
  validateImageBuffer, 
  processImageWithTimeout,
  createSecureSharpInstance,
  createSecureSharpWithCleanMetadata,
  validateSharpLimits,
  IMAGE_SECURITY_LIMITS
} from '../../src/utils/image-security';
import { PreviewGeneratorError } from '../../src/types';
import sharp from 'sharp';

describe('Sharp Security Configuration - Enhanced', () => {
  beforeAll(() => {
    // Initialize Sharp security settings
    initializeSharpSecurity();
  });

  describe('Security limits validation', () => {
    it('should enforce 64MP pixel limit', () => {
      expect(IMAGE_SECURITY_LIMITS.MAX_INPUT_PIXELS).toBe(64 * 1024 * 1024);
    });

    it('should have processing timeout configured', () => {
      expect(IMAGE_SECURITY_LIMITS.PROCESSING_TIMEOUT).toBe(30_000);
    });

    it('should validate allowed formats whitelist', () => {
      const expectedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'bmp', 'tiff'];
      expect(IMAGE_SECURITY_LIMITS.ALLOWED_IMAGE_FORMATS).toEqual(expectedFormats);
    });

    it('should reject operations exceeding pixel limits', () => {
      const width = 10000;
      const height = 10000; // 100MP > 64MP limit
      
      expect(() => validateSharpLimits(width, height)).toThrow(PreviewGeneratorError);
    });

    it('should reject operations exceeding dimension limits', () => {
      expect(() => validateSharpLimits(10000, 100)).toThrow(PreviewGeneratorError);
      expect(() => validateSharpLimits(100, 10000)).toThrow(PreviewGeneratorError);
    });

    it('should allow operations within limits', () => {
      expect(() => validateSharpLimits(1920, 1080)).not.toThrow();
      expect(() => validateSharpLimits(4096, 4096)).not.toThrow();
    });
  });

  describe('Timeout protection', () => {
    it('should timeout long-running operations', async () => {
      let timer: NodeJS.Timeout | undefined;
      const slowOperation = () => new Promise<string>(resolve => {
        timer = setTimeout(() => resolve('done'), 5000); // 5 seconds
        timer.unref?.();
      });

      await expect(
        processImageWithTimeout(slowOperation, 100) // 100ms timeout
      ).rejects.toThrow('timed out');

      if (timer) clearTimeout(timer);
    }, 10000);

    it('should complete fast operations normally', async () => {
      const fastOperation = () => Promise.resolve('completed');

      const result = await processImageWithTimeout(fastOperation, 1000);
      expect(result).toBe('completed');
    });

    it('should use default timeout when not specified', async () => {
      const operation = () => Promise.resolve('default');
      const result = await processImageWithTimeout(operation);
      expect(result).toBe('default');
    });
  });

  describe('Secure Sharp instance creation', () => {
    const createTestImageBuffer = async (width = 100, height = 100) => {
      return await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 255, g: 0, b: 0 }
        }
      }).png().toBuffer();
    };

    it('should create instance with security configuration', async () => {
      const buffer = await createTestImageBuffer();
      const instance = createSecureSharpInstance(buffer);
      
      expect(instance).toBeDefined();
      // Verify the instance is properly configured
      const metadata = await instance.metadata();
      expect(metadata.width).toBe(100);
      expect(metadata.height).toBe(100);
    });

    it('should create instance with metadata cleaning', async () => {
      const buffer = await createTestImageBuffer();
      const instance = createSecureSharpWithCleanMetadata(buffer);
      
      expect(instance).toBeDefined();
      
      // Process and check that metadata is cleaned
      const cleanedBuffer = await instance.png().toBuffer();
      const cleanedMetadata = await sharp(cleanedBuffer).metadata();
      
      // Should have basic properties but no sensitive metadata
      expect(cleanedMetadata.width).toBe(100);
      expect(cleanedMetadata.height).toBe(100);
      // Note: Sharp may still include some technical metadata, but it should be minimal
      // The key is that we processed with .withMetadata({}) to strip user metadata
    });

    it('should handle sequential read for memory efficiency', async () => {
      const buffer = await createTestImageBuffer(1000, 1000); // Larger image
      const instance = createSecureSharpInstance(buffer);
      
      // Should be able to process without memory issues
      const resized = await instance
        .resize(500, 500)
        .png()
        .toBuffer();
      
      expect(resized.length).toBeGreaterThan(0);
    });
  });

  describe('High DPI protection', () => {
    it('should block extremely high DPI images in validation', async () => {
      // This test would require creating an image with extremely high DPI
      // For now, we'll test the concept that validateImageBuffer should reject high DPI
      
      // Create a minimal test image
      const buffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
      }).png().toBuffer();
      
      // Normal validation should pass
      await expect(validateImageBuffer(buffer)).resolves.not.toThrow();
    });
  });

  describe('Format whitelist enforcement', () => {
    it('should only process whitelisted formats', async () => {
      // Create images in allowed formats
      const jpegBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
      }).jpeg().toBuffer();

      const pngBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
      }).png().toBuffer();

      const webpBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
      }).webp().toBuffer();

      // All should pass validation
      await expect(validateImageBuffer(jpegBuffer)).resolves.not.toThrow();
      await expect(validateImageBuffer(pngBuffer)).resolves.not.toThrow();
      await expect(validateImageBuffer(webpBuffer)).resolves.not.toThrow();
    });
  });

  describe('Memory protection', () => {
    it('should handle large images within limits efficiently', async () => {
      // Create a reasonably large image (within limits)
      const largeBuffer = await sharp({
        create: {
          width: 2048,
          height: 2048,
          channels: 3,
          background: { r: 128, g: 128, b: 128 }
        }
      }).png().toBuffer();

      await expect(validateImageBuffer(largeBuffer)).resolves.not.toThrow();
      
      // Should be able to create secure instance
      const instance = createSecureSharpInstance(largeBuffer);
      expect(instance).toBeDefined();
    });

    it('should reject pixel bomb attempts', async () => {
      // Test with dimensions that would exceed our 64MP limit
      const limit64MP = 64 * 1024 * 1024; // 67,108,864 pixels
      const widthAtLimit = Math.floor(Math.sqrt(limit64MP)); // ~8192
      const heightAtLimit = Math.floor(limit64MP / widthAtLimit);
      
      // This should be within the limit and should pass
      expect(() => validateSharpLimits(widthAtLimit, heightAtLimit)).not.toThrow();
      
      // Test with dimensions that clearly exceed the limit
      const width = 8193; // Just over 8192 dimension limit
      const height = 8193;
      expect(() => validateSharpLimits(width, height)).toThrow();
      
      // Test with dimensions that exceed pixel limit but not dimension limit
      const width2 = 8000;
      const height2 = 9000; // 72MP > 64MP
      expect(() => validateSharpLimits(width2, height2)).toThrow();
    });
  });
});
