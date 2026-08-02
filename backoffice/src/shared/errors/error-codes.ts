// The backoffice's own codes — deliberately not a copy of the platform's list.
// Platform errors reach the operator by pass-through (status + body), so this
// enum only covers what the backoffice itself decides.
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USERNAME_ALREADY_EXISTS: 'USERNAME_ALREADY_EXISTS',
  // Refusals that protect the console from locking everyone out.
  LAST_ADMIN: 'LAST_ADMIN',
  SELF_DELETE: 'SELF_DELETE',
  // The platform's admin API could not be reached at all — distinct from a
  // refusal it returned, which is passed through with its own status.
  PLATFORM_UNAVAILABLE: 'PLATFORM_UNAVAILABLE',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
