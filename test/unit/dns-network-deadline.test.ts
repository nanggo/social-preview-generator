import dns from 'dns';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearInflightRequests,
  extractMetadata,
  fetchImage,
} from '../../src/core/metadata-extractor';
import {
  __testDNSLookupLimiter,
  invalidateDNSCache,
} from '../../src/utils/enhanced-secure-agent';
import {
  __testNetworkRequestLimiter,
  NetworkRequestDeadlineError,
} from '../../src/utils/network-request-control';
import { ErrorType, PreviewGeneratorError } from '../../src/types';

vi.mock('axios');

const mockedAxios = vi.mocked(axios);
const originalDNSLookup = dns.lookup;

type DNSLookupCallback = (
  error: NodeJS.ErrnoException | null,
  addresses: dns.LookupAddress[]
) => void;

function deferNativeDNSLookup() {
  let callback: DNSLookupCallback | undefined;

  (dns.lookup as any) = vi.fn((
    _hostname: string,
    _options: unknown,
    lookupCallback: DNSLookupCallback
  ) => {
    callback = lookupCallback;
  });

  return {
    resolve() {
      if (!callback) {
        throw new Error('Native DNS lookup did not start');
      }
      const pendingCallback = callback;
      callback = undefined;
      pendingCallback(null, [{ address: '8.8.8.8', family: 4 }]);
    },
    rejectForCleanup() {
      if (!callback) {
        return;
      }
      const pendingCallback = callback;
      callback = undefined;
      const error = new Error('test cleanup') as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      pendingCallback(error, []);
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  await Promise.resolve();
}

describe('DNS preflight network deadline composition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    invalidateDNSCache();
    clearInflightRequests();
    __testNetworkRequestLimiter!.reset();
  });

  afterEach(() => {
    dns.lookup = originalDNSLookup;
    invalidateDNSCache();
    clearInflightRequests();
    __testNetworkRequestLimiter!.reset();
    vi.useRealTimers();
  });

  it('bounds HTML DNS preflight with the same total deadline and performs no Axios I/O', async () => {
    const deferredDNS = deferNativeDNSLookup();

    try {
      const request = extractMetadata('https://pending-html-dns.example', { timeout: 50 });
      const capturedError = request.then(
        () => undefined,
        error => error as PreviewGeneratorError
      );

      await flushAsyncWork();
      expect(dns.lookup).toHaveBeenCalledOnce();
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(__testNetworkRequestLimiter!.getStats()).toMatchObject({ active: 1, queued: 0 });
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 1, queued: 0 });

      await vi.advanceTimersByTimeAsync(50);
      const error = await capturedError;

      expect(error).toMatchObject({
        type: ErrorType.FETCH_ERROR,
        message: expect.stringContaining('Network request deadline exceeded after 50ms'),
        details: expect.any(NetworkRequestDeadlineError),
      });
      expect(error?.type).not.toBe(ErrorType.VALIDATION_ERROR);
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(__testNetworkRequestLimiter!.getStats()).toMatchObject({ active: 0, queued: 0 });
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 1, queued: 0 });

      deferredDNS.resolve();
      await flushAsyncWork();
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 0, queued: 0 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      deferredDNS.rejectForCleanup();
    }
  });

  it('bounds image DNS preflight with the same total deadline and performs no Axios I/O', async () => {
    const deferredDNS = deferNativeDNSLookup();

    try {
      const request = fetchImage('https://pending-image-dns.example/image.jpg', {
        timeout: 50,
      });
      const capturedError = request.then(
        () => undefined,
        error => error as PreviewGeneratorError
      );

      await flushAsyncWork();
      expect(dns.lookup).toHaveBeenCalledOnce();
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(__testNetworkRequestLimiter!.getStats()).toMatchObject({ active: 1, queued: 0 });
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 1, queued: 0 });

      await vi.advanceTimersByTimeAsync(50);
      const error = await capturedError;

      expect(error).toMatchObject({
        type: ErrorType.IMAGE_ERROR,
        message: expect.stringContaining('Network request deadline exceeded after 50ms'),
        details: expect.any(NetworkRequestDeadlineError),
      });
      expect(error?.type).not.toBe(ErrorType.VALIDATION_ERROR);
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(__testNetworkRequestLimiter!.getStats()).toMatchObject({ active: 0, queued: 0 });
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 1, queued: 0 });

      deferredDNS.resolve();
      await flushAsyncWork();
      expect(__testDNSLookupLimiter!.getStats()).toMatchObject({ active: 0, queued: 0 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      deferredDNS.rejectForCleanup();
    }
  });
});
