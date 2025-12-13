export {
  PreviewOptions,
  ExtractedMetadata,
  GeneratedPreview,
  TemplateConfig,
  ErrorType,
  PreviewGeneratorError,
} from './types';

export { startCacheCleanup, stopCacheCleanup, isCacheCleanupRunning } from './utils/cache';

export { getInflightRequestStats, clearInflightRequests } from './core/metadata-extractor';

export { getCacheStats, clearAllCaches, shutdownSharpCaches } from './utils/sharp-cache';

