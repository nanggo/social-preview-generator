import { ErrorType, PreviewGeneratorError } from '../types';

interface SecurityPolicyErrorDetails {
  securityPolicyViolation: true;
  cause?: unknown;
}

export function createSecurityPolicyError(
  message: string,
  cause?: unknown
): PreviewGeneratorError {
  return new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, message, {
    securityPolicyViolation: true,
    cause,
  } satisfies SecurityPolicyErrorDetails);
}

export function isSecurityPolicyError(error: unknown): error is PreviewGeneratorError {
  if (
    !(error instanceof PreviewGeneratorError) ||
    error.type !== ErrorType.VALIDATION_ERROR ||
    !error.details ||
    typeof error.details !== 'object'
  ) {
    return false;
  }

  return (
    (error.details as Partial<SecurityPolicyErrorDetails>).securityPolicyViolation === true
  );
}
