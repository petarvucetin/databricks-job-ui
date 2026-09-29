import { describe, expect, it } from 'vitest';
import { apiErrorParts } from './apiError';

describe('apiErrorParts', () => {
  it('keeps a plain message', () => {
    expect(apiErrorParts(new Error('boom')).message).toBe('boom');
  });

  it('appends the network cause behind "fetch failed"', () => {
    const tls = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    const e = Object.assign(new Error('fetch failed'), { cause: tls });
    expect(apiErrorParts(e).message).toBe('fetch failed (cause: self-signed certificate in certificate chain [SELF_SIGNED_CERT_IN_CHAIN])');
  });

  it('follows nested causes and skips a code already in the message', () => {
    const inner = Object.assign(new Error('getaddrinfo ENOTFOUND adb-1.azuredatabricks.net'), { code: 'ENOTFOUND' });
    const e = Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('connect failed'), { cause: inner }) });
    expect(apiErrorParts(e).message).toBe('fetch failed (cause: connect failed <- getaddrinfo ENOTFOUND adb-1.azuredatabricks.net)');
  });
});
