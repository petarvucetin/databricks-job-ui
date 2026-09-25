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
    if (result.current.state === 'error') expect(result.current.message).toBe('Could not load runs: HTTP 500');
  });
});
