export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AuthRequiredError extends BridgeError {
  constructor(public readonly providerId: string) {
    super(`${providerId} not authenticated. Open Dashboard to login.`);
  }
}

export class AuthExpiredError extends BridgeError {
  constructor(public readonly providerId: string) {
    super(`${providerId} authentication expired. Open Dashboard to re-login.`);
  }
}

export class InvalidModelError extends BridgeError {
  constructor(public readonly modelId: string) {
    super(`Invalid model: "${modelId}". Format: {provider}/{model}`);
  }
}

export class ProviderDisabledError extends BridgeError {
  constructor(public readonly providerId: string) {
    super(`Provider "${providerId}" is not enabled.`);
  }
}

export class InvalidBodyError extends BridgeError {
  constructor(detail: string) {
    super(`Invalid request body: ${detail}`);
  }
}

export class InvalidTokenError extends BridgeError {
  constructor() {
    super('Invalid or missing Bearer token.');
  }
}

export class BrowserUnavailableError extends BridgeError {
  constructor(detail: string) {
    super(`Browser unavailable: ${detail}`);
  }
}

export class UpstreamRateLimitError extends BridgeError {
  constructor(public readonly providerId: string) {
    super(`${providerId} rate limited by upstream.`);
  }
}

export class UpstreamBlockedError extends BridgeError {
  constructor(public readonly providerId: string) {
    super(`${providerId} blocked by upstream (Cloudflare or similar).`);
  }
}

export class TimeoutError extends BridgeError {
  constructor(public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms.`);
  }
}

interface ErrorResponse {
  status: number;
  body: {
    error: {
      message: string;
      type: string;
      code: string;
      param: null;
    };
  };
}

export function errorToHttpResponse(err: Error): ErrorResponse {
  const base = { param: null as null, message: err.message };

  if (err instanceof AuthRequiredError) {
    return { status: 401, body: { error: { ...base, type: 'authentication_error', code: 'auth_required' } } };
  }
  if (err instanceof AuthExpiredError) {
    return { status: 401, body: { error: { ...base, type: 'authentication_error', code: 'auth_expired' } } };
  }
  if (err instanceof InvalidModelError) {
    return { status: 400, body: { error: { ...base, type: 'invalid_request_error', code: 'invalid_model' } } };
  }
  if (err instanceof ProviderDisabledError) {
    return { status: 404, body: { error: { ...base, type: 'not_found_error', code: 'provider_disabled' } } };
  }
  if (err instanceof InvalidBodyError) {
    return { status: 400, body: { error: { ...base, type: 'invalid_request_error', code: 'invalid_body' } } };
  }
  if (err instanceof InvalidTokenError) {
    return { status: 403, body: { error: { ...base, type: 'permission_error', code: 'invalid_token' } } };
  }
  if (err instanceof BrowserUnavailableError) {
    return { status: 503, body: { error: { ...base, type: 'server_error', code: 'browser_unavailable' } } };
  }
  if (err instanceof UpstreamRateLimitError) {
    return { status: 429, body: { error: { ...base, type: 'rate_limit_error', code: 'upstream_rate_limit' } } };
  }
  if (err instanceof UpstreamBlockedError) {
    return { status: 502, body: { error: { ...base, type: 'server_error', code: 'upstream_blocked' } } };
  }
  if (err instanceof TimeoutError) {
    return { status: 504, body: { error: { ...base, type: 'server_error', code: 'timeout' } } };
  }

  return { status: 500, body: { error: { ...base, type: 'server_error', code: 'internal_error' } } };
}
