// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createErrorReporter } from './reportError';

afterEach(() => vi.unstubAllGlobals());

describe('client error reporter', () => {
  it('posts message, stack, url, user agent and time', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    const report = createErrorReporter(20);
    const err = new Error('boom');
    report(err);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/diag/client-error');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body).toMatchObject({ message: 'Error: boom', url: window.location.href, userAgent: navigator.userAgent });
    expect(body.stack).toContain('boom');
    expect(Date.parse(body.at)).not.toBeNaN();
  });

  it('sends at most N per page load and never throws', () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const report = createErrorReporter(3);
    for (let i = 0; i < 10; i++) report(`e${i}`);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
