// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRuns } from './useRuns';

afterEach(() => vi.unstubAllGlobals());

describe('useRuns', () => {
  it('loads runs', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ asOf: 5, source: 'mock', runs: [] }), { status: 200 }))));
    const { result } = renderHook(() => useRuns());
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    if (result.current.state === 'ready') expect(result.current.data.asOf).toBe(5);
  });

  it('reports an error and retries', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ asOf: 1, source: 'mock', runs: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.state).toBe('error'));
    if (result.current.state === 'error') {
      expect(result.current.message).toBe('Could not load runs: Failed to fetch');
      const retry = result.current.retry;
      act(() => retry());
    }
    await waitFor(() => expect(result.current.state).toBe('ready'));
  });

  it('treats a non-200 answer as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"error":"boom"}', { status: 500 }))));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.state).toBe('error'));
    if (result.current.state === 'error') expect(result.current.message).toBe('Could not load runs: HTTP 500: boom');
  });

  it('falls back to the status when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('Bad Gateway', { status: 502 }))));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.state).toBe('error'));
    if (result.current.state === 'error') expect(result.current.message).toBe('Could not load runs: HTTP 502');
  });

  describe('auto refresh', () => {
    const ok = (asOf: number) => new Response(JSON.stringify({ asOf, source: 'live', runs: [] }), { status: 200 });
    afterEach(() => {
      vi.useRealTimers();
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    });

    it('refreshes on the interval and keeps the page ready meanwhile', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchMock = vi.fn().mockResolvedValueOnce(ok(1)).mockResolvedValueOnce(ok(2));
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHook(() => useRuns(30_000));
      await waitFor(() => expect(result.current.state).toBe('ready'));
      await act(() => vi.advanceTimersByTimeAsync(31_000));
      await waitFor(() => expect(result.current.state === 'ready' && result.current.data.asOf).toBe(2));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps the last good data when a refresh fails, and waits a full interval before trying again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchMock = vi.fn().mockResolvedValueOnce(ok(1)).mockResolvedValue(new Response('{"error":"boom"}', { status: 502 }));
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHook(() => useRuns(30_000));
      await waitFor(() => expect(result.current.state).toBe('ready'));
      await act(() => vi.advanceTimersByTimeAsync(31_000));
      await waitFor(() => expect(result.current.state === 'ready' && result.current.refreshError).toBe('Could not load runs: HTTP 502: boom'));
      if (result.current.state === 'ready') expect(result.current.data.asOf).toBe(1);
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not refresh while the tab is hidden, and catches up when it is shown', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchMock = vi.fn().mockResolvedValueOnce(ok(1)).mockResolvedValueOnce(ok(2));
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHook(() => useRuns(30_000));
      await waitFor(() => expect(result.current.state).toBe('ready'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      await act(() => vi.advanceTimersByTimeAsync(90_000));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitFor(() => expect(result.current.state === 'ready' && result.current.data.asOf).toBe(2));
    });

    it('does not refresh when the interval is off', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchMock = vi.fn().mockResolvedValue(ok(1));
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHook(() => useRuns(0));
      await waitFor(() => expect(result.current.state).toBe('ready'));
      await act(() => vi.advanceTimersByTimeAsync(600_000));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('reports a timeout in plain language', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('x', 'TimeoutError'))));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.state).toBe('error'));
    if (result.current.state === 'error') expect(result.current.message).toBe('Could not load runs: request timed out');
  });
});
