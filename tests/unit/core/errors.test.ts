import { describe, it, expect } from 'vitest';
import {
  AuthRequiredError,
  AuthExpiredError,
  InvalidModelError,
  ProviderDisabledError,
  InvalidBodyError,
  InvalidTokenError,
  BrowserUnavailableError,
  UpstreamRateLimitError,
  UpstreamBlockedError,
  TimeoutError,
  errorToHttpResponse,
} from '../../../src/core/errors.js';

describe('Error classes', () => {
  it('AuthRequiredError maps to 401', () => {
    const err = new AuthRequiredError('claude-web');
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('authentication_error');
    expect(res.body.error.code).toBe('auth_required');
    expect(res.body.error.message).toContain('claude-web');
  });

  it('AuthExpiredError maps to 401', () => {
    const err = new AuthExpiredError('chatgpt-web');
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth_expired');
  });

  it('InvalidModelError maps to 400', () => {
    const err = new InvalidModelError('unknown/model');
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe('invalid_request_error');
    expect(res.body.error.code).toBe('invalid_model');
  });

  it('ProviderDisabledError maps to 404', () => {
    const err = new ProviderDisabledError('kimi-web');
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(404);
    expect(res.body.error.type).toBe('not_found_error');
    expect(res.body.error.code).toBe('provider_disabled');
  });

  it('InvalidBodyError maps to 400', () => {
    const err = new InvalidBodyError('missing model field');
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_body');
  });

  it('InvalidTokenError maps to 403', () => {
    const err = new InvalidTokenError();
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(403);
    expect(res.body.error.type).toBe('permission_error');
    expect(res.body.error.code).toBe('invalid_token');
  });

  it('BrowserUnavailableError maps to 503', () => {
    const err = new BrowserUnavailableError('Chrome not found');
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(503);
    expect(res.body.error.type).toBe('server_error');
    expect(res.body.error.code).toBe('browser_unavailable');
  });

  it('UpstreamRateLimitError maps to 429', () => {
    const err = new UpstreamRateLimitError('claude-web');
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(429);
    expect(res.body.error.type).toBe('rate_limit_error');
  });

  it('UpstreamBlockedError maps to 502', () => {
    const err = new UpstreamBlockedError('claude-web');
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('upstream_blocked');
  });

  it('TimeoutError maps to 504', () => {
    const err = new TimeoutError(30000);
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('timeout');
  });

  it('Unknown error maps to 500', () => {
    const err = new Error('unexpected');
    const res = errorToHttpResponse(err);
    expect(res.status).toBe(500);
    expect(res.body.error.type).toBe('server_error');
    expect(res.body.error.code).toBe('internal_error');
  });

  it('error response has correct OpenAI shape', () => {
    const err = new AuthRequiredError('test');
    const res = errorToHttpResponse(err);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('message');
    expect(res.body.error).toHaveProperty('type');
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('param', null);
  });
});
