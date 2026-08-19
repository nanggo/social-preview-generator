interface SafeErrorDetails {
  name: string;
  code?: string;
  status?: number;
}

const SAFE_ERROR_CODES = new Set([
  'ABORT_ERR',
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_BAD_REQUEST',
  'ERR_BAD_RESPONSE',
  'ERR_CANCELED',
  'ERR_INVALID_IP_ADDRESS',
  'ERR_NETWORK',
]);

function readProperty(value: object, property: PropertyKey): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function getSafeHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

export function getSafeUrlOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function createSafeErrorDetails(error: unknown): SafeErrorDetails | undefined {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return undefined;

  const candidate = error as object;
  const codeValue = readProperty(candidate, 'code');
  const response = readProperty(candidate, 'response');
  const directStatus = getSafeHttpStatus(readProperty(candidate, 'status'));
  const responseStatus = response && (typeof response === 'object' || typeof response === 'function')
    ? getSafeHttpStatus(readProperty(response, 'status'))
    : undefined;
  const code = typeof codeValue === 'string' && SAFE_ERROR_CODES.has(codeValue)
    ? codeValue
    : undefined;
  const status = directStatus ?? responseStatus;

  return {
    name: 'Error',
    ...(code ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}
