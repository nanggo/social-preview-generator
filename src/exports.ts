export {
  PreviewOptions,
  PreviewMetadataInput,
  ExtractedMetadata,
  GeneratedPreview,
  TemplateConfig,
  FontConfig,
  SetupFontsOptions,
  ErrorType,
  PreviewGeneratorError,
} from './types';

export { setupFonts } from './core/font-setup';

export { startCacheCleanup, stopCacheCleanup, isCacheCleanupRunning } from './utils/cache';

export { getInflightRequestStats, clearInflightRequests } from './core/metadata-extractor';

export { getCacheStats, clearAllCaches, shutdownSharpCaches } from './utils/sharp-cache';
